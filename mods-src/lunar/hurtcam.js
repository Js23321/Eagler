/* ==OneClientMod==
 * @id oc-hurtcam
 * @name Hurt Cam
 * @version 1.0
 * @author OneClient
 * @description Tones down (or switches off) the way the screen tilts and shakes when you take damage.
 * @category Visual
 * @icon heart
 * @order 58
 * @needs camera
 * ==/OneClientMod== */
api.settings.define([
  { type: "section", label: "Hurt Cam" },
  { k: "strength", type: "range", label: "Shake when hurt", note: "100 is the game's own tilt, 0 keeps the picture level", min: 0, max: 100, step: 5, unit: "%", def: 0 },
  { k: "always", type: "toggle", label: "Also level the picture while walking", note: "Takes the sideways wobble out of the walking camera too", def: false }
]);
if (api.schemaOnly) return;

var hurtAt = -1e9, prev = 0;
api.player.onEvent(function (type) { if (type === "hurt") hurtAt = performance.now(); });

/* the game puts its camera tilt into the 2 x 2 block of the projection matrix (f[1] and f[4] are the cross terms, zero for a level picture) */
api.gl.rewrite("projection", function (f) {
  var cross = Math.max(Math.abs(f[1]), Math.abs(f[4]));
  if (cross > 0.15 && prev < 0.02) hurtAt = performance.now();             // the tilt jumps from level to strong in one picture: a hit, even before its packet is seen
  prev = cross;
  var s = api.settings, k = s.get("strength") / 100, recent = performance.now() - hurtAt < 800;
  if (!recent && !s.get("always")) return false;
  if (!recent) k = 0;
  if (f[1] === 0 && f[4] === 0) return false;
  f[1] *= k; f[4] *= k;
  return true;
});
