/* RHEX Reality Debate Show: Grand Finale countdown + cinematic event gallery. */
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Grand Finale countdown ---------- */
  // Friday 13 November 2026, 9am to 12 noon, Nigeria time (UTC+1).
  var START = Date.parse("2026-11-13T09:00:00+01:00"), END = Date.parse("2026-11-13T12:00:00+01:00");
  var cd = document.getElementById("countdown"), status = document.getElementById("finale-status");
  var ribbon = document.querySelector(".finale-ribbon");
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function tick() {
    var now = Date.now();
    if (now >= END) {
      if (cd) cd.hidden = true;
      if (status) { status.hidden = false; status.textContent = "The Grand Finale has taken place. Thank you to everyone who came and voted."; }
      if (ribbon) ribbon.hidden = true;
      return false;
    }
    if (now >= START) {
      if (cd) cd.hidden = true;
      if (status) { status.hidden = false; status.textContent = "Happening now: the Grand Finale is live until 12 noon."; }
      if (ribbon) ribbon.querySelector("span").textContent = "Live now · Hybrid Preparatory School";
      return true;
    }
    var s = Math.floor((START - now) / 1000);
    var parts = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
    if (cd) Object.keys(parts).forEach(function (k) {
      var el = cd.querySelector("[data-" + k + "]"); if (!el) return;
      var v = k === "d" ? String(parts[k]) : pad(parts[k]);
      if (el.textContent !== v) { el.textContent = v; if (!reduced) { el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); } }
    });
    return true;
  }
  if (tick()) { var timer = setInterval(function () { if (!tick()) clearInterval(timer); }, 1000); }

  /* ---------- Gallery ---------- */
  var reel = document.getElementById("reel");
  if (!reel) return;
  var slides = [].slice.call(reel.querySelectorAll(".slide"));
  var bars = [].slice.call(reel.querySelectorAll(".bar i"));
  var cap = reel.querySelector(".cap span"), capNo = reel.querySelector(".cap small");
  var DUR = 6000, i = 0, t = null, paused = false, visible = true;
  function show(n) {
    i = (n + slides.length) % slides.length;
    slides.forEach(function (s, k) { s.classList.toggle("on", k === i); });
    bars.forEach(function (b, k) { b.classList.toggle("done", k < i); b.classList.remove("now"); });
    void reel.offsetWidth;
    if (bars[i]) bars[i].classList.add("now");
    cap.textContent = slides[i].dataset.cap || "";
    capNo.textContent = "Scene " + (i + 1) + " / " + slides.length;
    cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
    schedule();
  }
  function schedule() {
    clearTimeout(t);
    if (!paused && visible && !reduced) t = setTimeout(function () { show(i + 1); }, DUR);
  }
  reel.style.setProperty("--dur", DUR / 1000 + "s");
  var playBtn = reel.querySelector("[data-play]");
  function setPaused(p) {
    paused = p; reel.classList.toggle("paused", p);
    if (playBtn) { playBtn.setAttribute("aria-label", p ? "Play slideshow" : "Pause slideshow"); playBtn.innerHTML = p ? ICON.play : ICON.pause; }
    schedule();
  }
  var ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  };
  reel.querySelector("[data-prev]").addEventListener("click", function () { show(i - 1); });
  reel.querySelector("[data-next]").addEventListener("click", function () { show(i + 1); });
  if (playBtn) playBtn.addEventListener("click", function () { setPaused(!paused); });
  if (reduced) setPaused(true);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; schedule(); }, { threshold: .25 }).observe(reel);
  }
  document.addEventListener("visibilitychange", function () { visible = !document.hidden; schedule(); });
  // swipe
  var x0 = null;
  reel.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  reel.addEventListener("touchend", function (e) {
    if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
  });

  /* ---------- Lightbox ---------- */
  var photos = slides.map(function (s) { return { src: s.dataset.full, cap: s.dataset.cap || "" }; });
  var lb = document.getElementById("lightbox"), lbImg = lb.querySelector("img"), lbCap = lb.querySelector("figcaption"), li = 0, lastFocus = null;
  function openLb(n) {
    li = (n + photos.length) % photos.length;
    lbImg.src = photos[li].src; lbImg.alt = photos[li].cap; lbCap.textContent = photos[li].cap;
    if (!lb.classList.contains("open")) { lastFocus = document.activeElement; lb.classList.add("open"); lb.setAttribute("aria-hidden", "false"); lb.querySelector(".x").focus(); setPaused(true); document.body.style.overflow = "hidden"; }
  }
  function closeLb() { lb.classList.remove("open"); lb.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; if (lastFocus) lastFocus.focus(); }
  slides.forEach(function (s, k) { s.addEventListener("click", function () { openLb(k); }); });
  document.querySelectorAll("[data-photo]").forEach(function (b) { b.addEventListener("click", function () { openLb(Number(b.dataset.photo)); }); });
  lb.querySelector(".x").addEventListener("click", closeLb);
  lb.querySelector(".prev").addEventListener("click", function () { openLb(li - 1); });
  lb.querySelector(".next").addEventListener("click", function () { openLb(li + 1); });
  lb.addEventListener("click", function (e) { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", function (e) {
    if (!lb.classList.contains("open")) return;
    if (e.key === "Escape") closeLb(); else if (e.key === "ArrowLeft") openLb(li - 1); else if (e.key === "ArrowRight") openLb(li + 1);
  });
  var lx = null;
  lb.addEventListener("touchstart", function (e) { lx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", function (e) { if (lx == null) return; var dx = e.changedTouches[0].clientX - lx; lx = null; if (Math.abs(dx) > 40) openLb(li + (dx < 0 ? 1 : -1)); });

  show(0);
})();
