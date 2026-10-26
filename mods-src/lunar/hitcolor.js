/* ==OneClientMod==
 * @id oc-hitcolor
 * @name Hit Color
 * @version 1.0
 * @author OneClient
 * @description Changes the red flash on a mob or player when it gets hurt.
 * @category Visual
 * @icon drop
 * @order 54
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define([
  { type: "section", label: "Hit Color" },
  { k: "color", type: "color", label: "Flash colour", def: "#ff3df0" },
  { k: "strength", type: "range", label: "Strength", note: "The game's own flash is red at 30%", min: 10, max: 100, step: 5, unit: "%", def: 45 },
  { k: "rainbow", type: "toggle", label: "Cycling colour", note: "Every hit flashes a different colour", def: false }
]);
if (api.schemaOnly) return;

var t0 = performance.now();
function apply() {
  var s = api.settings, rgb = s.get("rainbow") ? kit.hue((performance.now() - t0) / 1000 * 0.35) : kit.rgb(s.get("color"));
  api.gl.fx.set("oc_hit", [rgb[0], rgb[1], rgb[2], s.get("strength") / 100]);
}
apply();
api.settings.onChange(apply);
api.events.on("frame", function () { if (api.settings.get("rainbow")) apply(); });
