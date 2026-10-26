/* Selections and what can be done with the world around them: two corner positions (set to your feet or to the block you look at), a saved copy of
 * the selected blocks as a .litematic (read from the world the game has loaded), and pasting the loaded schematic into a singleplayer world with
 * commands. */
var Sel = (function () {
  var a = null, b = null;                                            // block positions [x, y, z]
  var MAX_CELLS = 16000000;

  function box() {
    if (!a || !b) return null;
    var min = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    return { min: min, max: max, size: [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1] };
  }
  function set(i, p) { if (i === 1) a = p ? [p[0], p[1], p[2]] : null; else b = p ? [p[0], p[1], p[2]] : null; api.storage.set("sel", { a: a, b: b }); LM.changed(); }
  function clear() { a = b = null; api.storage.remove("sel"); LM.changed(); }
  function restore() { var s = api.storage.get("sel", null); if (s) { a = s.a || null; b = s.b || null; } }
  restore();

  /* the block the camera looks at: a voxel walk along the view direction through the loaded world (air and water are looked through) */
  function aim(reach) {
    var c = api.game.cam;
    if (!c || !api.world.ready) return null;
    var dx = c.fx, dy = c.fy, dz = c.fz, ox = c.x, oy = c.y, oz = c.z;
    var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    var sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    var tx = dx !== 0 ? ((dx > 0 ? x + 1 - ox : ox - x) / Math.abs(dx)) : Infinity, ty = dy !== 0 ? ((dy > 0 ? y + 1 - oy : oy - y) / Math.abs(dy)) : Infinity, tz = dz !== 0 ? ((dz > 0 ? z + 1 - oz : oz - z) / Math.abs(dz)) : Infinity;
    var ddx = dx !== 0 ? 1 / Math.abs(dx) : Infinity, ddy = dy !== 0 ? 1 / Math.abs(dy) : Infinity, ddz = dz !== 0 ? 1 / Math.abs(dz) : Infinity, t = 0;
    for (var i = 0; i < 400 && t <= (reach || 64); i++) {
      var id = api.world.getState(x, y, z);
      if (id < 0) return null;                                       // the chunk is not loaded
      if (!api.blocks.isAir(id)) { var nm = api.blocks.nameOf(id); if (nm !== "minecraft:water" && nm !== "minecraft:lava") return [x, y, z]; }
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += ddx; } else if (ty < tz) { y += sy; t = ty; ty += ddy; } else { z += sz; t = tz; tz += ddz; }
    }
    return null;
  }
  function feet() { var c = api.game.cam; return c ? [Math.floor(c.x), Math.floor(c.y - 1.62 + 0.05), Math.floor(c.z)] : null; }

  /* ---------- the selected blocks as a .litematic ---------- */
  function missingChunks(bx) {
    var out = [];
    for (var cz = bx.min[2] >> 4; cz <= (bx.max[2] >> 4); cz++) for (var cx = bx.min[0] >> 4; cx <= (bx.max[0] >> 4); cx++) if (!api.world.isLoaded(cx, cz)) out.push([cx, cz]);
    return out;
  }
  function exportBytes(name, author) {
    var bx = box();
    if (!bx) return Promise.reject(new Error("Set both corners first."));
    if (!api.world.ready) return Promise.reject(new Error("Join a world first."));
    var vol = bx.size[0] * bx.size[1] * bx.size[2];
    if (vol > MAX_CELLS) return Promise.reject(new Error("The selection is too big (" + LM.fmt(vol) + " blocks, the limit is " + LM.fmt(MAX_CELLS) + ")."));
    var miss = missingChunks(bx);
    if (miss.length) return Promise.reject(new Error(miss.length + " chunk" + (miss.length > 1 ? "s" : "") + " of the selection are not loaded. Move closer so the game loads them."));
    var sx = bx.size[0], sy = bx.size[1], sz = bx.size[2], data = new Uint16Array(vol), pal = [{ name: "minecraft:air", props: {} }], map = new Int32Array(40000).fill(-1), scratch = new Uint16Array(4096), total = 0;
    var minY = bx.min[1];
    for (var sec = minY >> 4; sec <= (bx.max[1] >> 4); sec++) for (var cz = bx.min[2] >> 4; cz <= (bx.max[2] >> 4); cz++) for (var cx = bx.min[0] >> 4; cx <= (bx.max[0] >> 4); cx++) {
      var ids = api.world.section(cx, sec, cz, scratch);
      if (!ids) continue;
      var x0 = Math.max(bx.min[0], cx * 16), x1 = Math.min(bx.max[0], cx * 16 + 15), z0 = Math.max(bx.min[2], cz * 16), z1 = Math.min(bx.max[2], cz * 16 + 15), y0 = Math.max(minY, sec * 16), y1 = Math.min(bx.max[1], sec * 16 + 15);
      for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) {
        var id = ids[((y & 15) << 8) | ((z & 15) << 4) | (x & 15)], idx;
        if (api.blocks.isAir(id)) idx = 0;
        else {
          idx = map[id];
          if (idx < 0) { var inf = api.blocks.info(id); idx = map[id] = pal.length; pal.push({ name: inf ? inf.name : "minecraft:air", props: inf ? inf.props : {} }); }
          total++;
        }
        data[((y - minY) * sz + (z - bx.min[2])) * sx + (x - bx.min[0])] = idx;
      }
    }
    var bits = Math.max(2, 32 - Math.clz32(Math.max(1, pal.length - 1))), T = NBT.tag, now = Date.now();
    var palette = pal.map(function (p) {
      var o = { Name: T.string(p.name) }, keys = Object.keys(p.props);
      if (keys.length) { var pr = {}; keys.forEach(function (k) { pr[k] = T.string(p.props[k]); }); o.Properties = T.compound(pr); }
      return T.compound(o);
    });
    var xyz = function (x, y, z) { return T.compound({ x: T.int(x), y: T.int(y), z: T.int(z) }); };
    var emptyList = function () { return T.list(10, []); };
    var root = {
      MinecraftDataVersion: T.int(4790), Version: T.int(6), SubVersion: T.int(1),
      Metadata: T.compound({ Name: T.string(name), Author: T.string(author || "OneClient"), Description: T.string("Saved from the world with OneClient"), EnclosingSize: xyz(sx, sy, sz), RegionCount: T.int(1), TimeCreated: T.long(now), TimeModified: T.long(now), TotalBlocks: T.int(total), TotalVolume: T.int(vol) }),
      Regions: T.compound({ main: T.compound({ Position: xyz(0, 0, 0), Size: xyz(sx, sy, sz), BlockStatePalette: T.list(10, palette), BlockStates: T.longs(NBT.packBits(data, bits)), TileEntities: emptyList(), Entities: emptyList(), PendingBlockTicks: emptyList(), PendingFluidTicks: emptyList() }) })
    };
    return NBT.gzip(NBT.write(root)).then(function (bytes) { return { bytes: bytes, blocks: total, volume: vol, size: bx.size, palette: pal.length }; });
  }

  /* ---------- pasting the schematic into a singleplayer world ---------- */
  var paste = null;
  function stateString(name, props) {
    var k = Object.keys(props || {});
    return name + (k.length ? "[" + k.map(function (x) { return x + "=" + props[x]; }).join(",") + "]" : "");
  }
  function pasteCommands(withAir) {
    var S = LM.schem, pl = LM.placement, rot = pl.rot, mx = pl.mirrorX, mz = pl.mirrorZ, cmds = [], skipped = 0;
    function mapXZ(x, z) { if (mx) x = -x; if (mz) z = -z; switch (rot) { case 1: return [-z, x]; case 2: return [-x, -z]; case 3: return [z, -x]; default: return [x, z]; } }
    S.regions.forEach(function (r) {
      if (LM.hidden[r.name]) return;
      var dx = r.dim[0], dy = r.dim[1], dz = r.dim[2], strs = r.palette.map(function (st) {
        if (Formats.isAir(st.name)) return withAir ? "minecraft:air" : null;
        if (!api.blocks.has(st.name)) { return undefined; }
        return stateString(st.name, States.transform(st.name, st.props || {}, rot, mx, mz));
      });
      for (var y = 0; y < dy; y++) for (var z = 0; z < dz; z++) {
        var x = 0;
        while (x < dx) {
          var p = r.data[(y * dz + z) * dx + x], s = strs[p];
          if (s === null) { x++; continue; }
          if (s === undefined) { skipped++; x++; continue; }
          var x2 = x; while (x2 + 1 < dx && r.data[(y * dz + z) * dx + x2 + 1] === p && x2 - x < 255) x2++;
          var a1 = mapXZ(r.min[0] + x, r.min[2] + z), a2 = mapXZ(r.min[0] + x2, r.min[2] + z), wy = pl.y + r.min[1] + y;
          var X1 = pl.x + a1[0], Z1 = pl.z + a1[1], X2 = pl.x + a2[0], Z2 = pl.z + a2[1];
          cmds.push(x2 > x ? "fill " + Math.min(X1, X2) + " " + wy + " " + Math.min(Z1, Z2) + " " + Math.max(X1, X2) + " " + wy + " " + Math.max(Z1, Z2) + " " + s : "setblock " + X1 + " " + wy + " " + Z1 + " " + s);
          x = x2 + 1;
        }
      }
    });
    return { cmds: cmds, skipped: skipped };
  }
  function startPaste(withAir) {
    if (paste) return Promise.reject(new Error("A paste is already running."));
    if (!LM.schem) return Promise.reject(new Error("Load a schematic first."));
    if (!api.world.ready || api.net.transport !== "singleplayer") return Promise.reject(new Error("Pasting works in singleplayer worlds with cheats on (it uses commands)."));
    var built = pasteCommands(withAir), cmds = built.cmds;
    if (!cmds.length) return Promise.reject(new Error("There is nothing to paste."));
    var S = LM.schem, pl = LM.placement, st = Mesher.state, b = st.bounds || { min: S.min, max: [S.min[0] + S.size[0], S.min[1] + S.size[1], S.min[2] + S.size[2]] };
    var bx = { min: [pl.x + b.min[0], 0, pl.z + b.min[2]], max: [pl.x + b.max[0] - 1, 0, pl.z + b.max[2] - 1] }, miss = missingChunks(bx);
    if (miss.length) return Promise.reject(new Error(miss.length + " chunk" + (miss.length > 1 ? "s" : "") + " of the area are not loaded. Stand closer so the whole area is loaded."));
    var i = 0, p = paste = { total: cmds.length, done: 0, skipped: built.skipped, cancelled: false, timer: null };
    return new Promise(function (resolve) {
      function tick() {
        if (p.cancelled || i >= cmds.length) { paste = null; LM.changed(); resolve({ sent: i, total: cmds.length, cancelled: p.cancelled }); return; }
        var batch = cmds.slice(i, i + 250); i += batch.length; p.done = i;
        api.net.commands(batch);
        LM.changed();
        p.timer = setTimeout(tick, 120);
      }
      tick();
    });
  }
  function pasteState() { return paste; }
  function cancelPaste() { if (paste) { paste.cancelled = true; if (paste.timer) clearTimeout(paste.timer); } }

  /* the selection box in the world is drawn by Render (it needs the GL context) */
  api.onDisable(function () { cancelPaste(); });

  return { box: box, set: set, clear: clear, aim: aim, feet: feet, exportBytes: exportBytes, missingChunks: missingChunks, startPaste: startPaste, pasteState: pasteState, cancelPaste: cancelPaste, pasteCommands: pasteCommands,
    get a() { return a; }, get b() { return b; } };
})();
