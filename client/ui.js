/* OneClient UI: HUD widgets + the Right Shift overlay.
 *
 *   Right Shift  ->  game background blurs, HUD widgets become draggable, a glass "Mods" button fades in
 *   click Mods   ->  the Mods menu (mods.js): cards to enable / disable each mod and a settings page per mod
 *   Right Shift / Esc  ->  close (Esc first closes the Mods menu, or goes back from a settings page)
 *
 * Layers (back to front): game canvas, #oc-back (blur), #oc-hud (widgets), #oc-front (Mods button, Mods menu).
 * No ancestor of a glass surface uses opacity/filter, which would break its backdrop blur. */
(function () {
  "use strict";

  var OC = window.OneClient, S = OC.S;
  var built = false, state = 0;                  // 0 closed, 1 open
  var root, back, hud, front, guideV, guideH, toastEl;
  var widgets = [], drag = null, refs = {};
  var SNAP = 9, MARGIN = 10;

  var ICON_GRID = '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>';

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function setText(node, t) { if (node && node._t !== t) { node.textContent = t; node._t = t; } }
  function setOn(node, on) { if (node && node._o !== on) { node.classList.toggle("on", on); node._o = on; } }

  /* ---------- widgets ---------- */
  function addWidget(id, mod, inner, def, isTag) {
    var el = h("div", "ocw hid"), box = h("div", "ocw-in");
    box.appendChild(inner);
    el.appendChild(box);
    el.setAttribute("data-w", id);
    hud.appendChild(el);
    var w = { id: id, mod: mod, el: el, box: box, def: def, tag: !!isTag };
    widgets.push(w);
    bindDrag(w);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (!drag || drag.w !== w) place(w); }).observe(el);
    }
    return w;
  }

  function chip(label, id) {
    var c = h("span", "oc-chip", "<b>0</b><i>" + label + "</i>");
    refs[id] = c.firstChild;
    return c;
  }
  function tag(text) { return h("span", "oc-chip oc-tag", text); }

  function keysWidget() {
    var grid = h("div", "oc-keys");
    function key(id, area, cls, html) {
      var k = h("div", "oc-k " + cls, html);
      k.style.gridArea = area;
      grid.appendChild(k);
      refs[id] = k;
      return k;
    }
    key("kW", "1 / 3 / 2 / 5", "", "W");
    key("kA", "2 / 1 / 3 / 3", "", "A");
    key("kS", "2 / 3 / 3 / 5", "", "S");
    key("kD", "2 / 5 / 3 / 7", "", "D");
    key("kSp", "3 / 1 / 4 / 7", "sp", "");
    var l = key("kL", "4 / 1 / 5 / 4", "ms", "<small>LMB</small><em>0</em>");
    var r = key("kR", "4 / 4 / 5 / 7", "ms", "<small>RMB</small><em>0</em>");
    refs.lc = l.lastChild;
    refs.rc = r.lastChild;
    return grid;
  }

  /* default spots, in CSS px; once the player drags a widget it is stored as a 0..1 fraction */
  var DEF = {
    fps: function () { return { x: 10, y: 44 }; },
    cps: function () { return { x: 10, y: 82 }; },
    fb: function () { return { x: 10, y: 120 }; },
    sprint: function () { return { x: 10, y: 158 }; },
    keys: function (vw, vh, bw, bh) { return { x: 10, y: Math.round((vh - bh) * 0.6) }; }
  };

  function place(w) {
    var L = S.layout[w.id], s = (L && L.s) || 1;
    var vw = innerWidth, vh = innerHeight;
    var bw = w.el.offsetWidth * s, bh = w.el.offsetHeight * s, x, y;
    if (L && typeof L.fx === "number") {
      x = L.fx * Math.max(0, vw - bw);
      y = L.fy * Math.max(0, vh - bh);
    } else {
      var d = w.def(vw, vh, bw, bh);
      x = d.x; y = d.y;
    }
    w.el.style.setProperty("--s", s);
    w.el.style.left = clamp(x, 0, Math.max(0, vw - bw)) + "px";
    w.el.style.top = clamp(y, 0, Math.max(0, vh - bh)) + "px";
  }
  function placeAll() { widgets.forEach(place); }

  function commit(w) {
    var vw = innerWidth, vh = innerHeight, r = w.el.getBoundingClientRect();
    var L = S.layout[w.id] || (S.layout[w.id] = { s: 1 });
    L.fx = clamp(parseFloat(w.el.style.left) / Math.max(1, vw - r.width), 0, 1);
    L.fy = clamp(parseFloat(w.el.style.top) / Math.max(1, vh - r.height), 0, 1);
    OC.save();
  }

  /* a widget shows while its mod is on (and, for the small status tags, while the mod's "show tag" option is on);
   * with the overlay open every widget shows, dimmed when its mod is off, so it can be placed */
  function refreshWidgets() {
    widgets.forEach(function (w) {
      var on = !!S.mods[w.mod] && (!w.tag || !!OC.cfg(w.mod, "tag"));
      w.el.classList.toggle("hid", !(state > 0 || on));
      w.el.classList.toggle("off", state > 0 && !on);
    });
  }

  /* per-mod options that change how a widget looks */
  function widgetBox(id) { for (var i = 0; i < widgets.length; i++) if (widgets[i].id === id) return widgets[i].box; return null; }
  function flag(box, name, on) { if (box) { if (on) box.setAttribute(name, ""); else box.removeAttribute(name); } }
  function applyCfg() {
    [["fps", "fps"], ["cps", "cps"]].forEach(function (p) {
      var box = widgetBox(p[0]);
      if (!box) return;
      flag(box, "data-nolabel", !OC.cfg(p[1], "label"));
      flag(box, "data-nobg", !OC.cfg(p[1], "bg"));
      box.style.setProperty("--oc-c", OC.cfg(p[1], "color"));
    });
    var kb = widgetBox("keys");
    if (kb) {
      var c = OC.cfg("keystrokes", "color");
      flag(kb, "data-nomouse", !OC.cfg("keystrokes", "mouse"));
      flag(kb, "data-nospace", !OC.cfg("keystrokes", "space"));
      kb.style.setProperty("--oc-pressed", c);
      kb.style.setProperty("--oc-pressed-glow", c + "55");
    }
  }

  /* ---------- drag, snap, resize ---------- */
  function snap(pos, size, vsize) {
    var targets = [
      { p: MARGIN, line: MARGIN },
      { p: (vsize - size) / 2, line: vsize / 2 },
      { p: vsize - size - MARGIN, line: vsize - MARGIN }
    ];
    for (var i = 0; i < targets.length; i++) {
      if (Math.abs(pos - targets[i].p) <= SNAP) return { pos: targets[i].p, line: targets[i].line };
    }
    return { pos: pos, line: null };
  }
  function showGuide(g, at, vertical) {
    if (at == null) { g.classList.remove("show"); return; }
    g.style[vertical ? "left" : "top"] = at + "px";
    g.classList.add("show");
  }
  function hideGuides() { guideV.classList.remove("show"); guideH.classList.remove("show"); }

  function bindDrag(w) {
    var el = w.el;
    el.addEventListener("pointerdown", function (e) {
      if (!state || e.button !== 0) return;
      e.preventDefault();
      var r = el.getBoundingClientRect();
      drag = { w: w, id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, bw: r.width, bh: r.height };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add("dragging");
    });
    el.addEventListener("pointermove", function (e) {
      if (!drag || drag.w !== w || e.pointerId !== drag.id) return;
      var vw = innerWidth, vh = innerHeight;
      var x = clamp(e.clientX - drag.ox, 0, Math.max(0, vw - drag.bw));
      var y = clamp(e.clientY - drag.oy, 0, Math.max(0, vh - drag.bh));
      var sx = snap(x, drag.bw, vw), sy = snap(y, drag.bh, vh);
      el.style.left = sx.pos + "px";
      el.style.top = sy.pos + "px";
      showGuide(guideV, sx.line, true);
      showGuide(guideH, sy.line, false);
    });
    function end(e) {
      if (!drag || drag.w !== w) return;
      drag = null;
      el.classList.remove("dragging");
      hideGuides();
      commit(w);
      try { el.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", function (e) {
      if (!state) return;
      e.preventDefault();
      e.stopPropagation();
      var L = S.layout[w.id] || (S.layout[w.id] = { s: 1 });
      var left = parseFloat(el.style.left) || 0, top = parseFloat(el.style.top) || 0;
      L.s = clamp((L.s || 1) * (e.deltaY < 0 ? 1.07 : 1 / 1.07), 0.6, 2.2);
      el.style.setProperty("--s", L.s);
      var r = el.getBoundingClientRect();
      el.style.left = clamp(left, 0, Math.max(0, innerWidth - r.width)) + "px";
      el.style.top = clamp(top, 0, Math.max(0, innerHeight - r.height)) + "px";
      commit(w);
    }, { passive: false });
  }

  function resetLayout() {
    S.layout = {};
    OC.save();
    placeAll();
  }

  /* ---------- states ---------- */
  function blurFocus() {
    var a = document.activeElement;
    if (a && a !== document.body && root && root.contains(a)) a.blur();
  }

  function setState(n) {
    if (!built) build();
    if (!built || n === state) return;
    var prev = state;
    state = n;
    root.classList.toggle("oc-open", n > 0);
    root.classList.toggle("oc-edit", n > 0);          // widgets are movable as soon as the overlay opens
    document.body.classList.toggle("oc-ui-open", n > 0);
    if (prev === 0 && n > 0) { OC.stopZoom(); OC.releaseLock(); }   // free the mouse without the game noticing (no Esc menu)
    if (n === 0) { drag = null; hideGuides(); blurFocus(); OC.restoreLock(); }
    refreshWidgets();
    OC.emit("ui", n);
  }

  OC.ui = {
    isOpen: function () { return state > 0; },
    state: function () { return state; },
    toggle: function () { setState(state ? 0 : 1); },
    close: function () { setState(0); },
    /* Esc: close the top-most layer (a key being chosen, a settings page, the Mods menu), then the overlay itself */
    back: function () { if (OC.mods && OC.mods.back()) return; setState(0); },
    /* open the overlay straight into the Mods menu (used by the Home page's Mods button) */
    openMods: function () { setState(1); if (OC.mods) OC.mods.open(); },
    resetLayout: resetLayout,
    relayout: function () { if (!built) return; applyCfg(); refreshWidgets(); placeAll(); },       // the settings were replaced from outside (a server's own settings): draw everything again
    /* widgets for mods loaded with "Load mods": a draggable chip that shows while its mod key (S.mods[mod]) is on */
    get built() { return built; },
    addWidget: function (id, mod, inner, def, isTag) {
      if (!built) return null;
      for (var i = 0; i < widgets.length; i++) if (widgets[i].id === id) return widgets[i];
      var w = addWidget(id, mod, inner, def, isTag);
      place(w); refreshWidgets();
      return w;
    },
    removeWidget: function (id) {
      for (var i = 0; i < widgets.length; i++) {
        if (widgets[i].id === id) { var w = widgets[i]; widgets.splice(i, 1); if (w.el.parentNode) w.el.parentNode.removeChild(w.el); return true; }
      }
      return false;
    },
    /* the size of a widget (0.6 .. 2.2): the mouse wheel in the overlay and a mod's size slider change the same value */
    getScale: function (id) { var L = S.layout[id]; return (L && L.s) || 1; },
    setScale: function (id, s) {
      var L = S.layout[id] || (S.layout[id] = { s: 1 });
      L.s = clamp(+s || 1, 0.6, 2.2);
      for (var i = 0; i < widgets.length; i++) if (widgets[i].id === id) { place(widgets[i]); break; }
      OC.save();
    }
  };

  /* ---------- build ---------- */
  function noFocus(btn) {
    btn.type = "button";
    btn.tabIndex = -1;
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    return btn;
  }

  function build() {
    if (built || !document.body) return;
    built = true;

    root = h("div"); root.id = "oc-root";
    back = h("div"); back.id = "oc-back";
    hud = h("div"); hud.id = "oc-hud";
    front = h("div"); front.id = "oc-front";
    root.appendChild(back); root.appendChild(hud); root.appendChild(front);

    // widgets
    addWidget("fps", "fps", chip("FPS", "fps"), DEF.fps);
    addWidget("cps", "cps", chip("CPS", "cps"), DEF.cps);
    addWidget("fb", "fullbright", tag("Fullbright"), DEF.fb, true);
    addWidget("sprint", "toggleSprint", tag("Sprint"), DEF.sprint, true);
    addWidget("keys", "keystrokes", keysWidget(), DEF.keys);

    // stage 1: the Mods button opens the Mods menu
    var home = h("div"); home.id = "oc-home";
    var mods = noFocus(h("button", "oc-mods oc-glass", '<svg class="oc-ic" viewBox="0 0 24 24" aria-hidden="true">' + ICON_GRID + "</svg><span>Mods</span>"));
    mods.addEventListener("click", function () { if (OC.mods) OC.mods.open(); else OC.emit("mods"); });
    home.appendChild(mods);
    home.appendChild(h("div", "oc-sub", "Press Right Shift to close"));
    front.appendChild(home);

    // editor chrome
    var edit = h("div"); edit.id = "oc-edit";
    edit.appendChild(h("div", "oc-hint oc-glass", "<b>Drag</b> to move &nbsp;&middot;&nbsp; <b>Scroll</b> to resize"));
    guideV = h("div", "oc-guide v");
    guideH = h("div", "oc-guide h");
    edit.appendChild(guideV);
    edit.appendChild(guideH);
    front.appendChild(edit);

    toastEl = h("div", "oc-toast oc-glass", "<span>Press</span><kbd>Right Shift</kbd><span>to open OneClient</span>");
    front.appendChild(toastEl);

    root.addEventListener("contextmenu", function (e) { if (state) e.preventDefault(); });

    document.body.appendChild(root);
    placeAll();
    applyCfg();
    refreshWidgets();
    OC.on("mod", refreshWidgets);
    OC.on("cfg", function () { applyCfg(); refreshWidgets(); });
    OC.on("f1", function () { hud.classList.toggle("oc-hidehud"); });
    window.addEventListener("resize", placeAll);
    OC.emit("ui-built", { root: root, front: front, hud: hud });
  }

  /* ---------- per-frame HUD values ---------- */
  OC.frame = function (now) {
    if (!built) return;
    var c = OC.cps(now), d = OC.down, m = OC.mouse;
    setText(refs.fps, OC.fps);
    setText(refs.cps, OC.cfg("cps", "right") ? c[0] + " | " + c[1] : String(c[0]));
    setText(refs.lc, c[0]);
    setText(refs.rc, c[1]);
    setOn(refs.kW, !!(d.KeyW || d.ArrowUp));
    setOn(refs.kA, !!(d.KeyA || d.ArrowLeft));
    setOn(refs.kS, !!(d.KeyS || d.ArrowDown));
    setOn(refs.kD, !!(d.KeyD || d.ArrowRight));
    setOn(refs.kSp, !!d.Space);
    setOn(refs.kL, !!m[0]);
    setOn(refs.kR, !!m[2]);
  };

  /* ---------- welcome toast (first few launches only) ---------- */
  function waitForGame(t0) {
    if (window.__eaglerGameReady === true) {
      setTimeout(function () {
        if (!built || S.toasts >= 3) return;
        S.toasts++;
        OC.save();
        toastEl.classList.add("show");
        setTimeout(function () { toastEl.classList.remove("show"); }, 5200);
      }, 700);
      return;
    }
    if (Date.now() - t0 < 300000) setTimeout(function () { waitForGame(t0); }, 500);
  }

  function init() { build(); waitForGame(Date.now()); }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
