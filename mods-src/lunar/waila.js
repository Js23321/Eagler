/* ==OneClientMod==
 * @id oc-waila
 * @name WAILA
 * @version 1.0
 * @author OneClient
 * @description What Am I Looking At: the name of the block or mob under your crosshair, with its position and details.
 * @category HUD
 * @icon eye
 * @order 27
 * @needs world
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "What it shows" },
  { k: "reach", type: "range", label: "How far it looks", note: "In blocks", min: 3, max: 12, step: 1, unit: "blocks", def: 6 },
  { k: "mobs", type: "toggle", label: "Mobs and players", note: "Also tell what you are looking at when it is a mob", def: true },
  { k: "coords", type: "toggle", label: "Show the position", def: true },
  { k: "props", type: "toggle", label: "Show block details", note: "Facing, age, powered ... the game's block state", def: false },
  { k: "id", type: "toggle", label: "Show the game's name", note: "minecraft:grass_block under the display name", def: false },
  { k: "hide", type: "toggle", label: "Hide when nothing is there", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tc", row: 1, rowStep: 44 });
var NOT_TARGET = { "minecraft:air": 1, "minecraft:cave_air": 1, "minecraft:void_air": 1, "minecraft:water": 1, "minecraft:lava": 1, "minecraft:light": 1, "minecraft:structure_void": 1, "minecraft:bubble_column": 1 };

/* walk the grid of blocks along the line of sight (every block treated as a full cube) */
function rayBlock(c, reach) {
  var ox = c.x, oy = c.y, oz = c.z, dx = c.fx, dy = c.fy, dz = c.fz;
  var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  var tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  var tx = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (ox - x) / -dx : Infinity;
  var ty = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (oy - y) / -dy : Infinity;
  var tz = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (oz - z) / -dz : Infinity, t = 0, first = true;
  for (var i = 0; i < 80 && t <= reach; i++) {
    var b = api.world.getBlock(x, y, z);
    if (b === null) return null;                                // the chunk is not loaded
    if (!first && b.name && !NOT_TARGET[b.name]) return { t: t, x: x, y: y, z: z, b: b };
    first = false;
    if (tx < ty && tx < tz) { t = tx; tx += tdx; x += sx; }
    else if (ty < tz) { t = ty; ty += tdy; y += sy; }
    else { t = tz; tz += tdz; z += sz; }
  }
  return null;
}
function rayBox(c, x0, y0, z0, x1, y1, z1) {                    // distance to an axis aligned box along the line of sight, or -1
  var tmin = 0, tmax = 1e9, o = [c.x, c.y, c.z], d = [c.fx, c.fy, c.fz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (var a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return -1; continue; }
    var t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
    if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function update() {
  var c = api.game.cam, s = api.settings;
  if (!c || !api.game.inWorld || !api.world.ready) { hud.visible(false); return; }
  var reach = s.get("reach"), hit = rayBlock(c, reach), best = hit ? hit.t : reach + 1, ent = null;
  if (s.get("mobs") && api.entities.ready) {
    api.entities.list().forEach(function (e) {
      if (!e.w) return;
      var t = rayBox(c, e.x - e.w / 2, e.y, e.z - e.w / 2, e.x + e.w / 2, e.y + e.h, e.z + e.w / 2);
      if (t >= 0 && t <= reach && t < best) { best = t; ent = e; }
    });
  }
  var lines = [];
  if (ent) {
    lines.push(["", fmt.name("entity", ent.name), "#ffe27a"]);
    if (s.get("id")) lines.push(["", "minecraft:" + ent.name]);
    if (s.get("coords")) lines.push(["", Math.floor(ent.x) + " " + Math.floor(ent.y) + " " + Math.floor(ent.z)]);
  } else if (hit) {
    lines.push(["", fmt.name("block", hit.b.name), "#9dffc8"]);
    if (s.get("id")) lines.push(["", hit.b.name]);
    if (s.get("coords")) lines.push(["", hit.x + " " + hit.y + " " + hit.z]);
    if (s.get("props")) { var ps = Object.keys(hit.b.props || {}).map(function (k) { return k + "=" + hit.b.props[k]; }); if (ps.length) lines.push(["", ps.join("  ")]); }
  }
  hud.visible(lines.length > 0 || !s.get("hide"));
  hud.set(lines.length ? lines : [["", "-"]]);
}
api.every(100, update);
update();
