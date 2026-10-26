/* ==OneClientMod==
 * @id oc-color
 * @name Color Saturation
 * @version 1.0
 * @author OneClient
 * @description Make colours richer or washed out, or adjust the brightness and contrast of the world.
 * @category Visual
 * @icon palette
 * @order 52
 * @needs camera
 * ==/OneClientMod== */
api.settings.define([
  { type: "section", label: "Colour" },
  { k: "saturation", type: "range", label: "Saturation", note: "0 is black and white, 100 is the game's own colours, 200 is very vivid", min: 0, max: 200, step: 5, unit: "%", def: 130 },
  { k: "brightness", type: "range", label: "Brightness", min: 50, max: 150, step: 5, unit: "%", def: 100 },
  { k: "contrast", type: "range", label: "Contrast", min: 50, max: 150, step: 5, unit: "%", def: 100 },
  { type: "info", label: "This changes the world picture only; the hotbar, menus and your hand are drawn afterwards and stay as they are." }
]);
if (api.schemaOnly) return;

function apply() {
  var s = api.settings;
  api.gl.post.set("color", { saturation: s.get("saturation") / 100, brightness: s.get("brightness") / 100, contrast: s.get("contrast") / 100 });
}
apply();
api.settings.onChange(apply);
