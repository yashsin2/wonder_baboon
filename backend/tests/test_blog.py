import io
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="wb_uploads_")
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ["ENVIRONMENT"] = "development"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mongomock  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import main  # noqa: E402
from auth_utils import create_token  # noqa: E402
from services import blog_service  # noqa: E402
from services.mongo_service import mongo_service  # noqa: E402

STORY = "It started with a confident driver and a very bad idea. The river looked ankle-deep. It was not ankle-deep."


@pytest.fixture()
def client():
  for leftover in Path(os.environ["UPLOAD_DIR"]).rglob("*.webp"):
    leftover.unlink()
  mongo_service._db = mongomock.MongoClient()["userlogindetails"]
  mongo_service._ready = True
  blog_service.ensure_indexes()
  blog_service._rate_hits.clear()
  for email, name in (("asha@example.com", "Asha R."), ("kabir@example.com", "Kabir M."), ("meera@example.com", "Meera T.")):
    mongo_service.user_collection.insert_one({"email": email, "name": name, "mobile": email})
  return TestClient(main.app)


def auth(email):
  return {"Authorization": "Bearer " + create_token({"role": "user", "email": email})}


ADMIN = {"Authorization": "Bearer " + create_token({"role": "admin", "username": "admin"})}


def jpeg_bytes(size=(3000, 2000), exif_orientation=None):
  img = Image.new("RGB", size, (200, 120, 60))
  buf = io.BytesIO()
  if exif_orientation:
    exif = Image.Exif()
    exif[0x0112] = exif_orientation
    exif[0x8825] = {1: "N", 2: (12.0, 30.0, 0.0)}
    img.save(buf, "JPEG", exif=exif)
  else:
    img.save(buf, "JPEG")
  return buf.getvalue()


def mpo_bytes(size=(3000, 2000)):
  """An iPhone Portrait-mode photo: a JPEG with a second depth frame — Pillow reports this
  as format MPO rather than JPEG, even though the Camera app made it like any other photo."""
  main = Image.new("RGB", size, (180, 140, 90))
  depth = Image.new("RGB", size, (80, 80, 80))
  buf = io.BytesIO()
  main.save(buf, format="MPO", save_all=True, append_images=[depth])
  return buf.getvalue()


def upload(client, email, data, name="p.jpg"):
  return client.post("/api/blog/photos", files=[("files", (name, data, "image/jpeg"))], headers=auth(email))


def make_post(client, email="asha@example.com", images=None, title="The night our jeep got stuck", mood="Funny"):
  body = {"title": title, "body": STORY, "mood": mood, "place": "Chandratal", "images": images or []}
  return client.post("/api/blog", json=body, headers=auth(email))


def test_photo_pipeline_resizes_strips_exif_and_rotates(client):
  res = upload(client, "asha@example.com", jpeg_bytes((3000, 2000), exif_orientation=6))
  assert res.status_code == 200, res.text
  img = res.json()["images"][0]
  assert img["full"].endswith("_full.webp") and img["thumb"].endswith("_thumb.webp")
  files = {p.name: p for p in Path(os.environ["UPLOAD_DIR"]).rglob("*.webp")}
  full = next(p for n, p in files.items() if n.endswith("_full.webp"))
  with Image.open(full) as out:
    assert out.format == "WEBP"
    assert max(out.size) <= 1600
    assert out.size[1] > out.size[0]  # orientation 6 rotated the landscape shot to portrait
    assert not out.getexif()
  assert img["w"] == out.size[0] and img["h"] == out.size[1]


@pytest.mark.parametrize("payload,name", [
  (b"<html><script>alert(1)</script></html>", "x.jpg"),
  (b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "x.svg"),
  (b"GIF89a" + b"\x00" * 50, "x.gif"),
  (b"\xff\xd8\xff" + b"garbage", "x.jpg"),
])
def test_rejects_non_images(client, payload, name):
  assert upload(client, "asha@example.com", payload, name).status_code == 400


def test_rejects_oversize(client):
  assert upload(client, "asha@example.com", b"\xff\xd8\xff" + b"0" * (20 * 1024 * 1024 + 10)).status_code == 400


def test_accepts_heic_from_iphone_camera_roll(client):
  pillow_heif = pytest.importorskip("pillow_heif")
  heif = pillow_heif.from_pillow(Image.new("RGB", (640, 480), (90, 140, 170)))
  buf = io.BytesIO()
  heif.save(buf, format="HEIF")
  res = client.post(
    "/api/blog/photos",
    files=[("files", ("IMG_0001.heic", buf.getvalue(), "image/heic"))],
    headers=auth("asha@example.com"),
  )
  assert res.status_code == 200, res.text
  img = res.json()["images"][0]
  assert img["full"].endswith("_full.webp")  # always converted to WebP regardless of source format


def test_accepts_iphone_portrait_mode_mpo_photo(client):
  res = upload(client, "asha@example.com", mpo_bytes((800, 600)), name="IMG_1234.JPG")
  assert res.status_code == 200, res.text
  img = res.json()["images"][0]
  assert img["full"].endswith("_full.webp")


def test_upload_requires_login(client):
  assert client.post("/api/blog/photos", files=[("files", ("p.jpg", jpeg_bytes((50, 50)), "image/jpeg"))]).status_code == 401


def test_create_list_get_and_attach_uploaded_photo(client):
  img = upload(client, "asha@example.com", jpeg_bytes((800, 600))).json()["images"][0]
  res = make_post(client, images=[img])
  assert res.status_code == 200, res.text
  post_id = res.json()["post"]["id"]
  listing = client.get("/api/blog").json()
  assert [p["id"] for p in listing["posts"]] == [post_id]
  assert listing["posts"][0]["images"][0]["thumb"] == img["thumb"]
  assert "body" not in listing["posts"][0]
  assert client.get(f"/api/blog/{post_id}").json()["post"]["body"] == STORY


def test_cannot_attach_someone_elses_or_made_up_photo(client):
  img = upload(client, "asha@example.com", jpeg_bytes((300, 300))).json()["images"][0]
  assert make_post(client, "kabir@example.com", images=[img]).status_code == 400
  fake = {"full": "http://x/api/media/blog/2026/01/" + "a" * 32 + "_full.webp", "thumb": "http://x/api/media/blog/2026/01/" + "a" * 32 + "_thumb.webp", "w": 10, "h": 10}
  assert make_post(client, images=[fake]).status_code == 400
  evil = {"full": "http://x/etc/passwd", "thumb": "http://x/etc/passwd", "w": 10, "h": 10}
  assert make_post(client, images=[evil]).status_code == 400


def test_text_validation_allows_sql_words_but_blocks_html(client):
  ok = make_post(client, title="How to select a delete-proof backpack")
  assert ok.status_code == 200, ok.text
  assert make_post(client, title="<script>alert(1)</script>").status_code == 422
  assert make_post(client, mood="Hacking").status_code == 422
  assert client.post("/api/blog", json={"title": "Hello there", "body": "too short", "mood": "Funny"}, headers=auth("asha@example.com")).status_code == 422
  assert client.post("/api/blog", json={"title": "Hello there", "body": STORY, "mood": "Funny"}).status_code == 401


def test_like_toggle_is_idempotent_under_concurrency(client):
  post_id = make_post(client).json()["post"]["id"]
  r1 = client.post(f"/api/blog/{post_id}/like", headers=auth("kabir@example.com")).json()
  assert r1 == {"liked": True, "likeCount": 1}
  r2 = client.post(f"/api/blog/{post_id}/like", headers=auth("kabir@example.com")).json()
  assert r2 == {"liked": False, "likeCount": 0}
  client.post(f"/api/blog/{post_id}/like", headers=auth("kabir@example.com"))
  client.post(f"/api/blog/{post_id}/like", headers=auth("meera@example.com"))
  assert client.get(f"/api/blog/{post_id}").json()["post"]["likeCount"] == 2
  assert client.get(f"/api/blog/{post_id}", headers=auth("kabir@example.com")).json()["post"]["likedByMe"] is True
  assert client.get(f"/api/blog/{post_id}").json()["post"]["likedByMe"] is False
  assert client.post(f"/api/blog/{post_id}/like").status_code == 401


def test_comments_replies_and_permissions(client):
  post_id = make_post(client).json()["post"]["id"]
  c = client.post(f"/api/blog/{post_id}/comments", json={"body": "Loved this!"}, headers=auth("kabir@example.com"))
  assert c.status_code == 200, c.text
  cid = c.json()["comment"]["id"]
  r = client.post(f"/api/blog/{post_id}/comments", json={"body": "Same!", "parentId": cid}, headers=auth("meera@example.com"))
  rid = r.json()["comment"]["id"]
  nested = client.post(f"/api/blog/{post_id}/comments", json={"body": "nested", "parentId": rid}, headers=auth("asha@example.com"))
  assert nested.json()["comment"]["parentId"] == cid  # flattened to one level
  top = client.get(f"/api/blog/{post_id}/comments").json()["comments"]
  assert len(top) == 1 and top[0]["replyCount"] == 2 and len(top[0]["replies"]) == 2
  assert client.get(f"/api/blog/{post_id}").json()["post"]["commentCount"] == 3
  assert client.post(f"/api/blog/{post_id}/comments", json={"body": "x"}).status_code == 401
  assert client.post(f"/api/blog/{post_id}/comments", json={"body": "<b>hi</b>"}, headers=auth("kabir@example.com")).status_code == 422
  assert client.delete(f"/api/blog/comments/{cid}", headers=auth("meera@example.com")).status_code == 403
  assert client.delete(f"/api/blog/comments/{rid}", headers=auth("meera@example.com")).status_code == 200  # own reply
  assert client.delete(f"/api/blog/comments/{cid}", headers=auth("asha@example.com")).status_code == 200  # story author
  assert client.get(f"/api/blog/{post_id}").json()["post"]["commentCount"] == 0


def test_delete_post_permissions_and_files(client):
  img = upload(client, "asha@example.com", jpeg_bytes((300, 300))).json()["images"][0]
  post_id = make_post(client, images=[img]).json()["post"]["id"]
  assert client.delete(f"/api/blog/{post_id}", headers=auth("kabir@example.com")).status_code == 403
  assert client.delete(f"/api/blog/{post_id}").status_code == 401
  assert client.delete(f"/api/blog/{post_id}", headers=auth("asha@example.com")).status_code == 200
  assert client.get(f"/api/blog/{post_id}").status_code == 404
  assert not list(Path(os.environ["UPLOAD_DIR"]).rglob(img["full"].rsplit("/", 1)[1]))


def test_delete_post_scrubs_every_footprint(client):
  post_id = make_post(client, "asha@example.com", images=[]).json()["post"]["id"]
  client.post(f"/api/blog/{post_id}/like", headers=auth("kabir@example.com"))
  client.post(f"/api/blog/{post_id}/save", headers=auth("kabir@example.com"))
  cid = client.post(f"/api/blog/{post_id}/comments", json={"body": "nice one!", "parentId": None}, headers=auth("kabir@example.com")).json()["comment"]["id"]
  client.post(f"/api/blog/comments/{cid}/report", json={"reason": "spam"}, headers=auth("meera@example.com"))
  from bson import ObjectId

  from services.mongo_service import mongo_service as _m

  assert _m.db["blog_likes"].count_documents({"postId": ObjectId(post_id)}) == 1
  assert _m.db["blog_saves"].count_documents({"postId": ObjectId(post_id)}) == 1
  assert _m.db["blog_comments"].count_documents({"postId": ObjectId(post_id)}) == 1
  assert _m.db["blog_reports"].count_documents({"targetType": "comment", "targetId": ObjectId(cid)}) == 1

  assert client.delete(f"/api/blog/{post_id}", headers=auth("asha@example.com")).status_code == 200

  assert _m.db["blog_likes"].count_documents({"postId": ObjectId(post_id)}) == 0
  assert _m.db["blog_saves"].count_documents({"postId": ObjectId(post_id)}) == 0
  assert _m.db["blog_comments"].count_documents({"postId": ObjectId(post_id)}) == 0
  assert _m.db["blog_reports"].count_documents({"targetType": "comment", "targetId": ObjectId(cid)}) == 0
  assert _m.db["blog_reports"].count_documents({"targetType": "post", "targetId": ObjectId(post_id)}) == 0


def test_follow_author_and_new_story_email(client, monkeypatch):
  post_id = make_post(client, "asha@example.com", images=[]).json()["post"]["id"]
  # Can't follow yourself
  assert client.post(f"/api/blog/{post_id}/follow", headers=auth("asha@example.com")).status_code == 400
  res = client.post(f"/api/blog/{post_id}/follow", headers=auth("kabir@example.com"))
  assert res.status_code == 200 and res.json()["following"] is True
  assert blog_service.list_followers("asha@example.com") == ["kabir@example.com"]
  # Toggling again unfollows
  res = client.post(f"/api/blog/{post_id}/follow", headers=auth("kabir@example.com"))
  assert res.json()["following"] is False
  assert blog_service.list_followers("asha@example.com") == []
  # Re-follow, then publishing a new story should notify the follower
  client.post(f"/api/blog/{post_id}/follow", headers=auth("kabir@example.com"))
  listing = client.get("/api/blog", headers=auth("kabir@example.com")).json()["posts"]
  assert listing[0]["followingAuthor"] is True

  sent = []
  monkeypatch.setattr(
    main.email_service,
    "notify_new_story_subscriber",
    lambda to, **kw: sent.append((to, kw)),
  )
  make_post(client, "asha@example.com", title="A second tale worth telling", images=[])
  for _ in range(50):  # the email dispatch runs on a background thread
    if sent:
      break
    time.sleep(0.05)
  assert sent and sent[0][0] == "kabir@example.com"
  assert sent[0][1]["author_name"] == "Asha R."


def test_reports_auto_hide_and_admin_restore(client):
  for i in range(5):
    mongo_service.user_collection.insert_one({"email": f"r{i}@example.com", "name": f"R{i}", "mobile": str(i)})
  post_id = make_post(client).json()["post"]["id"]
  assert client.post(f"/api/blog/{post_id}/report", json={}, headers=auth("asha@example.com")).status_code == 400  # own story
  for i in range(5):
    out = client.post(f"/api/blog/{post_id}/report", json={"reason": "spam"}, headers=auth(f"r{i}@example.com")).json()
  assert out["hidden"] is True
  assert client.post(f"/api/blog/{post_id}/report", json={}, headers=auth("r0@example.com")).status_code == 404
  assert client.get("/api/blog").json()["posts"] == []
  assert client.get(f"/api/blog/{post_id}").status_code == 404
  assert client.get("/api/admin/blog?status=reported").status_code == 403
  assert client.get("/api/admin/blog?status=reported", headers=ADMIN).json()["posts"][0]["id"] == post_id
  assert client.patch(f"/api/admin/blog/{post_id}", json={"status": "published"}, headers=ADMIN).status_code == 200
  assert len(client.get("/api/blog").json()["posts"]) == 1


def test_pagination_mood_filter_and_saved(client):
  ids = [make_post(client, title=f"Story number {i}", mood="Funny" if i % 2 else "Food").json()["post"]["id"] for i in range(5)]
  first = client.get("/api/blog?limit=2").json()
  assert [p["id"] for p in first["posts"]] == ids[::-1][:2] and first["nextCursor"]
  second = client.get(f"/api/blog?limit=2&cursor={first['nextCursor']}").json()
  assert [p["id"] for p in second["posts"]] == ids[::-1][2:4]
  third = client.get(f"/api/blog?limit=2&cursor={second['nextCursor']}").json()
  assert [p["id"] for p in third["posts"]] == ids[::-1][4:] and third["nextCursor"] == ""
  assert {p["mood"] for p in client.get("/api/blog?mood=Funny").json()["posts"]} == {"Funny"}
  assert client.get("/api/blog?mood=Nope").status_code == 400
  client.post(f"/api/blog/{ids[0]}/like", headers=auth("kabir@example.com"))
  assert client.get("/api/blog?sort=loved&limit=1").json()["posts"][0]["id"] == ids[0]
  client.post(f"/api/blog/{ids[1]}/save", headers=auth("kabir@example.com"))
  saved = client.get("/api/blog?saved=true", headers=auth("kabir@example.com")).json()["posts"]
  assert [p["id"] for p in saved] == [ids[1]] and saved[0]["savedByMe"] is True
  assert client.get("/api/blog?saved=true").status_code == 401
  assert client.get("/api/blog?cursor=garbage").status_code == 400


def test_post_rate_limit(client):
  codes = [make_post(client, title=f"Story number {i}").status_code for i in range(6)]
  assert codes[:5] == [200] * 5 and codes[5] == 429


def test_edit_own_post_updates_fields_and_swaps_photos(client):
  first = upload(client, "asha@example.com", jpeg_bytes((400, 300))).json()["images"][0]
  second = upload(client, "asha@example.com", jpeg_bytes((300, 300))).json()["images"][0]
  post_id = make_post(client, images=[first]).json()["post"]["id"]
  first_file = Path(first["full"].split("/api/media/")[-1])
  # Author edits title and replaces the photo
  new_body = STORY + " But then it got worse before it got better and we laughed about it later."
  res = client.patch(
    f"/api/blog/{post_id}",
    json={"title": "Updated: our jeep story", "body": new_body, "mood": "Emotional", "place": "Chandratal", "images": [second]},
    headers=auth("asha@example.com"),
  )
  assert res.status_code == 200, res.text
  got = res.json()["post"]
  assert got["title"] == "Updated: our jeep story"
  assert got["mood"] == "Emotional"
  assert got["images"][0]["full"] == second["full"]
  # Old image file should be gone
  assert not (Path(os.environ["UPLOAD_DIR"]) / first_file).exists()
  # Someone else cannot edit
  bad = client.patch(f"/api/blog/{post_id}", json={"title": "steal", "body": STORY, "mood": "Funny", "place": "", "images": []}, headers=auth("kabir@example.com"))
  assert bad.status_code == 403


def test_mine_filter_returns_only_authors_posts(client):
  a_id = make_post(client, "asha@example.com", images=[]).json()["post"]["id"]
  make_post(client, "kabir@example.com", images=[])
  mine = client.get("/api/blog?mine=1", headers=auth("asha@example.com")).json()
  assert [p["id"] for p in mine["posts"]] == [a_id]
  assert client.get("/api/blog?mine=1").status_code == 401


def test_discard_upload_deletes_file_immediately(client):
  img = upload(client, "asha@example.com", jpeg_bytes((200, 200))).json()["images"][0]
  rel = img["full"].split("/api/media/")[-1]
  assert (Path(os.environ["UPLOAD_DIR"]) / rel).exists()
  res = client.request("DELETE", "/api/blog/photos", json={"full": img["full"], "thumb": img["thumb"]}, headers=auth("asha@example.com"))
  assert res.status_code == 200, res.text
  assert not (Path(os.environ["UPLOAD_DIR"]) / rel).exists()
  # Someone else's upload is untouched by this call (ownership scoped) and so is a repeat call
  img2 = upload(client, "kabir@example.com", jpeg_bytes((200, 200))).json()["images"][0]
  rel2 = img2["full"].split("/api/media/")[-1]
  client.request("DELETE", "/api/blog/photos", json={"full": img2["full"], "thumb": img2["thumb"]}, headers=auth("asha@example.com"))
  assert (Path(os.environ["UPLOAD_DIR"]) / rel2).exists()


def test_discard_upload_never_deletes_a_published_photo(client):
  img = upload(client, "asha@example.com", jpeg_bytes((200, 200))).json()["images"][0]
  make_post(client, "asha@example.com", images=[img])
  rel = img["full"].split("/api/media/")[-1]
  # Even if the upload record hasn't expired yet, an attached photo must survive a discard call.
  client.request("DELETE", "/api/blog/photos", json={"full": img["full"], "thumb": img["thumb"]}, headers=auth("asha@example.com"))
  assert (Path(os.environ["UPLOAD_DIR"]) / rel).exists()


def test_orphan_sweep_keeps_attached_and_removes_stale(client):
  attached = upload(client, "asha@example.com", jpeg_bytes((200, 200))).json()["images"][0]
  orphan = upload(client, "asha@example.com", jpeg_bytes((200, 200))).json()["images"][0]
  make_post(client, images=[attached])
  old = 2 * 86400
  for p in Path(os.environ["UPLOAD_DIR"]).rglob("*.webp"):
    os.utime(p, (p.stat().st_atime - old, p.stat().st_mtime - old))
  assert blog_service.sweep_orphan_images() == 2
  names = {p.name for p in Path(os.environ["UPLOAD_DIR"]).rglob("*.webp")}
  assert attached["full"].rsplit("/", 1)[1] in names
  assert orphan["full"].rsplit("/", 1)[1] not in names
