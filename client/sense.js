/* OneClient sense: what the game shows the browser, turned into data a mod can use.
 *
 * The game is a sealed WebAssembly build, but everything it does reaches the browser through standard APIs. Its
 * shaders are the vanilla ones, with named uniform blocks, so by shadowing the uniform buffers it uploads we can read the
 * exact camera it renders with, without any access to the game's own code:
 *
 *   Globals      { ivec3 CameraBlockPos; vec3 CameraOffset; vec2 ScreenSize; ... }   camera position = CameraBlockPos - CameraOffset
 *   Projection   { mat4 ProjMat }                                                    reverse-Z perspective (depthFunc GEQUAL)
 *   ChunkSection { mat4 ModelViewMat; float ChunkVisibility; ivec2 TextureSize; ivec3 ChunkPosition }
 *
 * Terrain vertices are positioned as   gl_Position = ProjMat * ModelViewMat * vec4(world - camera, 1).
 *
 * OC.sense.cam      the camera of the last world frame (position, view and projection matrices, yaw/pitch, fov)
 * OC.sense.inWorld  true while the game is drawing a world (terrain) and not only menus
 * OC.glx            hook to draw into the game's own frame, in the world pass, depth-tested against the terrain
 *                   (OC.glx.onWorld(fn): fn(ctx) runs right before the game clears depth for the hand and the HUD)
 * ASCII-only source. Must load right after core.js: the game caches nothing from before we wrap the context. */
(function () {
  "use strict";

  var OC = window.OneClient;
  var GL2 = window.WebGL2RenderingContext;
  if (!OC || !GL2) return;

  var UBO = 0x8A11, FRAMEBUFFER = 0x8D40, DRAW_FRAMEBUFFER = 0x8CA9, DEPTH_BIT = 0x100, COLOR_BIT = 0x4000;
  var sense = OC.sense = {
    cam: null,                       // { x, y, z, bx, by, bz, ox, oy, oz, view, proj, yaw, pitch, fov, aspect, near, far, frame }
    inWorld: false,
    frame: 0,                        // finished game frames
    worldFrame: 0,                   // frames in which a world was drawn
    gl: null,                        // the game's WebGL2 context
    width: 0, height: 0,             // size of the world render target
    stats: { passes: 0, missed: 0, hookErrors: 0 }
  };
  var glx = OC.glx = { hooks: [] };
  var frameCbs = [];
  sense.onFrame = function (fn) { frameCbs.push(fn); return function () { var i = frameCbs.indexOf(fn); if (i >= 0) frameCbs.splice(i, 1); }; };

  /* ---------- per-context state ---------- */
  var states = new WeakMap();
  function st(gl) {
    var s = states.get(gl);
    if (!s) {
      s = { gen: null, ubo: [], shadow: new WeakMap(), program: null, fbo: null, progs: new WeakMap(), terrain: false, injected: false, captured: false, drew: false };
      states.set(gl, s);
    }
    return s;
  }
  var inHook = false;

  function bytesOf(data, srcOff, len) {                          // a copy of the bytes of an ArrayBuffer / typed array argument
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data)) {
      var es = data.BYTES_PER_ELEMENT || 1, off = data.byteOffset + (srcOff || 0) * es, n = len ? len * es : data.byteLength - (srcOff || 0) * es;
      return new Uint8Array(data.buffer.slice(off, off + n));
    }
    return null;
  }

  /* ---------- buffer shadows (uniform buffers only) ---------- */
  var P = GL2.prototype;
  function pre(name, fn) {
    var orig = P[name];
    if (typeof orig !== "function") return;
    P[name] = function () {
      if (!inHook) { try { fn(this, arguments); } catch (e) { sense.stats.hookErrors++; } }
      return orig.apply(this, arguments);
    };
  }

  pre("bindBuffer", function (gl, a) { if (a[0] === UBO) st(gl).gen = a[1]; });
  pre("bindBufferBase", function (gl, a) { if (a[0] === UBO) { var s = st(gl); s.ubo[a[1]] = { buf: a[2], off: 0, size: 0 }; s.gen = a[2]; } });
  pre("bindBufferRange", function (gl, a) { if (a[0] === UBO) { var s = st(gl); s.ubo[a[1]] = { buf: a[2], off: a[3], size: a[4] }; s.gen = a[2]; } });
  /* Uniform buffer uploads are shadowed (above) and may be rewritten on their way to the GPU: a mod that registers a rewriter with
   * OC.glx.rewrite("projection" | "fog", fn) sees the 64-byte perspective matrix / the 40-byte fog block of every frame as a Float32Array,
   * changes it in place and returns true. The shadow keeps the changed bytes, so OC.sense.cam describes what is really drawn. */
  var rewriters = glx.rewriters = [];
  /* late = true: run after every other rewriter of that kind, and the matrix as it was before the late ones is kept (glx.preLate) so the hand and the HUD,
   * which the game draws with the same projection right after the world, can get it back (see "clear" below): this is what Zoom does. */
  glx.rewrite = function (kind, fn, owner, late) {
    var r = { kind: kind, fn: fn, owner: owner || null, errors: 0, late: !!late };
    rewriters.push(r);
    return function () { var i = rewriters.indexOf(r); if (i >= 0) rewriters.splice(i, 1); };
  };
  function rewriteBytes(bytes) {
    if (!rewriters.length) return false;
    var n = bytes.length, kind = n === 64 ? "projection" : n === 40 ? "fog" : null;
    if (!kind) return false;
    var f = new Float32Array(bytes.buffer, bytes.byteOffset, n >> 2);
    if (kind === "projection" && !(Math.abs(f[11] + 1) < 1e-3 && Math.abs(f[15]) < 1e-3 && f[5] > 0 && f[0] > 0)) return false;     // the GUI's orthographic matrix stays as it is (the tilt of a hit or a walking bob makes -1 come out as -0.9999999)
    if (kind === "fog" && !(f[3] >= 0 && f[3] <= 1 && f[5] > 0 && f[7] > 0)) return false;
    var changed = false;
    if (kind === "projection") glx.lateChanged = false;
    for (var pass = 0; pass < 2; pass++) {                          // the ordinary rewriters, then the late ones
      if (pass === 1 && kind === "projection") glx.preLate = new Float32Array(f);
      for (var i = 0; i < rewriters.length; i++) {
        var r = rewriters[i];
        if (r.kind !== kind || r.dead || r.late !== (pass === 1)) continue;
        try { if (r.fn(f) !== false) { changed = true; if (pass === 1 && kind === "projection") glx.lateChanged = true; } }
        catch (e) { if (++r.errors >= 5) { r.dead = true; try { console.error("[OneClient] a " + kind + " rewriter of " + (r.owner || "?") + " switched off after repeated errors:", e); } catch (x) {} } }
      }
    }
    return changed;
  }
  var bufferData = P.bufferData, bufferSubData = P.bufferSubData;
  P.bufferData = function (target, data, usage, srcOff, len) {
    if (target === UBO && !inHook) {
      try {
        var s = st(this), b = s.gen;
        if (b) {
          if (typeof data === "number") s.shadow.set(b, new Uint8Array(data));
          else {
            var bytes = bytesOf(data, srcOff, len);
            if (bytes) { var mod = rewriteBytes(bytes); s.shadow.set(b, bytes); if (mod) return bufferData.call(this, target, bytes, usage); }
            else s.shadow.set(b, new Uint8Array(0));
          }
        }
      } catch (e) { sense.stats.hookErrors++; }
    }
    return bufferData.apply(this, arguments);
  };
  P.bufferSubData = function (target, off, data, srcOff, len) {
    if (target === UBO && !inHook) {
      try {
        var s = st(this), b = s.gen;
        if (b) {
          var bytes = bytesOf(data, srcOff, len);
          if (bytes) {
            var mod = rewriteBytes(bytes), sh = s.shadow.get(b), need = off + bytes.length;
            if (!sh || sh.length < need) { var bigger = new Uint8Array(need); if (sh) bigger.set(sh); sh = bigger; s.shadow.set(b, sh); }
            sh.set(bytes, off);
            if (mod) return bufferSubData.call(this, target, off, bytes);
          }
        }
      } catch (e) { sense.stats.hookErrors++; }
    }
    return bufferSubData.apply(this, arguments);
  };
  pre("bindFramebuffer", function (gl, a) { if (a[0] === FRAMEBUFFER || a[0] === DRAW_FRAMEBUFFER) st(gl).fbo = a[1]; });
  pre("useProgram", function (gl, a) { st(gl).program = a[0]; });

  /* ---------- which program draws terrain, and where its uniform blocks are bound ---------- */
  function analyse(gl, s, prog) {
    var info = { terrain: false, bind: {} };
    try {
      var n = gl.getProgramParameter(prog, 0x8A36);                // ACTIVE_UNIFORM_BLOCKS
      for (var i = 0; i < n; i++) info.bind[gl.getActiveUniformBlockName(prog, i)] = gl.getActiveUniformBlockParameter(prog, i, 0x8A3F);   // UNIFORM_BLOCK_BINDING
      info.terrain = info.bind.ChunkSection !== undefined && info.bind.Projection !== undefined && info.bind.Globals !== undefined;
    } catch (e) { /* program not linked yet: look again next time */ return info; }
    s.progs.set(prog, info);
    return info;
  }
  function block(s, binding, min) {
    var r = s.ubo[binding];
    if (!r) return null;
    var sh = s.shadow.get(r.buf);
    if (!sh || r.off + min > sh.length) return null;
    return new DataView(sh.buffer, sh.byteOffset + r.off, sh.length - r.off);
  }

  var camScratch = { view: new Float32Array(16), proj: new Float32Array(16) };
  function capture(gl, s, info) {
    var g = block(s, info.bind.Globals, 28), pr = block(s, info.bind.Projection, 64), cs = block(s, info.bind.ChunkSection, 64);
    if (!g || !pr || !cs) return;
    var i, bx = g.getInt32(0, true), by = g.getInt32(4, true), bz = g.getInt32(8, true), ox = g.getFloat32(16, true), oy = g.getFloat32(20, true), oz = g.getFloat32(24, true);
    var view = camScratch.view, proj = camScratch.proj;
    for (i = 0; i < 16; i++) { view[i] = cs.getFloat32(i * 4, true); proj[i] = pr.getFloat32(i * 4, true); }
    if (!(proj[5] > 0) || !isFinite(view[0])) return;               // not a perspective camera (a menu panorama, a half-written buffer ...)
    var fx = -view[2], fy = -view[6], fz = -view[10];
    var c = sense.cam || (sense.cam = { view: new Float32Array(16), proj: new Float32Array(16) });
    c.bx = bx; c.by = by; c.bz = bz; c.ox = ox; c.oy = oy; c.oz = oz;
    c.x = bx - ox; c.y = by - oy; c.z = bz - oz;                    // exact: the game computes world - camera as (world - block) + offset
    c.view.set(view); c.proj.set(proj);
    c.yaw = Math.atan2(-fx, fz) * 180 / Math.PI;                    // Minecraft convention: 0 = south (+z), 90 = west (-x)
    c.pitch = -Math.asin(Math.max(-1, Math.min(1, fy))) * 180 / Math.PI;
    c.fx = fx; c.fy = fy; c.fz = fz;
    c.fov = 2 * Math.atan(1 / proj[5]) * 180 / Math.PI;
    c.aspect = proj[5] / proj[0];
    var za = Math.abs(proj[14] / (proj[10] + 1)), zb = Math.abs(proj[14] / (proj[10] - 1));      // the two clip distances, whichever way round the depth runs
    c.near = Math.min(za, zb); c.far = Math.max(za, zb);
    c.reverseZ = proj[10] > 0;                                      // the game uses reverse-Z (depth func GEQUAL): geometry we add must do the same
    c.frame = sense.frame;
    s.captured = true;
  }

  /* ---------- frame phases ---------- */
  function onDraw(gl) {
    var s = st(gl);
    if (s.fbo === null || s.fbo === undefined) {                    // a draw to the screen: the final composite, the frame is over
      if (s.drew) endFrame(gl, s);
      return;
    }
    s.drew = true;
    var p = s.program;
    if (!p) return;
    var info = s.progs.get(p) || analyse(gl, s, p);
    if (info.terrain) {
      s.terrain = true;
      s.projBind = info.bind.Projection;
      if (!s.captured) capture(gl, s, info);
    }
  }
  /* The hand and the HUD are drawn after the world with the projection that is in the game's buffer at that moment. When a late rewriter (Zoom)
   * has narrowed the world's view, put the matrix as it was before it back, so the hand and everything after keep their normal size. */
  function restoreHand(gl, s) {
    if (!glx.lateChanged || !glx.preLate || s.projBind === undefined) return;
    var r = s.ubo[s.projBind];
    if (!r || !r.buf) return;
    glx.lateChanged = false;
    var prev = gl.getParameter(0x8A28), was = inHook;                // UNIFORM_BUFFER_BINDING
    inHook = true;                                                   // our own upload must not be rewritten or shadowed again
    try { gl.bindBuffer(UBO, r.buf); bufferSubData.call(gl, UBO, r.off || 0, glx.preLate); }
    finally { gl.bindBuffer(UBO, prev); inHook = was; }
  }
  function endFrame(gl, s) {
    var world = s.terrain && s.captured;
    if (s.terrain && !s.injected && glx.hooks.length) sense.stats.missed++;
    sense.inWorld = world;
    sense.frame++;
    if (world) sense.worldFrame++;
    s.terrain = s.injected = s.captured = s.drew = false;
    for (var i = 0; i < frameCbs.length; i++) { try { frameCbs[i](sense.frame, world); } catch (e) { console.error("[OneClient]", e); } }
  }
  ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"].forEach(function (n) { pre(n, onDraw); });

  /* The world pass hook: the game clears the depth buffer once the world is drawn (before the hand and the HUD). Right before
   * that clear the colour and depth of the whole scene are in the game's frame buffer: draw there. */
  pre("clear", function (gl, a) {
    var s = st(gl), m = a[0];
    if ((m & DEPTH_BIT) && !(m & COLOR_BIT) && s.terrain && s.captured && !s.injected) {
      s.injected = true;
      runWorld(gl);
      try { restoreHand(gl, s); } catch (e) { sense.stats.hookErrors++; }
    }
  });

  var UNPACK = [0x0CF5, 0x9240, 0x9241, 0x9243, 0x0CF2, 0x0CF3, 0x0CF4, 0x806E, 0x806B];   // UNPACK_ALIGNMENT FLIP_Y PREMULTIPLY COLORSPACE ROW_LENGTH SKIP_ROWS SKIP_PIXELS IMAGE_HEIGHT SKIP_IMAGES
  var STATE_CAPS = [0x0B71, 0x0BE2, 0x0B44, 0x0C11, 0x8037, 0x0B90, 0x0BD0];   // DEPTH_TEST BLEND CULL_FACE SCISSOR_TEST POLYGON_OFFSET_FILL STENCIL_TEST DITHER
  function saveState(gl) {
    var S = { caps: STATE_CAPS.map(function (c) { return gl.isEnabled(c); }), tex: {} };
    S.program = gl.getParameter(gl.CURRENT_PROGRAM);
    S.vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    S.abuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    S.unit = gl.getParameter(gl.ACTIVE_TEXTURE);
    S.depthFunc = gl.getParameter(gl.DEPTH_FUNC);
    S.depthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    S.blend = [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB), gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA), gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA)];
    S.cullMode = gl.getParameter(gl.CULL_FACE_MODE);
    S.polyOffset = [gl.getParameter(0x8038), gl.getParameter(0x2A00)];            // POLYGON_OFFSET_FACTOR, POLYGON_OFFSET_UNITS
    S.front = gl.getParameter(gl.FRONT_FACE);
    S.colorMask = gl.getParameter(gl.COLOR_WRITEMASK);
    S.unpack = UNPACK.map(function (p) { return gl.getParameter(p); });
    S.fbDraw = gl.getParameter(0x8CA6); S.fbRead = gl.getParameter(0x8CAA);       // DRAW_ / READ_FRAMEBUFFER_BINDING: a hook may draw into frame buffers of its own
    S.viewport = gl.getParameter(gl.VIEWPORT);
    S.scissor = gl.getParameter(0x0C10);                                           // SCISSOR_BOX
    S.drawBuffers = [gl.getParameter(0x8825), gl.getParameter(0x8826), gl.getParameter(0x8827), gl.getParameter(0x8828)];   // DRAW_BUFFER0..3: right now NONE (a depth-only clear is about to happen)
    return S;
  }
  function restoreState(gl, S) {
    var i;
    for (var u in S.tex) {
      gl.activeTexture(0x84C0 + (+u));
      gl.bindTexture(0x0DE1, S.tex[u].t);
      gl.bindSampler(+u, S.tex[u].s);
    }
    gl.activeTexture(S.unit);
    gl.bindFramebuffer(0x8CA9, S.fbDraw); gl.bindFramebuffer(0x8CA8, S.fbRead);
    gl.viewport(S.viewport[0], S.viewport[1], S.viewport[2], S.viewport[3]);
    gl.scissor(S.scissor[0], S.scissor[1], S.scissor[2], S.scissor[3]);
    gl.bindVertexArray(S.vao);
    gl.bindBuffer(0x8892, S.abuf);
    gl.useProgram(S.program);
    for (i = 0; i < STATE_CAPS.length; i++) { if (S.caps[i]) gl.enable(STATE_CAPS[i]); else gl.disable(STATE_CAPS[i]); }
    gl.depthFunc(S.depthFunc);
    gl.depthMask(S.depthMask);
    gl.blendFuncSeparate(S.blend[0], S.blend[1], S.blend[2], S.blend[3]);
    gl.blendEquationSeparate(S.blend[4], S.blend[5]);
    gl.cullFace(S.cullMode);
    gl.polygonOffset(S.polyOffset[0], S.polyOffset[1]);
    gl.frontFace(S.front);
    gl.colorMask(S.colorMask[0], S.colorMask[1], S.colorMask[2], S.colorMask[3]);
    for (i = 0; i < UNPACK.length; i++) gl.pixelStorei(UNPACK[i], S.unpack[i]);
    var db = S.drawBuffers.slice(), n = db.length;
    while (n > 1 && db[n - 1] === 0) n--;                           // the list the game had: trailing NONE entries are the default
    gl.drawBuffers(db.slice(0, n));
  }

  function runWorld(gl) {
    var hooks = glx.hooks;
    if (!hooks.length || inHook) return;
    var c = sense.cam, vp = gl.getParameter(gl.VIEWPORT);
    sense.gl = gl; sense.width = vp[2]; sense.height = vp[3];
    inHook = true;
    var S = null;
    try {
      S = saveState(gl);
      gl.drawBuffers([0x8CE0]);                                      // the game switches colour writes off for the depth clear: turn them on for our pass
      var ctx = {
        gl: gl, cam: c, width: vp[2], height: vp[3], frame: sense.frame, time: performance.now(),
        resetUnpack: function () {                                    // plain tightly packed uploads, whatever the game left set
          gl.pixelStorei(0x0CF5, 4); gl.pixelStorei(0x9240, 0); gl.pixelStorei(0x9241, 0); gl.pixelStorei(0x9243, 0x9244);
          gl.pixelStorei(0x0CF2, 0); gl.pixelStorei(0x0CF3, 0); gl.pixelStorei(0x0CF4, 0); gl.pixelStorei(0x806E, 0); gl.pixelStorei(0x806B, 0);
        },
        bindTexture: function (unit, tex) {                           // bind a texture for the duration of this pass (the previous binding comes back after it)
          if (!(unit in S.tex)) { gl.activeTexture(0x84C0 + unit); S.tex[unit] = { t: gl.getParameter(0x8069), s: gl.getParameter(0x8919) }; }
          gl.activeTexture(0x84C0 + unit); gl.bindTexture(0x0DE1, tex); gl.bindSampler(unit, null);
        }
      };
      for (var i = 0, ordered = hooks.filter(function (x) { return !x.late; }).concat(hooks.filter(function (x) { return x.late; })); i < ordered.length; i++) {
        var h = ordered[i];
        if (h.dead) continue;
        try { h.fn(ctx); }
        catch (e) {
          sense.stats.hookErrors++;
          if (++h.errors >= 5) { h.dead = true; console.error("[OneClient] world hook of " + (h.owner || "?") + " switched off after repeated errors:", e); if (h.onDead) { try { h.onDead(e); } catch (e2) {} } }
          else console.error("[OneClient] world hook error:", e);
        }
      }
      sense.stats.passes++;
    } finally {
      try { if (S) restoreState(gl, S); } catch (e) { console.error("[OneClient] could not restore the GL state:", e); }
      inHook = false;
    }
  }

  /* subscribe to the world pass: fn(ctx) with ctx = { gl, cam, width, height, frame, time, bindTexture(unit, tex) }.
   * Returns a function that removes the hook. */
  glx.onWorld = function (fn, owner, onDead) {
    var h = { fn: fn, owner: owner || null, errors: 0, dead: false, onDead: onDead || null };
    glx.hooks.push(h);
    return function () { var i = glx.hooks.indexOf(h); if (i >= 0) glx.hooks.splice(i, 1); };
  };
  /* the same, but run after every other hook: for effects on the finished picture (OC.glx.post) */
  glx.onWorldLate = function (fn, owner, onDead) {
    var h = { fn: fn, owner: owner || null, errors: 0, dead: false, onDead: onDead || null, late: true };
    glx.hooks.push(h);
    return function () { var i = glx.hooks.indexOf(h); if (i >= 0) glx.hooks.splice(i, 1); };
  };

  /* ---------- small math helpers (column-major, like WebGL) ---------- */
  var M = glx.mat4 = {
    mul: function (a, b, out) {                                    // out = a * b
      out = out || new Float32Array(16);
      for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return out;
    },
    identity: function (out) { out = out || new Float32Array(16); out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; },
    translate: function (x, y, z, out) { out = M.identity(out); out[12] = x; out[13] = y; out[14] = z; return out; }
  };

  /* project a world position to canvas CSS pixels with the last world camera: { x, y, depth, visible } */
  sense.project = function (wx, wy, wz) {
    var c = sense.cam;
    if (!c) return null;
    var rx = wx - c.x, ry = wy - c.y, rz = wz - c.z, v = c.view, p = c.proj;
    var ex = v[0] * rx + v[4] * ry + v[8] * rz + v[12], ey = v[1] * rx + v[5] * ry + v[9] * rz + v[13], ez = v[2] * rx + v[6] * ry + v[10] * rz + v[14];
    var cx = p[0] * ex + p[4] * ey + p[8] * ez + p[12], cy = p[1] * ex + p[5] * ey + p[9] * ez + p[13], cw = p[3] * ex + p[7] * ey + p[11] * ez + p[15];
    if (!(cw > 0)) return { x: 0, y: 0, depth: -ez, visible: false };
    var cv = document.querySelector("canvas"), w = cv ? cv.clientWidth : innerWidth, h = cv ? cv.clientHeight : innerHeight, rc = cv ? cv.getBoundingClientRect() : { left: 0, top: 0 };
    var sx = (cx / cw * 0.5 + 0.5) * w, sy = (1 - (cy / cw * 0.5 + 0.5)) * h;
    return { x: sx + rc.left, y: sy + rc.top, depth: -ez, visible: sx >= 0 && sx <= w && sy >= 0 && sy <= h };
  };
})();
