/* ==OneClientMod==
 * @id oc-fov
 * @name FOV Changer
 * @version 1.0
 * @author OneClient
 * @description Set the field of view to any value from 30 to 150 degrees, further than the game's own slider goes.
 * @category Visual
 * @icon fov
 * @order 50
 * @needs camera
 * ==/OneClientMod== */
api.settings.define([
  { type: "section", label: "Field of view" },
  { k: "fov", type: "range", label: "Field of view", note: "Degrees from the bottom of the screen to the top. The game's own slider ends at 110", min: 30, max: 150, step: 1, unit: "deg", def: 90 },
  { k: "dynamic", type: "toggle", label: "Keep sprint and potion zoom", note: "On: the widening when you sprint or drink a speed potion stays, on top of your number (70 counts as the game's normal view). Off: the view never changes by itself", def: false }
]);
if (api.schemaOnly) return;

var BASE = Math.tan(70 * Math.PI / 360);                          // the game's default 70 degrees
api.gl.rewrite("projection", function (f) {
  var s = api.settings, v = s.get("fov") * Math.PI / 180, half = Math.tan(v / 2), k;
  if (s.get("dynamic")) k = BASE / half;                          // relative: the game's own changes keep working
  else { var cur = Math.hypot(f[4], f[5]); if (!(cur > 0)) return false; k = (1 / half) / cur; }
  if (Math.abs(k - 1) < 1e-4) return false;
  f[0] *= k; f[1] *= k; f[4] *= k; f[5] *= k;                     // the x and y scale (and the tiny roll the game puts in there)
  return true;
});
