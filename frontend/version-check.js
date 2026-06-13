(function () {
  var KEY = "wb_app_version";
  var BANNER_ID = "wb-update-banner";

  function allowContextMenu(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  document.addEventListener(
    "contextmenu",
    function (e) {
      if (allowContextMenu(e.target)) return;
      e.preventDefault();
    },
    { capture: true }
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key === "F12") {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey && e.shiftKey && /^[ijc]$/i.test(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey && !e.shiftKey && /^u$/i.test(e.key)) {
        e.preventDefault();
      }
    },
    { capture: true }
  );

  function showUpdateBanner() {
    if (document.getElementById(BANNER_ID)) return;

    var bar = document.createElement("div");
    bar.id = BANNER_ID;
    bar.setAttribute("role", "status");
    bar.innerHTML =
      '<span>Wonder Baboon was updated.</span>' +
      '<button type="button">Refresh</button>';

    Object.assign(bar.style, {
      position: "fixed",
      left: "0",
      right: "0",
      bottom: "0",
      zIndex: "99999",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      padding: "12px 16px",
      background: "#1a1a2e",
      color: "#fff",
      font: '500 14px/1.4 system-ui, -apple-system, sans-serif',
      boxShadow: "0 -4px 20px rgba(0,0,0,0.25)",
    });

    var btn = bar.querySelector("button");
    Object.assign(btn.style, {
      border: "none",
      borderRadius: "8px",
      padding: "8px 14px",
      background: "#e94560",
      color: "#fff",
      font: "inherit",
      cursor: "pointer",
    });
    btn.addEventListener("click", function () {
      location.reload();
    });

    document.body.appendChild(bar);
  }

  fetch("/version.json?_=" + Date.now(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("version fetch failed");
      return res.json();
    })
    .then(function (data) {
      var v = data && data.v;
      if (!v) return;

      var prev = localStorage.getItem(KEY);
      if (prev && prev !== v) showUpdateBanner();
      localStorage.setItem(KEY, v);
    })
    .catch(function () {});
})();
