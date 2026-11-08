/* RHEX Reality Debate Show: shared behaviour (theme, starfield with exploding stars, reveals, helpers). */
(function () {
  "use strict";
  var RHEX = (window.RHEX = window.RHEX || {});
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Phones and touch tablets get a lighter sky: fewer stars and sparks, no glow halos, cheaper blending.
  var lite = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;

  /* ---------- Theme (same key as the main site) ---------- */
  function currentTheme() {
    return root.getAttribute("data-theme") ||
      "dark"; // dark is the default
  }
  RHEX.isDark = function () { return currentTheme() === "dark"; };
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    var next = currentTheme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("rhex-theme", next); } catch (err) {}
  });

  /* ---------- Helpers ---------- */
  RHEX.data = window.RHEX_DEBATE || { config: {}, contestants: [] };
  // Contestants are managed in the admin dashboard (/admin/) and served live by
  // /api/debate/contestants. The list in data/contestants.js is only a fallback
  // for when that can't be reached. Calls cb() once the list is ready.
  var readyQueue = null;
  RHEX.ready = function (cb) {
    if (readyQueue === true) return cb();
    if (readyQueue) return readyQueue.push(cb);
    readyQueue = [cb];
    var url = (RHEX.data.config || {}).contestantsEndpoint;
    function done() { var q = readyQueue; readyQueue = true; q.forEach(function (f) { f(); }); }
    if (!url || location.protocol === "file:" || !window.fetch) return done();
    var finished = false;
    var timer = setTimeout(function () { if (!finished) { finished = true; done(); } }, 5000);
    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && Array.isArray(j.contestants) && !finished) { RHEX.data.contestants = j.contestants; RHEX.data.settings = j.settings || {}; } })
      .catch(function () {})
      .then(function () { if (!finished) { finished = true; clearTimeout(timer); done(); } });
  };
  // Returns a message when voting for this contestant is switched off (null when open).
  RHEX.votingBlocked = function (c) {
    var st = RHEX.data.settings || {};
    if (st.votingOpen === false) return st.closedMessage || "Voting is closed for now. Please check back for the next round.";
    if (c && c.eliminated) return c.name + " has been evicted from the show, so voting for them is closed. Thank you for your support.";
    return null;
  };
  RHEX.naira = function (n) {
    return "₦" + Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 });
  };
  RHEX.initials = function (name) {
    return String(name || "").trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("");
  };
  RHEX.contestantUrl = function (c) {
    return "contestant/" + encodeURIComponent(c.number);
  };
  RHEX.escape = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };
  RHEX.artHTML = function (c) {
    if (c.photo) return '<img src="' + RHEX.escape(c.photo) + '" alt="' + RHEX.escape(c.name) + '" loading="lazy">';
    return '<div class="monogram" role="img" aria-label="' + RHEX.escape(c.name) + '"><span>' + RHEX.escape(RHEX.initials(c.name)) + "</span></div>";
  };
  RHEX.cardHTML = function (c, totals, base) {
    return '<a class="ccard" href="' + (base || "") + RHEX.contestantUrl(c) + '">' +
      '<div class="art">' + RHEX.artHTML(c) + '</div>' +
      '<span class="tag">No. ' + RHEX.escape(c.number) + (c.eliminated ? ' · Evicted' : '') + '</span>' +
      (totals ? '<span class="votes-pill">' + RHEX.votesLabel(totals[c.number]) + '</span>' : '') +
      '<div class="meta"><h3>' + RHEX.escape(c.name) + '</h3><span>Vote now <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></div>' +
      '</a>';
  };
  RHEX.matches = function (c, term) {
    term = (term || "").trim().toLowerCase().replace(/^no\.?\s*/, "");
    return !term || c.name.toLowerCase().indexOf(term) > -1 || String(c.number).toLowerCase().indexOf(term) > -1;
  };
  // Logo: uses the main site's logo; shows the wordmark alone if it isn't there yet.
  document.querySelectorAll("img[data-logo]").forEach(function (img) {
    img.addEventListener("error", function () { img.remove(); });
  });

  /* ---------- Live vote totals ---------- */
  // Calls cb({ "1120": 57, ... }) whenever fresh totals arrive. Stays silent if
  // counts are hidden, switched off, or the backend isn't reachable.
  RHEX.watchTally = function (cb) {
    var cfg = RHEX.data.config || {};
    var url = cfg.tallyEndpoint;
    if (!url || location.protocol === "file:") return { refresh: function () {} };
    var every = Math.max(10, Number(cfg.tallyRefreshSeconds) || 30) * 1000;
    var timer = null;
    function load(bust) {
      clearTimeout(timer);
      var u = bust === true ? url + (url.indexOf("?") < 0 ? "?" : "&") + "_=" + Date.now() : url;
      fetch(u, { headers: { Accept: "application/json" }, cache: bust === true ? "no-store" : "default" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && !j.hidden && j.totals) cb(j.totals); })
        .catch(function () {})
        .then(function () { timer = setTimeout(load, every); });
    }
    load();
    return { refresh: function () { load(true); } };
  };
  // Right after checkout: ask our server to confirm the payment with Paystack and
  // record it, so the count updates in seconds without waiting for the webhook.
  // Retries briefly while Paystack still reports the payment as processing.
  RHEX.confirmPayment = function (reference, done) {
    var tries = 0;
    function attempt() {
      tries++;
      fetch("/api/debate/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ reference: reference })
      })
        .then(function (r) { return r.status === 200 ? "ok" : (r.status === 202 || r.status >= 500 ? "retry" : "stop"); })
        .catch(function () { return "retry"; })
        .then(function (state) {
          if (state === "retry" && tries < 5) return setTimeout(attempt, 2000 * tries);
          if (done) done(state === "ok");
        });
    }
    attempt();
  };
  RHEX.votesLabel = function (n) { n = Number(n) || 0; return n.toLocaleString() + (n === 1 ? " vote" : " votes"); };
  RHEX.countUp = function (el, to) {
    var from = Number(el.dataset.v || 0); to = Number(to) || 0; el.dataset.v = to;
    if (reduced || from === to) { el.textContent = to.toLocaleString(); return; }
    var t0 = performance.now(), dur = 1200;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString();
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  };

  /* ---------- Reveal on scroll ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduced) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { io.observe(el); });
  }
  RHEX.initReveal = initReveal;

  /* ---------- Sky: drifting stardust, shooting stars and exploding stars ---------- */
  var canvas = document.getElementById("sky");
  var ctx = canvas && canvas.getContext("2d");
  var W = 0, H = 0, DPR = 1;
  var dust = [], sparks = [], shooters = [];
  var mouse = { x: -9999, y: -9999 };
  var palette = {
    dark: ["#F9A01B", "#E9CF7A", "#D4AF37", "#FFF4D6", "#FFFFFF"],
    light: ["#E49125", "#D4AF37", "#B8860B", "#F9A01B", "#C9971F"]
  };
  function colors() { return RHEX.isDark() ? palette.dark : palette.light; }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    // Phones fire resize whenever the address bar slides in or out; skip those small height-only changes.
    if (W && Math.abs(window.innerWidth - W) < 2 && Math.abs(window.innerHeight - H) < 150) return;
    DPR = Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var target = Math.round(Math.min(lite ? 60 : 160, (W * H) / (lite ? 12000 : 9000)));
    while (dust.length < target) dust.push(makeDust(true));
    dust.length = target;
  }
  function makeDust(anywhere) {
    return {
      x: rand(0, W), y: anywhere ? rand(0, H) : H + 10,
      r: rand(0.4, 1.9), vx: rand(-0.12, 0.12), vy: rand(-0.35, -0.06),
      tw: rand(0, Math.PI * 2), tws: rand(0.01, 0.04), c: pick(colors())
    };
  }

  // An exploding star: a flash, a ring of sparks with trails, and slow glitter.
  function burst(x, y, power) {
    if (!ctx) return;
    power = power || 1;
    if (lite && sparks.length > 220) return; // keep phones smooth when bursts overlap
    var cs = colors();
    var scale = lite ? 0.55 : 1;
    var n = Math.round(rand(46, 70) * power * scale);
    var speed = rand(2.6, 4.2) * Math.sqrt(power);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
      var s = speed * rand(0.55, 1.05);
      sparks.push({ x: x, y: y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1, decay: rand(0.008, 0.016), r: rand(1, 2.2), c: pick(cs), trail: true });
    }
    for (var j = 0; j < 26 * power * scale; j++) {
      var b = rand(0, Math.PI * 2), t = rand(0.2, 1.6);
      sparks.push({ x: x, y: y, px: x, py: y, vx: Math.cos(b) * t, vy: Math.sin(b) * t,
        life: 1, decay: rand(0.006, 0.012), r: rand(0.6, 1.4), c: pick(cs), glitter: true });
    }
    sparks.push({ flash: true, x: x, y: y, life: 1, decay: 0.05, r: 60 * power });
  }
  RHEX.burst = burst;
  RHEX.celebrate = function () {
    if (!ctx) return;
    var shots = reduced ? 1 : 7;
    for (var i = 0; i < shots; i++) {
      (function (k) {
        setTimeout(function () { burst(rand(W * 0.15, W * 0.85), rand(H * 0.15, H * 0.55), k === 0 ? 1.6 : rand(0.8, 1.3)); }, k * 260);
      })(i);
    }
  };

  function launchShooter() {
    var fromLeft = Math.random() < 0.5;
    shooters.push({
      x: fromLeft ? rand(-50, W * 0.4) : rand(W * 0.6, W + 50), y: rand(-20, H * 0.35),
      vx: (fromLeft ? 1 : -1) * rand(7, 11), vy: rand(2.5, 4.5), life: 1, len: rand(80, 160)
    });
  }

  var last = 0, nextAmbient = 2500, nextShooter = 4000, looping = false;
  function loop() { if (!looping) { looping = true; requestAnimationFrame(frame); } }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && ctx && !reduced) loop(); });
  function frame(t) {
    if (document.hidden) { looping = false; return; }
    var dt = Math.min(50, t - last || 16); last = t;
    ctx.clearRect(0, 0, W, H);
    var dark = RHEX.isDark();
    ctx.globalCompositeOperation = dark && !lite ? "lighter" : "source-over";

    // stardust
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      d.tw += d.tws; d.x += d.vx; d.y += d.vy;
      var dx = d.x - mouse.x, dy = d.y - mouse.y, dist2 = dx * dx + dy * dy;
      if (dist2 < 14400) { var f = (14400 - dist2) / 14400 * 0.9; d.x += dx / 60 * f; d.y += dy / 60 * f; }
      if (d.y < -10 || d.x < -10 || d.x > W + 10) dust[i] = makeDust(false);
      var alpha = (0.35 + Math.sin(d.tw) * 0.35) * (dark ? 1 : 0.75);
      ctx.globalAlpha = Math.max(0.05, alpha);
      ctx.fillStyle = d.c;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
      if (d.r > 1.5 && dark && !lite) {
        ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 4, 0, 6.283); ctx.fill();
      }
    }

    // shooting stars
    for (var s = shooters.length - 1; s >= 0; s--) {
      var sh = shooters[s];
      sh.x += sh.vx; sh.y += sh.vy; sh.life -= 0.012;
      var nx = sh.vx / Math.hypot(sh.vx, sh.vy), ny = sh.vy / Math.hypot(sh.vx, sh.vy);
      var g = ctx.createLinearGradient(sh.x, sh.y, sh.x - nx * sh.len, sh.y - ny * sh.len);
      g.addColorStop(0, dark ? "rgba(255,244,214,.95)" : "rgba(228,145,37,.9)");
      g.addColorStop(1, "rgba(249,160,27,0)");
      ctx.globalAlpha = Math.max(0, sh.life);
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - nx * sh.len, sh.y - ny * sh.len); ctx.stroke();
      if (sh.life <= 0 || sh.x < -200 || sh.x > W + 200 || sh.y > H + 200) {
        if (sh.life > 0.2 && Math.random() < 0.5) burst(sh.x, sh.y, 0.5);
        shooters.splice(s, 1);
      }
    }

    // exploding star sparks
    for (var p = sparks.length - 1; p >= 0; p--) {
      var k = sparks[p];
      k.life -= k.decay;
      if (k.life <= 0) { sparks.splice(p, 1); continue; }
      if (k.flash) {
        var rg = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, k.r * (1.6 - k.life));
        rg.addColorStop(0, dark ? "rgba(255,248,225," + k.life + ")" : "rgba(249,160,27," + k.life * 0.6 + ")");
        rg.addColorStop(1, "rgba(249,160,27,0)");
        ctx.globalAlpha = 1; ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(k.x, k.y, k.r * 1.6, 0, 6.283); ctx.fill();
        continue;
      }
      k.px = k.x; k.py = k.y;
      k.vx *= 0.975; k.vy = k.vy * 0.975 + 0.035; k.x += k.vx; k.y += k.vy;
      var al = k.glitter ? k.life * (0.5 + 0.5 * Math.sin(t / 60 + p)) : k.life;
      ctx.globalAlpha = Math.max(0, al);
      if (k.trail) {
        ctx.strokeStyle = k.c; ctx.lineWidth = k.r;
        ctx.beginPath(); ctx.moveTo(k.px - k.vx * 3, k.py - k.vy * 3); ctx.lineTo(k.x, k.y); ctx.stroke();
      }
      ctx.fillStyle = k.c;
      ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, 6.283); ctx.fill();
    }

    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

    // ambient events
    if (!document.hidden) {
      nextAmbient -= dt; nextShooter -= dt;
      if (nextAmbient <= 0) { burst(rand(W * 0.1, W * 0.9), rand(H * 0.08, H * 0.45), rand(0.45, 0.85)); nextAmbient = rand(3200, 6500) * (lite ? 1.6 : 1); }
      if (nextShooter <= 0) { launchShooter(); nextShooter = rand(2500, 6000) * (lite ? 1.5 : 1); }
    }
    requestAnimationFrame(frame);
  }

  function initSky() {
    if (!ctx) return;
    resize();
    window.addEventListener("resize", resize);
    if (reduced) {
      // Static stardust only
      ctx.clearRect(0, 0, W, H);
      dust.forEach(function (d) { ctx.globalAlpha = 0.5; ctx.fillStyle = d.c; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill(); });
      ctx.globalAlpha = 1;
      return;
    }
    window.addEventListener("pointermove", function (e) { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    window.addEventListener("pointerleave", function () { mouse.x = mouse.y = -9999; });
    // Click empty space to set off a star
    document.addEventListener("pointerdown", function (e) {
      if (e.target.closest("a, button, input, label, .vote-panel, .ccard")) return;
      burst(e.clientX, e.clientY, 0.8);
    });
    setTimeout(function () { burst(W / 2, H * 0.34, 1.4); }, 700);
    loop();
  }

  /* ---------- Shareable QR card ----------
     RHEX.qrCard(contestant, voteUrl, price) resolves to a 1080×1350 canvas: name,
     photo and a QR code that opens the one-tap vote link. The QR library
     (assets/qrcode.js, MIT, Kazuhiko Arase) only loads when someone asks for a card. */
  var qrLib = null;
  function loadQR() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLib) qrLib = new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = "assets/qrcode.js";
      s.onload = function () { window.qrcode ? ok(window.qrcode) : fail(new Error("QR library missing")); };
      s.onerror = function () { qrLib = null; fail(new Error("QR library failed to load")); };
      document.head.appendChild(s);
    });
    return qrLib;
  }
  function loadImg(src) {
    return new Promise(function (ok) {
      if (!src) return ok(null);
      var im = new Image();
      if (/^https?:/.test(src) && src.indexOf(location.origin) !== 0) im.crossOrigin = "anonymous";
      im.onload = function () { ok(im); };
      im.onerror = function () { ok(null); };
      im.src = src;
    });
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function fitText(g, text, font, size, maxW) {
    do { g.font = font.replace("{s}", size); size -= 2; } while (g.measureText(text).width > maxW && size > 20);
  }
  RHEX.qrCard = function (c, url, price) {
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return Promise.all([loadQR(), loadImg(c.photo), fontsReady]).then(function (r) {
      var qrcode = r[0], photo = r[1];
      var W = 1080, H = 1350, cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var g = cv.getContext("2d");
      var display = '700 {s}px "Cormorant Garamond", Georgia, serif';
      var body = '600 {s}px Montserrat, "Segoe UI", sans-serif';

      // background: night sky with a warm glow and a few stars
      var bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#1b1c24"); bg.addColorStop(1, "#0b0c10");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      var glow = g.createRadialGradient(W / 2, 330, 40, W / 2, 330, 620);
      glow.addColorStop(0, "rgba(249,160,27,.28)"); glow.addColorStop(1, "rgba(249,160,27,0)");
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      var seed = 7; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
      for (var i = 0; i < 90; i++) {
        g.globalAlpha = .25 + rnd() * .6; g.fillStyle = rnd() > .7 ? "#E9CF7A" : "#ffffff";
        g.beginPath(); g.arc(rnd() * W, rnd() * H, .8 + rnd() * 2.2, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(212,175,55,.55)"; g.lineWidth = 3; rrect(g, 28, 28, W - 56, H - 56, 36); g.stroke();

      g.textAlign = "center"; g.textBaseline = "alphabetic";
      g.fillStyle = "#E9CF7A"; g.font = body.replace("{s}", 26);
      g.letterSpacing = "8px";
      g.fillText("RHEX REALITY DEBATE SHOW", W / 2, 112);
      g.letterSpacing = "0px";
      var gold = g.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
      gold.addColorStop(0, "#B8860B"); gold.addColorStop(.5, "#F5DE8C"); gold.addColorStop(1, "#D4AF37");
      g.fillStyle = gold; g.font = display.replace("{s}", 84);
      g.fillText("THE PRESIDENT", W / 2, 196);

      // photo
      var pr = 120, py = 350;
      g.save(); g.beginPath(); g.arc(W / 2, py, pr, 0, 6.283); g.clip();
      if (photo) {
        var s = Math.max(pr * 2 / photo.width, pr * 2 / photo.height), iw = photo.width * s, ih = photo.height * s;
        g.drawImage(photo, W / 2 - iw / 2, py - pr, iw, ih); // keep the top of portrait photos (faces)
      } else {
        g.fillStyle = "#2F323E"; g.fillRect(W / 2 - pr, py - pr, pr * 2, pr * 2);
        g.fillStyle = "#E9CF7A"; g.font = display.replace("{s}", 110); g.textBaseline = "middle";
        g.fillText(String(c.name || "?").trim().charAt(0).toUpperCase(), W / 2, py + 6); g.textBaseline = "alphabetic";
      }
      g.restore();
      g.strokeStyle = "#D4AF37"; g.lineWidth = 6; g.beginPath(); g.arc(W / 2, py, pr + 4, 0, 6.283); g.stroke();

      g.fillStyle = "#ffffff"; fitText(g, c.name, display, 76, W - 160);
      g.fillText(c.name, W / 2, 556);
      g.fillStyle = "#E9CF7A"; g.font = body.replace("{s}", 30);
      g.fillText("Contestant No. " + c.number, W / 2, 606);

      // QR code on a white tile
      var qr = qrcode(0, "M"); qr.addData(url); qr.make();
      var n = qr.getModuleCount(), tile = 470, tx = (W - tile) / 2, ty = 650, quiet = 26;
      var cell = Math.floor((tile - quiet * 2) / n), off = (tile - cell * n) / 2;
      g.fillStyle = "#ffffff"; rrect(g, tx, ty, tile, tile, 28); g.fill();
      g.fillStyle = "#111218";
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect(tx + off + x * cell, ty + off + y * cell, cell, cell);

      g.fillStyle = gold; g.font = body.replace("{s}", 40);
      g.letterSpacing = "6px";
      g.fillText("SCAN TO VOTE", W / 2, 1200);
      g.letterSpacing = "0px";
      g.fillStyle = "rgba(255,255,255,.82)"; g.font = body.replace("{s}", 28);
      g.fillText(RHEX.naira(price) + " per vote  ·  " + url.replace(/^https?:\/\//, ""), W / 2, 1254);
      return cv;
    });
  };

  document.addEventListener("DOMContentLoaded", function () {
    initSky();
    initReveal();
    var y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
  });
})();
