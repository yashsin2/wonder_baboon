import logging
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, List, Optional, Tuple

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from models import BLOG_MOODS, BlogCommentRequest, BlogPostRequest
from services import image_service
from services.mongo_service import mongo_service

logger = logging.getLogger(__name__)

AUTO_HIDE_REPORTS = 5
PAGE_SIZE_MAX = 30
IMAGE_URL_RE = re.compile(r"/api/media/blog/\d{4}/\d{2}/([0-9a-f]{32})_(full|thumb)\.webp$")

RATE_LIMITS: Dict[str, Tuple[int, int]] = {
  "post": (5, 3600),
  "comment": (30, 3600),
  "like": (120, 3600),
  "save": (120, 3600),
  "photo": (30, 3600),
  "report": (30, 3600),
  "follow": (60, 3600),
}
_rate_hits: Dict[str, Deque[float]] = defaultdict(deque)
_rate_lock = threading.Lock()


def check_rate(action: str, user: str) -> None:
  limit, window = RATE_LIMITS[action]
  now = time.time()
  key = f"{action}:{user}"
  with _rate_lock:
    hits = _rate_hits[key]
    while hits and hits[0] <= now - window:
      hits.popleft()
    if len(hits) >= limit:
      raise HTTPException(status_code=429, detail="You're doing that too fast. Please try again later.")
    hits.append(now)


def _db():
  return mongo_service.db


def _posts():
  return _db()["blog_posts"]


def _likes():
  return _db()["blog_likes"]


def _saves():
  return _db()["blog_saves"]


def _comments():
  return _db()["blog_comments"]


def _reports():
  return _db()["blog_reports"]


def _uploads():
  return _db()["blog_uploads"]


def _follows():
  return _db()["blog_follows"]


def ensure_indexes() -> None:
  _posts().create_index([("status", ASCENDING), ("createdAt", DESCENDING)])
  _posts().create_index([("status", ASCENDING), ("mood", ASCENDING), ("createdAt", DESCENDING)])
  _posts().create_index([("status", ASCENDING), ("likeCount", DESCENDING), ("createdAt", DESCENDING)])
  _posts().create_index([("authorEmail", ASCENDING), ("createdAt", DESCENDING)])
  _likes().create_index([("postId", ASCENDING), ("userEmail", ASCENDING)], unique=True)
  _likes().create_index([("userEmail", ASCENDING)])
  _saves().create_index([("postId", ASCENDING), ("userEmail", ASCENDING)], unique=True)
  _saves().create_index([("userEmail", ASCENDING), ("createdAt", DESCENDING)])
  _comments().create_index([("postId", ASCENDING), ("parentId", ASCENDING), ("status", ASCENDING), ("createdAt", ASCENDING)])
  _reports().create_index(
    [("targetType", ASCENDING), ("targetId", ASCENDING), ("userEmail", ASCENDING)], unique=True
  )
  _uploads().create_index([("stem", ASCENDING)], unique=True)
  _uploads().create_index([("createdAt", ASCENDING)], expireAfterSeconds=86400)
  _follows().create_index([("authorEmail", ASCENDING), ("subscriberEmail", ASCENDING)], unique=True)
  _follows().create_index([("authorEmail", ASCENDING)])


def _oid(value: str, what: str = "id") -> ObjectId:
  try:
    return ObjectId(value)
  except (InvalidId, TypeError):
    raise HTTPException(status_code=404, detail=f"{what} not found")


def _iso(value: Any) -> str:
  return value.isoformat() + "Z" if isinstance(value, datetime) else ""


def _ms(value: datetime) -> int:
  return int(value.timestamp() * 1000) if value.tzinfo else int((value - datetime(1970, 1, 1)).total_seconds() * 1000)


def _from_ms(ms: int) -> datetime:
  return datetime(1970, 1, 1) + timedelta(milliseconds=ms)


def _author_name(email: str) -> str:
  user = mongo_service.find_user_by_email(email) or {}
  name = str(user.get("name") or "").strip()
  return name or email.split("@")[0]


def _handle(email: str) -> str:
  return "@" + re.sub(r"[^a-z0-9._]", "", email.split("@")[0].lower())[:24]


def serialize_post(
  doc: Dict[str, Any],
  liked: bool = False,
  saved: bool = False,
  viewer: str = "",
  full: bool = False,
  following: bool = False,
) -> Dict[str, Any]:
  images = doc.get("images") or []
  is_mine = bool(viewer) and viewer == doc.get("authorEmail")
  out = {
    "id": str(doc["_id"]),
    "title": doc.get("title", ""),
    "mood": doc.get("mood", ""),
    "place": doc.get("place", ""),
    "authorName": doc.get("authorName", ""),
    "authorHandle": _handle(doc.get("authorEmail", "")),
    "createdAt": _iso(doc.get("createdAt")),
    "likeCount": int(doc.get("likeCount", 0)),
    "commentCount": int(doc.get("commentCount", 0)),
    "likedByMe": liked,
    "savedByMe": saved,
    "mine": is_mine,
    # Never true for your own stories — following yourself makes no sense.
    "followingAuthor": following and not is_mine,
    "status": doc.get("status", "published"),
    "readMinutes": max(1, round(len((doc.get("body") or "").split()) / 200)),
    "images": [
      {"full": i.get("full"), "thumb": i.get("thumb"), "w": i.get("w"), "h": i.get("h"), "caption": i.get("caption", "")}
      for i in images
    ],
  }
  body = doc.get("body", "")
  if full:
    out["body"] = body
  else:
    out["excerpt"] = body if len(body) <= 220 else body[:220].rsplit(" ", 1)[0] + "…"
    out["truncated"] = len(body) > 220
  return out


def _viewer_flags(post_ids: List[ObjectId], viewer: str) -> Tuple[set, set]:
  if not viewer or not post_ids:
    return set(), set()
  liked = {d["postId"] for d in _likes().find({"userEmail": viewer, "postId": {"$in": post_ids}}, {"postId": 1})}
  saved = {d["postId"] for d in _saves().find({"userEmail": viewer, "postId": {"$in": post_ids}}, {"postId": 1})}
  return liked, saved


def _following_authors(author_emails: List[str], viewer: str) -> set:
  if not viewer or not author_emails:
    return set()
  return {
    d["authorEmail"]
    for d in _follows().find({"subscriberEmail": viewer, "authorEmail": {"$in": list(set(author_emails))}}, {"authorEmail": 1})
  }


def list_posts(mood: str, sort: str, cursor: str, limit: int, viewer: str, saved_only: bool = False, mine_only: bool = False) -> Dict[str, Any]:
  limit = max(1, min(limit, PAGE_SIZE_MAX))
  query: Dict[str, Any] = {"status": "published"}
  if mine_only:
    if not viewer:
      raise HTTPException(status_code=401, detail="log in to see your stories")
    # Author sees their own stories regardless of status (except deleted)
    query = {"authorEmail": viewer, "status": {"$ne": "deleted"}}
  if mood and mood != "All":
    if mood not in BLOG_MOODS:
      raise HTTPException(status_code=400, detail="unknown mood")
    query["mood"] = mood
  if saved_only:
    ids = [d["postId"] for d in _saves().find({"userEmail": viewer}, {"postId": 1})]
    query["_id"] = {"$in": ids}

  loved = sort == "loved"
  if cursor:
    try:
      parts = cursor.split(":")
      if loved:
        likes, ms, oid = int(parts[0]), int(parts[1]), ObjectId(parts[2])
        when = _from_ms(ms)
        query["$or"] = [
          {"likeCount": {"$lt": likes}},
          {"likeCount": likes, "createdAt": {"$lt": when}},
          {"likeCount": likes, "createdAt": when, "_id": {"$lt": oid}},
        ]
      else:
        ms, oid = int(parts[0]), ObjectId(parts[1])
        when = _from_ms(ms)
        query["$or"] = [{"createdAt": {"$lt": when}}, {"createdAt": when, "_id": {"$lt": oid}}]
    except (ValueError, IndexError, InvalidId):
      raise HTTPException(status_code=400, detail="bad cursor")

  order = [("likeCount", DESCENDING), ("createdAt", DESCENDING), ("_id", DESCENDING)] if loved else [("createdAt", DESCENDING), ("_id", DESCENDING)]
  docs = list(_posts().find(query).sort(order).limit(limit + 1))
  has_more = len(docs) > limit
  docs = docs[:limit]
  liked, saved = _viewer_flags([d["_id"] for d in docs], viewer)
  following = _following_authors([d.get("authorEmail", "") for d in docs], viewer)
  next_cursor = ""
  if has_more and docs:
    last = docs[-1]
    ms = _ms(last["createdAt"])
    next_cursor = f"{last.get('likeCount', 0)}:{ms}:{last['_id']}" if loved else f"{ms}:{last['_id']}"
  return {
    "posts": [
      serialize_post(d, d["_id"] in liked, d["_id"] in saved, viewer, following=d.get("authorEmail") in following)
      for d in docs
    ],
    "nextCursor": next_cursor,
  }


def _visible_post(post_id: str, is_admin: bool = False) -> Dict[str, Any]:
  doc = _posts().find_one({"_id": _oid(post_id, "story")})
  if not doc or (doc.get("status") != "published" and not is_admin):
    raise HTTPException(status_code=404, detail="story not found")
  return doc


def get_post(post_id: str, viewer: str, is_admin: bool = False) -> Dict[str, Any]:
  doc = _visible_post(post_id, is_admin)
  liked, saved = _viewer_flags([doc["_id"]], viewer)
  following = _following_authors([doc.get("authorEmail", "")], viewer)
  return serialize_post(
    doc, doc["_id"] in liked, doc["_id"] in saved, viewer, full=True, following=doc.get("authorEmail") in following
  )


def toggle_follow_author(post_id: str, subscriber_email: str) -> Dict[str, Any]:
  """Follow/unfollow the author of a story, keyed by author (not by the individual post)."""
  doc = _visible_post(post_id)
  author_email = doc.get("authorEmail", "")
  if author_email == subscriber_email:
    raise HTTPException(status_code=400, detail="you can't follow yourself")
  check_rate("follow", subscriber_email)
  key = {"authorEmail": author_email, "subscriberEmail": subscriber_email}
  try:
    _follows().insert_one({**key, "createdAt": datetime.utcnow()})
    following = True
  except DuplicateKeyError:
    _follows().delete_one(key)
    following = False
  return {"following": following, "authorName": doc.get("authorName", "")}


def list_followers(author_email: str) -> List[str]:
  return [d["subscriberEmail"] for d in _follows().find({"authorEmail": author_email}, {"subscriberEmail": 1})]


def record_upload(email: str, image: Dict[str, Any]) -> None:
  match = IMAGE_URL_RE.search(image["full"])
  if match:
    _uploads().insert_one({"stem": match.group(1), "userEmail": email, "createdAt": datetime.utcnow()})


def discard_upload(email: str, full: str, thumb: str) -> None:
  """Immediately remove a just-uploaded photo the author decided not to use —
  so it doesn't sit on disk for up to 24h waiting on the orphan sweep."""
  full_m, thumb_m = IMAGE_URL_RE.search(full or ""), IMAGE_URL_RE.search(thumb or "")
  if not full_m or not thumb_m or full_m.group(1) != thumb_m.group(1):
    raise HTTPException(status_code=400, detail="invalid image reference")
  stem = full_m.group(1)
  removed = _uploads().find_one_and_delete({"stem": stem, "userEmail": email})
  if not removed:
    # Already attached to a published story, already discarded, or never this user's — nothing to do.
    return
  # If it has since been attached to a story (e.g. a second tab), don't delete files out from under it.
  if _posts().find_one({"images.full": full}):
    return
  image_service.delete_image({"full": full, "thumb": thumb})


def _verify_images(email: str, images: List[Any]) -> List[Dict[str, Any]]:
  checked: List[Dict[str, Any]] = []
  seen = set()
  for img in images:
    full_m, thumb_m = IMAGE_URL_RE.search(img.full), IMAGE_URL_RE.search(img.thumb)
    if not full_m or not thumb_m or full_m.group(1) != thumb_m.group(1) or full_m.group(2) != "full" or thumb_m.group(2) != "thumb":
      raise HTTPException(status_code=400, detail="invalid image reference")
    stem = full_m.group(1)
    if stem in seen:
      raise HTTPException(status_code=400, detail="duplicate image")
    seen.add(stem)
    if not _uploads().find_one({"stem": stem, "userEmail": email}):
      raise HTTPException(status_code=400, detail="image upload expired, please add the photo again")
    checked.append({"full": img.full, "thumb": img.thumb, "w": img.w, "h": img.h, "caption": img.caption})
  return checked


def create_post(email: str, payload: BlogPostRequest) -> Dict[str, Any]:
  check_rate("post", email)
  images = _verify_images(email, payload.images)
  now = datetime.utcnow()
  doc = {
    "title": payload.title,
    "body": payload.body,
    "mood": payload.mood,
    "place": payload.place,
    "images": images,
    "authorEmail": email,
    "authorName": _author_name(email),
    "likeCount": 0,
    "commentCount": 0,
    "reportCount": 0,
    "status": "published",
    "createdAt": now,
    "updatedAt": now,
  }
  doc["_id"] = _posts().insert_one(doc).inserted_id
  logger.info("blog post created id=%s author=%s", doc["_id"], email)
  return serialize_post(doc, viewer=email, full=True)


def update_post(post_id: str, email: str, payload: BlogPostRequest) -> Dict[str, Any]:
  doc = _posts().find_one({"_id": _oid(post_id, "story")})
  if not doc:
    raise HTTPException(status_code=404, detail="story not found")
  if doc.get("authorEmail") != email:
    raise HTTPException(status_code=403, detail="you can only edit your own stories")
  if doc.get("status") == "deleted":
    raise HTTPException(status_code=404, detail="story not found")
  # Figure out which existing images are being kept vs removed, and which are new.
  existing = {IMAGE_URL_RE.search(img.get("full", "")).group(1): img for img in doc.get("images") or [] if IMAGE_URL_RE.search(img.get("full", ""))}
  kept: List[Dict[str, Any]] = []
  new_images = []
  seen = set()
  for img in payload.images:
    full_m = IMAGE_URL_RE.search(img.full)
    if not full_m:
      raise HTTPException(status_code=400, detail="invalid image reference")
    stem = full_m.group(1)
    if stem in seen:
      raise HTTPException(status_code=400, detail="duplicate image")
    seen.add(stem)
    if stem in existing:
      # Keep the existing image but let the author tweak the caption.
      kept.append({**existing[stem], "caption": img.caption})
    else:
      new_images.append(img)
  # Verify the brand-new image references against this user's recent uploads.
  verified_new = _verify_images(email, new_images) if new_images else []
  # Build the final image list, preserving the order given by the client.
  final: List[Dict[str, Any]] = []
  for img in payload.images:
    full_m = IMAGE_URL_RE.search(img.full)
    stem = full_m.group(1) if full_m else ""
    if stem in existing:
      final.append(next(k for k in kept if IMAGE_URL_RE.search(k["full"]).group(1) == stem))
    else:
      final.append(next(v for v in verified_new if IMAGE_URL_RE.search(v["full"]).group(1) == stem))
  # Remove image files the author took out.
  removed_stems = set(existing) - seen
  for stem, img in existing.items():
    if stem in removed_stems:
      image_service.delete_image(img)
  now = datetime.utcnow()
  update = {
    "title": payload.title,
    "body": payload.body,
    "mood": payload.mood,
    "place": payload.place,
    "images": final,
    "updatedAt": now,
  }
  _posts().update_one({"_id": doc["_id"]}, {"$set": update})
  logger.info("blog post updated id=%s author=%s", doc["_id"], email)
  return serialize_post({**doc, **update}, viewer=email, full=True)


def delete_post(post_id: str, email: str, is_admin: bool) -> None:
  doc = _posts().find_one({"_id": _oid(post_id, "story")})
  if not doc:
    raise HTTPException(status_code=404, detail="story not found")
  if not is_admin and doc.get("authorEmail") != email:
    raise HTTPException(status_code=403, detail="you can only delete your own stories")
  comment_ids = [c["_id"] for c in _comments().find({"postId": doc["_id"]}, {"_id": 1})]
  _posts().delete_one({"_id": doc["_id"]})
  for table in (_likes(), _saves()):
    table.delete_many({"postId": doc["_id"]})
  _comments().delete_many({"postId": doc["_id"]})
  _reports().delete_many({"targetType": "post", "targetId": doc["_id"]})
  if comment_ids:
    _reports().delete_many({"targetType": "comment", "targetId": {"$in": comment_ids}})
  for image in doc.get("images") or []:
    image_service.delete_image(image)
  logger.info("blog post deleted id=%s by=%s admin=%s", doc["_id"], email, is_admin)


def _toggle(table, post_id: str, email: str, action: str) -> bool:
  check_rate(action, email)
  post = _visible_post(post_id)
  key = {"postId": post["_id"], "userEmail": email}
  try:
    table.insert_one({**key, "createdAt": datetime.utcnow()})
    return True
  except DuplicateKeyError:
    table.delete_one(key)
    return False


def toggle_like(post_id: str, email: str) -> Dict[str, Any]:
  post = _visible_post(post_id)
  now_liked = _toggle(_likes(), post_id, email, "like")
  count = _likes().count_documents({"postId": post["_id"]})
  _posts().update_one({"_id": post["_id"]}, {"$set": {"likeCount": count}})
  return {"liked": now_liked, "likeCount": count}


def toggle_save(post_id: str, email: str) -> Dict[str, Any]:
  return {"saved": _toggle(_saves(), post_id, email, "save")}


def _serialize_comment(doc: Dict[str, Any], viewer: str, post_author: str, is_admin: bool = False) -> Dict[str, Any]:
  email = doc.get("authorEmail", "")
  return {
    "id": str(doc["_id"]),
    "postId": str(doc["postId"]),
    "parentId": str(doc["parentId"]) if doc.get("parentId") else None,
    "body": doc.get("body", ""),
    "authorName": doc.get("authorName", ""),
    "authorHandle": _handle(email),
    "createdAt": _iso(doc.get("createdAt")),
    "mine": bool(viewer) and viewer == email,
    "canDelete": is_admin or (bool(viewer) and viewer in (email, post_author)),
    "isStoryAuthor": email == post_author,
  }


def list_comments(post_id: str, parent_id: str, cursor: str, limit: int, viewer: str, is_admin: bool = False) -> Dict[str, Any]:
  post = _visible_post(post_id, is_admin)
  limit = max(1, min(limit, PAGE_SIZE_MAX))
  parent = _oid(parent_id, "comment") if parent_id else None
  query: Dict[str, Any] = {"postId": post["_id"], "parentId": parent, "status": "published"}
  top_level = parent is None
  if cursor:
    try:
      ms_s, oid_s = cursor.split(":")
      when, oid = _from_ms(int(ms_s)), ObjectId(oid_s)
    except (ValueError, InvalidId):
      raise HTTPException(status_code=400, detail="bad cursor")
    cmp = "$lt" if top_level else "$gt"
    query["$or"] = [{"createdAt": {cmp: when}}, {"createdAt": when, "_id": {cmp: oid}}]
  direction = DESCENDING if top_level else ASCENDING
  docs = list(_comments().find(query).sort([("createdAt", direction), ("_id", direction)]).limit(limit + 1))
  has_more = len(docs) > limit
  docs = docs[:limit]
  author = post.get("authorEmail", "")
  items = [_serialize_comment(d, viewer, author, is_admin) for d in docs]
  if top_level and docs:
    ids = [d["_id"] for d in docs]
    counts = {r["_id"]: r["n"] for r in _comments().aggregate([
      {"$match": {"postId": post["_id"], "parentId": {"$in": ids}, "status": "published"}},
      {"$group": {"_id": "$parentId", "n": {"$sum": 1}}},
    ])}
    for item, d in zip(items, docs):
      n = counts.get(d["_id"], 0)
      item["replyCount"] = n
      previews = []
      if n:
        previews = [
          _serialize_comment(r, viewer, author, is_admin)
          for r in _comments().find({"postId": post["_id"], "parentId": d["_id"], "status": "published"}).sort("createdAt", ASCENDING).limit(2)
        ]
      item["replies"] = previews
  next_cursor = f"{_ms(docs[-1]['createdAt'])}:{docs[-1]['_id']}" if has_more and docs else ""
  return {"comments": items, "nextCursor": next_cursor}


def add_comment(post_id: str, email: str, payload: BlogCommentRequest) -> Dict[str, Any]:
  check_rate("comment", email)
  post = _visible_post(post_id)
  parent = None
  if payload.parentId:
    parent = _comments().find_one({"_id": _oid(payload.parentId, "comment"), "postId": post["_id"], "status": "published"})
    if not parent:
      raise HTTPException(status_code=404, detail="comment not found")
    if parent.get("parentId"):
      parent = _comments().find_one({"_id": parent["parentId"]}) or parent  # replies stay one level deep
  doc = {
    "postId": post["_id"],
    "parentId": parent["_id"] if parent else None,
    "body": payload.body,
    "authorEmail": email,
    "authorName": _author_name(email),
    "reportCount": 0,
    "status": "published",
    "createdAt": datetime.utcnow(),
  }
  doc["_id"] = _comments().insert_one(doc).inserted_id
  _posts().update_one({"_id": post["_id"]}, {"$inc": {"commentCount": 1}})
  return _serialize_comment(doc, email, post.get("authorEmail", ""))


def delete_comment(comment_id: str, email: str, is_admin: bool) -> Dict[str, Any]:
  doc = _comments().find_one({"_id": _oid(comment_id, "comment")})
  if not doc:
    raise HTTPException(status_code=404, detail="comment not found")
  post = _posts().find_one({"_id": doc["postId"]}) or {}
  if not is_admin and email not in (doc.get("authorEmail"), post.get("authorEmail")):
    raise HTTPException(status_code=403, detail="you can't delete this comment")
  ids = [doc["_id"]]
  if not doc.get("parentId"):
    ids += [r["_id"] for r in _comments().find({"parentId": doc["_id"]}, {"_id": 1})]
  removed = _comments().delete_many({"_id": {"$in": ids}}).deleted_count
  _reports().delete_many({"targetType": "comment", "targetId": {"$in": ids}})
  if removed:
    _posts().update_one({"_id": doc["postId"]}, {"$inc": {"commentCount": -removed}})
  return {"removed": removed}


def report(target_type: str, target_id: str, email: str, reason: str) -> Dict[str, Any]:
  check_rate("report", email)
  coll = _posts() if target_type == "post" else _comments()
  doc = coll.find_one({"_id": _oid(target_id, target_type), "status": "published"})
  if not doc:
    raise HTTPException(status_code=404, detail=f"{target_type} not found")
  if doc.get("authorEmail") == email:
    raise HTTPException(status_code=400, detail="you can't report your own content")
  try:
    _reports().insert_one({
      "targetType": target_type, "targetId": doc["_id"], "userEmail": email,
      "reason": reason, "createdAt": datetime.utcnow(),
    })
  except DuplicateKeyError:
    return {"reported": True, "hidden": False}
  updated = coll.find_one_and_update({"_id": doc["_id"]}, {"$inc": {"reportCount": 1}}, return_document=ReturnDocument.AFTER)
  hidden = int(updated.get("reportCount", 0)) >= AUTO_HIDE_REPORTS
  if hidden:
    coll.update_one({"_id": doc["_id"]}, {"$set": {"status": "hidden"}})
    logger.warning("blog %s auto-hidden id=%s", target_type, doc["_id"])
  return {"reported": True, "hidden": hidden}


def admin_list(status: str, limit: int = 50) -> Dict[str, Any]:
  query: Dict[str, Any] = {}
  if status == "reported":
    query = {"reportCount": {"$gt": 0}}
  elif status in ("hidden", "published"):
    query = {"status": status}
  posts = list(_posts().find(query).sort([("reportCount", DESCENDING), ("createdAt", DESCENDING)]).limit(limit))
  out = []
  for d in posts:
    item = serialize_post(d, full=True)
    item["reportCount"] = int(d.get("reportCount", 0))
    item["authorEmail"] = d.get("authorEmail", "")
    item["reasons"] = [r.get("reason", "") for r in _reports().find({"targetType": "post", "targetId": d["_id"]}).limit(10) if r.get("reason")]
    out.append(item)
  return {"posts": out}


def admin_set_status(post_id: str, status: str) -> Dict[str, Any]:
  doc = _posts().find_one_and_update(
    {"_id": _oid(post_id, "story")},
    {"$set": {"status": status, "updatedAt": datetime.utcnow()}},
    return_document=ReturnDocument.AFTER,
  )
  if not doc:
    raise HTTPException(status_code=404, detail="story not found")
  if status == "published":
    _posts().update_one({"_id": doc["_id"]}, {"$set": {"reportCount": 0}})
    _reports().delete_many({"targetType": "post", "targetId": doc["_id"]})
  return {"id": str(doc["_id"]), "status": status}


def sweep_orphan_images() -> int:
  referenced = set()
  for d in _posts().find({}, {"images": 1}):
    for image in d.get("images") or []:
      m = IMAGE_URL_RE.search(image.get("full", ""))
      if m:
        referenced.add(m.group(1))
  return image_service.sweep_orphans(referenced, max_age_seconds=90000)
