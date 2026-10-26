/* Drawing the schematic inside the game's own frame (api.gl.onWorld): sections are uploaded lazily, culled against the camera frustum and
 * the draw distance, then drawn twice: a depth-only pass so only the nearest surface of the schematic shows, then the coloured pass. */
var Render = (function () {
  var gl0 = null, prog = null, lprog = null, vprog = null, loc = {}, lloc = {}, vloc = {}, ibo = null, ibQuads = 0, atlasTex = null, atlasVersion = -1, lineVao = null, lineBuf = null;
  var UNIT = 15;
  var VS = "#version 300 es\nprecision highp float;\nin vec3 aPos; in vec2 aUV; in vec4 aCol;\nuniform mat4 uPV; uniform vec3 uOff; uniform float uBaseY;\nout vec2 vUV; out vec4 vCol; out float vY;\ninvariant gl_Position;\nvoid main() { vUV = aUV; vCol = aCol; vY = aPos.y + uBaseY; gl_Position = uPV * vec4(aPos + uOff, 1.0); }";
  var FS = "#version 300 es\nprecision highp float;\nin vec2 vUV; in vec4 vCol; in float vY;\nuniform sampler2D uTex; uniform float uAlpha; uniform vec2 uLayer;\nout vec4 o;\nvoid main() {\n  if (vY < uLayer.x || vY > uLayer.y) discard;\n  vec4 c = texture(uTex, vUV) * vCol;\n  if (c.a < 0.1) discard;\n  o = vec4(c.rgb, c.a * uAlpha);\n}";
  var LVS = "#version 300 es\nprecision highp float;\nin vec3 aPos; uniform mat4 uPV; uniform vec3 uOff;\nvoid main() { gl_Position = uPV * vec4(aPos + uOff, 1.0); }";
  var LFS = "#version 300 es\nprecision mediump float;\nuniform vec4 uCol; out vec4 o;\nvoid main() { o = uCol; }";
  var VVS = "#version 300 es\nprecision highp float;\nin vec3 aPos; in vec4 aCol; uniform mat4 uPV; uniform vec3 uOff;\nout vec4 vC;\nvoid main() { vC = aCol; gl_Position = uPV * vec4(aPos + uOff, 1.0); }";
  var VFS = "#version 300 es\nprecision mediump float;\nin vec4 vC; out vec4 o;\nvoid main() { o = vC; }";

  function compile(gl, vs, fs, attribs) {
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attribs.forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function init(gl) {
    prog = compile(gl, VS, FS, ["aPos", "aUV", "aCol"]);
    ["uPV", "uOff", "uBaseY", "uTex", "uAlpha", "uLayer"].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    lprog = compile(gl, LVS, LFS, ["aPos"]);
    ["uPV", "uOff", "uCol"].forEach(function (n) { lloc[n] = gl.getUniformLocation(lprog, n); });
    vprog = compile(gl, VVS, VFS, ["aPos", "aCol"]);
    ["uPV", "uOff"].forEach(function (n) { vloc[n] = gl.getUniformLocation(vprog, n); });
    atlasTex = gl.createTexture(); atlasVersion = -1;
    ibo = gl.createBuffer(); ibQuads = 0;
    lineVao = gl.createVertexArray(); lineBuf = gl.createBuffer();
    gl.bindVertexArray(lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl0 = gl;
  }

  function ensureIndices(gl, vao, quads) {                   // one shared index pattern 0 1 2 0 2 3 + 4k, grown when a section needs more
    if (quads > ibQuads) {
      var n = Math.max(quads, ibQuads * 2, 4096), idx = new Uint32Array(n * 6);
      for (var q = 0; q < n; q++) { var b = q * 4, o = q * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
      gl.bindVertexArray(vao);                               // the element buffer binding lives in the VAO
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      ibQuads = n;
    }
  }
  function sectionVao(gl, s) {
    var vao = gl.createVertexArray(), vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(s.verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 24, 20);
    ensureIndices(gl, vao, s.quads);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    return { vao: vao, vbo: vbo, quads: s.quads };
  }
  function freeGl(gl, r) { try { gl.deleteVertexArray(r.vao); gl.deleteBuffer(r.vbo); } catch (e) {} }

  function uploadAtlas(gl, ctx) {
    var a = Assets.atlas;
    if (!a.canvas || atlasVersion === a.version) return;
    var px = a.canvas.getContext("2d").getImageData(0, 0, a.width, a.height).data;
    ctx.bindTexture(UNIT, atlasTex);
    ctx.resetUnpack();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, a.width, a.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(px.buffer, px.byteOffset, px.byteLength));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    atlasVersion = a.version;
  }

  /* the six clip planes of the view-projection in camera-relative space */
  function planes(m) {
    var p = [], r = function (i) { return [m[i], m[4 + i], m[8 + i], m[12 + i]]; }, r0 = r(0), r1 = r(1), r2 = r(2), r3 = r(3), k;
    function add(a, b, s) { var v = [r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]], l = Math.hypot(v[0], v[1], v[2]) || 1; p.push([v[0] / l, v[1] / l, v[2] / l, v[3] / l]); }
    add(r0, 0, 1); add(r0, 0, -1); add(r1, 0, 1); add(r1, 0, -1); add(r2, 0, 1); add(r2, 0, -1);
    return p;
  }
  function visible(pl, x, y, z, s) {                          // AABB (x..x+s) against the planes
    for (var i = 0; i < 6; i++) {
      var q = pl[i], px = q[0] > 0 ? x + s : x, py = q[1] > 0 ? y + s : y, pz = q[2] > 0 ? z + s : z;
      if (q[0] * px + q[1] * py + q[2] * pz + q[3] < 0) return false;
    }
    return true;
  }

  var statsLast = { drawn: 0, culled: 0, quads: 0 };

  function draw(ctx) {
    var gl = ctx.gl, c = ctx.cam, S = LM.schem, st = Mesher.state, set = LM.set;
    if (gl0 !== gl) { try { init(gl); } catch (e) { LM.fatal("Could not start the renderer: " + e.message); return; } }
    // free what was dropped since the last frame
    while (st.pendingFree.length) freeGl(gl, st.pendingFree.pop());
    if (!S) return;
    Verify.step(3);                                          // a few milliseconds of comparing the schematic with the world
    var pv = api.gl.mat4.mul(c.proj, c.view), planesCam = planes(pv), reverse = c.reverseZ;
    if (!st.list.length || !set("visible")) { drawVerify(gl, c, pv, planesCam, reverse ? gl.GEQUAL : gl.LEQUAL, set("distance")); drawSelection(gl, c, pv, reverse ? gl.GEQUAL : gl.LEQUAL); return; }
    uploadAtlas(gl, ctx);
    ctx.bindTexture(UNIT, atlasTex);                         // the binding only lasts for this pass: bind every frame
    var pl = LM.placement, b = st.bounds;
    if (!b) b = { min: S.min, max: [S.min[0] + S.size[0], S.min[1] + S.size[1], S.min[2] + S.size[2]] };
    var dist = set("distance"), d2 = dist * dist, ox = pl.x + b.min[0], oy = pl.y + b.min[1], oz = pl.z + b.min[2];
    var alpha = set("opacity") / 100, lm = set("layerMode"), ly = set("layer");
    var yMin = -1e9, yMax = 1e9;
    if (lm === "single") { yMin = oy + ly; yMax = oy + ly + 1; }
    else if (lm === "below") { yMax = oy + ly + 1; }
    else if (lm === "above") { yMin = oy + ly; }

    var vis = [], i, s;
    for (i = 0; i < st.list.length; i++) {
      s = st.list[i];
      var sx = ox + s.cx * 16 - c.x, sy = oy + s.cy * 16 - c.y, sz = oz + s.cz * 16 - c.z;
      var cx = sx + 8, cy = sy + 8, cz = sz + 8;
      if (cx * cx + cy * cy + cz * cz > d2 + 900) continue;
      if (!visible(planesCam, sx, sy, sz, 16)) continue;
      if (!s.gl) { s.gl = sectionVao(gl, s); s.verts = null; }                 // the copy on the GPU is the only one we keep
      vis.push({ s: s, x: sx, y: sy, z: sz, baseY: oy + s.cy * 16 });
    }
    statsLast.drawn = vis.length; statsLast.culled = st.list.length - vis.length;
    var depthFunc = reverse ? gl.GEQUAL : gl.LEQUAL;
    if (vis.length) {
      gl.useProgram(prog);
      gl.uniformMatrix4fv(loc.uPV, false, pv);
      gl.uniform1i(loc.uTex, UNIT);
      gl.uniform1f(loc.uAlpha, alpha);
      gl.uniform2f(loc.uLayer, yMin, yMax);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(reverse ? 1 : -1, reverse ? 1 : -1);        // pull the ghost a hair towards the camera: where it sits exactly on a real block face it must not fight with it
      gl.disable(gl.BLEND);
      var through = set("throughWalls"), quads = 0;
      // pass 1: depth only, so overlapping faces of the schematic itself do not blend through each other
      gl.colorMask(false, false, false, false); gl.depthMask(true); gl.depthFunc(through ? gl.ALWAYS : depthFunc);
      for (i = 0; i < vis.length; i++) { drawSection(gl, vis[i]); quads += vis[i].s.quads; }
      // pass 2: colour, only where this surface is the one in the depth buffer
      gl.colorMask(true, true, true, true); gl.depthMask(false); gl.depthFunc(through ? (reverse ? gl.GEQUAL : gl.LEQUAL) : depthFunc);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (i = 0; i < vis.length; i++) drawSection(gl, vis[i]);
      statsLast.quads = quads;
    }
    if (set("outline")) drawOutline(gl, c, pv, b, pl, depthFunc);
    drawVerify(gl, c, pv, planesCam, depthFunc, dist);
    drawSelection(gl, c, pv, depthFunc);
  }

  /* the verifier's boxes: what is missing / wrong, as coloured wireframes (one line buffer per world section, built when first seen) */
  function drawVerify(gl, c, pv, planesCam, depthFunc, dist) {
    while (Verify.free.length) freeGl(gl, Verify.free.pop());
    if (!Verify.active()) return;
    var mask = Verify.mask(), d2 = dist * dist, any = false;
    Verify.sections.forEach(function (res) {
      if (!res.kind.length) return;
      var sx = res.cx * 16 - c.x, sy = res.sy * 16 - c.y, sz = res.cz * 16 - c.z, cx = sx + 8, cy = sy + 8, cz = sz + 8;
      if (cx * cx + cy * cy + cz * cz > d2 + 900 || !visible(planesCam, sx, sy, sz, 16)) return;
      if (!any) {
        any = true;
        gl.useProgram(vprog); gl.uniformMatrix4fv(vloc.uPV, false, pv);
        gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.depthFunc(LM.set("throughWalls") ? gl.ALWAYS : depthFunc); gl.colorMask(true, true, true, true);
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      if (res.glMask !== mask) {
        if (res.gl) { freeGl(gl, res.gl); res.gl = null; }
        var L = Verify.lines(res);
        if (L.count) {
          var vao = gl.createVertexArray(), vbo = gl.createBuffer();
          gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(L.data), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 16, 12);
          res.gl = { vao: vao, vbo: vbo, count: L.count };
        }
        res.glMask = mask;
      }
      if (!res.gl) return;
      gl.uniform3f(vloc.uOff, sx, sy, sz);
      gl.bindVertexArray(res.gl.vao);
      gl.drawArrays(gl.LINES, 0, res.gl.count);
    });
  }
  function drawSection(gl, v) {
    gl.bindVertexArray(v.s.gl.vao);
    gl.uniform3f(loc.uOff, v.x, v.y, v.z);
    gl.uniform1f(loc.uBaseY, v.baseY);
    gl.drawElements(gl.TRIANGLES, v.s.quads * 6, gl.UNSIGNED_INT, 0);
  }

  /* a wireframe box in world coordinates */
  function lineBox(gl, c, pv, x0, y0, z0, x1, y1, z1, rgba, depthFunc) {
    var e = [x0, y0, z0, x1, y0, z0, x0, y1, z0, x1, y1, z0, x0, y0, z1, x1, y0, z1, x0, y1, z1, x1, y1, z1,
      x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x0, y0, z1, x0, y1, z1, x1, y0, z1, x1, y1, z1,
      x0, y0, z0, x0, y0, z1, x1, y0, z0, x1, y0, z1, x0, y1, z0, x0, y1, z1, x1, y1, z0, x1, y1, z1];
    var f = new Float32Array(72);
    for (var i = 0; i < 24; i++) { f[i * 3] = e[i * 3] - c.x; f[i * 3 + 1] = e[i * 3 + 1] - c.y; f[i * 3 + 2] = e[i * 3 + 2] - c.z; }
    gl.useProgram(lprog);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.uniformMatrix4fv(lloc.uPV, false, pv);
    gl.uniform3f(lloc.uOff, 0, 0, 0);
    gl.bindVertexArray(lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.depthFunc(depthFunc); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    gl.uniform4f(lloc.uCol, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.drawArrays(gl.LINES, 0, 24);
  }
  /* the enclosing box of the schematic */
  function drawOutline(gl, c, pv, b, pl, depthFunc) {
    lineBox(gl, c, pv, pl.x + b.min[0], pl.y + b.min[1], pl.z + b.min[2], pl.x + b.max[0], pl.y + b.max[1], pl.z + b.max[2], [0.55, 0.82, 1, 0.9], depthFunc);
  }
  /* the selection (the corner blocks are included: the box spans max + 1) */
  function drawSelection(gl, c, pv, depthFunc) {
    var bx = Sel.box();
    if (!bx) { var p = Sel.a || Sel.b; if (p) lineBox(gl, c, pv, p[0] - 0.003, p[1] - 0.003, p[2] - 0.003, p[0] + 1.003, p[1] + 1.003, p[2] + 1.003, [0.45, 1, 0.55, 0.95], depthFunc); return; }
    lineBox(gl, c, pv, bx.min[0] - 0.003, bx.min[1] - 0.003, bx.min[2] - 0.003, bx.max[0] + 1.003, bx.max[1] + 1.003, bx.max[2] + 1.003, [0.45, 1, 0.55, 0.95], depthFunc);
  }

  function release() {                                        // the mod was switched off: give every GPU object back
    if (!gl0) return;
    var gl = gl0;
    try {
      Mesher.state.pendingFree.splice(0).forEach(function (r) { freeGl(gl, r); });
      Mesher.state.list.forEach(function (s) { if (s.gl) freeGl(gl, s.gl); s.gl = null; });
      Verify.free.splice(0).forEach(function (r) { freeGl(gl, r); });
      Verify.sections.forEach(function (s) { if (s.gl) freeGl(gl, s.gl); s.gl = null; s.glMask = -1; });
      [prog, lprog, vprog].forEach(function (p) { if (p) gl.deleteProgram(p); });
      if (ibo) gl.deleteBuffer(ibo);
      if (atlasTex) gl.deleteTexture(atlasTex);
      if (lineVao) gl.deleteVertexArray(lineVao);
      if (lineBuf) gl.deleteBuffer(lineBuf);
    } catch (e) { /* the context may be gone already */ }
    gl0 = prog = lprog = vprog = ibo = atlasTex = lineVao = lineBuf = null; atlasVersion = -1; ibQuads = 0;
  }

  return { draw: draw, stats: statsLast, release: release };
})();
