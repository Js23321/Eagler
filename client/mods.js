/* OneClient Mods menu + crosshair.
 *
 *   Mods button (Right Shift overlay) -> a blurred glass rectangle with one card per mod:
 *       icon, name, and a green "Enabled" / red "Disabled" button that is the bottom edge of the card.
 *   click the green / red button      -> turn the mod on or off
 *   click anywhere else on the card   -> that mod's settings page (hotkey, sliders, colours ...)
 *
 * Settings live in OC.S.cfg (core.js: OC.cfg / OC.setCfg, defaults in OC.CFG_DEF) and apply at once.
 * The crosshair changer hides the game's own crosshair (core.js skips its one draw call while the mouse is captured) and
 * shows the player's design in a small overlay in the middle of the screen. ASCII-only source. */
(function () {
  "use strict";

  var OC = window.OneClient, S = OC.S;
  var built = false, front = null, layer, panel, views, grid, setView, preview = null;
  var menuOpen = false, current = null, capturing = null, rows = [], cards = {}, ext = {}, ovl = null;

  var ICONS = {
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    pointer: '<path d="M5 3l14 7-6 2-2 6z"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3v3.5a5 5 0 0 0 2 4l3 1.5-3 1.5a5 5 0 0 0-2 4V21M17 3v3.5a5 5 0 0 1-2 4L12 12l3 1.5a5 5 0 0 1 2 4V21"/>',
    stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 3h5M12 3v3"/>',
    server: '<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M7.5 7.2h.01M7.5 16.8h.01"/>',
    memory: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    signal: '<path d="M4 20v-4M9 20v-8M14 20V8M19 20V4"/>',
    gauge: '<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="M12 14l4-5"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    apple: '<path d="M12 7c-2-2-6-1-6 4 0 4 3 8 6 8s6-4 6-8c0-5-4-6-6-4z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/>',
    flask: '<path d="M9.5 3h5M10.5 3v6L5 18.5A2 2 0 0 0 6.7 21.5h10.6A2 2 0 0 0 19 18.5L13.5 9V3"/><path d="M8 15h8"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z"/>',
    flame: '<path d="M12 3c1 3-3 4.5-3 8a3.5 3.5 0 0 0 7 0c0-1-.5-2-1-3 3 1.5 4 4.5 4 6.5a7.5 7.5 0 0 1-15 0C4 8 11 7 12 3z"/>',
    ruler: '<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    chunks: '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>',
    hitbox: '<rect x="5.5" y="3.5" width="13" height="17" rx="1.5" stroke-dasharray="3 2.5"/><circle cx="12" cy="9" r="2"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
    sneak: '<path d="M12 4v13M6.5 12l5.5 5.5 5.5-5.5M5 21h14"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    fov: '<path d="M3 12L21 5v14z"/>',
    fog: '<path d="M7 16.5h10a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.7-1.2A4.2 4.2 0 0 0 7 16.5z"/><path d="M5 20h14"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01"/>',
    blur: '<path d="M3 8h8M3 12h14M3 16h8"/><circle cx="18" cy="12" r="2.5"/>',
    drop: '<path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    rain: '<path d="M7 15h10a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.7-1.2A4.2 4.2 0 0 0 7 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
    pack: '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
    items: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 14v6M14 17h6"/>',
    map: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    bomb: '<circle cx="10.5" cy="14" r="6.5"/><path d="M15 9.5l3-3M17.5 4l2.5 2.5M19.5 3.5v-1.5M21.5 5.5h1.5M20 8l1-1"/>'
  };
  function icon(n) { return '<svg class="oc-ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + "</svg>"; }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function noFocus(b) { b.type = "button"; b.tabIndex = -1; b.addEventListener("mousedown", function (e) { if (e.target.tagName !== "INPUT") e.preventDefault(); }); return b; }

  /* ---------- what each mod offers ---------- */
  var COLORS = ["#ffffff", "#9cd0ff", "#7dffb2", "#ffe27a", "#ffa37a", "#ff7a9c", "#c79bff", "#7af0ff"];
  var STYLES = [["cross", "Cross"], ["tee", "T"], ["x", "X"], ["circle", "Circle"], ["square", "Square"], ["brackets", "Corners"], ["dot", "Dot"]];
  var HOT = function (note) { return { k: "key", type: "key", label: "Hotkey", note: note }; };

  var MODS = [
    { k: "fullbright", cat: "Visual", name: "Fullbright", icon: "sun", desc: "See clearly everywhere, even in caves and at night.", settings: [
      HOT("Toggles Fullbright while you play"),
      { k: "strength", type: "range", label: "Brightness", note: "How bright dark places get", min: 10, max: 100, step: 5, unit: "%" },
      { k: "tag", type: "toggle", label: "Show status tag", note: "A small tag on screen while it is on" }
    ] },
    { k: "fps", cat: "HUD", name: "FPS", icon: "activity", desc: "Shows how many frames per second the game runs at.", settings: [
      { k: "label", type: "toggle", label: "Show label", note: "The word FPS next to the number" },
      { k: "bg", type: "toggle", label: "Background", note: "A dark glass box behind the counter" },
      { k: "color", type: "color", label: "Text color" }
    ] },
    { k: "cps", cat: "HUD", name: "CPS", icon: "pointer", desc: "Shows how many times you click per second.", settings: [
      { k: "right", type: "toggle", label: "Show right clicks", note: "Left | right instead of left only" },
      { k: "label", type: "toggle", label: "Show label", note: "The word CPS next to the numbers" },
      { k: "bg", type: "toggle", label: "Background", note: "A dark glass box behind the counter" },
      { k: "color", type: "color", label: "Text color" }
    ] },
    { k: "keystrokes", cat: "HUD", name: "Keystrokes", icon: "keyboard", desc: "Shows WASD, space and your mouse buttons as you press them.", settings: [
      { k: "mouse", type: "toggle", label: "Mouse buttons", note: "The LMB and RMB keys" },
      { k: "space", type: "toggle", label: "Space bar", note: "The jump key under WASD" },
      { k: "color", type: "color", label: "Pressed color" }
    ] },
    { k: "zoom", cat: "Utility", name: "Zoom", icon: "zoom", desc: "Hold a key to zoom in like a spyglass.", settings: [
      HOT("Hold it to zoom"),
      { k: "factor", type: "range", label: "Zoom strength", note: "How far it zooms in", min: 1.5, max: 8, step: 0.1, unit: "x", get: function () { return S.zoomFactor; }, set: function (v) { OC.setZoomFactor(v); } },
      { k: "smooth", type: "toggle", label: "Smooth zoom", note: "Ease in and out instead of snapping" },
      { k: "scroll", type: "toggle", label: "Scroll to adjust", note: "The mouse wheel changes the strength while zooming" }
    ] },
    { k: "toggleSprint", cat: "Utility", name: "Toggle Sprint", icon: "bolt", desc: "Keeps you sprinting while you hold forward.", settings: [
      HOT("Turns toggle sprint on or off"),
      { k: "tag", type: "toggle", label: "Show status tag", note: "A small tag on screen while it is on" }
    ] },
    { k: "crosshair", cat: "Visual", name: "Crosshair", icon: "crosshair", desc: "Replace the game's crosshair with your own design.", preview: true, settings: [
      { k: "style", type: "choice", label: "Style", opts: STYLES, thumbs: true },
      { k: "color", type: "color", label: "Color", note: "Ignored when \"Match the game\" is on", when: function (c) { return !c.invert; } },
      { k: "size", type: "range", label: "Size", min: 6, max: 48, step: 1, unit: "px" },
      { k: "thickness", type: "range", label: "Thickness", min: 1, max: 6, step: 1, unit: "px", when: function (c) { return c.style !== "dot"; } },
      { k: "gap", type: "range", label: "Gap in the middle", min: 0, max: 16, step: 1, unit: "px", when: function (c) { return c.style === "cross" || c.style === "tee" || c.style === "x"; } },
      { k: "opacity", type: "range", label: "Opacity", min: 20, max: 100, step: 5, unit: "%" },
      { k: "dot", type: "toggle", label: "Center dot", note: "A small dot in the middle", when: function (c) { return c.style !== "dot"; } },
      { k: "outline", type: "toggle", label: "Outline", note: "A thin dark edge so it shows on bright scenes", when: function (c) { return !c.invert; } },
      { k: "invert", type: "toggle", label: "Match the game", note: "Draws inverted over the scene, like the game's own crosshair" }
    ] }
  ];
  function modByKey(k) { for (var i = 0; i < MODS.length; i++) if (MODS[i].k === k) return MODS[i]; return null; }
  function getVal(mod, st) { return st.get ? st.get() : (mod.external ? undefined : OC.cfg(mod.k, st.k)); }
  function setVal(mod, st, v) { if (st.set) st.set(v); else if (!mod.external) OC.setCfg(mod.k, st.k, v); }
  function cfgOf(mod) {                                        // all current values of a mod (for "when" tests)
    var o = {};
    mod.settings.forEach(function (st) { if (st.k) o[st.k] = getVal(mod, st); });
    return o;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hue(s) { var n = 0; s = String(s); for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n % 360; }

  /* ---------- crosshair drawing (used by the screen overlay, the preview and the style buttons) ---------- */
  function xhMarkup(c) {
    var t = clamp(+c.thickness || 2, 1, 8), R = clamp(+c.size || 18, 4, 80) / 2, g = clamp(+c.gap || 0, 0, Math.max(0, R - 2));
    var W = Math.ceil(R * 2 + (t + 4) * 2); if (W % 2) W++;
    var cx = W / 2, lines = "", ring = 0, rect = 0, dotR = 0, style = c.style;
    var color = c.invert ? "#ffffff" : c.color;
    function arm(x1, y1, x2, y2) { return "M" + x1 + " " + y1 + "L" + x2 + " " + y2; }
    if (style === "cross" || style === "tee") {
      lines = arm(cx - R, cx, cx - g, cx) + arm(cx + g, cx, cx + R, cx) + arm(cx, cx + g, cx, cx + R);
      if (style === "cross") lines += arm(cx, cx - R, cx, cx - g);
    } else if (style === "x") {
      var a0 = g / 1.4142, a1 = R / 1.4142;
      lines = arm(cx - a1, cx - a1, cx - a0, cx - a0) + arm(cx + a0, cx + a0, cx + a1, cx + a1) + arm(cx + a1, cx - a1, cx + a0, cx - a0) + arm(cx - a0, cx + a0, cx - a1, cx + a1);
    } else if (style === "circle") ring = R * 0.8;
    else if (style === "square") rect = R * 0.75;
    else if (style === "brackets") {
      var q = R * 0.85, L = R * 0.55;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) { lines += "M" + (cx + s[0] * q) + " " + (cx + s[1] * (q - L)) + "V" + (cx + s[1] * q) + "H" + (cx + s[0] * (q - L)); });
    } else if (style === "dot") dotR = Math.max(t, R * 0.3);
    if (c.dot && style !== "dot") dotR = Math.max(1.5, t * 0.8);
    function layer(stroke, sw, fill, grow, alpha) {
      var s = '<g fill="none" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linejoin="miter"' + (alpha ? ' opacity="' + alpha + '"' : "") + ">";
      if (lines) s += '<path d="' + lines + '"/>';
      if (ring) s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + ring + '"/>';
      if (rect) s += '<rect x="' + (cx - rect) + '" y="' + (cx - rect) + '" width="' + rect * 2 + '" height="' + rect * 2 + '"/>';
      s += "</g>";
      if (dotR) s += '<circle cx="' + cx + '" cy="' + cx + '" r="' + (dotR + grow) + '" fill="' + fill + '"/>';
      return s;
    }
    var crisp = style === "cross" || style === "tee" || style === "square" || style === "brackets";
    var body = (c.outline && !c.invert ? layer("#000", t + 2, "#000", 1, 0.85) : "") + layer(color, t, color, 0, 0);
    return { size: W, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + W + '" viewBox="0 0 ' + W + " " + W + '" shape-rendering="' + (crisp ? "crispEdges" : "geometricPrecision") + '">' + body + "</svg>" };
  }
  function xhCfg() {
    var o = {};
    Object.keys(OC.CFG_DEF.crosshair).forEach(function (k) { o[k] = OC.cfg("crosshair", k); });
    return o;
  }

  /* the crosshair on screen: a small element beside the game canvas, centred, shown only while the game itself would
   * draw a crosshair (core.js tells us per frame) and no OneClient layer is up */
  var xhEl = null, xhSig = "";
  function xhEnsure() {
    if (xhEl || !document.body) return;
    xhEl = h("div"); xhEl.id = "oc-xh";
    document.body.appendChild(xhEl);
  }
  function xhUpdate() {
    xhEnsure();
    if (!xhEl) return;
    var on = !!(S.mods.crosshair && OC.xhVisible() && !(OC.ui && OC.ui.isOpen()) && !(OC.menu && OC.menu.visible));
    if (!on) { xhEl.style.display = "none"; return; }
    var c = xhCfg(), sig = JSON.stringify(c);
    if (sig !== xhSig) {
      xhSig = sig;
      var m = xhMarkup(c);
      xhEl.innerHTML = m.svg;
      xhEl.style.width = xhEl.style.height = m.size + "px";
      xhEl.style.opacity = String(clamp(c.opacity, 5, 100) / 100);
      xhEl.style.mixBlendMode = c.invert ? "difference" : "normal";
    }
    xhEl.style.left = Math.round(innerWidth / 2 - xhEl.offsetWidth / 2) + "px";
    xhEl.style.top = Math.round(innerHeight / 2 - xhEl.offsetHeight / 2) + "px";
    xhEl.style.display = "block";
  }

  /* ---------- key names ---------- */
  var KEYNAMES = { Space: "Space", ShiftLeft: "Left Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl", AltLeft: "Left Alt", AltRight: "Right Alt", Tab: "Tab", CapsLock: "Caps", Enter: "Enter", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Insert: "Insert", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down" };
  function keyLabel(code) {
    if (!code) return "None";
    var m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(code);
    if (m) return m[1];
    return KEYNAMES[code] || code.replace(/^Numpad/, "Num ");
  }

  /* ---------- controls ---------- */
  function rowText(st, external) {
    var l = external ? esc(st.label) : st.label, n = external ? esc(st.note) : st.note;
    return '<div class="ocx-rl"><b>' + l + "</b>" + (st.note ? "<small>" + n + "</small>" : "") + "</div>";
  }

  function makeRow(mod, st) {
    var x = !!mod.external;
    if (st.type === "section") return { el: h("div", "ocx-sec", esc(st.label)), st: st, update: function () {} };
    if (st.type === "info") return { el: h("div", "ocx-info", esc(st.label)), st: st, update: function () {} };
    var row = h("div", "ocx-row" + (st.type === "choice" ? " col" : ""), rowText(st, x)), ctl, update;
    if (st.type === "button") {
      var btnText = function () { var t = typeof st.text === "function" ? st.text() : st.text; return String(t || "Run"); };
      ctl = noFocus(h("button", "ocx-act", esc(btnText())));
      ctl.addEventListener("click", function () { try { if (st.onClick) st.onClick(); } catch (e) { console.error("[OneClient]", e); } });
      row.appendChild(ctl);
      update = function () { var t = btnText(); if (ctl.textContent !== t) ctl.textContent = t; };
    } else if (st.type === "text") {
      var inp = h("input", "ocx-text");
      inp.type = "text"; inp.spellcheck = false; inp.autocomplete = "off"; inp.placeholder = st.placeholder || ""; inp.tabIndex = -1;
      inp.addEventListener("input", function () { setVal(mod, st, inp.value); });
      row.appendChild(inp);
      update = function () { var v = String(getVal(mod, st) == null ? "" : getVal(mod, st)); if (document.activeElement !== inp && inp.value !== v) inp.value = v; };
    } else if (st.type === "toggle") {
      ctl = noFocus(h("button", "ocx-switch", "<i></i>"));
      ctl.addEventListener("click", function () { setVal(mod, st, !getVal(mod, st)); });
      update = function () { ctl.classList.toggle("on", !!getVal(mod, st)); };
      row.appendChild(ctl);
    } else if (st.type === "range") {
      var box = h("div", "ocx-rc"), rng = h("input", "ocx-range"), out = h("output");
      rng.type = "range"; rng.min = st.min; rng.max = st.max; rng.step = st.step; rng.tabIndex = -1;
      rng.addEventListener("input", function () { setVal(mod, st, +rng.value); });
      box.appendChild(rng); box.appendChild(out); row.appendChild(box);
      update = function () {
        var v = +getVal(mod, st);
        if (+rng.value !== v) rng.value = v;
        rng.style.setProperty("--p", ((v - st.min) / (st.max - st.min) * 100) + "%");
        var u = st.unit || "";
        out.textContent = (st.step < 1 ? v.toFixed(st.step < 0.1 ? 2 : 1) : Math.round(v)) + (u === "x" || u === "%" ? u : u ? " " + u : "");
      };
    } else if (st.type === "choice") {
      var seg = h("div", "ocx-seg"), btns = [];
      st.opts.forEach(function (o) {
        var b = noFocus(h("button", "ocx-opt" + (st.thumbs ? "" : " txt"), (st.thumbs ? "<span class=\"th\"></span>" : "") + "<span>" + (x ? esc(o[1]) : o[1]) + "</span>"));
        b.addEventListener("click", function () { setVal(mod, st, o[0]); });
        b._v = o[0]; btns.push(b); seg.appendChild(b);
      });
      row.appendChild(seg);
      update = function () {
        var v = getVal(mod, st), cc = mod.k === "crosshair" ? xhCfg() : null;
        btns.forEach(function (b) {
          b.classList.toggle("on", b._v === v);
          var th = b.querySelector(".th");
          if (th && cc && !th.firstChild) th.innerHTML = xhMarkup({ style: b._v, color: "#ffffff", size: 26, thickness: 2, gap: 4, dot: false, outline: false, invert: false }).svg;
        });
      };
    } else if (st.type === "color") {
      var sw = h("div", "ocx-swatches"), dots = [];
      COLORS.forEach(function (c) {
        var b = noFocus(h("button", "ocx-sw")); b.style.setProperty("--c", c); b.title = c; b._c = c;
        b.addEventListener("click", function () { setVal(mod, st, c); });
        dots.push(b); sw.appendChild(b);
      });
      var cust = h("label", "ocx-sw custom"), inp = h("input"); inp.type = "color"; inp.tabIndex = -1; inp.title = "Pick any color";
      inp.addEventListener("input", function () { setVal(mod, st, inp.value); });
      cust.appendChild(inp); sw.appendChild(cust); row.appendChild(sw);
      update = function () {
        var v = String(getVal(mod, st)).toLowerCase(), hit = false;
        dots.forEach(function (b) { var on = b._c === v; hit = hit || on; b.classList.toggle("on", on); });
        cust.classList.toggle("on", !hit);
        if (/^#[0-9a-f]{6}$/.test(v)) inp.value = v;
      };
    } else if (st.type === "key") {
      ctl = noFocus(h("button", "ocx-key"));
      ctl.addEventListener("click", function () { startCapture(mod, st, ctl); });
      row.appendChild(ctl);
      update = function () { if (!capturing || capturing.btn !== ctl) ctl.textContent = keyLabel(getVal(mod, st)); ctl.classList.toggle("cap", !!(capturing && capturing.btn === ctl)); };
      row._keyBtn = ctl;
    }
    return { el: row, st: st, update: update };
  }

  function refreshRows() {
    if (!current) return;
    var c = cfgOf(current);
    rows.forEach(function (r) {
      r.update();
      r.el.style.display = r.st.when && !r.st.when(c) ? "none" : "";
    });
    if (preview) preview.innerHTML = xhMarkup(xhCfg()).svg;
  }

  /* ---------- choosing a hotkey ---------- */
  function startCapture(mod, st, btn) {
    cancelCapture();
    capturing = { mod: mod, st: st, btn: btn };
    btn.textContent = "Press a key\u2026";
    btn.classList.add("cap");
  }
  function cancelCapture() {
    if (!capturing) return false;
    var c = capturing;
    capturing = null;
    c.btn.classList.remove("cap");
    c.btn.textContent = keyLabel(getVal(c.mod, c.st));
    return true;
  }
  window.addEventListener("keydown", function (e) {
    if (!capturing || e.__oc) return;
    if (e.code === "Escape") return;                              // handled by OC.ui.back (cancels)
    e.preventDefault();
    if (e.code === "ShiftRight") { capturing.btn.textContent = "Right Shift opens this menu"; return; }
    var c = capturing;
    capturing = null;
    setVal(c.mod, c.st, e.code === "Backspace" || e.code === "Delete" ? "" : e.code);
  }, true);

  /* ---------- the menu ---------- */
  function iconHtml(info) {                                    // a loaded mod's icon: its own picture, one of the menu's icons (built-in mods), or a coloured letter
    if (info.iconKey && ICONS[info.iconKey]) return '<span class="ocx-ico">' + icon(info.iconKey) + "</span>";
    if (info.icon) return '<span class="ocx-ico img"><img alt="" src="' + esc(info.icon) + '"></span>';
    var hu = hue(info.name);
    return '<span class="ocx-ico lt" style="--c1:hsl(' + hu + ',70%,62%);--c2:hsl(' + ((hu + 40) % 360) + ',70%,46%)">' + esc((info.name || "?").charAt(0).toUpperCase()) + "</span>";
  }
  function addCard(i, k, nameHtml, iconMarkup, title, onOpen, onToggle) {
    var card = h("div", "ocx-card");
    card.style.setProperty("--i", Math.min(i, 12));
    var body = noFocus(h("button", "ocx-body", '<span class="ocx-gear">' + icon("gear") + "</span>" + iconMarkup + '<span class="ocx-name">' + nameHtml + "</span>"));
    body.title = title;
    body.addEventListener("click", onOpen);
    var state = noFocus(h("button", "ocx-state", "<i></i><span></span>"));
    state.addEventListener("click", onToggle);
    card.appendChild(body); card.appendChild(state);
    grid.appendChild(card);
    cards[k] = { el: card, label: state.lastChild, btn: state };
  }
  /* every mod the menu can show, in the order of the categories: the game-level mods, OneClient's built-in ones, then the ones you loaded */
  var CATS = ["HUD", "World", "Visual", "Utility"];
  var view = { cat: "All", q: "", on: false };
  function catalog() {
    var out = [];
    MODS.forEach(function (m, i) { out.push({ k: m.k, name: m.name, desc: m.desc, cat: m.cat || "Utility", order: i - 1000, core: m, enabled: function () { return !!S.mods[m.k]; } }); });
    (OC.loader ? OC.loader.list() : []).forEach(function (info) {
      out.push({ k: info.k, name: info.name, desc: info.description || "", cat: info.builtin ? (CATS.indexOf(info.category) >= 0 ? info.category : "Utility") : "Yours", order: info.order || 0, info: info, enabled: function () { var c = OC.loader.info(info.id); return !!(c && c.enabled); } });
    });
    return out;
  }
  function catIcon(m) { return m.core ? '<span class="ocx-ico">' + icon(m.core.icon) + "</span>" : iconHtml(m.info); }
  function matches(m) {
    if (view.cat !== "All" && m.cat !== view.cat) return false;
    if (view.on && !m.enabled()) return false;
    var q = view.q.trim().toLowerCase();
    if (!q) return true;
    var hay = (m.name + " " + m.desc + " " + (m.cat === "Yours" ? "your loaded" : m.cat)).toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }
  var gridSig = "";
  function renderCards(still) {
    grid.textContent = "";
    grid.classList.toggle("still", !!still);
    cards = {}; ext = {};
    var all = catalog(), shown = all.filter(matches), n = 0;
    gridSig = all.map(function (m) { return m.k; }).join("|");
    var order = CATS.concat(["Yours"]);
    order.forEach(function (cat) {
      var list = shown.filter(function (m) { return m.cat === cat; });
      if (!list.length) return;
      list.sort(function (a, b) { return a.order - b.order; });
      if (view.cat === "All" || cat === "Yours") grid.appendChild(h("div", "ocx-sechead", "<span>" + (cat === "Yours" ? "Your mods" : cat) + "</span><small>" + list.length + "</small>"));
      list.forEach(function (m) {
        if (m.core) addCard(n++, m.k, m.name, catIcon(m), m.desc, function () { showSettings(m.core); }, function () { OC.toggleMod(m.k); });
        else {
          ext[m.k] = m.info;
          addCard(n++, m.k, esc(m.name), catIcon(m), m.desc || m.name, function () { showSettings(extMod(OC.loader.info(m.info.id) || m.info)); }, function () {
            var cur = OC.loader.info(m.info.id);
            if (!cur || cur.unsupported) showSettings(extMod(cur || m.info)); else OC.toggleMod(m.k);
          });
        }
      });
    });
    if (!shown.length) grid.appendChild(h("div", "ocx-empty", view.on && !view.q && view.cat === "All" ? "No mod is switched on yet." : "No mods match" + (view.q ? " \u201c" + esc(view.q.trim()) + "\u201d" : "") + "."));
    refreshCards();
    updateChips(all);
  }

  /* per-server settings (client/profiles.js): the strip under the title. On a server it offers the server its own settings; the box ticks while they are in force. */
  var srvEl = null, srvBox = null, srvText = null, srvHint = null;
  function buildServerBar() {
    srvEl = h("div", "ocx-srv");
    var left = h("div", "ocx-srvtext");
    srvText = h("b"); srvHint = h("span");
    left.appendChild(srvText); left.appendChild(srvHint);
    var lab = h("label", "ocx-srvsw");
    srvBox = h("input"); srvBox.type = "checkbox"; srvBox.tabIndex = -1;
    srvBox.addEventListener("change", function () { if (OC.profiles && !OC.profiles.setOwn(srvBox.checked)) srvBox.checked = false; updateServerBar(); });
    lab.appendChild(srvBox); lab.appendChild(h("span", null, "Own settings for this server"));
    srvEl.appendChild(left); srvEl.appendChild(lab);
    updateServerBar();
    return srvEl;
  }
  function updateServerBar() {
    if (!srvEl) return;
    if (!OC.profiles) { srvEl.style.display = "none"; return; }
    var i = OC.profiles.info();
    srvEl.classList.toggle("own", i.own);
    srvEl.classList.toggle("idle", !i.connected);
    srvBox.disabled = !i.connected; srvBox.checked = i.own;
    srvText.textContent = !i.connected ? "Settings for each server" : i.own ? i.label + " has its own settings" : "You are on " + i.label;
    srvHint.textContent = !i.connected ? "Join a server and open this menu to give it its own mod settings."
      : i.own ? "What you change now stays with this server. Untick the box to use your normal settings here."
      : "These are your normal settings. Tick the box to give this server its own" + (i.has ? " (the ones it had are brought back)." : " (a copy of these to start with).");
  }

  /* the search box and the category chips above the cards */
  var barEl = null, chipEls = {}, searchEl = null;
  function buildBar() {
    barEl = h("div", "ocx-bar");
    var sw = h("label", "ocx-search", icon("search"));
    searchEl = h("input");
    searchEl.type = "text"; searchEl.placeholder = "Search mods"; searchEl.spellcheck = false; searchEl.autocomplete = "off"; searchEl.tabIndex = -1;
    searchEl.addEventListener("input", function () { view.q = searchEl.value; renderCards(true); });
    sw.appendChild(searchEl);
    barEl.appendChild(sw);
    var chips = h("div", "ocx-chips");
    ["All"].concat(CATS, ["Yours"]).forEach(function (c) { chips.appendChild(chip(c, function () { view.cat = c; renderCards(true); })); });
    chips.appendChild(chip("Enabled", function () { view.on = !view.on; renderCards(true); }, "on"));
    barEl.appendChild(chips);
    return barEl;
  }
  function chip(name, onClick, key) {
    var b = noFocus(h("button", "ocx-chip", esc(name) + "<small></small>"));
    b.addEventListener("click", onClick);
    b.setAttribute("data-k", key || name);
    chipEls[key || name] = b;
    return b;
  }
  function updateChips(all) {
    if (!barEl) return;
    all = all || catalog();
    var counts = { All: all.length, on: 0 };
    all.forEach(function (m) { counts[m.cat] = (counts[m.cat] || 0) + 1; if (m.enabled()) counts.on++; });
    Object.keys(chipEls).forEach(function (k) {
      var b = chipEls[k], on = k === "on" ? view.on : view.cat === k;
      b.classList.toggle("on", on);
      var sm = b.querySelector("small");
      if (sm) sm.textContent = counts[k] === undefined ? "0" : String(counts[k]);
    });
    var extra = all.filter(function (m) { return m.cat === "Yours"; }).length;
    barEl.setAttribute("data-yours", extra);
  }
  function extStatus(info) {                                   // [css class, label, tooltip]
    if (info.unsupported) return ["na", "Can't run", "A real Java mod: it cannot run in this browser build"];
    if (info.error) return ["err", "Error", info.error];
    if (info.starting) return ["", "Starting\u2026", ""];
    return [info.enabled ? "on" : "", info.enabled ? "Enabled" : "Disabled", ""];
  }
  function paintState(el, label, s) {
    el.classList.toggle("on", s[0] === "on"); el.classList.toggle("na", s[0] === "na"); el.classList.toggle("err", s[0] === "err");
    label.textContent = s[1];
  }
  function refreshCards() {
    MODS.forEach(function (m) {
      var c = cards[m.k], on = !!S.mods[m.k];
      if (!c) return;
      c.el.classList.toggle("on", on);
      c.label.textContent = on ? "Enabled" : "Disabled";
    });
    if (OC.loader) Object.keys(ext).forEach(function (k) {
      var c = cards[k], info = OC.loader.info(ext[k].id);
      if (!c || !info) return;
      ext[k] = info;
      var s = extStatus(info);
      paintState(c.el, c.label, s);
      c.btn.title = s[2];
    });
    updateChips();
    if (current && setView) {
      var pill = setView.querySelector(".ocx-pill");
      if (pill) {
        if (current.external) { var i2 = OC.loader && OC.loader.info(current.info.id); if (i2) { var s2 = extStatus(i2); paintState(pill, pill.lastChild, s2); pill.title = s2[2]; } }
        else { var on2 = !!S.mods[current.k]; pill.classList.toggle("on", on2); pill.lastChild.textContent = on2 ? "Enabled" : "Disabled"; }
      }
    }
  }

  /* a loaded mod as a settings page: its schema rows, then one row per key it registered */
  function extRow(id, st) {
    var r = Object.assign({}, st);
    if (st.k && st.type !== "button" && st.type !== "info" && st.type !== "section") {
      if (typeof st.get !== "function") r.get = function () { return OC.loader.cfgGet(id, st.k); };
      if (typeof st.set !== "function") r.set = function (v) { OC.loader.cfgSet(id, st.k, v); };
    }
    if (typeof st.when === "function") r.when = function (c) { try { return st.when(c); } catch (e) { return true; } };
    return r;
  }
  function extMod(info) {
    var id = info.id, list = (info.schema || []).map(function (st) { return extRow(id, st); });
    (info.keys || []).forEach(function (b) {
      list.push({ k: "key:" + b.id, type: "key", label: b.label, note: "", get: function () { return OC.loader.keyGet(id, b.id); }, set: function (v) { OC.loader.keySet(id, b.id, v); } });
    });
    var sig = [(info.schema || []).length, (info.keys || []).length, !!info.panel, info.active, !!info.error, info.unsupported].join("/");
    return { k: info.k, name: info.name, desc: info.description || (info.unsupported ? "A real Minecraft mod" : "A mod you loaded"), external: true, info: info, settings: list, sig: sig };
  }

  var NEEDS = {
    net: "The game's packet data: singleplayer worlds and servers (through a relay, or direct) whose connection is not encrypted. An online-mode server can be read when you joined it with a Java account in OneClient (Multiplayer > Java account, with the login switch on); any other encrypted server cannot.",
    world: "The world the game has loaded: singleplayer worlds and servers whose connection can be read.",
    rewrite: "It changes what the game receives, only on your screen: singleplayer worlds and servers whose connection can be read (see above). An encrypted server OneClient cannot read cannot be changed either.",
    camera: "Nothing special: it reads what the game draws."
  };
  function aboutBlock(inf) {
    var b = h("div", "ocx-about"), real = inf.unsupported;
    var rows = [];
    function add(k, v) { if (v) rows.push("<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>"); }
    var m = inf.manifest || {};
    add("Version", inf.version);
    add("Author", inf.author);
    add("Type", real ? "Real Minecraft mod (" + (m.loader || "Java") + ")" : inf.builtin ? "Built into OneClient (" + (inf.category || "Utility") + ")" : inf.kind === "js" ? "OneClient mod (one .js file)" : "OneClient mod package");
    if (inf.jar) add("Loaded from", inf.jar.name + " " + (inf.jar.version || "") + " (" + inf.jar.loader + ", " + (inf.jar.size / 1048576).toFixed(1) + " MB)");
    else if (!inf.builtin) add("File", inf.file);
    if (inf.builtin && inf.needs) add("Needs", NEEDS[inf.needs] || inf.needs);
    if (real) {
      var dep = m.depends && m.depends.minecraft ? (Array.isArray(m.depends.minecraft) ? m.depends.minecraft.join(" or ") : String(m.depends.minecraft)) : "";
      add("Minecraft", dep);
      add("Files inside", (m.assets || 0) + " asset, " + (m.data || 0) + " data");
    }
    b.innerHTML = "<dl>" + rows.join("") + "</dl>";
    if (real) {
      var p = h("p", "ocx-why", "This is a real Java mod. OneClient is the game compiled to WebAssembly: there is no Java VM, no class loading and no mixins inside it, so the code of this mod cannot run here. Mods written for OneClient (.js / .ocmod) load fine, and OneClient has ports of some popular mods (Litematica).");
      b.appendChild(p);
    } else if (inf.via === "jar") {
      b.appendChild(h("p", "ocx-why", "OneClient has its own port of this mod, so you do not need the jar to run it. The jar you loaded only told OneClient which mod you wanted; its Java code is not used."));
    }
    var st = extStatus(inf);
    if (!real && inf.error) b.appendChild(h("p", "ocx-bad", esc(inf.error)));
    if (inf.logs && inf.logs.length) {
      var d = h("details", "ocx-log"), pre = h("pre");
      d.appendChild(h("summary", null, "Log (" + inf.logs.length + ")"));
      pre.textContent = inf.logs.slice(-40).join("\n");
      d.appendChild(pre); b.appendChild(d);
    }
    return b;
  }

  /* a live copy of the mod's on-screen widgets at the top of its settings page */
  var pvTimer = 0, pvBox = null;
  function stopPreview() { clearInterval(pvTimer); pvTimer = 0; pvBox = null; }
  function startPreview(id) {
    var box = pvBox = h("div", "ocx-hudpv"), inf = OC.loader && OC.loader.info(id), hudMod = !inf || inf.category === "HUD";
    function tick() {
      if (pvBox !== box) return;
      var nodes = OC.kit.preview(id), sig = nodes.length;
      if (!nodes.length) {                                       // nothing to copy: a HUD mod asks to be switched on, a mod that draws in the world has no preview at all
        if (box.firstChild) box.textContent = "";
        if (hudMod) { box.setAttribute("data-empty", ""); box.style.display = ""; } else box.style.display = "none";
        return;
      }
      box.style.display = "";
      box.removeAttribute("data-empty");
      while (box.childNodes.length > nodes.length) box.removeChild(box.lastChild);
      nodes.forEach(function (n, i) {
        var copy = n.cloneNode(true);
        copy.removeAttribute("data-gone");
        var src = n.querySelectorAll("canvas"), dst = copy.querySelectorAll("canvas");      // a cloned canvas is blank: copy its picture over
        for (var ci = 0; ci < src.length && ci < dst.length; ci++) { try { dst[ci].getContext("2d").drawImage(src[ci], 0, 0); } catch (e) { /* tainted or lost: stays blank */ } }
        var old = box.childNodes[i];
        if (old) box.replaceChild(copy, old); else box.appendChild(copy);
      });
    }
    pvTimer = setInterval(tick, 250);
    tick();
    setView.appendChild(box);
  }
  function showGrid() {
    stopPreview();
    cancelCapture();
    current = null; rows = []; preview = null;
    if (barEl) barEl.style.display = "";
    views.setAttribute("data-view", "grid");
  }

  function showSettings(mod) {
    cancelCapture();
    var keepScroll = current && current.k === mod.k ? setView.scrollTop : 0;
    current = mod; rows = []; preview = null;
    setView.textContent = "";
    var x = !!mod.external, inf = mod.info;
    var head = h("div", "ocx-sethead");
    var back = noFocus(h("button", "ocx-back", icon("left")));
    back.title = "Back to all mods";
    back.addEventListener("click", showGrid);
    var ico = x ? h("div", null, iconHtml(inf)).firstChild : h("span", "ocx-ico", icon(mod.icon));
    var tt = h("div", "ocx-settitle", "<h3>" + (x ? esc(mod.name) : mod.name) + "</h3><p>" + (x ? esc(mod.desc) : mod.desc) + "</p>");
    var pill = noFocus(h("button", "ocx-state ocx-pill", "<i></i><span></span>"));
    pill.addEventListener("click", function () { if (x) { if (!inf.unsupported) OC.toggleMod(mod.k); } else OC.toggleMod(mod.k); });
    head.appendChild(back); head.appendChild(ico); head.appendChild(tt); head.appendChild(pill);
    setView.appendChild(head);

    stopPreview();
    if (x && inf.builtin && OC.kit && OC.kit.preview) startPreview(inf.id);
    var body = h("div", "ocx-setbody"), list = h("div", "ocx-rows");
    mod.settings.forEach(function (st) { var r = makeRow(mod, st); rows.push(r); list.appendChild(r.el); });
    body.appendChild(list);
    if (mod.preview) { preview = h("div", "ocx-preview"); body.appendChild(preview); }
    if (mod.settings.length || !x) setView.appendChild(body);

    if (x) {
      if (inf.panel) {                                          // the mod's own controls (file lists, placement ...)
        var pc = h("div", "ocx-custom");
        setView.appendChild(pc);
        try { inf.panel(pc); } catch (e) { pc.textContent = "This mod's page failed to open: " + (e && e.message || e); console.error("[OneClient]", e); }
      }
      setView.appendChild(aboutBlock(inf));
    }

    var foot = h("div", "ocx-setfoot");
    if (x && !inf.builtin) {
      var rm = noFocus(h("button", "ocx-ghost danger", icon("trash") + "<span>Remove mod</span>")), armed = false, tm = 0;
      rm.addEventListener("click", function () {
        if (!armed) { armed = true; rm.querySelector("span").textContent = "Click again to remove"; tm = setTimeout(function () { armed = false; rm.querySelector("span").textContent = "Remove mod"; }, 3200); return; }
        clearTimeout(tm);
        OC.loader.remove(inf.id).then(function () { showGrid(); renderCards(); });
      });
      foot.appendChild(rm);
    }
    if (!x || mod.settings.length) {
      var reset = noFocus(h("button", "ocx-ghost", icon("reset") + "<span>Reset to defaults</span>"));
      reset.addEventListener("click", function () { cancelCapture(); if (x) OC.loader.resetCfg(inf.id); else OC.resetCfg(mod.k); });
      foot.appendChild(reset);
    }
    setView.appendChild(foot);

    pill.style.display = x && inf.unsupported ? "none" : "";
    if (barEl) barEl.style.display = "none";
    views.setAttribute("data-view", "set");
    setView.scrollTop = keepScroll;
    refreshCards();
    refreshRows();
  }

  /* ---------- Load mods: file picker, drag and drop, the notice and the report ---------- */
  function closeOverlay() { if (!ovl) return false; if (ovl.parentNode) ovl.parentNode.removeChild(ovl); ovl = null; return true; }
  function showOverlay(node) {
    closeOverlay();
    ovl = h("div", "ocx-ovl");
    ovl.appendChild(node);
    ovl.addEventListener("click", function (e) { if (e.target === ovl) closeOverlay(); });
    panel.appendChild(ovl);
  }
  function askTrust(then) {
    if (S.modsAck) { then(); return; }
    var d = h("div", "ocx-dlg");
    d.innerHTML = "<h3>Load mods</h3><p>Mods are code. A mod you load runs inside this page with full access to it, like any script you open in your browser. Only load mods from people you trust.</p>" +
      "<p>Real Minecraft mods (.jar) are read for their details. Their Java code cannot run in this browser build; OneClient has its own ports of some of them (Litematica).</p>";
    var a = h("div", "ocx-dlgacts"), no = noFocus(h("button", "ocx-ghost", "Cancel")), yes = noFocus(h("button", "ocx-primary", "I understand, continue"));
    no.addEventListener("click", closeOverlay);
    yes.addEventListener("click", function () { S.modsAck = true; OC.save(); closeOverlay(); then(); });
    a.appendChild(no); a.appendChild(yes); d.appendChild(a);
    showOverlay(d);
  }
  function loadFiles(files) {
    if (!files || !files.length || !OC.loader) return;
    OC.loader.toast("Loading " + files.length + " file" + (files.length > 1 ? "s" : "") + "\u2026");
    OC.loader.addFiles(files).then(showReport, function (e) { OC.loader.toast("Could not load: " + (e && e.message || e), true); });
  }
  function pickAndLoad() {
    askTrust(function () { OC.loader.pickFiles(".js,.ocmod,.zip,.jar,.litematic,.schem,.schematic,.nbt", true).then(loadFiles); });
  }
  function showReport(reports) {
    var ok = reports.filter(function (r) { return r.ok; }).length, d = h("div", "ocx-dlg ocx-report");
    d.appendChild(h("h3", null, ok ? (ok === 1 ? "1 file loaded" : ok + " files loaded") : "Nothing was loaded"));
    var list = h("div", "ocx-replist");
    reports.forEach(function (r) {
      var it = h("div", "ocx-rep " + (r.ok ? "ok" : r.warn ? "warn" : "bad"));
      it.innerHTML = '<span class="mk">' + icon(r.ok ? "check" : "warn") + "</span><div><b>" + esc(r.title || r.file) + "</b>" + (r.lines || []).map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("") + "</div>";
      list.appendChild(it);
    });
    d.appendChild(list);
    var a = h("div", "ocx-dlgacts"), done = noFocus(h("button", "ocx-primary", "Done")), first = null;
    reports.forEach(function (r) { if (!first && r.id) first = r; });
    done.addEventListener("click", closeOverlay);
    if (first && OC.loader.info(first.id)) {
      var op = noFocus(h("button", "ocx-ghost", "Open page"));
      op.addEventListener("click", function () { closeOverlay(); openMod("x:" + first.id); });
      a.appendChild(op);
    }
    a.appendChild(done); d.appendChild(a);
    showOverlay(d);
    renderCards();
  }
  function openMod(k) {
    if (!built) buildMenu();
    if (!menuOpen) { if (OC.ui && !OC.ui.isOpen()) OC.ui.openMods(); else open(); }
    var info = OC.loader && OC.loader.info(String(k).replace(/^x:/, ""));
    if (info) showSettings(extMod(info));
  }

  function buildMenu() {
    if (!front) front = document.getElementById("oc-front");        // ui.js may have been built before this script ran
    if (built || !front) return;
    built = true;
    layer = h("div", "ocx-layer");
    var scrim = h("div", "ocx-scrim");
    scrim.addEventListener("click", function () { close(); });
    panel = h("section", "ocx-panel");
    panel.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });

    var head = h("header", "ocx-head");
    head.appendChild(h("div", "ocx-title", '<span class="ocx-badge">' + icon("grid") + '</span><div><h2>Mods</h2><p>Switch mods on or off, or click a card to change its settings.</p></div>'));
    var acts = h("div", "ocx-headacts");
    if (OC.loader) {
      var lm = noFocus(h("button", "ocx-primary", icon("upload") + "<span>Load mods</span>"));
      lm.title = "Load mods you downloaded: .js or .ocmod mods, real Minecraft .jar mods (Litematica works), schematics";
      lm.addEventListener("click", pickAndLoad);
      acts.appendChild(lm);
    }
    var rl = noFocus(h("button", "ocx-ghost", icon("reset") + "<span>Reset layout</span>"));
    rl.title = "Put the HUD widgets back where they started";
    rl.addEventListener("click", function () { if (OC.ui) OC.ui.resetLayout(); });
    var x = noFocus(h("button", "ocx-x", icon("x")));
    x.title = "Close";
    x.addEventListener("click", function () { close(); });
    acts.appendChild(rl); acts.appendChild(x);
    head.appendChild(acts);
    panel.appendChild(head);

    if (OC.loader) {                                              // drop mod files anywhere on the menu
      var depth = 0;
      function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, "Files") >= 0; }
      panel.addEventListener("dragenter", function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; panel.classList.add("ocx-dropping"); });
      panel.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
      panel.addEventListener("dragleave", function (e) { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; panel.classList.remove("ocx-dropping"); } });
      panel.addEventListener("drop", function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth = 0; panel.classList.remove("ocx-dropping");
        var files = Array.prototype.slice.call(e.dataTransfer.files || []);
        askTrust(function () { loadFiles(files); });
      });
    }

    panel.appendChild(buildServerBar());
    panel.appendChild(buildBar());
    views = h("div", "ocx-views"); views.setAttribute("data-view", "grid");
    var gv = h("div", "ocx-view ocx-grid-view");
    grid = h("div", "ocx-grid");
    gv.appendChild(grid);
    gv.appendChild(h("p", "ocx-note", "Drag the on-screen widgets to move them, scroll over one to resize it." + (OC.loader ? " Press Load mods or drop files here to add mods." : "")));
    setView = h("div", "ocx-view ocx-set-view");
    views.appendChild(gv); views.appendChild(setView);
    panel.appendChild(views);

    layer.appendChild(scrim); layer.appendChild(panel);
    front.appendChild(layer);
    renderCards();
  }

  function open() {
    var rootEl = document.getElementById("oc-root");
    if (!built) buildMenu();
    if (!built || !rootEl) return;
    showGrid();
    if (built) { renderCards(false); updateServerBar(); }
    menuOpen = true;
    rootEl.classList.add("oc-menu");
  }
  function close() {
    stopPreview();
    cancelCapture();
    closeOverlay();
    var rootEl = document.getElementById("oc-root");
    if (rootEl) rootEl.classList.remove("oc-menu");
    menuOpen = false;
    if (built) showGrid();
  }

  /* Esc: a key being chosen -> cancel that; a settings page -> back to the cards; the menu -> close it */
  function back() {
    if (cancelCapture()) return true;
    if (!menuOpen) return false;
    if (closeOverlay()) return true;
    if (current) { showGrid(); return true; }
    close();
    return true;
  }

  OC.mods = { open: open, close: close, back: back, openMod: openMod, isOpen: function () { return menuOpen; }, capturing: function () { return !!capturing; }, keyLabel: keyLabel };

  OC.on("ui-built", function (r) { front = r.front; xhUpdate(); });
  OC.on("ui", function (n) { if (!n) close(); xhUpdate(); });
  OC.on("profiles", function () { if (built) { refreshCards(); refreshRows(); updateServerBar(); } });
  OC.on("mod", function () { refreshCards(); xhUpdate(); });
  OC.on("cfg", function () { refreshRows(); xhUpdate(); });
  OC.on("cfg-ext", function () { refreshRows(); });
  OC.on("loader-changed", function () {                         // a mod was added, removed, started or stopped
    if (!built) return;
    if (current && current.external) {
      var cur = OC.loader.info(current.info.id);
      if (!cur) { showGrid(); renderCards(); return; }
      var nm = extMod(cur);
      if (nm.sig !== current.sig) { showSettings(nm); return; }
      current.info = cur;
      refreshCards();
      return;
    }
    if (views.getAttribute("data-view") === "grid") { if (catalog().map(function (m) { return m.k; }).join("|") !== gridSig) renderCards(true); else refreshCards(); } else refreshCards();
  });
  OC.on("xh", xhUpdate);
  window.addEventListener("resize", xhUpdate);
})();
