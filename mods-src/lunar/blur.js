/* ==OneClientMod==
 * @id oc-blur
 * @name Motion Blur
 * @version 1.0
 * @author OneClient
 * @description Blends each picture with the one before it, so fast turns and movement leave a soft trail.
 * @category Visual
 * @icon blur
 * @order 53
 * @needs camera
 * ==/OneClientMod== */
api.settings.define([
  { type: "section", label: "Motion Blur" },
  { k: "strength", type: "range", label: "Strength", note: "How much of the last picture stays: a little is subtle, a lot is dreamy", min: 5, max: 90, step: 5, unit: "%", def: 50 },
  { type: "info", label: "The trail lasts the same time at any frame rate. It is only drawn on the world; the hotbar and menus stay sharp." }
]);
if (api.schemaOnly) return;

var last = performance.now();
function apply() {
  var now = performance.now(), dt = Math.max(0.001, Math.min(0.1, (now - last) / 1000)), s = api.settings.get("strength") / 100;
  last = now;
  api.gl.post.set("blur", { amount: Math.pow(s, dt * 60) });       // the same trail length whether the game runs at 30 or 144 frames per second
}
apply();
api.events.on("frame", apply);
