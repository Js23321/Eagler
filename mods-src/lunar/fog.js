/* ==OneClientMod==
 * @id oc-fog
 * @name Fog Customizer
 * @version 1.0
 * @author OneClient
 * @description Thin the fog out, make it thicker, tint it, or switch the fog at the edge of your view off.
 * @category Visual
 * @icon fog
 * @order 51
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define([
  { type: "section", label: "Fog" },
  { k: "mode", type: "choice", label: "Distance fog", opts: [["custom", "Custom"], ["off", "No fog"]], def: "custom" },
  { k: "distance", type: "range", label: "Where the fog ends", note: "Percent of the game's own distance. Below 100 brings the fog closer, above 100 pushes it back", min: 20, max: 300, step: 5, unit: "%", def: 100, when: function (c) { return c.mode === "custom"; } },
  { k: "start", type: "range", label: "Where it starts", note: "Percent of the way to where it ends: low is a long soft fade, high is a short one", min: 0, max: 95, step: 5, unit: "%", def: 90, when: function (c) { return c.mode === "custom"; } },
  { type: "section", label: "Colour" },
  { k: "tint", type: "toggle", label: "Tint the fog", def: false },
  { k: "color", type: "color", label: "Fog colour", def: "#b8d8ff", when: function (c) { return !!c.tint; } },
  { k: "amount", type: "range", label: "How strongly", min: 10, max: 100, step: 5, unit: "%", def: 60, when: function (c) { return !!c.tint; } },
  { type: "info", label: "Fog under water and in lava, and from effects like blindness, is left to the game." }
]);
if (api.schemaOnly) return;

/* the fog block: colour (4), environmental start and end, render distance start and end, sky end, clouds end */
api.gl.rewrite("fog", function (f) {
  var s = api.settings, mode = s.get("mode"), changed = false;
  if (mode === "off") { f[6] = 1e5; f[7] = 1e5 + 1; changed = true; }
  else {
    var end = f[7] * s.get("distance") / 100;
    if (Math.abs(s.get("distance") - 100) > 0.5 || Math.abs(s.get("start") - 90) > 0.5) {
      f[7] = end; f[6] = end * s.get("start") / 100; changed = true;
    }
  }
  if (s.get("tint")) {
    var c = kit.rgb(s.get("color")), a = s.get("amount") / 100;
    f[0] += (c[0] - f[0]) * a; f[1] += (c[1] - f[1]) * a; f[2] += (c[2] - f[2]) * a; changed = true;
  }
  return changed;
});
