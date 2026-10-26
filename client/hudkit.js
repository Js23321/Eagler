/* OneClient HUD kit: the building blocks the built-in on-screen mods share, so that every one of them looks the same and offers the same
 * good settings (text colour, label, glass background and its opacity, corner roundness, text shadow, size).
 *
 * A mod gets its own copy as api.kit:
 *
 *   api.settings.define(api.kit.settings({ rows: [ ...the mod's own settings... ], label: true }));
 *   if (api.schemaOnly) return;
 *   var hud = api.kit.hud({ id: "main", anchor: "tl", row: 4 });       // a draggable widget; anchor: t|c|b + l|c|r (default spot), row: 0, 1, 2 ... stacks widgets
 *   hud.set([["X", "12.5"], ["Y", "64"]]);                              // lines of [label, value] (or { l, v, c: colour, icon: url }); a plain string is one line
 *   hud.set(lines, { row: true });                                      // the lines side by side instead of one below the other
 *   hud.visible(false);                                                 // hide it (it is still shown, dimmed, while the widgets are being moved)
 *
 * The widget uses the same drag / scroll-to-resize / save-position machinery as the built-in FPS and CPS counters (ui.js). ASCII-only source. */
(function () {
  "use strict";

  var OC = window.OneClient;
  if (!OC) return;
  var kit = OC.kit = {};
  var live = [];                                                 // every widget that exists right now (to follow the overlay opening)
  /* the widgets each mod shows, for the live preview on its settings page (mods.js) */
  kit.preview = function (modId) { var out = []; live.forEach(function (h) { if (h.modId === modId && !h.dead) out.push(h.el); }); return out; };

  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function flag(node, name, on) { if (on) node.setAttribute(name, ""); else node.removeAttribute(name); }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  /* ---------- formatting helpers (kit.fmt) ---------- */
  var fmt = kit.fmt = {
    pad2: function (n) { n = Math.floor(Math.abs(n)); return (n < 10 ? "0" : "") + n; },
    fixed: function (v, d) { return isFinite(v) ? (+v).toFixed(d) : "-"; },
    int: function (v) { return isFinite(v) ? String(Math.round(v)) : "-"; },
    /* seconds -> 1:02:03 (hours only when needed) */
    clock: function (sec, ms) {
      sec = Math.max(0, sec); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
      var t = (h ? h + ":" + fmt.pad2(m) : m) + ":" + fmt.pad2(s);
      if (ms) t += "." + fmt.pad2(Math.floor(sec % 1 * 100));
      return t;
    },
    roman: function (n) { var r = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]; return n >= 0 && n < r.length ? r[n] : String(n); },
    title: function (id) { return String(id || "").replace(/^minecraft:/, "").replace(/[_:]+/g, " ").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  };

  /* display names of the game's things (blocks, items, entities, effects, enchantments): build.js packs the English ones into <script id="oc-lang"> */
  var lang = null;
  kit.lang = function () {
    if (lang) return lang;
    lang = {};
    try { var e = document.getElementById("oc-lang"); if (e && e.textContent) lang = JSON.parse(e.textContent) || {}; } catch (x) { lang = {}; }
    return lang;
  };
  fmt.name = function (kind, id) {
    id = String(id || "").replace(/^minecraft:/, "");
    var m = kit.lang()[kind];
    return (m && m[id]) || fmt.title(id);
  };
  /* "#ffcc00" -> [1, 0.8, 0] */
  kit.rgb = function (hex, fallback) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return fallback || [1, 1, 1];
    var n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };
  /* hue 0..1 -> [r, g, b] (a colour wheel at full saturation) */
  kit.hue = function (h) {
    h = ((h % 1) + 1) % 1;
    var i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f;
    return [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][i % 6];
  };

  /* the game's own icons (potion effects ...) as data URLs: build.js packs them into <script id="oc-icons"> */
  var icons = null;
  kit.icons = function () {
    if (icons) return icons;
    icons = {};
    try { var e = document.getElementById("oc-icons"); if (e && e.textContent) icons = JSON.parse(e.textContent) || {}; } catch (x) { icons = {}; }
    return icons;
  };

  /* one colour per block, averaged from the game's textures by build.js into <script id="oc-blockcolors">: { "stone": "7e7e7e", "grass_block": "939393r" ... }
   * (six hex digits and an optional kind letter: r grass tint, f foliage tint, l leaves, g glass, w water, v lava, x nothing to draw). Used by the Minimap. */
  var blockColors = null;
  kit.blockColors = function () {
    if (blockColors) return blockColors;
    blockColors = {};
    try { var e = document.getElementById("oc-blockcolors"); if (e && e.textContent) blockColors = JSON.parse(e.textContent) || {}; } catch (x) { blockColors = {}; }
    return blockColors;
  };

  /* the tints of every biome ("plains": ["91bd59", "77ab2f", "3f76e4"] = grass, foliage, water), worked out by build.js from the game's colour maps and biome files */
  var biomeColors = null;
  kit.biomeColors = function () {
    if (biomeColors) return biomeColors;
    biomeColors = {};
    try { var e = document.getElementById("oc-biomecolors"); if (e && e.textContent) biomeColors = JSON.parse(e.textContent) || {}; } catch (x) { biomeColors = {}; }
    return biomeColors;
  };

  /* ---------- per-mod kit ---------- */
  kit.forMod = function (api, modId, track) {
    var K = { fmt: fmt, icons: kit.icons, rgb: kit.rgb, hue: kit.hue, lang: kit.lang, blockColors: kit.blockColors, biomeColors: kit.biomeColors };

    /* The standard settings of an on-screen mod. o.rows: the mod's own rows (shown first); o.label: false when there is no label to hide;
     * o.color: the default text colour; o.widget: the id of the main widget (for the size slider). */
    K.settings = function (o) {
      o = o || {};
      var wid = "x:" + modId + ":" + (o.widget || "main");
      var rows = (o.rows || []).slice();
      var bgOn = function (c) { return !!c.bg; };
      rows.push({ type: "section", label: "Appearance" });
      if (o.label !== false) rows.push({ k: "label", type: "toggle", label: "Show label", note: "The name of the value next to it", def: true });
      rows.push({ k: "color", type: "color", label: "Text color", def: o.color || "#ffffff" });
      rows.push({ k: "bg", type: "toggle", label: "Background", note: "A dark glass box behind the text", def: true });
      rows.push({ k: "bgAlpha", type: "range", label: "Background opacity", min: 0, max: 90, step: 5, unit: "%", def: 46, when: bgOn });
      rows.push({ k: "round", type: "range", label: "Corner roundness", min: 0, max: 20, step: 1, unit: "px", def: 12, when: bgOn });
      rows.push({ k: "shadow", type: "toggle", label: "Text shadow", note: "Keeps the text readable on bright scenes", def: true });
      rows.push({
        k: "scale", type: "range", label: "Size", note: "You can also scroll over the widget while moving it", min: 60, max: 220, step: 5, unit: "%", def: 100,
        get: function () { return OC.ui && OC.ui.getScale ? Math.round(OC.ui.getScale(wid) * 100) : 100; },
        set: function (v) { if (OC.ui && OC.ui.setScale) OC.ui.setScale(wid, v / 100); }
      });
      return rows;
    };

    /* make an element follow the standard appearance settings (text colour, background and its opacity, roundness, shadow, label) */
    K.look = function (node) {
      function apply() {
        var g = api.settings.get, c = g("color"), bg = g("bg") !== false, a = g("bgAlpha");
        node.style.setProperty("--hk-c", /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#ffffff");
        node.style.setProperty("--hk-bg", "rgba(12,14,20," + (clamp(a === undefined ? 46 : a, 0, 100) / 100) + ")");
        node.style.setProperty("--hk-r", clamp(g("round") === undefined ? 12 : g("round"), 0, 24) + "px");
        flag(node, "data-nobg", !bg);
        flag(node, "data-nolabel", g("label") === false);
        flag(node, "data-noshadow", g("shadow") === false);
      }
      apply();
      api.settings.onChange(function () { apply(); });
      return apply;
    };

    /* any element as a draggable widget: K.widget({ id, anchor, row }, node) -> { el, wid, visible(bool), remove() } */
    K.widget = function (o, node) {
      o = o || {};
      var wid = "x:" + modId + ":" + (o.id || "main"), shown = true;
      var h = { el: node, wid: wid, modId: modId, widget: null, dead: false };
      function def(vw, vh, bw, bh) {
        var a = o.anchor || "tl", v = a.charAt(0), hz = a.charAt(1) || "l", m = 10, step = o.rowStep || 40, row = (o.row || 0) * step;
        var x = hz === "r" ? vw - bw - m : hz === "c" ? (vw - bw) / 2 : m;
        var y = v === "b" ? vh - bh - m - row : v === "c" ? (vh - bh) / 2 + row : m + row;
        return { x: x, y: y };
      }
      function mount() {
        if (h.dead || h.widget || !OC.ui || !OC.ui.addWidget) return;
        h.widget = OC.ui.addWidget(wid, "x:" + modId, node, def, false);
        applyShown();
      }
      if (OC.ui && OC.ui.built) mount(); else OC.on("ui-built", mount);
      function applyShown() { if (h.widget) flag(node, "data-gone", !shown && !(OC.ui && OC.ui.isOpen())); }
      h.visible = function (on) { on = !!on; if (on === shown) return; shown = on; applyShown(); };
      h.remove = function () {
        if (h.dead) return;
        h.dead = true;
        var i = live.indexOf(h); if (i >= 0) live.splice(i, 1);
        if (h.widget && OC.ui && OC.ui.removeWidget) OC.ui.removeWidget(wid);
      };
      h._shown = applyShown;
      live.push(h);
      track(h.remove);
      return h;
    };

    /* a widget on the HUD with text lines */
    K.hud = function (o) {
      o = o || {};
      var box = el("div", "oc-hk"), lines = [], mode = "";
      var h = K.widget(o, box);

      K.look(box);
      function addLine() {
        var row = el("div", "hk-l"), ic = el("img", "hk-i"), lab = el("i"), val = el("b"), aft = el("i", "hk-a");
        ic.alt = ""; ic.style.display = "none"; ic.draggable = false; aft.style.display = "none";
        row.appendChild(ic); row.appendChild(lab); row.appendChild(val); row.appendChild(aft);
        box.appendChild(row);
        lines.push({ row: row, ic: ic, lab: lab, val: val, aft: aft, l: null, v: null, c: null, i: null, a: null });
      }
      function dropLine() { var ln = lines.pop(); if (ln && ln.row.parentNode) ln.row.parentNode.removeChild(ln.row); }

      /* data: a string (one line without a label) or an array of [label, value] / { l, v, c, icon } */
      h.set = function (data, opts) {
        if (h.dead) return;
        if (typeof data === "string" || typeof data === "number") data = [{ v: String(data) }];
        data = data || [];
        while (lines.length < data.length) addLine();
        while (lines.length > data.length) dropLine();
        for (var i = 0; i < data.length; i++) {
          var d = data[i], ln = lines[i], l, v, c, ic, a;
          if (Array.isArray(d)) { l = d[0]; v = d[1]; c = d[2]; ic = d[3]; a = d[4]; } else { l = d.l; v = d.v; c = d.c; ic = d.icon; a = d.a; }
          l = l == null ? "" : String(l); v = v == null ? "" : String(v); ic = ic || ""; a = a == null ? "" : String(a);
          if (ln.a !== a) { ln.a = a; ln.aft.textContent = a; ln.aft.style.display = a ? "" : "none"; }
          if (ln.l !== l) { ln.l = l; ln.lab.textContent = l; ln.lab.style.display = l ? "" : "none"; }
          if (ln.v !== v) { ln.v = v; ln.val.textContent = v; }
          if (ln.c !== (c || "")) { ln.c = c || ""; ln.val.style.color = c || ""; }
          if (ln.i !== ic) { ln.i = ic; if (ic) { ln.ic.src = ic; ln.ic.style.display = ""; } else { ln.ic.removeAttribute("src"); ln.ic.style.display = "none"; } }
        }
        var m = opts && opts.row ? "row" : "";
        if (m !== mode) { mode = m; flag(box, "data-row", !!m); }
      };
      if (o.lines) h.set(o.lines);
      return h;
    };

    /* an interval that stops with the mod */
    K.every = function (ms, fn) { return api.every(ms, fn); };
    return K;
  };

  /* hidden widgets show up again (dimmed) while the overlay is open, so they can be placed */
  OC.on("ui", function () { live.slice().forEach(function (h) { try { h._shown(); } catch (e) {} }); });
})();
