/* ==OneClientMod==
 * @id ghost-box
 * @name Ghost Box
 * @version 1.0
 * @author OneClient
 * @description Example of drawing into the game's world: a see-through box and grid, depth-tested against the terrain.
 * ==/OneClientMod== */

// api.gl.onWorld(fn) runs in the game's own frame, right before it clears the depth buffer for the hand and the HUD, with the
// game's camera in ctx.cam. Geometry is positioned like the game does it: (world position - camera) * view * projection, and
// the game uses REVERSE-Z, so depth testing must use GEQUAL.

api.settings.define([
  { key: "color", type: "color", label: "Box colour", default: "#ff4fd8" },
  { key: "alpha", type: "range", label: "Opacity", min: 5, max: 100, step: 5, unit: "%", default: 40 },
  { key: "grid", type: "toggle", label: "Show floor grid", default: true },
  { key: "place", type: "button", label: "Put the box in front of me", text: "Place", onClick: placeHere }
]);

var anchor = api.storage.get("anchor", [0, 64, 0]);
function placeHere() {
  var c = api.game.cam;
  if (!c) { api.ui.toast("Join a world first", true); return; }
  anchor = [Math.floor(c.x + c.fx * 3), Math.floor(c.y - 1.62 + 1), Math.floor(c.z + c.fz * 3)];
  api.storage.set("anchor", anchor);
}

var gl0 = null, prog, vao, buf, locs, nBox = 0, nGrid = 0;
function build(gl) {
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, "#version 300 es\nin vec3 aPos; uniform mat4 uPV; uniform vec3 uOff; void main(){ gl_Position = uPV * vec4(aPos + uOff, 1.0); }"));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, "#version 300 es\nprecision mediump float; uniform vec4 uCol; out vec4 o; void main(){ o = uCol; }"));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  locs = { pv: gl.getUniformLocation(prog, "uPV"), off: gl.getUniformLocation(prog, "uOff"), col: gl.getUniformLocation(prog, "uCol") };
  var v = [], i;
  var q = [[0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1], [1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0], [0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0]];
  q.forEach(function (f) { [0, 1, 2, 0, 2, 3].forEach(function (k) { v.push(f[k * 3], f[k * 3 + 1], f[k * 3 + 2]); }); });
  nBox = v.length / 3;
  for (i = -8; i <= 8; i++) { v.push(i, 0.02, -8, i, 0.02, 8, -8, 0.02, i, 8, 0.02, i); }
  nGrid = v.length / 3 - nBox;
  vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  var a = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 12, 0);
  gl0 = gl;
}
function rgb(hex) { var n = parseInt(String(hex).slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

api.gl.onWorld(function (ctx) {
  var gl = ctx.gl, c = ctx.cam;
  if (gl0 !== gl) build(gl);
  gl.useProgram(prog); gl.bindVertexArray(vao);
  gl.uniformMatrix4fv(locs.pv, false, api.gl.mat4.mul(c.proj, c.view));
  gl.uniform3f(locs.off, anchor[0] - c.x, anchor[1] - c.y, anchor[2] - c.z);      // doubles minus doubles first, then to float: no jitter far from the origin
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(c.reverseZ ? gl.GEQUAL : gl.LEQUAL); gl.depthMask(false);
  gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  var col = rgb(api.settings.get("color"));
  gl.uniform4f(locs.col, col[0], col[1], col[2], api.settings.get("alpha") / 100);
  gl.drawArrays(gl.TRIANGLES, 0, nBox);
  if (api.settings.get("grid")) { gl.uniform4f(locs.col, 1, 1, 1, 0.5); gl.drawArrays(gl.LINES, nBox, nGrid); }
});
