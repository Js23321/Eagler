/* ==OneClientMod==
 * @id oc-glint
 * @name Glint Colorizer
 * @version 1.0
 * @author OneClient
 * @description Gives the shimmer on enchanted items and armor a colour of your choice, or a colour that cycles.
 * @category Visual
 * @icon sparkle
 * @order 55
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define([
  { type: "section", label: "Glint" },
  { k: "color", type: "color", label: "Glint colour", def: "#4dffb8", when: function (c) { return !c.rainbow; } },
  { k: "rainbow", type: "toggle", label: "Cycling colour", note: "The shimmer slowly goes through every colour", def: false }
]);
if (api.schemaOnly) return;

var t0 = performance.now();
function apply() {
  var s = api.settings, rgb = s.get("rainbow") ? kit.hue((performance.now() - t0) / 1000 * 0.12) : kit.rgb(s.get("color"));
  api.gl.fx.set("oc_glint", [rgb[0], rgb[1], rgb[2], 1]);
}
apply();
api.settings.onChange(apply);
api.events.on("frame", function () { if (api.settings.get("rainbow")) apply(); });
