/* OneClient native bridge: everything that talks to the game from the outside.
 *
 *  1. Frame hook   - captures the game's WebGL context, counts frames, and a few times a second reads the
 *                    finished frame to look for the screen markers baked into the OneClient pack
 *                    (see markers.json)                                     -> OC.screen, OC.on("screen")
 *  2. Saved options (GUI scale etc.)                                        -> OC.native.opts / scale()
 *  3. Synthetic mouse / keyboard input on the game canvas                   -> OC.native.click / type / key
 *     + N.grab (read back part of the frame), N.onNextFrame
 *  4. File-picker hook (hands our own File to the game's import buttons)    -> OC.native.pickFile(file)
 *  5. NBT codec (servers.dat)                                               -> OC.nbt
 *
 * The game is the source of truth: our menus are skins over its real screens and only ever act on
 * them through this bridge. ASCII-only source (the host page declares its charset late). */
(function () {
  "use strict";

  var OC = window.OneClient, N = OC.native = { canvas: null, opts: {} };
  var markers = (window.__OC_MARKERS || []).map(function (m) { return { id: m.id, where: m.where, A: rgba(m.a), B: rgba(m.b) }; });
  function rgba(c) { return ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0; }   // RGBA bytes as a little-endian uint32

  /* ---------- 1. frame hook + marker scan ---------- */
  var gl = null, frames = 0, waiters = [], frameCbs = [], drawScheduled = false, lastScan = 0, scanFailed = false;
  var bufs = {};

  var getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var ctx = getContext.apply(this, arguments);
    if (!gl && ctx && (type === "webgl2" || type === "webgl")) { gl = ctx; N.canvas = this; hookGl(ctx); }
    return ctx;
  };

  function hookGl(ctx) {
    ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"].forEach(function (name) {
      var orig = ctx[name];
      if (typeof orig !== "function") return;
      ctx[name] = function () {
        var r = orig.apply(this, arguments);
        if (!drawScheduled) { drawScheduled = true; Promise.resolve().then(frameDone); }   // runs after the game's frame finished
        return r;
      };
    });
  }

  function frameDone() {
    drawScheduled = false;
    frames++;
    for (var i = waiters.length - 1; i >= 0; i--) {
      if (frames >= waiters[i].at) { var w = waiters.splice(i, 1)[0]; w.resolve(); }
    }
    if (frameCbs.length) {
      var cbs = frameCbs;
      frameCbs = [];
      cbs.forEach(function (fn) { try { fn(); } catch (e) { console.error("[OneClient]", e); } });
    }
    if (OC.onFrameEnd) OC.onFrameEnd();
    var now = performance.now();
    // some screen is up whenever the game does not hold the mouse: look at (almost) every frame, so a menu we skin
    // is covered in the same frame it first appears. While playing with the mouse captured, a few looks a second do.
    var gap = (N.fastScan || !OC.inGame()) ? 12 : 250;
    if (!scanFailed && markers.length && now - lastScan >= gap && N.scanEnabled !== false) scanFrame(now);
  }

  /* resolves after n more game frames (or after a timeout, so a hidden tab can never deadlock us) */
  N.frames = function (n) {
    return new Promise(function (resolve) {
      var done = false, at = frames + (n || 1);
      function fin() { if (!done) { done = true; resolve(); } }
      waiters.push({ at: at, resolve: fin });
      setTimeout(fin, 1500 + (n || 1) * 400);
    });
  };
  N.frameCount = function () { return frames; };
  /* run fn right after the game's next finished frame, while that frame is still in the buffer (see N.grab) */
  N.onNextFrame = function (fn) { frameCbs.push(fn); };

  /* Regions of the frame that hold the markers (canvas pixels, top-left origin): screen titles sit at the top
   * centre, the title screen's marker at the bottom left, the connecting / disconnected texts mid screen. */
  function clampRect(W, H, x, y, w, h) {
    x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y)));
    return { x: x, y: y, w: Math.max(1, Math.min(W - x, Math.round(w))), h: Math.max(1, Math.min(H - y, Math.round(h))) };
  }
  function regions(W, H) {
    var s = N.scale();
    return {
      top: clampRect(W, H, W / 2 - 170 * s, 0, 340 * s, Math.max(8, H * 0.3)),
      center: clampRect(W, H, W / 2 - 170 * s, H / 2 - 62 * s, 340 * s, 66 * s),
      bottom: clampRect(W, H, 0, H - Math.max(8, H * 0.08), Math.max(8, W * 0.25), Math.max(8, H * 0.08))
    };
  }
  var ORDER = ["top", "center", "bottom"];

  function scanFrame(now) {
    lastScan = now;
    var c = N.canvas, W = c.width, H = c.height;
    if (!W || !H) return;
    try {
      var R = regions(W, H), id = null;
      var prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      for (var k = 0; k < ORDER.length && !id; k++) {
        var name = ORDER[k];
        if (!byColour[name].size) continue;
        var r = R[name], need = r.w * r.h * 4, b = bufs[name];
        if (!b || b.length !== need) b = bufs[name] = new Uint8Array(need);
        gl.readPixels(r.x, H - r.y - r.h, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, b);
        id = find(b, name);
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
      report(id);
    } catch (e) {
      scanFailed = true;
      console.warn("[OneClient] screen detection unavailable:", e);
    }
  }

  /* Copy a rectangle of the frame that was just drawn: canvas pixels, top-left origin -> { w, h, data } with RGBA rows
   * top-down. Only valid inside an N.onNextFrame callback or an OC "screen" handler (the frame is still in the buffer). */
  N.grab = function (x, y, w, h) {
    var c = N.canvas;
    if (!gl || !c) return null;
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(c.width - x, Math.round(w)); h = Math.min(c.height - y, Math.round(h));
    if (w < 1 || h < 1) return null;
    var raw = new Uint8Array(w * h * 4), out = new Uint8ClampedArray(w * h * 4);
    try {
      var prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.readPixels(x, c.height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
    } catch (e) { return null; }
    for (var row = 0; row < h; row++) out.set(raw.subarray((h - 1 - row) * w * 4, (h - row) * w * 4), row * w * 4);
    return { w: w, h: h, data: out };
  };

  var byColour = { top: new Map(), bottom: new Map(), center: new Map() };
  markers.forEach(function (m) { (byColour[m.where] || byColour.top).set(m.A, m); });

  function find(u8, where) {
    var map = byColour[where];
    if (!map.size) return null;
    var px = new Uint32Array(u8.buffer, u8.byteOffset, u8.length >> 2), n = px.length - 10;
    for (var i = 0; i < n; i++) {
      var v = px[i];
      if ((v & 0xFF000000) === 0 || (v & 0xC0) > 0x40) continue;              // cheap reject: marker colours are dark
      var m = map.get(v);
      if (!m) continue;
      for (var s = 1; s <= 8; s++) if (px[i + s] === m.B) return m.id;       // the second colour sits one texel to the right
    }
    return null;
  }

  /* A marker is believed at once (so our cover goes up in the very frame the game's screen first shows); losing it
   * takes two scans in a row without it, so a single odd frame can never uncover a native screen by mistake. */
  var cur = null, missN = 0;
  function report(id) {
    if (id) { missN = 0; if (id !== cur) setScreen(id); return; }
    if (cur !== null && ++missN >= 2) setScreen(null);
  }
  function setScreen(id) {
    var prev = cur;
    cur = id;
    OC.screen = id;
    OC.emit("screen", id, prev);
  }
  OC.screen = null;
  N.scanNow = function () { lastScan = 0; };
  N.isBroken = function () { return scanFailed; };

  /* ---------- 2. saved options ---------- */
  var enc = new TextEncoder(), dec = new TextDecoder("utf-8"), lastG = null;
  function pipe(bytes, transform) { return new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer(); }
  function b64ToBytes(b64) { var bin = atob(b64), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

  N.readOptions = function () {
    var g = null;
    try { g = localStorage.getItem("_eaglercraftX.g"); } catch (e) {}
    if (!g || g === lastG) return Promise.resolve(N.opts);
    lastG = g;
    return pipe(b64ToBytes(g), new DecompressionStream("gzip")).then(function (buf) {
      var o = {};
      dec.decode(buf).split("\n").forEach(function (l) { var i = l.indexOf(":"); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); });
      N.opts = o;
      return o;
    }, function () { return N.opts; });
  };
  N.readOptions();
  setInterval(N.readOptions, 2000);
  OC.on("screen", function () { N.readOptions(); });

  /* vanilla's GUI scale rule (Window.calculateScale) */
  N.scale = function () {
    var c = N.canvas;
    if (!c) return 2;
    var opt = parseInt(N.opts.guiScale || "0", 10) || 0, i = 1;
    while (i !== opt && i < c.width && i < c.height && c.width / (i + 1) >= 320 && c.height / (i + 1) >= 240) i++;
    if (N.opts.forceUnicodeFont === "true" && i % 2 !== 0) i++;
    return i;
  };
  /* scaled screen size in GUI units */
  N.gui = function () { var c = N.canvas, s = N.scale(); return c ? { w: Math.ceil(c.width / s), h: Math.ceil(c.height / s), s: s } : { w: 640, h: 360, s: 2 }; };

  /* ---------- 3. synthetic input ---------- */
  N.toClient = function (gx, gy) {
    var c = N.canvas, r = c.getBoundingClientRect(), s = N.scale();
    return [r.left + gx * s * (r.width / c.width), r.top + gy * s * (r.height / c.height)];
  };
  N.fromClient = function (cx, cy) {
    var c = N.canvas, r = c.getBoundingClientRect(), k = N.scale();
    return [(cx - r.left) / (k * (r.width / c.width)), (cy - r.top) / (k * (r.height / c.height))];
  };
  function mouseEvent(type, p, button) {
    var e = new MouseEvent(type, { clientX: p[0], clientY: p[1], button: button || 0, buttons: type === "mouseup" ? 0 : (button === 2 ? 2 : 1), bubbles: true, cancelable: true, view: window });
    e.__oc = true;
    return e;
  }
  N.move = function (gx, gy) { N.canvas.dispatchEvent(mouseEvent("mousemove", N.toClient(gx, gy))); return N.frames(2); };
  N.click = function (gx, gy) {
    var p = N.toClient(gx, gy), c = N.canvas;
    c.dispatchEvent(mouseEvent("mousemove", p));
    return N.frames(2).then(function () {
      c.dispatchEvent(mouseEvent("mousedown", p));
      return N.frames(2);
    }).then(function () {
      c.dispatchEvent(mouseEvent("mouseup", p));
      return N.frames(3);
    });
  };
  N.wheel = function (gx, gy, dy) {
    var p = N.toClient(gx, gy), e = new WheelEvent("wheel", { clientX: p[0], clientY: p[1], deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, view: window });
    e.__oc = true;
    N.canvas.dispatchEvent(e);
    return N.frames(2);
  };

  var CODES = { " ": "Space", "/": "Slash", ".": "Period", ",": "Comma", "-": "Minus", "_": "Minus", ":": "Semicolon", ";": "Semicolon", "'": "Quote", "=": "Equal", "+": "Equal", "@": "Digit2", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "!": "Digit1", "?": "Slash" };
  function keyEvent(type, key, code, keyCode, extra) {
    var e = new KeyboardEvent(type, Object.assign({ key: key, code: code, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true }, extra || {}));
    e.__oc = true;
    return e;
  }
  N.key = function (key, code, keyCode, extra) {
    window.dispatchEvent(keyEvent("keydown", key, code, keyCode, extra));
    return N.frames(1).then(function () { window.dispatchEvent(keyEvent("keyup", key, code, keyCode, extra)); return N.frames(1); });
  };
  N.type = function (text) {
    var chain = Promise.resolve();
    Array.prototype.forEach.call(String(text), function (ch) {
      chain = chain.then(function () {
        var code = /[a-z]/i.test(ch) ? "Key" + ch.toUpperCase() : /[0-9]/.test(ch) ? "Digit" + ch : (CODES[ch] || "Unidentified");
        var kc = /[a-z]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : ch.charCodeAt(0);
        window.dispatchEvent(keyEvent("keydown", ch, code, kc));
        window.dispatchEvent(keyEvent("keypress", ch, code, kc));
        window.dispatchEvent(keyEvent("keyup", ch, code, kc));
        return N.frames(1);
      });
    });
    return chain;
  };
  N.backspace = function (n) {
    var chain = Promise.resolve();
    for (var i = 0; i < n; i++) chain = chain.then(function () { return N.key("Backspace", "Backspace", 8); });
    return chain;
  };
  N.escape = function () { return N.key("Escape", "Escape", 27); };

  /* ---------- 4. file-picker hook ---------- */
  var pending = null, inputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (pending && this.type === "file") {
      var file = pending, input = this;
      pending = null;
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        try { input.files = dt.files; } catch (e) { Object.defineProperty(input, "files", { value: dt.files, configurable: true }); }
      } catch (e) { return; }
      setTimeout(function () { input.dispatchEvent(new Event("change", { bubbles: true })); }, 30);
      return;
    }
    return inputClick.apply(this, arguments);
  };
  N.pickFile = function (file) { pending = file; };
  N.cancelPick = function () { pending = null; };

  /* ---------- 5. NBT codec ----------
   * tag = { t: type, v: value }; compound v = [[name, tag], ...] (ordered); list = { t: 9, et: elementType, v: [tag, ...] } */
  var NBT = OC.nbt = {};
  NBT.read = function (u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 0;
    function str() { var n = dv.getUint16(p); p += 2; var s = dec.decode(new Uint8Array(dv.buffer, dv.byteOffset + p, n)); p += n; return s; }
    function val(t) {
      var v, n, i;
      switch (t) {
        case 1: v = dv.getInt8(p); p += 1; return v;
        case 2: v = dv.getInt16(p); p += 2; return v;
        case 3: v = dv.getInt32(p); p += 4; return v;
        case 4: v = dv.getBigInt64(p); p += 8; return v;
        case 5: v = dv.getFloat32(p); p += 4; return v;
        case 6: v = dv.getFloat64(p); p += 8; return v;
        case 7: n = dv.getInt32(p); p += 4; v = new Int8Array(dv.buffer.slice(dv.byteOffset + p, dv.byteOffset + p + n)); p += n; return v;
        case 8: return str();
        case 9: {
          var et = dv.getInt8(p); p += 1; n = dv.getInt32(p); p += 4; var items = [];
          for (i = 0; i < n; i++) items.push({ t: et, v: val(et) });
          return { et: et, items: items };
        }
        case 10: {
          var entries = [];
          for (;;) { var tt = dv.getInt8(p); p += 1; if (tt === 0) break; var name = str(); entries.push([name, tagOf(tt)]); }
          return entries;
        }
        case 11: n = dv.getInt32(p); p += 4; v = []; for (i = 0; i < n; i++) { v.push(dv.getInt32(p)); p += 4; } return v;
        case 12: n = dv.getInt32(p); p += 4; v = []; for (i = 0; i < n; i++) { v.push(dv.getBigInt64(p)); p += 8; } return v;
        default: throw new Error("NBT: unknown tag " + t);
      }
    }
    function tagOf(t) { var v = val(t); return t === 9 ? { t: 9, et: v.et, v: v.items } : { t: t, v: v }; }
    var rootType = dv.getInt8(p); p += 1;
    if (rootType !== 10) throw new Error("NBT: root is not a compound");
    var rootName = str();
    return { name: rootName, tag: tagOf(10) };
  };
  NBT.write = function (root) {
    var out = [], te = enc;
    function u8(n) { out.push(new Uint8Array([n & 255])); }
    function num(bytes, fn) { var b = new ArrayBuffer(bytes); fn(new DataView(b)); out.push(new Uint8Array(b)); }
    function str(s) { var b = te.encode(s); num(2, function (d) { d.setUint16(0, b.length); }); out.push(b); }
    function val(tag) {
      var i, v = tag.v;
      switch (tag.t) {
        case 1: u8(v); break;
        case 2: num(2, function (d) { d.setInt16(0, v); }); break;
        case 3: num(4, function (d) { d.setInt32(0, v); }); break;
        case 4: num(8, function (d) { d.setBigInt64(0, BigInt(v)); }); break;
        case 5: num(4, function (d) { d.setFloat32(0, v); }); break;
        case 6: num(8, function (d) { d.setFloat64(0, v); }); break;
        case 7: num(4, function (d) { d.setInt32(0, v.length); }); out.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); break;
        case 8: str(v); break;
        case 9: u8(tag.et); num(4, function (d) { d.setInt32(0, v.length); }); for (i = 0; i < v.length; i++) val(v[i]); break;
        case 10: for (i = 0; i < v.length; i++) { u8(v[i][1].t); str(v[i][0]); val(v[i][1]); } u8(0); break;
        case 11: num(4, function (d) { d.setInt32(0, v.length); }); v.forEach(function (x) { num(4, function (d) { d.setInt32(0, x); }); }); break;
        case 12: num(4, function (d) { d.setInt32(0, v.length); }); v.forEach(function (x) { num(8, function (d) { d.setBigInt64(0, BigInt(x)); }); }); break;
        default: throw new Error("NBT: cannot write tag " + tag.t);
      }
    }
    u8(10); str(root.name || ""); val(root.tag);
    var len = out.reduce(function (n, b) { return n + b.length; }, 0), res = new Uint8Array(len), at = 0;
    out.forEach(function (b) { res.set(b, at); at += b.length; });
    return res;
  };
  NBT.get = function (compound, name) { var e = compound.v.filter(function (p) { return p[0] === name; })[0]; return e ? e[1] : null; };
  NBT.set = function (compound, name, tag) {
    for (var i = 0; i < compound.v.length; i++) if (compound.v[i][0] === name) { compound.v[i][1] = tag; return; }
    compound.v.push([name, tag]);
  };
})();
