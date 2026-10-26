/* ==OneClientMod==
 * @id oc-chunks
 * @name Chunk Borders
 * @version 1.0
 * @author OneClient
 * @description Draws the borders of the chunks around you, like the game's F3+G view but with the colours, thickness and range you choose.
 * @category World
 * @icon chunks
 * @order 40
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit, shown = true;

api.keys.register({ id: "toggle", label: "Show / hide the borders", def: "", onDown: function () { if (live) { shown = !shown; api.ui.toast("Chunk borders " + (shown ? "shown" : "hidden")); } } });
var live = false;

api.settings.define([
  { type: "section", label: "Chunk Borders" },
  { k: "radius", type: "range", label: "Chunks around you", note: "0 is only the chunk you stand in", min: 0, max: 4, step: 1, unit: "", def: 1 },
  { k: "span", type: "range", label: "Height shown", note: "Blocks above and below you", min: 8, max: 128, step: 8, unit: "blocks", def: 48, when: function (c) { return !c.full; } },
  { k: "full", type: "toggle", label: "Whole world height", note: "From the bottom of the world to the top", def: false },
  { k: "sections", type: "toggle", label: "Marks every 16 blocks of height", note: "Rings around your chunk where its sections meet", def: true },
  { type: "section", label: "Look" },
  { k: "color", type: "color", label: "Your chunk", def: "#ffd23f" },
  { k: "color2", type: "color", label: "Neighbouring chunks", def: "#6bb7ff" },
  { k: "thickness", type: "range", label: "Thickness", min: 1, max: 6, step: 1, unit: "px", def: 2 },
  { k: "opacity", type: "range", label: "Opacity", min: 20, max: 100, step: 5, unit: "%", def: 90 },
  { k: "through", type: "toggle", label: "Show through walls", note: "Off: blocks hide the lines like they hide everything else", def: false }
]);
if (api.schemaOnly) return;
live = true;

var batch = api.gl.batch();

api.gl.onWorld(function (ctx) {
  if (!shown) return;
  var s = api.settings, c = ctx.cam, R = s.get("radius"), cx = Math.floor(c.x / 16), cz = Math.floor(c.z / 16);
  var minY = api.world.ready ? api.world.minY : -64, maxY = minY + (api.world.ready ? api.world.height : 384);
  var full = s.get("full"), span = s.get("span");
  var lo = full ? minY : Math.max(minY, Math.floor(c.y - span)), hi = full ? maxY : Math.min(maxY, Math.ceil(c.y + span));
  if (hi <= lo) return;
  var w = s.get("thickness"), a = s.get("opacity") / 100, k1 = kit.rgb(s.get("color")).concat(a), k2 = kit.rgb(s.get("color2")).concat(a * 0.8);
  batch.begin(ctx);
  var dx, dz, x, z, own;
  for (dz = -R; dz <= R + 1; dz++) for (dx = -R; dx <= R + 1; dx++) {
    x = (cx + dx) * 16; z = (cz + dz) * 16;
    own = dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1;                          // a corner of the chunk you stand in
    batch.line(x, lo, z, x, hi, z, own ? k1 : k2, own ? w + 1 : w);
  }
  if (s.get("sections")) {
    var x0 = cx * 16, z0 = cz * 16, x1 = x0 + 16, z1 = z0 + 16, ring = k1.slice(0, 3).concat(a * 0.75);
    for (var y = Math.ceil(lo / 16) * 16; y <= hi; y += 16) {
      batch.line(x0, y, z0, x1, y, z0, ring, w); batch.line(x1, y, z0, x1, y, z1, ring, w);
      batch.line(x1, y, z1, x0, y, z1, ring, w); batch.line(x0, y, z1, x0, y, z0, ring, w);
    }
  }
  batch.draw(ctx, { through: s.get("through") });
});
