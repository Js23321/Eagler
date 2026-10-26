/* OneClient core: settings, mouse-lock handling, fullbright, input tracking, zoom, toggle sprint.
 *
 * build.js injects this as the FIRST script in <head>, so it can wrap browser APIs before the
 * game boots. The game itself is a sealed WASM binary, so every mod works at the browser layer
 * (WebGL shader patching, input events, DOM overlay). Source is ASCII-only on purpose: the host
 * page declares its charset very late. */
(function () {
  "use strict";

  var OC = window.OneClient = { version: 3 };

  /* ---------- settings ---------- */
  var KEY = "oneclient.settings.v2", OLD_KEY = "oneclient.settings.v1";
  var S = OC.S = {
    mods: { fullbright: false, fps: true, cps: true, keystrokes: true, zoom: true, toggleSprint: false, crosshair: false },
    zoomFactor: 3,
    layout: {},   // widget id -> { fx, fy, s }  (fx/fy are 0..1 positions inside the free space)
    cfg: {},      // per-mod options changed in the Mods menu: mod -> { option: value } (defaults in CFG_DEF)
    toasts: 0,
    servers: [],  // OneClient server list (managed by menu.js)
    modcfg: {},   // settings of the mods loaded with "Load mods" (modloader.js): mod id -> { key: value }
    modsAck: false // the "mods run with full access to this page" notice was accepted
  };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var v = JSON.parse(raw);
      Object.assign(S.mods, v.mods || {});
      if (typeof v.zoomFactor === "number") S.zoomFactor = v.zoomFactor;
      if (v.layout && typeof v.layout === "object") S.layout = v.layout;
      if (typeof v.toasts === "number") S.toasts = v.toasts;
      if (Array.isArray(v.servers)) S.servers = v.servers;
      if (v.cfg && typeof v.cfg === "object") S.cfg = v.cfg;
      if (v.modcfg && typeof v.modcfg === "object") S.modcfg = v.modcfg;
      if (v.modsAck === true) S.modsAck = true;
    } else {
      var old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
      if (old) Object.keys(S.mods).forEach(function (k) { if (typeof old[k] === "boolean") S.mods[k] = old[k]; });
    }
  } catch (e) { /* storage blocked: run with defaults */ }

  var saveTimer = 0;
  OC.persistView = null;      // client/profiles.js: while a server's own mod settings are in force it returns what belongs in this file (the everywhere settings), never the server's
  OC.save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(OC.persistView ? OC.persistView(S) : S)); } catch (e) {}
    }, 150);
  };

  var subs = {};
  OC.on = function (name, fn) { (subs[name] = subs[name] || []).push(fn); };
  OC.emit = function (name, a, b) {
    (subs[name] || []).forEach(function (fn) { try { fn(a, b); } catch (e) { console.error("[OneClient]", e); } });
  };

  OC.setMod = function (k, on) {
    on = !!on;
    if (S.mods[k] === on) return;
    S.mods[k] = on;
    if (k === "zoom" && !on) setZoom(false);
    if (k === "toggleSprint" && !on) releaseSprint();
    OC.save();
    OC.emit("mod", k, on);
  };
  OC.toggleMod = function (k) { OC.setMod(k, !S.mods[k]); };

  /* options of each mod (the Mods menu edits these); a value that was never changed falls back to its default */
  var CFG_DEF = OC.CFG_DEF = {
    fullbright: { key: "KeyB", strength: 100, tag: true },
    fps: { label: true, bg: true, color: "#ffffff" },
    cps: { right: true, label: true, bg: true, color: "#ffffff" },
    keystrokes: { mouse: true, space: true, color: "#ffffff" },
    zoom: { key: "KeyC", smooth: true, scroll: true },           // the zoom strength itself is S.zoomFactor
    toggleSprint: { key: "KeyV", tag: true },
    crosshair: { style: "cross", color: "#ffffff", size: 22, thickness: 2, gap: 4, opacity: 100, dot: false, outline: true, invert: false }
  };
  OC.cfg = function (mod, key) { var m = S.cfg[mod]; return m && m[key] !== undefined ? m[key] : CFG_DEF[mod][key]; };
  OC.setCfg = function (mod, key, value) {
    (S.cfg[mod] || (S.cfg[mod] = {}))[key] = value;
    OC.save();
    OC.emit("cfg", mod, key);
  };
  OC.resetCfg = function (mod) {
    delete S.cfg[mod];
    if (mod === "zoom") S.zoomFactor = 3;
    OC.save();
    OC.emit("cfg", mod, null);
  };
  OC.setZoomFactor = function (v) { S.zoomFactor = clamp(v, 1.5, 8); OC.save(); OC.emit("cfg", "zoom", "factor"); };

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function canvas() { return document.querySelector("canvas"); }

  /* ---------- mouse lock ----------
   * The game polls `document.pointerLockElement === canvas` and opens its Esc/pause menu the moment
   * the lock is gone. To open our overlay WITHOUT that menu we release the real lock but keep
   * REPORTING the canvas as locked (a getter on `document`) and swallow the two lock-change events,
   * so the game never notices. On close we take the lock back the same way the game does. */
  var pleDesc = Object.getOwnPropertyDescriptor(Document.prototype, "pointerLockElement");
  function realLock() { return pleDesc && pleDesc.get ? pleDesc.get.call(document) : null; }
  var spoofEl = null, releasedByUs = false, relockPending = false, expectEvents = 0, expectTimer = 0;
  if (pleDesc && pleDesc.get) {
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: function () { return spoofEl || realLock(); } });
  }
  function armExpect() { clearTimeout(expectTimer); expectTimer = setTimeout(function () { expectEvents = 0; }, 1500); }

  /* The game asks for the mouse with element.requestPointerLock() when a screen closes. We pass that on to
   * menu.js ("lockrequest": a join finished loading) and, while a join is in flight and the browser would
   * refuse the request (no click in the last few seconds), hold it back: the game is told it has the mouse
   * (same spoof as above) and OC.restoreLock() takes the real lock on the next click, from our own
   * "Click to play" screen, so the game never falls back to its pause menu. */
  var ownLockCall = false, nativeRequestLock = Element.prototype.requestPointerLock;
  OC.lockDeferred = false;
  if (typeof nativeRequestLock === "function") {
    Element.prototype.requestPointerLock = function () {
      if (!ownLockCall) {
        var held = !!(OC.wantDeferLock && OC.wantDeferLock() && !realLock() && deferLock(this));
        try { OC.emit("lockrequest", this); } catch (e) {}
        if (held) return Promise.resolve();
      }
      return nativeRequestLock.apply(this, arguments);
    };
  }
  function deferLock(el) {
    var ua = navigator.userActivation;
    if (!ua || ua.isActive) return false;                 // unknown, or a fresh click: the browser grants it
    spoofEl = el; releasedByUs = true; OC.lockDeferred = true;
    return true;
  }

  document.addEventListener("pointerlockchange", function (e) {
    if (relockPending && realLock()) { spoofEl = null; relockPending = false; }   // the lock we asked for has arrived
    if (expectEvents <= 0) return;                         // not ours: the game must see it (normal Esc etc.)
    expectEvents--;
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener("pointerlockerror", function (e) {
    if (!relockPending) return;
    e.stopImmediatePropagation();
    relockFailed();
  }, true);

  OC.releaseLock = function () {
    var el = realLock();
    if (!el || releasedByUs) return false;
    spoofEl = el; releasedByUs = true; expectEvents++; armExpect();
    try { document.exitPointerLock(); }
    catch (e) { spoofEl = null; releasedByUs = false; expectEvents = 0; return false; }
    return true;
  };

  function relockFailed() {
    if (!relockPending && !spoofEl) return;
    relockPending = false; expectEvents = 0; spoofEl = null;
    // The browser refused (closing with Esc carries no user gesture). Let the game see the truth: it
    // opens its normal pause menu, exactly as if the player had pressed Esc.
    try { document.dispatchEvent(new Event("pointerlockchange")); } catch (e) {}
  }

  OC.restoreLock = function () {
    if (!releasedByUs) return;
    releasedByUs = false;
    var el = spoofEl;
    if (!el) return;
    var deferred = OC.lockDeferred;                         // the game's own request was held back, so it never saw a lock arrive: this one must reach it (or its Esc would not open its menu)
    relockPending = true; if (!deferred) expectEvents++; armExpect(); OC.lockDeferred = false;
    try {
      ownLockCall = true;
      var p = el.requestPointerLock();
      ownLockCall = false;
      if (p && typeof p.then === "function") p.then(null, relockFailed);
    } catch (e) { ownLockCall = false; relockFailed(); return; }
    setTimeout(function () { if (relockPending && !realLock()) relockFailed(); }, 1200);
  };

  function inGame() { return !!realLock(); }
  OC.inGame = inGame;

  /* ---------- Ctrl+W (sprint + forward) closes the tab: protect the game while it is being played ----------
   * A page cannot cancel the browser's own tab shortcuts. Two things help. In fullscreen Chrome lets a page claim keys (the Keyboard Lock API), so
   * Ctrl+W reaches the game like any other key. And wherever that is not possible, a tab that is being closed (or reloaded) while the mouse is
   * captured by the game asks "Leave site?" first: Cancel keeps the game. The Toggle Sprint mod avoids Ctrl altogether. */
  window.addEventListener("beforeunload", function (e) {
    if (!OC.inGame()) return undefined;
    e.preventDefault();
    e.returnValue = "";
    return "";
  });
  var kbLocked = false, kbTick = 0;
  function keyboardLock() {                                                      // in fullscreen while playing: W A S D belong to the game, whatever Ctrl is held with them
    var kb = navigator.keyboard;
    if (!kb || typeof kb.lock !== "function") return false;
    var want = !!document.fullscreenElement && !!OC.inGame();
    if (want === kbLocked) return kbLocked;
    kbLocked = want;
    try {
      if (want) { var p = kb.lock(["KeyW", "KeyA", "KeyS", "KeyD"]); if (p && typeof p.catch === "function") p.catch(function () { kbLocked = false; }); }
      else kb.unlock();
    } catch (e) { kbLocked = false; }
    return kbLocked;
  }
  OC.tabGuard = { keyboardLock: keyboardLock, locked: function () { return kbLocked; } };

  /* ---------- FULLBRIGHT: patch the lightmap fragment shader ----------
   * The game translates vanilla GLSL to GLSL ES 3.00 and calls gl.shaderSource. We add a uniform
   * `oc_fb` to the lightmap shader and blend its output to white. The uniform is re-set every
   * time the game binds that program, so toggling takes effect on the next light update. */
  var lightmapShaders = new WeakSet();
  var lightmapPrograms = new WeakMap(); // program -> { loc }

  function patchLightmap(src) {
    if (typeof src !== "string" || src.indexOf("lightmapInfo") < 0 || src.indexOf("notGamma") < 0) return null;
    var tail = "fragColor = vec4(color, 1.0);";
    if (src.indexOf("void main()") < 0 || src.indexOf(tail) < 0) return null;
    return src
      .replace("void main()", "uniform float oc_fb;\nvoid main()")
      .replace(tail, "fragColor = vec4(mix(color, vec3(1.0), oc_fb), 1.0);");
  }

  [window.WebGL2RenderingContext, window.WebGLRenderingContext].forEach(function (C) {
    if (!C) return;
    var P = C.prototype, shaderSource = P.shaderSource, attachShader = P.attachShader, useProgram = P.useProgram;
    P.shaderSource = function (shader, src) {
      var patched = patchLightmap(src);
      if (patched) { lightmapShaders.add(shader); src = patched; }
      return shaderSource.call(this, shader, src);
    };
    P.attachShader = function (program, shader) {
      if (lightmapShaders.has(shader)) lightmapPrograms.set(program, { loc: undefined });
      return attachShader.call(this, program, shader);
    };
    P.useProgram = function (program) {
      var r = useProgram.call(this, program);
      var info = program && lightmapPrograms.get(program);
      if (info) {
        if (info.loc === undefined) info.loc = this.getUniformLocation(program, "oc_fb");
        if (info.loc) this.uniform1f(info.loc, S.mods.fullbright ? clamp(OC.cfg("fullbright", "strength") / 100, 0.05, 1) : 0.0);
      }
      return r;
    };
  });

  /* ---------- CROSSHAIR: replace the game's own ----------
   * The game draws its crosshair as one quad per frame with the "invert" blend (ONE_MINUS_DST_COLOR, ONE_MINUS_SRC_COLOR,
   * ONE, ZERO); nothing else in the HUD uses that blend. We track the blend state and, while the Crosshair mod is on and
   * the mouse is captured (no screen open), skip exactly that draw. Seeing it also tells us the game wants a crosshair this
   * frame (first person, HUD shown ...), which the overlay in mods.js mirrors with the player's own design. */
  var GL_BLEND = 0x0BE2, xhSeen = false, xhVisible = false;
  OC.xhVisible = function () { return xhVisible; };
  OC.onFrameEnd = function () {                          // called by detect.js after every finished game frame
    if (xhVisible !== xhSeen) { xhVisible = xhSeen; OC.emit("xh", xhVisible); }
    xhSeen = false;
  };

  [window.WebGL2RenderingContext, window.WebGLRenderingContext].forEach(function (C) {
    if (!C) return;
    var P = C.prototype, blendFunc = P.blendFunc, blendFuncSeparate = P.blendFuncSeparate, enable = P.enable, disable = P.disable;
    function st(gl) { return gl.__ocBlend || (gl.__ocBlend = { on: false, s: 1, d: 0, sa: 1, da: 0 }); }
    P.blendFunc = function (s, d) { var b = st(this); b.s = b.sa = s; b.d = b.da = d; return blendFunc.call(this, s, d); };
    P.blendFuncSeparate = function (s, d, sa, da) { var b = st(this); b.s = s; b.d = d; b.sa = sa; b.da = da; return blendFuncSeparate.call(this, s, d, sa, da); };
    P.enable = function (cap) { if (cap === GL_BLEND) st(this).on = true; return enable.call(this, cap); };
    P.disable = function (cap) { if (cap === GL_BLEND) st(this).on = false; return disable.call(this, cap); };
    ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"].forEach(function (name) {
      var orig = P[name];
      if (typeof orig !== "function") return;
      P[name] = function () {
        if (S.mods.crosshair) {
          var b = this.__ocBlend;
          if (b && b.on && b.s === 0x0307 && b.d === 0x0301 && b.sa === 1 && b.da === 0 && realLock()) { xhSeen = true; return; }
        }
        return orig.apply(this, arguments);
      };
    });
  });

  /* ---------- input tracking ---------- */
  var down = OC.down = {};          // KeyboardEvent.code -> true
  var mouse = OC.mouse = { 0: false, 2: false };
  var lClicks = [], rClicks = [];
  var zooming = false;

  function inOverlay(e) { return !!(e.target && e.target.closest && e.target.closest("#oc-root, #oc-menu")); }
  function uiBlocksKeys() { return !!((OC.ui && OC.ui.isOpen()) || (OC.menu && OC.menu.blocksKeys && OC.menu.blocksKeys())); }

  window.addEventListener("keydown", function (e) {
    if (e.__oc) return;                                   // our own synthetic events
    var code = e.code;
    if (code === "ShiftRight") {                          // open / close the OneClient overlay
      if (!e.repeat && OC.ui && !(OC.mods && OC.mods.capturing())) OC.ui.toggle();
      e.stopPropagation();
      return;
    }
    down[code] = true;
    if (OC.ui && OC.ui.isOpen()) {                        // overlay open: the game must not see keys
      if (code === "Escape" && !e.repeat) OC.ui.back();
      e.__ocUi = true;                                    // taken: the menus (menu.js) must not act on this key as well
      e.stopPropagation();
      return;
    }
    if (OC.menu && OC.menu.blocksKeys && OC.menu.blocksKeys()) { e.stopPropagation(); return; }   // our menu is up
    if (code === "F1" && !e.repeat) OC.emit("f1");        // the game hides its HUD; hide ours with it
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || !inGame()) return; // never steal keys in chat / menus
    if (code === OC.cfg("fullbright", "key")) OC.toggleMod("fullbright");
    else if (code === OC.cfg("toggleSprint", "key")) OC.toggleMod("toggleSprint");
    else if (code === OC.cfg("zoom", "key") && S.mods.zoom) setZoom(true);
  }, true);

  window.addEventListener("keyup", function (e) {
    if (e.__oc) return;
    down[e.code] = false;
    if (e.code === OC.cfg("zoom", "key")) setZoom(false);
  }, true);

  window.addEventListener("blur", function () {
    for (var k in down) down[k] = false;
    mouse[0] = mouse[2] = false;
    setZoom(false);
  });

  window.addEventListener("mousedown", function (e) {
    if (e.__oc || inOverlay(e)) return;
    mouse[e.button] = true;
    if (e.button === 0) lClicks.push(performance.now());
    else if (e.button === 2) rClicks.push(performance.now());
  }, true);
  window.addEventListener("mouseup", function (e) { if (!e.__oc) mouse[e.button] = false; }, true);

  OC.cps = function (now) {
    while (lClicks.length && now - lClicks[0] > 1000) lClicks.shift();
    while (rClicks.length && now - rClicks[0] > 1000) rClicks.shift();
    return [lClicks.length, rClicks.length];
  };

  /* ---------- zoom (hold C while playing): narrow the game's view like a spyglass; scroll to change strength ----------
   * The world's perspective projection is tightened by a late rewriter (OC.glx.rewrite, client/sense.js), so only the game's picture is magnified:
   * the HUD, the crosshair, the chat and the hand keep their size (sense.js gives the hand and everything drawn after the world its normal projection
   * back). Without that hook (no WebGL2 layer) the whole canvas is scaled instead, as older builds did. */
  var zoomCur = 1, zoomLast = 0, zoomHook = null;
  function zoomRewrite(f) {
    var k = zoomCur;
    if (!(k > 1.001)) return false;
    f[0] *= k; f[1] *= k; f[4] *= k; f[5] *= k;                      // the x and y scale of the projection (and the tiny roll in it): the same terms the FOV Changer scales
    return true;
  }
  OC.zoomLevel = function () { return zoomCur; };
  function applyZoom() {
    if (!zoomHook && OC.glx && OC.glx.rewrite) zoomHook = OC.glx.rewrite("projection", zoomRewrite, "zoom", true);
    var c = canvas();
    if (zoomHook) {
      if (c && c.style.transform) { c.style.transform = ""; c.style.transition = ""; }      // scaling an older build may have left on the canvas
      if (!OC.cfg("zoom", "smooth")) zoomCur = zooming ? S.zoomFactor : 1;
      return;                                                        // zoomStep (every frame) moves zoomCur toward the target
    }
    if (!c) return;
    if (zooming) {
      c.style.transformOrigin = "50% 50%";
      c.style.transition = OC.cfg("zoom", "smooth") ? "transform .14s ease-out" : "none";
      c.style.transform = "scale(" + S.zoomFactor.toFixed(3) + ")";
    } else {
      c.style.transform = "";
    }
  }
  function zoomStep(now) {
    var dt = Math.min(100, now - (zoomLast || now)), target = zooming && zoomHook ? S.zoomFactor : 1;
    zoomLast = now;
    if (zoomCur === target) return;
    if (!OC.cfg("zoom", "smooth") || Math.abs(target - zoomCur) < 0.003) { zoomCur = target; return; }
    zoomCur += (target - zoomCur) * (1 - Math.exp(-dt / 65));      // ease in and out (about the pace of the old .14 s transition)
  }
  function setZoom(on) {
    if (on === zooming) return;
    zooming = on;
    applyZoom();
  }
  OC.stopZoom = function () { setZoom(false); };

  window.addEventListener("wheel", function (e) {
    if (!zooming || !OC.cfg("zoom", "scroll")) return;
    S.zoomFactor = clamp(S.zoomFactor * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1.5, 8);
    applyZoom();
    OC.save();
    e.stopPropagation();   // keep the hotbar from scrolling while adjusting zoom
    e.preventDefault();
  }, { capture: true, passive: false });

  /* ---------- toggle sprint: hold Left Ctrl for the player while W is held ---------- */
  var sprintHeld = false;
  function fakeCtrl(type) {
    var target = document.pointerLockElement || canvas() || document.body;
    var ev = new KeyboardEvent(type, { key: "Control", code: "ControlLeft", keyCode: 17, which: 17, ctrlKey: type === "keydown", bubbles: true, cancelable: true });
    ev.__oc = true;
    target.dispatchEvent(ev);
  }
  function releaseSprint() { if (sprintHeld) { sprintHeld = false; fakeCtrl("keyup"); } }
  function sprintTick() {
    var want = S.mods.toggleSprint && inGame() && !uiBlocksKeys() && (down.KeyW || down.ArrowUp);
    if (want && !sprintHeld) { sprintHeld = true; fakeCtrl("keydown"); }
    else if (!want && sprintHeld) releaseSprint();
  }

  /* ---------- frame loop (FPS counter + per-frame work) ---------- */
  var frames = 0, last = performance.now();
  OC.fps = 0;
  function loop(now) {
    frames++;
    if (now - last >= 500) { OC.fps = Math.round(frames * 1000 / (now - last)); frames = 0; last = now; }
    sprintTick();
    zoomStep(now);
    if (now - kbTick > 400) { kbTick = now; keyboardLock(); }
    if (OC.frame) OC.frame(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
