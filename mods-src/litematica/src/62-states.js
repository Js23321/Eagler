/* Block states in the game's own numbering (api.blocks), for comparing a schematic with the world:
 *  - expectedId(): the state the world should hold for a schematic block under the current placement (rotate / mirror turn facing, axis, rotation,
 *    side connections and rail shapes the way the game turns them);
 *  - canon(): a state with the properties that follow from the surroundings or from time reset, so "same enough" is one number comparison
 *    (stairs shape, fence connections, powered, lit, leaves distance, crop age ...). Strict mode keeps every property. */
var States = (function () {
  var DIRS = ["north", "east", "south", "west"];
  var strict = false, canonCache = null;

  function dirMap(d, rot, mx, mz) {
    if (mx) { if (d === "east") d = "west"; else if (d === "west") d = "east"; }
    if (mz) { if (d === "north") d = "south"; else if (d === "south") d = "north"; }
    var i = DIRS.indexOf(d);
    return i < 0 ? d : DIRS[(i + rot) & 3];
  }
  function railShape(v, rot, mx, mz) {
    var parts = v.split("_"), asc = parts[0] === "ascending", ds = asc ? [parts[1]] : parts;
    ds = ds.map(function (d) { return dirMap(d, rot, mx, mz); });
    if (asc) return "ascending_" + ds[0];
    var has = function (d) { return ds.indexOf(d) >= 0; };
    if (has("north") && has("south")) return "north_south";
    if (has("east") && has("west")) return "east_west";
    if (has("south") && has("east")) return "south_east";
    if (has("south") && has("west")) return "south_west";
    if (has("north") && has("west")) return "north_west";
    return "north_east";
  }

  /* props as the schematic has them -> props after the placement's mirror (x, then z) and clockwise rotation (rot * 90 degrees) */
  function transform(name, props, rot, mx, mz) {
    if (!rot && !mx && !mz) return props;
    var out = {}, flips = (mx ? 1 : 0) + (mz ? 1 : 0), keys = Object.keys(props), isRail = /rail$/.test(name);
    keys.forEach(function (k) {
      var v = props[k];
      if (k === "facing") out[k] = dirMap(v, rot, mx, mz);
      else if (k === "axis") out[k] = (rot & 1) && v !== "y" ? (v === "x" ? "z" : "x") : v;
      else if (k === "rotation") {                                           // 0..15, signs / banners / heads
        var r = parseInt(v, 10) || 0;
        if (mx) { var j = r > 8 ? r - 16 : r; r = (16 - j) % 16; }
        if (mz) { var j2 = r > 8 ? r - 16 : r; r = (8 - j2 + 16) % 16; }
        out[k] = String((r + 4 * rot) % 16);
      }
      else if (k === "north" || k === "east" || k === "south" || k === "west") out[dirMap(k, rot, mx, mz)] = v;
      else if (k === "shape" && isRail) out[k] = railShape(v, rot, mx, mz);
      else if (k === "hinge" && (flips & 1)) out[k] = v === "left" ? "right" : "left";
      else if (k === "type" && (flips & 1) && (v === "left" || v === "right")) out[k] = v === "left" ? "right" : "left";
      else out[k] = v;
    });
    return out;
  }

  /* the world state id a schematic state stands for under this placement; -1 when the game does not know the block, -3 for air */
  function expectedId(st, rot, mx, mz) {
    var B = api.blocks;
    if (Formats.isAir(st.name)) return -3;
    var id = B.idOfLoose(st.name, transform(st.name, st.props || {}, rot, mx, mz));
    return id < 0 ? -1 : id;
  }

  /* ---------- "same enough" ---------- */
  var IGNORE_ALL = { waterlogged: 1, powered: 1, power: 1, lit: 1, triggered: 1, locked: 1, distance: 1, persistent: 1, age: 1, stage: 1, moisture: 1, extended: 1, bottom: 1, enabled: 1 };
  var SIDES = { north: 1, east: 1, south: 1, west: 1, up: 1, down: 1 };
  function ignoredProps(name) {
    var n = String(name).replace(/^minecraft:/, ""), list = [];
    if (/_stairs$/.test(n)) list.push("shape");
    if (/(_fence$|^fence$|_wall$|_pane$|_bars$|^iron_bars$|^chorus_plant$|^redstone_wire$|^tripwire$)/.test(n)) Object.keys(SIDES).forEach(function (k) { list.push(k); });
    if (/_fence_gate$/.test(n)) list.push("in_wall");
    if (n === "redstone_wire") list.push("power");
    if (n === "water" || n === "lava") list.push("level");
    return list;
  }
  var ignoreCache = {};
  function ignoreSet(name) {
    var c = ignoreCache[name];
    if (c) return c;
    var set = {}; ignoredProps(name).forEach(function (k) { set[k] = 1; });
    var props = api.blocks.propsOf(name); props.forEach(function (p) { if (IGNORE_ALL[p[0]]) set[p[0]] = 1; });
    return ignoreCache[name] = set;
  }

  /* the state with every ignored property set to its first value (computed from the table: id = first id + sum(index * stride)) */
  function canon(id) {
    if (strict || id < 0) return id;
    var c = canonCache[id];
    if (c !== undefined && c !== -2) return c;
    var B = api.blocks, info = B.info(id);
    if (!info) return canonCache[id] = id;
    var range = B.rangeOf(info.name), props = B.propsOf(info.name), ig = ignoreSet(info.name), off = id - range.min, out = range.min;
    for (var k = 0; k < props.length; k++) {
      var n = props[k][1].length, idx = Math.floor(off / range.strides[k]) % n;
      out += (ig[props[k][0]] ? 0 : idx) * range.strides[k];
    }
    return canonCache[id] = out;
  }
  function setStrict(v) { strict = !!v; canonCache = new Int32Array(40000).fill(-2); }
  setStrict(false);

  /* which block (range) a state id belongs to, for "wrong block" versus "wrong state" */
  function blockOf(id) { var i = api.blocks.info(id); return i ? i.block : -1; }

  return { transform: transform, expectedId: expectedId, canon: canon, setStrict: setStrict, blockOf: blockOf, get strict() { return strict; } };
})();
