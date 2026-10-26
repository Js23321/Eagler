/* OneClient fx: small, always-on patches of the game's own shaders, driven by uniforms the mods set.
 *
 * The game compiles its (vanilla) shaders once at start-up, long before most mods are switched on, so the patches are applied to the
 * source as it is compiled and do nothing until a mod sets a value (every uniform defaults to "off"):
 *
 *   oc_outline  vec4  rgb + opacity   the block outline (the black selection box): colour and opacity      (rendertype_lines)
 *   oc_outlineW float                 the block outline width, a multiplier of the game's own            (rendertype_lines)
 *   oc_hitbox   vec4  rgb + opacity   the white entity hitbox boxes of the game's F3+B debug view          (rendertype_lines)
 *   oc_glint    vec4  rgb + on        the enchantment glint: tinted with this colour                     (glint)
 *   oc_hit      vec4  rgb + strength  the red flash of a mob or player that got hurt                     (entity)
 *
 * OC.glx.fx.set(name, value) changes a value (an array of numbers, or a number); OC.glx.fx.get(name) reads it.
 * ASCII-only source. Must load before the game compiles its shaders (build.js puts it right after sense.js). */
(function () {
  "use strict";

  var OC = window.OneClient;
  var GL2 = window.WebGL2RenderingContext;
  if (!OC || !GL2) return;
  var glx = OC.glx || (OC.glx = {});

  var DEFAULTS = { oc_outline: [0, 0, 0, 0], oc_outlineW: 1, oc_hitbox: [1, 1, 1, 0], oc_glint: [0.5, 0.2, 1, 0], oc_hit: [1, 0, 0, 0] };
  var values = {};
  Object.keys(DEFAULTS).forEach(function (k) { values[k] = DEFAULTS[k].slice ? DEFAULTS[k].slice() : DEFAULTS[k]; });
  glx.fx = {
    names: Object.keys(DEFAULTS),
    set: function (name, v) {
      if (!(name in DEFAULTS)) return false;
      values[name] = typeof v === "number" ? v : Array.prototype.slice.call(v);
      return true;
    },
    get: function (name) { return values[name]; },
    reset: function (name) { var d = DEFAULTS[name]; if (d !== undefined) values[name] = d.slice ? d.slice() : d; }
  };

  /* ---------- source patches ---------- */
  function insertBeforeMain(src, decl) { return src.replace(/\n(void main\s*\(\s*\))/, "\n" + decl + "\n$1"); }
  function swap(src, from, to) { return src.indexOf(from) >= 0 ? src.replace(from, to) : null; }

  var PATCHES = [
    {   // lines, vertex stage: thicker block outline
      test: function (s) { return s.indexOf("in float LineWidth;") >= 0 && s.indexOf("vec2 lineOffset = vec2(-lineScreenDirection.y, lineScreenDirection.x) * LineWidth / ScreenSize;") >= 0; },
      apply: function (s) {
        s = swap(s, "vec2 lineOffset = vec2(-lineScreenDirection.y, lineScreenDirection.x) * LineWidth / ScreenSize;",
          "float ocw = LineWidth;\n    if (oc_outline.a > 0.0 && Color.r + Color.g + Color.b < 0.02) ocw *= oc_outlineW;\n    vec2 lineOffset = vec2(-lineScreenDirection.y, lineScreenDirection.x) * ocw / ScreenSize;");
        return s && insertBeforeMain(s, "uniform vec4 oc_outline;\nuniform float oc_outlineW;");
      },
      uniforms: ["oc_outline", "oc_outlineW"]
    },
    {   // lines, fragment stage: outline colour, hitbox colour
      test: function (s) { return s.indexOf("vec4 color = vertexColor * ColorModulator;") >= 0 && s.indexOf("in vec4 vertexColor;") >= 0 && s.indexOf("sphericalVertexDistance") >= 0 && s.indexOf("texCoord0") < 0 && s.indexOf("Sampler0") < 0; },
      apply: function (s) {
        s = swap(s, "vec4 color = vertexColor * ColorModulator;",
          "vec4 color = vertexColor * ColorModulator;\n    if (oc_outline.a > 0.0 && vertexColor.r + vertexColor.g + vertexColor.b < 0.02) color = vec4(oc_outline.rgb, oc_outline.a * ColorModulator.a);\n    else if (oc_hitbox.a > 0.0 && vertexColor.r > 0.97 && vertexColor.g > 0.97 && vertexColor.b > 0.97) color = vec4(oc_hitbox.rgb, oc_hitbox.a * color.a);");
        return s && insertBeforeMain(s, "uniform vec4 oc_outline;\nuniform vec4 oc_hitbox;");
      },
      uniforms: ["oc_outline", "oc_hitbox"]
    },
    {   // enchantment glint: tint the grey-purple glint texture with a colour
      test: function (s) { return s.indexOf("GlintAlpha") >= 0 && s.indexOf("fragColor = vec4(color.rgb * fade, color.a);") >= 0; },
      apply: function (s) {
        s = swap(s, "fragColor = vec4(color.rgb * fade, color.a);",
          "vec3 ocg = color.rgb;\n    if (oc_glint.a > 0.5) ocg = oc_glint.rgb * dot(ocg, vec3(0.3, 0.59, 0.11)) * 2.2;\n    fragColor = vec4(ocg * fade, color.a);");
        return s && insertBeforeMain(s, "uniform vec4 oc_glint;");
      },
      uniforms: ["oc_glint"]
    },
    {   // the red flash of a hurt entity
      test: function (s) { return s.indexOf("float overlayAmount = mix(1.0, overlayColor.a, step(0.04, overlayChroma));") >= 0; },
      apply: function (s) {
        s = swap(s, "color.rgb = mix(overlayColor.rgb, color.rgb, overlayAmount);",
          "vec3 ocOv = overlayColor.rgb;\n    if (oc_hit.a > 0.0 && overlayChroma > 0.04) { ocOv = oc_hit.rgb; overlayAmount = 1.0 - oc_hit.a; }\n    color.rgb = mix(ocOv, color.rgb, overlayAmount);");
        return s && insertBeforeMain(s, "uniform vec4 oc_hit;");
      },
      uniforms: ["oc_hit"]
    }
  ];

  var shaderRecs = new WeakMap();                                  // shader -> the patches applied to it
  var origSrc = new WeakMap();                                     // shader -> its source before patching (a patch that does not compile is taken back)
  var programRecs = new WeakMap();                                 // program -> { names: [uniform names], locs: { name: location | null } }

  var P = GL2.prototype, shaderSource = P.shaderSource, attachShader = P.attachShader, useProgram = P.useProgram, compileShader = P.compileShader, linkProgram = P.linkProgram;
  P.shaderSource = function (shader, src) {
    if (typeof src === "string" && src.indexOf("#version 300 es") === 0) {
      var used = null, orig = src;
      for (var i = 0; i < PATCHES.length; i++) {
        var pt = PATCHES[i];
        try {
          if (!pt.test(src)) continue;
          var out = pt.apply(src);
          if (out) { src = out; (used || (used = [])).push(pt); }
        } catch (e) { try { console.warn("[OneClient fx] a shader patch failed: " + e.message); } catch (x) {} }
      }
      if (used) { shaderRecs.set(shader, used); origSrc.set(shader, orig); }
    }
    return shaderSource.call(this, shader, src);
  };
  function unpatch(gl, shader) {                                   // put the game's own source back and compile it again
    var o = origSrc.get(shader);
    shaderRecs.delete(shader); origSrc.delete(shader);
    if (o === undefined) return;
    shaderSource.call(gl, shader, o);
    compileShader.call(gl, shader);
  }
  P.compileShader = function (shader) {
    compileShader.call(this, shader);
    if (shaderRecs.has(shader) && !this.getShaderParameter(shader, 0x8B81)) {          // COMPILE_STATUS
      try { console.warn("[OneClient fx] a shader patch did not compile, using the game's own shader: " + this.getShaderInfoLog(shader)); } catch (e) {}
      unpatch(this, shader);
    }
  };
  P.linkProgram = function (program) {
    linkProgram.call(this, program);
    if (programRecs.has(program) && !this.getProgramParameter(program, 0x8B82)) {      // LINK_STATUS
      try { console.warn("[OneClient fx] a patched program did not link, using the game's own shaders: " + this.getProgramInfoLog(program)); } catch (e) {}
      var self = this, shaders = this.getAttachedShaders(program) || [];
      programRecs.delete(program);
      shaders.forEach(function (sh) { if (shaderRecs.has(sh)) unpatch(self, sh); });
      linkProgram.call(this, program);
    }
  };
  P.attachShader = function (program, shader) {
    var used = shaderRecs.get(shader);
    if (used) {
      var rec = programRecs.get(program) || { names: [], locs: {} };
      used.forEach(function (pt) { pt.uniforms.forEach(function (n) { if (rec.names.indexOf(n) < 0) rec.names.push(n); }); });
      programRecs.set(program, rec);
    }
    return attachShader.call(this, program, shader);
  };
  P.useProgram = function (program) {
    var r = useProgram.call(this, program);
    var rec = program && programRecs.get(program);
    if (rec) {
      for (var i = 0; i < rec.names.length; i++) {
        var n = rec.names[i], loc = rec.locs[n];
        if (loc === undefined) loc = rec.locs[n] = this.getUniformLocation(program, n);
        if (!loc) continue;
        var v = values[n];
        if (typeof v === "number") this.uniform1f(loc, v); else this.uniform4f(loc, v[0], v[1], v[2], v[3]);
      }
    }
    return r;
  };
})();
