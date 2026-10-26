/* ==OneClientMod==
 * @id oc-outline
 * @name Block Outline
 * @version 1.0
 * @author OneClient
 * @description Changes the box the game draws around the block you look at: colour, opacity, thickness, or a colour that cycles.
 * @category World
 * @icon cube
 * @order 41
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define([
  { type: "section", label: "Block Outline" },
  { k: "color", type: "color", label: "Colour", def: "#ffffff", when: function (c) { return !c.chroma; } },
  { k: "chroma", type: "toggle", label: "Cycling colour", note: "The outline slowly goes through every colour", def: false },
  { k: "speed", type: "range", label: "Cycle speed", min: 1, max: 10, step: 1, unit: "", def: 3, when: function (c) { return !!c.chroma; } },
  { k: "opacity", type: "range", label: "Opacity", min: 10, max: 100, step: 5, unit: "%", def: 100 },
  { k: "thickness", type: "range", label: "Thickness", note: "Times the game's own line width", min: 1, max: 6, step: 0.5, unit: "x", def: 2 }
]);
if (api.schemaOnly) return;

var t0 = performance.now();
function apply() {
  var s = api.settings, rgb = s.get("chroma") ? kit.hue((performance.now() - t0) / 1000 * s.get("speed") * 0.06) : kit.rgb(s.get("color"));
  api.gl.fx.set("oc_outline", [rgb[0], rgb[1], rgb[2], s.get("opacity") / 100]);
  api.gl.fx.set("oc_outlineW", s.get("thickness"));
}
apply();
api.settings.onChange(apply);
api.events.on("frame", function () { if (api.settings.get("chroma")) apply(); });
