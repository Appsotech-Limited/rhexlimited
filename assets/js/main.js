/* RHEX: Royal Home of Excellence. Site interactions. No dependencies. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- Preloader ---------- */
  function done() { root.classList.add('is-loaded'); document.body.classList.add('is-loaded'); }
  var started = Date.now();
  function finish() { setTimeout(done, Math.max(0, (reduceMotion ? 0 : 1300) - (Date.now() - started))); }
  if (document.readyState === 'complete') finish(); else window.addEventListener('load', finish);
  setTimeout(done, 4000); // never block the page on a slow asset

  /* ---------- Theme toggle ---------- */
  var themeListeners = [];
  function setTheme(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('rhex-theme', t); } catch (e) {}
    themeListeners.forEach(function (fn) { fn(t); });
  }
  var toggle = $('.theme-toggle');
  if (toggle) {
    var syncLabel = function () {
      var dark = root.getAttribute('data-theme') === 'dark';
      toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    };
    syncLabel();
    toggle.addEventListener('click', function () {
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      syncLabel();
    });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystem = function (e) {
      var saved = null;
      try { saved = localStorage.getItem('rhex-theme'); } catch (err) {}
      if (!saved) { root.setAttribute('data-theme', e.matches ? 'dark' : 'light'); themeListeners.forEach(function (fn) { fn(); }); }
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystem);
  }

  /* ---------- Nav: scrolled state, hide on scroll down, progress ---------- */
  var nav = $('.nav');
  var lastY = 0, ticking = false;
  function onScroll() {
    var y = window.scrollY;
    nav.classList.toggle('is-scrolled', y > 40);
    nav.classList.toggle('is-hidden', y > 400 && y > lastY && !nav.classList.contains('menu-open'));
    lastY = y;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    root.style.setProperty('--progress', h > 0 ? (y / h).toFixed(4) : 0);
    // subtle hero parallax
    if (!reduceMotion && heroCopy && y < window.innerHeight) {
      heroCopy.style.transform = 'translate3d(0,' + (y * 0.18).toFixed(1) + 'px,0)';
      heroCopy.style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.85)));
    }
    ticking = false;
  }
  var heroCopy = $('.hero__content');
  window.addEventListener('scroll', function () { if (!ticking) { requestAnimationFrame(onScroll); ticking = true; } }, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  var burger = $('.nav__burger'), menu = $('#mobile-menu');
  function closeMenu() { nav.classList.remove('menu-open'); menu.hidden = true; burger.setAttribute('aria-expanded', 'false'); burger.setAttribute('aria-label', 'Open menu'); }
  if (burger && menu) {
    burger.addEventListener('click', function () {
      var open = menu.hidden;
      menu.hidden = !open;
      nav.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', closeMenu); });
    window.addEventListener('resize', function () { if (window.innerWidth >= 1080) closeMenu(); });
  }

  /* ---------- Active nav link ---------- */
  var links = $$('.nav__links a');
  if ('IntersectionObserver' in window) {
    var sectionObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.id;
        links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) sectionObs.observe(s); });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = $$('.reveal, .shot');
  // stagger siblings
  $$('.service-grid, .members, .why__list, .vm-grid, .contact__list, .stats').forEach(function (group) {
    $$('.reveal', group).forEach(function (el, i) { el.style.setProperty('--d', (i % 6) * 0.08 + 's'); });
  });
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); revealObs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { revealObs.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Count-up stats ---------- */
  var counters = $$('[data-count]');
  function countUp(el) {
    var target = parseInt(el.getAttribute('data-count'), 10), suffix = el.getAttribute('data-suffix') || '';
    var from = target > 1000 ? target - 40 : 0, dur = 1800, t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(from + (target - from) * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  if ('IntersectionObserver' in window && !reduceMotion) {
    var countObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); countObs.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counters.forEach(function (c) { countObs.observe(c); });
  }

  /* ---------- Service card spotlight ---------- */
  $$('.service').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* ---------- Gallery filter + lightbox ---------- */
  var shots = $$('.shot');
  $$('.filter').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var f = btn.getAttribute('data-filter');
      $$('.filter').forEach(function (b) { var on = b === btn; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
      shots.forEach(function (s) { s.classList.toggle('is-hidden', f !== 'all' && s.getAttribute('data-cat') !== f); });
    });
  });

  var lb = $('.lightbox'), lbImg = $('.lightbox img'), lbCap = $('.lightbox figcaption'), current = 0, lastFocus = null;
  function visibleShots() { return shots.filter(function (s) { return !s.classList.contains('is-hidden'); }); }
  function show(i) {
    var list = visibleShots(); if (!list.length) return;
    current = (i + list.length) % list.length;
    var img = $('img', list[current]);
    lbImg.src = img.currentSrc || img.src; lbImg.alt = img.alt;
    lbCap.textContent = $('figcaption', list[current]).textContent;
  }
  function openLb(shot) { lastFocus = document.activeElement; show(visibleShots().indexOf(shot)); lb.hidden = false; document.body.style.overflow = 'hidden'; $('.lightbox__close').focus(); }
  function closeLb() { lb.hidden = true; document.body.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
  shots.forEach(function (s) {
    s.tabIndex = 0; s.setAttribute('role', 'button');
    s.setAttribute('aria-label', 'View larger: ' + $('img', s).alt);
    s.addEventListener('click', function () { openLb(s); });
    s.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(s); } });
  });
  if (lb) {
    $('.lightbox__close').addEventListener('click', closeLb);
    $('.lightbox__nav--prev').addEventListener('click', function () { show(current - 1); });
    $('.lightbox__nav--next').addEventListener('click', function () { show(current + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
  }

  /* ---------- Contact form → WhatsApp ---------- */
  var form = $('#contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.name.value.trim(), msg = form.message.value.trim(), phone = form.phone.value.trim(), topic = form.topic.value;
      var err = $('.form__error', form);
      if (!name || !msg) { err.hidden = false; (name ? form.message : form.name).focus(); return; }
      err.hidden = true;
      var text = 'Hello RHEX, my name is ' + name + '.' + (phone ? ' (Phone: ' + phone + ')' : '') + '\n\nTopic: ' + topic + '\n\n' + msg;
      window.open('https://wa.me/2349097404887?text=' + encodeURIComponent(text), '_blank', 'noopener');
    });
  }

  var year = $('#year'); if (year) year.textContent = new Date().getFullYear();

  /* ==========================================================================
     Particles: golden embers drifting upward, joined by faint constellation
     lines, gently drawn towards the pointer. Paused when off-screen.
     ========================================================================== */
  function Particles(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.mode = canvas.getAttribute('data-particles') || 'hero';
    this.pts = []; this.mouse = { x: -9999, y: -9999 }; this.running = false; this.visible = false;
    this.palette();
    this.resize();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    var host = canvas.parentElement;
    host.addEventListener('pointermove', function (e) { var r = canvas.getBoundingClientRect(); self.mouse.x = e.clientX - r.left; self.mouse.y = e.clientY - r.top; });
    host.addEventListener('pointerleave', function () { self.mouse.x = self.mouse.y = -9999; });
    themeListeners.push(function () { self.palette(); if (reduceMotion) self.draw(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { self.visible = en[0].isIntersecting; if (self.visible) self.start(); }, { threshold: 0 }).observe(canvas);
    } else { this.visible = true; this.start(); }
  }
  Particles.prototype.palette = function () {
    var dark = root.getAttribute('data-theme') === 'dark';
    // Sections hosting particles are dark in both themes; dark mode leans gold, light mode leans orange.
    this.colors = dark ? ['233,207,122', '212,175,55', '249,160,27', '255,236,190'] : ['249,160,27', '228,145,37', '255,200,110', '255,255,255'];
    this.lineColor = dark ? '212,175,55' : '249,160,27';
  };
  Particles.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), r = this.c.getBoundingClientRect();
    this.w = r.width; this.h = r.height; this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var density = this.mode === 'hero' ? 9000 : 16000;
    var n = Math.round(Math.min(this.mode === 'hero' ? 130 : 70, (this.w * this.h) / density));
    if (this.w < 600) n = Math.round(n * 0.6);
    this.pts = [];
    for (var i = 0; i < n; i++) this.pts.push(this.spawn(true));
    if (reduceMotion) this.draw();
  };
  Particles.prototype.spawn = function (anywhere) {
    var big = Math.random() < 0.12;
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 10,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.15 + Math.random() * (this.mode === 'hero' ? 0.55 : 0.3)),
      r: big ? 1.8 + Math.random() * 2.2 : 0.6 + Math.random() * 1.4,
      a: 0.25 + Math.random() * 0.65,
      tw: Math.random() * Math.PI * 2,
      c: this.colors[(Math.random() * this.colors.length) | 0]
    };
  };
  Particles.prototype.start = function () {
    if (this.running || reduceMotion) return;
    this.running = true;
    var self = this;
    (function loop() {
      if (!self.visible || document.hidden) { self.running = false; return; }
      self.step(); self.draw();
      requestAnimationFrame(loop);
    })();
  };
  Particles.prototype.step = function () {
    var m = this.mouse;
    for (var i = 0; i < this.pts.length; i++) {
      var p = this.pts[i];
      p.tw += 0.03;
      var dx = m.x - p.x, dy = m.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < 22000) { var f = (1 - d2 / 22000) * 0.04; p.vx += dx * f * 0.02; p.vy += dy * f * 0.02; }
      p.vx *= 0.985; p.vx += (Math.random() - 0.5) * 0.02;
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10 || p.x < -20 || p.x > this.w + 20) { this.pts[i] = this.spawn(false); this.pts[i].c = this.colors[(Math.random() * this.colors.length) | 0]; }
    }
  };
  Particles.prototype.draw = function () {
    var ctx = this.ctx, pts = this.pts, maxD = this.mode === 'hero' ? 120 : 100, maxD2 = maxD * maxD;
    ctx.clearRect(0, 0, this.w, this.h);
    // constellation lines
    ctx.lineWidth = 0.6;
    for (var i = 0; i < pts.length; i++) {
      for (var j = i + 1; j < pts.length; j++) {
        var dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d2 = dx * dx + dy * dy;
        if (d2 < maxD2) {
          ctx.strokeStyle = 'rgba(' + this.lineColor + ',' + ((1 - d2 / maxD2) * 0.18).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
        }
      }
    }
    // embers
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k], alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
      if (p.r > 1.8) {
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, 'rgba(' + p.c + ',' + alpha + ')'); g.addColorStop(1, 'rgba(' + p.c + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(' + p.c + ',' + Math.min(1, alpha + 0.2) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  };

  var canvases = $$('canvas.particles');
  if (canvases.length && canvases[0].getContext) {
    var instances = canvases.map(function (c) { return new Particles(c); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) instances.forEach(function (p) { p.start(); }); });
  }
})();
