/* Schematic file formats -> one in-memory shape:
 *   { kind, name, author, description, dataVersion, bytes, regions: [ { name, min:[x,y,z], dim:[sx,sy,sz], palette:[{ name, props }], data } ],
 *     min:[x,y,z], size:[w,h,l], blocks, materials: [[blockName, count], ...] }
 * data is a Uint16Array (Uint32Array for huge palettes) indexed (y * sz + z) * sx + x, entries index the region's palette.
 * Litematica regions may have negative sizes; min is the lowest corner either way. */
var Formats = (function () {
  var AIR = { "minecraft:air": 1, "minecraft:cave_air": 1, "minecraft:void_air": 1, "minecraft:structure_void": 1 };

  function parseState(s) {                                   // "minecraft:oak_stairs[facing=east,half=bottom]"
    var i = s.indexOf("["), name = i < 0 ? s : s.slice(0, i), props = {};
    if (i >= 0) s.slice(i + 1, s.lastIndexOf("]")).split(",").forEach(function (kv) { var e = kv.indexOf("="); if (e > 0) props[kv.slice(0, e).trim()] = kv.slice(e + 1).trim(); });
    if (name.indexOf(":") < 0) name = "minecraft:" + name;
    return { name: name, props: props };
  }
  function stateKey(st) {
    var k = Object.keys(st.props).sort();
    return st.name + (k.length ? "[" + k.map(function (x) { return x + "=" + st.props[x]; }).join(",") + "]" : "");
  }
  function fromTag(t) { return { name: t.Name.indexOf(":") < 0 ? "minecraft:" + t.Name : t.Name, props: t.Properties || {} }; }

  /* ---- Litematica .litematic ---- */
  function litematic(root) {
    var meta = root.Metadata || {}, regionsTag = root.Regions || {}, regions = [];
    Object.keys(regionsTag).forEach(function (rn) {
      var r = regionsTag[rn], pos = r.Position || { x: 0, y: 0, z: 0 }, size = r.Size || { x: 0, y: 0, z: 0 };
      var dim = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)], vol = dim[0] * dim[1] * dim[2];
      if (!vol) return;
      var pal = (r.BlockStatePalette || []).map(fromTag);
      var bits = Math.max(2, 32 - Math.clz32(Math.max(1, pal.length - 1)));
      if (!r.BlockStates || !r.BlockStates.bits) throw new Error("region " + rn + " has no block data");
      regions.push({
        name: rn,
        min: [pos.x + (size.x < 0 ? size.x + 1 : 0), pos.y + (size.y < 0 ? size.y + 1 : 0), pos.z + (size.z < 0 ? size.z + 1 : 0)],
        dim: dim, palette: pal, data: NBT.unpackBits(r.BlockStates, bits, vol, pal.length > 65535)
      });
    });
    return { kind: "litematic", name: meta.Name || "", author: meta.Author || "", description: meta.Description || "", dataVersion: root.MinecraftDataVersion || 0, regions: regions };
  }

  /* ---- Sponge .schem (v1, v2, v3) ---- */
  function sponge(root) {
    var s = root.Schematic || root, blocks = s.Blocks, palObj = blocks ? blocks.Palette : s.Palette, bytes = blocks ? blocks.Data : s.BlockData;
    var W = s.Width, H = s.Height, L = s.Length;
    if (!palObj || !bytes || !(W > 0 && H > 0 && L > 0)) throw new Error("this .schem file has no block data");
    var pal = [], max = 0;
    Object.keys(palObj).forEach(function (k) { pal[palObj[k]] = parseState(k); max = Math.max(max, palObj[k]); });
    for (var q = 0; q <= max; q++) if (!pal[q]) pal[q] = { name: "minecraft:air", props: {} };
    var n = W * H * L, data = pal.length > 65535 ? new Uint32Array(n) : new Uint16Array(n), p = 0;
    for (var i = 0; i < n; i++) {
      var v = 0, sh = 0, b;
      do { b = bytes[p++] & 255; v += (b & 127) * Math.pow(2, sh); sh += 7; } while ((b & 128) && p < bytes.length + 8);
      data[i] = v;
    }
    var off = s.Offset || (s.Metadata && [s.Metadata.WEOffsetX | 0, s.Metadata.WEOffsetY | 0, s.Metadata.WEOffsetZ | 0]) || [0, 0, 0];
    var meta = s.Metadata || {};
    return { kind: "sponge", name: meta.Name || "", author: meta.Author || "", description: "", dataVersion: s.DataVersion || 0, regions: [{ name: "main", min: [off[0] | 0, off[1] | 0, off[2] | 0], dim: [W, H, L], palette: pal, data: data }] };
  }

  /* ---- vanilla structure file (.nbt) ---- */
  function structure(root) {
    var size = root.size, list = root.palette || (root.palettes && root.palettes[0]) || [], blocks = root.blocks || [];
    if (!size || size.length < 3) throw new Error("this .nbt file is not a structure");
    var pal = list.map(fromTag), air = pal.length;
    pal.push({ name: "minecraft:air", props: {} });
    var W = size[0], H = size[1], L = size[2], data = new Uint16Array(W * H * L).fill(air);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i], p = b.pos;
      if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= W || p[1] >= H || p[2] >= L) continue;
      data[(p[1] * L + p[2]) * W + p[0]] = b.state;
    }
    return { kind: "structure", name: "", author: root.author || "", description: "", dataVersion: root.DataVersion || 0, regions: [{ name: "structure", min: [0, 0, 0], dim: [W, H, L], palette: pal, data: data }] };
  }

  /* ---- legacy MCEdit .schematic: numeric block ids (see 25-legacy.js for the table) ---- */
  function legacy(root) {
    var W = root.Width, H = root.Height, L = root.Length, ids = root.Blocks, dv = root.Data, add = root.AddBlocks;
    if (!(W > 0 && H > 0 && L > 0) || !ids) throw new Error("this .schematic file has no block data");
    var n = W * H * L, pal = [], seen = {}, data = new Uint16Array(n);
    for (var i = 0; i < n; i++) {
      var id = ids[i] & 255;
      if (add) id |= ((i & 1) ? (add[i >> 1] >> 4) & 15 : add[i >> 1] & 15) << 8;
      var meta = dv ? dv[i] & 15 : 0, key = id * 16 + meta, idx = seen[key];
      if (idx === undefined) { idx = seen[key] = pal.length; pal.push(Legacy.state(id, meta)); }
      data[i] = idx;
    }
    var off = [root.WEOffsetX | 0, root.WEOffsetY | 0, root.WEOffsetZ | 0];
    return { kind: "legacy", name: "", author: "", description: "", dataVersion: 0, regions: [{ name: "main", min: off, dim: [W, H, L], palette: pal, data: data }] };
  }

  /* the block counts of the regions that are not in `hidden` (a set of region names): { list: [[blockName, count], ...] most first, total } */
  function materialsOf(sch, hidden) {
    var mats = {}, total = 0;
    sch.regions.forEach(function (r) {
      if (hidden && hidden[r.name]) return;
      Object.keys(r.mats).forEach(function (k) { mats[k] = (mats[k] || 0) + r.mats[k]; total += r.mats[k]; });
    });
    return { total: total, list: Object.keys(mats).map(function (k) { return [k, mats[k]]; }).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }) };
  }

  /* blocks the game renamed after the file was made: used only when this game version has no blockstate for the old name but has one for the new */
  var RENAMES = { "minecraft:grass": "minecraft:short_grass", "minecraft:grass_path": "minecraft:dirt_path", "minecraft:sign": "minecraft:oak_sign",
    "minecraft:wall_sign": "minecraft:oak_wall_sign", "minecraft:chain": "minecraft:iron_chain", "minecraft:magma": "minecraft:magma_block" };
  function upgrade(sch) {
    sch.regions.forEach(function (r) {
      r.palette.forEach(function (st) {
        var to = RENAMES[st.name];
        if (to) { if (!Assets.hasBlockstate(st.name) && Assets.hasBlockstate(to)) st.name = to; return; }
        if (st.name === "minecraft:cauldron" && st.props.level !== undefined && Assets.hasBlockstate("minecraft:water_cauldron")) {      // before 1.17 the water level was a property of the cauldron
          var lvl = parseInt(st.props.level, 10) || 0;
          st.props = lvl > 0 ? { level: String(Math.min(3, lvl)) } : {};
          if (lvl > 0) st.name = "minecraft:water_cauldron";
        }
      });
    });
  }

  function finish(sch, fileName, bytes) {
    upgrade(sch);
    var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    sch.regions.forEach(function (r) {
      for (var a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], r.min[a]); hi[a] = Math.max(hi[a], r.min[a] + r.dim[a]); }
      var counts = new Float64Array(r.palette.length), d = r.data, i;
      for (i = 0; i < d.length; i++) counts[d[i]]++;
      r.mats = {}; r.blocks = 0;
      r.palette.forEach(function (st, k) {
        if (!counts[k] || AIR[st.name]) return;
        r.mats[st.name] = (r.mats[st.name] || 0) + counts[k]; r.blocks += counts[k];
      });
    });
    if (!sch.regions.length) throw new Error("the file contains no blocks");
    sch.min = lo; sch.size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    var all = materialsOf(sch, null);
    sch.blocks = all.total; sch.materials = all.list;
    sch.bytes = bytes ? bytes.length : 0;
    if (!sch.name) sch.name = String(fileName || "schematic").replace(/\.[^.]+$/, "");
    return sch;
  }

  /* detect by content (litematic has Regions + Metadata, sponge has Palette/BlockData or Blocks.Palette, structure has size + palette + blocks) */
  function parseAny(root, fileName, bytes) {
    var sch;
    if (root.Regions) sch = litematic(root);
    else if (root.Schematic || root.BlockData || root.Palette) sch = sponge(root);
    else if (root.blocks && root.size) sch = structure(root);
    else if (root.Blocks && root.Width) sch = legacy(root);
    else throw new Error("unknown schematic format (no Regions, Palette, blocks or Blocks tag)");
    return finish(sch, fileName, bytes);
  }

  function load(fileName, bytes) {
    return NBT.read(bytes).then(function (root) { return parseAny(root, fileName, bytes); });
  }

  return { load: load, parseAny: parseAny, parseState: parseState, stateKey: stateKey, materialsOf: materialsOf, isAir: function (n) { return !!AIR[n]; }, AIR: AIR };
})();
