/* OneClient gfx: drawing helpers for mods that add things to the world (OC.glx.onWorld hooks) and a small post-processing pipeline.
 *
 * OC.glx.batch()    a batch of coloured lines (drawn as camera-facing ribbons, so they can be thicker than one pixel) and quads:
 *                     b.begin(ctx)                                  start filling (positions are world coordinates; the camera is subtracted here)
 *                     b.line(x0, y0, z0, x1, y1, z1, rgba, widthPx)
 *                     b.box(x0, y0, z0, x1, y1, z1, rgba, widthPx)   the 12 edges of an axis aligned box
 *                     b.quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, rgba)    a filled quad
 *                     b.fillBox(x0, y0, z0, x1, y1, z1, rgba)       the six faces
 *                     b.draw(ctx, { through: false })               draw what was added (through: true = also behind blocks); the batch is emptied
 *                   rgba is [r, g, b, a] with 0..1 values.
 * OC.glx.post       effects on the finished world picture (before the hand and the HUD are drawn):
 *                     post.set("color", { saturation, brightness, contrast } | null)      1 = unchanged
 *                     post.set("blur", { amount } | null)                                  0..0.9: how much of the previous frame stays
 *                   The pass is registered once an effect is set and costs one copy of the frame plus one or two full-screen draws.
 * ASCII-only source. */
(function () {
  "use strict";

  var OC = window.OneClient;
  if (!OC || !OC.glx || !OC.sense) return;
  var glx = OC.glx, M = glx.mat4;

  function compile(gl, vs, fs, attribs) {
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    (attribs || []).forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /* ---------- batches of lines and quads ---------- */
  var VS = "#version 300 es\nprecision highp float;\nin vec3 aPos; in vec4 aCol; uniform mat4 uPV;\nout vec4 vC;\nvoid main() { vC = aCol; gl_Position = uPV * vec4(aPos, 1.0); }";
  var FS = "#version 300 es\nprecision mediump float;\nin vec4 vC; out vec4 o;\nvoid main() { o = vC; }";
  var progs = new WeakMap();                                       // gl -> { prog, uPV }
  function program(gl) {
    var p = progs.get(gl);
    if (!p) { var pr = compile(gl, VS, FS, ["aPos", "aCol"]); p = { prog: pr, uPV: gl.getUniformLocation(pr, "uPV") }; progs.set(gl, p); }
    return p;
  }
  function pack(c) {                                               // [r, g, b, a] -> one 32 bit value whose bytes are r, g, b, a
    var r = Math.max(0, Math.min(255, Math.round(c[0] * 255))), g = Math.max(0, Math.min(255, Math.round(c[1] * 255))), b = Math.max(0, Math.min(255, Math.round(c[2] * 255))), a = Math.max(0, Math.min(255, Math.round((c[3] === undefined ? 1 : c[3]) * 255)));
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  function Batch() {
    this.cap = 2048; this.buf = new ArrayBuffer(this.cap * 16); this.f = new Float32Array(this.buf); this.u = new Uint32Array(this.buf);
    this.n = 0; this.cx = 0; this.cy = 0; this.cz = 0; this.fx = 0; this.fy = 0; this.fz = 1; this.k = 0.002; this.near = 0.05;
    this.gl = null; this.vao = null; this.vbo = null; this.vboBytes = 0;
  }
  var B = Batch.prototype;
  B.begin = function (ctx) {
    var c = ctx.cam;
    this.n = 0; this.cx = c.x; this.cy = c.y; this.cz = c.z; this.fx = c.fx; this.fy = c.fy; this.fz = c.fz;
    this.pxScale = 1 / (c.proj[5] * ctx.height);                   // world size of one pixel at distance 1
    this.ctx = ctx;
    return this;
  };
  B.grow = function (add) {
    if (this.n + add <= this.cap) return;
    var cap = this.cap; while (cap < this.n + add) cap *= 2;
    var nb = new ArrayBuffer(cap * 16), nf = new Float32Array(nb), nu = new Uint32Array(nb);
    nf.set(this.f.subarray(0, this.n * 4)); this.buf = nb; this.f = nf; this.u = nu; this.cap = cap;
  };
  B.vert = function (x, y, z, col) { var i = this.n * 4; this.f[i] = x; this.f[i + 1] = y; this.f[i + 2] = z; this.u[i + 3] = col; this.n++; };
  B.tri = function (ax, ay, az, bx, by, bz, cx, cy, cz, col) { this.grow(3); this.vert(ax, ay, az, col); this.vert(bx, by, bz, col); this.vert(cx, cy, cz, col); };
  /* positions are camera-relative inside the batch */
  B.quad = function (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, rgba) {
    var o = this, X = o.cx, Y = o.cy, Z = o.cz, col = pack(rgba);
    ax -= X; ay -= Y; az -= Z; bx -= X; by -= Y; bz -= Z; cx -= X; cy -= Y; cz -= Z; dx -= X; dy -= Y; dz -= Z;
    o.tri(ax, ay, az, bx, by, bz, cx, cy, cz, col); o.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, col);
  };
  B.line = function (x0, y0, z0, x1, y1, z1, rgba, widthPx) {
    var X = this.cx, Y = this.cy, Z = this.cz, ax = x0 - X, ay = y0 - Y, az = z0 - Z, bx = x1 - X, by = y1 - Y, bz = z1 - Z;
    var fx = this.fx, fy = this.fy, fz = this.fz, near = this.near;
    var da = ax * fx + ay * fy + az * fz, db = bx * fx + by * fy + bz * fz;
    if (da < near && db < near) return;
    if (da < near) { var t = (near - da) / (db - da); ax += (bx - ax) * t; ay += (by - ay) * t; az += (bz - az) * t; da = near; }
    else if (db < near) { var t2 = (near - db) / (da - db); bx += (ax - bx) * t2; by += (ay - by) * t2; bz += (az - bz) * t2; db = near; }
    var dx = bx - ax, dy = by - ay, dz = bz - az, mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
    var sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx, sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (sl < 1e-12) return;
    sx /= sl; sy /= sl; sz /= sl;
    var w = (widthPx || 2) * 0.5 * this.pxScale, ha = w * da, hb = w * db, col = pack(rgba);
    var alx = ax + sx * ha, aly = ay + sy * ha, alz = az + sz * ha, arx = ax - sx * ha, ary = ay - sy * ha, arz = az - sz * ha;
    var blx = bx + sx * hb, bly = by + sy * hb, blz = bz + sz * hb, brx = bx - sx * hb, bry = by - sy * hb, brz = bz - sz * hb;
    this.grow(6);
    this.vert(alx, aly, alz, col); this.vert(arx, ary, arz, col); this.vert(blx, bly, blz, col);
    this.vert(arx, ary, arz, col); this.vert(brx, bry, brz, col); this.vert(blx, bly, blz, col);
  };
  B.box = function (x0, y0, z0, x1, y1, z1, rgba, widthPx) {
    var l = this.line.bind(this);
    l(x0, y0, z0, x1, y0, z0, rgba, widthPx); l(x0, y1, z0, x1, y1, z0, rgba, widthPx); l(x0, y0, z1, x1, y0, z1, rgba, widthPx); l(x0, y1, z1, x1, y1, z1, rgba, widthPx);
    l(x0, y0, z0, x0, y1, z0, rgba, widthPx); l(x1, y0, z0, x1, y1, z0, rgba, widthPx); l(x0, y0, z1, x0, y1, z1, rgba, widthPx); l(x1, y0, z1, x1, y1, z1, rgba, widthPx);
    l(x0, y0, z0, x0, y0, z1, rgba, widthPx); l(x1, y0, z0, x1, y0, z1, rgba, widthPx); l(x0, y1, z0, x0, y1, z1, rgba, widthPx); l(x1, y1, z0, x1, y1, z1, rgba, widthPx);
  };
  B.fillBox = function (x0, y0, z0, x1, y1, z1, rgba) {
    var q = this.quad.bind(this);
    q(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, rgba); q(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, rgba);
    q(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0, rgba); q(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, rgba);
    q(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, rgba); q(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, rgba);
  };
  B.draw = function (ctx, opts) {
    opts = opts || {};
    var n = this.n;
    this.n = 0;
    if (!n) return;
    var gl = ctx.gl, c = ctx.cam, pr = program(gl);
    if (this.gl !== gl) { this.gl = gl; this.vao = gl.createVertexArray(); this.vbo = gl.createBuffer(); this.vboBytes = 0; }
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    var bytes = n * 16;
    if (bytes > this.vboBytes) { this.vboBytes = Math.max(bytes, this.vboBytes * 2, 65536); gl.bufferData(gl.ARRAY_BUFFER, this.vboBytes, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Uint8Array(this.buf, 0, bytes));
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    gl.useProgram(pr.prog);
    gl.uniformMatrix4fv(pr.uPV, false, M.mul(c.proj, c.view));
    var reverse = c.reverseZ !== false;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.depthFunc(opts.through ? gl.ALWAYS : (reverse ? gl.GEQUAL : gl.LEQUAL));
    gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(reverse ? 1 : -1, reverse ? 1 : -1);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, n);
  };
  glx.batch = function () { return new Batch(); };

  /* ---------- post-processing of the world picture ---------- */
  var PVS = "#version 300 es\nprecision highp float;\nout vec2 uv;\nvoid main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }";
  var PFS_MIX = "#version 300 es\nprecision highp float;\nuniform sampler2D uScene; uniform sampler2D uHist; uniform float uBlur;\nin vec2 uv; out vec4 o;\nvoid main() { o = vec4(mix(texture(uScene, uv).rgb, texture(uHist, uv).rgb, uBlur), 1.0); }";
  var PFS_ADJ = "#version 300 es\nprecision highp float;\nuniform sampler2D uSrc; uniform vec3 uAdj;\nin vec2 uv; out vec4 o;\nvoid main() {\n  vec3 c = texture(uSrc, uv).rgb;\n  float l = dot(c, vec3(0.299, 0.587, 0.114));\n  c = mix(vec3(l), c, uAdj.x);\n  c = (c - 0.5) * uAdj.z + 0.5;\n  c *= uAdj.y;\n  o = vec4(clamp(c, 0.0, 1.0), 1.0);\n}";
  var post = glx.post = { fx: { color: null, blur: null }, active: false };
  var pst = null;                                                  // GL objects, created on first use and rebuilt when the size changes
  var unhook = null;

  function target(ctx, w, h) {
    var gl = ctx.gl, t = gl.createTexture();
    ctx.bindTexture(7, t);                                         // (the game's own binding of that unit comes back after the pass)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fbo: f };
  }
  function setup(ctx, w, h) {
    var gl = ctx.gl;
    if (pst && pst.gl === gl && pst.w === w && pst.h === h) return pst;
    if (pst && pst.gl === gl) { [pst.scene, pst.a, pst.b].forEach(function (o) { gl.deleteTexture(o.tex); gl.deleteFramebuffer(o.fbo); }); }
    var s = pst && pst.gl === gl ? pst : { gl: gl, mix: compile(gl, PVS, PFS_MIX), adj: compile(gl, PVS, PFS_ADJ), vao: gl.createVertexArray() };
    s.w = w; s.h = h; s.scene = target(ctx, w, h); s.a = target(ctx, w, h); s.b = target(ctx, w, h); s.flip = false; s.histOk = false;
    s.u = {
      mixScene: gl.getUniformLocation(s.mix, "uScene"), mixHist: gl.getUniformLocation(s.mix, "uHist"), mixBlur: gl.getUniformLocation(s.mix, "uBlur"),
      adjSrc: gl.getUniformLocation(s.adj, "uSrc"), adjAdj: gl.getUniformLocation(s.adj, "uAdj")
    };
    return (pst = s);
  }

  function runPost(ctx) {
    var gl = ctx.gl, w = ctx.width, h = ctx.height, fx = post.fx, color = fx.color, blur = fx.blur;
    if (!color && !blur) return;
    var s = setup(ctx, w, h), main = gl.getParameter(0x8CA6);
    // 1. copy what has been drawn so far
    gl.bindFramebuffer(0x8CA8, main);
    var readBuf = gl.getParameter(gl.READ_BUFFER);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(0x8CA9, s.scene.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(false); gl.colorMask(true, true, true, true);
    gl.bindVertexArray(s.vao);
    gl.viewport(0, 0, w, h);
    var src = s.scene.tex;
    // 2. frame blending against the previous (blended) frame
    if (blur && blur.amount > 0) {
      var out = s.flip ? s.b : s.a, hist = s.flip ? s.a : s.b;
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.useProgram(s.mix);
      ctx.bindTexture(0, s.scene.tex); gl.uniform1i(s.u.mixScene, 0);
      ctx.bindTexture(1, hist.tex); gl.uniform1i(s.u.mixHist, 1);
      gl.uniform1f(s.u.mixBlur, s.histOk ? Math.max(0, Math.min(0.95, blur.amount)) : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      s.flip = !s.flip; s.histOk = true; src = out.tex;
    } else s.histOk = false;
    // 3. back into the game's picture, with the colour adjustment
    gl.bindFramebuffer(gl.FRAMEBUFFER, main);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.useProgram(s.adj);
    ctx.bindTexture(0, src); gl.uniform1i(s.u.adjSrc, 0);
    if (color) gl.uniform3f(s.u.adjAdj, color.saturation === undefined ? 1 : color.saturation, color.brightness === undefined ? 1 : color.brightness, color.contrast === undefined ? 1 : color.contrast);
    else gl.uniform3f(s.u.adjAdj, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(0x8CA8, main); gl.readBuffer(readBuf);       // the game's frame buffer reads the way it did
  }
  post.set = function (name, v) {
    if (name !== "color" && name !== "blur") return false;
    post.fx[name] = v || null;
    var want = !!(post.fx.color || post.fx.blur);
    if (want && !unhook) unhook = glx.onWorldLate(runPost, "post");
    else if (!want && unhook) { unhook(); unhook = null; }
    post.active = want;
    return true;
  };
})();
