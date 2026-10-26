/* OneClient world mirror: the blocks the game has loaded, rebuilt from the chunk packets it receives (see net.js).
 *
 * Read only: OneClient listens to the same packets the game gets (chunks, block changes, unloads) and keeps the block states.
 * States are numbers; OC.blocks turns them into names and properties. Chunks are kept as the game sent them (palette + packed longs) and
 * decoded on demand; a block change turns just that 16x16x16 section into a plain array.
 *
 * OC.world.getState(x, y, z)      state id, -1 when the chunk is not loaded
 * OC.world.getBlock(x, y, z)      { id, name, props } or null (not loaded)
 * OC.world.isLoaded(cx, cz)       chunk loaded?
 * OC.world.section(cx, sy, cz, out?)   Uint16Array(4096) of a section, index (y * 16 + z) * 16 + x, null when not loaded
 * OC.world.palette(cx, sy, cz)    the states a section holds without decoding it ([state] when it is all one state), null when unknown
 * OC.world.biomeIndex(x, y, z)   the biome of the 4 x 4 x 4 cell (an index into OC.world.biomeNames), -1 when the chunk is not loaded
 * OC.world.biomeAt(x, y, z)       its name ("minecraft:plains"), "" when not known;   OC.world.biomeNames: the names, in the order the server sent them
 * OC.world.onChange(fn)           fn({ type: "chunk" | "unload" | "block" | "section" | "reset", cx, cz, ... }) -> off()
 * OC.world.minY, .height, .dim, .version (counts every change), .chunkCount()
 */
(function () {
  "use strict";
  var OC = window.OneClient, net = OC && OC.net;
  if (!net) return;
  var CB = net.IDS.cb;

  var world = OC.world = { ready: false, dim: "", minY: -64, height: 384, version: 0, biomeNames: [] };
  var chunks = new Map(), subs = [], dimTypes = [];
  function key(cx, cz) { return cx * 8388608 + cz; }

  function emit(ev) { world.version++; for (var i = 0; i < subs.length; i++) { try { subs[i](ev); } catch (e) { warn("listener", e); } } }
  function warn(what, e) { try { console.warn("[OneClient world] " + what + ": " + (e && e.message || e)); } catch (x) {} }
  world.onChange = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };
  world.chunkCount = function () { return chunks.size; };
  world.isLoaded = function (cx, cz) { return chunks.has(key(cx, cz)); };
  world.chunkKeys = function () { var out = []; chunks.forEach(function (c) { out.push([c.cx, c.cz]); }); return out; };

  /* ---------- reading a section ---------- */
  /* a paletted container: single value | packed longs (big-endian on the wire) with an optional palette of state ids */
  function readEntry(s, idx) {
    var bits = s.bits, per = (64 / bits) | 0, li = (idx / per) | 0, off = (idx - li * per) * bits, o = li * 8, d = s.data;
    var hi = ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
    var lo = ((d[o + 4] << 24) | (d[o + 5] << 16) | (d[o + 6] << 8) | d[o + 7]) >>> 0;
    var v = off >= 32 ? hi >>> (off - 32) : (off + bits <= 32 ? lo >>> off : ((lo >>> off) | (hi << (32 - off))) >>> 0);
    v &= (1 << bits) - 1;
    return s.pal ? s.pal[v] : v;
  }
  function stateAt(s, lx, ly, lz) {
    var idx = (ly << 8) | (lz << 4) | lx;
    if (s.plain) return s.plain[idx];
    return s.single !== undefined ? s.single : readEntry(s, idx);
  }
  function decode(s, out) {
    out = out || new Uint16Array(4096);
    if (s.plain) { out.set(s.plain); return out; }
    if (s.single !== undefined) { out.fill(s.single); return out; }
    var bits = s.bits, per = (64 / bits) | 0, d = s.data, pal = s.pal, mask = (1 << bits) - 1, idx = 0, li, k, o, hi, lo, v, off;
    for (li = 0; idx < 4096; li++) {
      o = li * 8;
      hi = ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
      lo = ((d[o + 4] << 24) | (d[o + 5] << 16) | (d[o + 6] << 8) | d[o + 7]) >>> 0;
      for (k = 0, off = 0; k < per && idx < 4096; k++, off += bits, idx++) {
        v = off >= 32 ? hi >>> (off - 32) : (off + bits <= 32 ? lo >>> off : ((lo >>> off) | (hi << (32 - off))) >>> 0);
        v &= mask;
        out[idx] = pal ? pal[v] : v;
      }
    }
    return out;
  }
  function plainOf(s) { if (!s.plain) { s.plain = decode(s); s.data = null; s.pal = null; s.single = undefined; } return s.plain; }

  world.getState = function (x, y, z) {
    var c = chunks.get(key(x >> 4, z >> 4));
    if (!c) return -1;
    var si = (y - world.minY) >> 4;
    if (si < 0 || si >= c.secs.length) return 0;                         // above or below the build limit: air
    return stateAt(c.secs[si], x & 15, y & 15, z & 15);
  };
  world.getBlock = function (x, y, z) {
    var id = world.getState(x, y, z);
    if (id < 0) return null;
    var i = OC.blocks && OC.blocks.info(id);
    return i ? { id: id, name: i.name, props: i.props } : { id: id, name: "", props: {} };
  };
  world.section = function (cx, sy, cz, out) {
    var c = chunks.get(key(cx, cz));
    if (!c) return null;
    var si = sy - (world.minY >> 4);
    if (si < 0 || si >= c.secs.length) return null;
    return decode(c.secs[si], out);
  };
  world.biomeIndex = function (x, y, z) {
    var c = chunks.get(key(x >> 4, z >> 4));
    if (!c) return -1;
    var si = (y - world.minY) >> 4;
    if (si < 0) si = 0; else if (si >= c.secs.length) si = c.secs.length - 1;          // above or below the world: the nearest section
    var b = c.secs[si].bio;
    if (!b) return -1;
    return b.single !== undefined ? b.single : readEntry(b, (((y & 15) >> 2) << 4) | (((z & 15) >> 2) << 2) | ((x & 15) >> 2));
  };
  world.biomeAt = function (x, y, z) { var i = world.biomeIndex(x, y, z); return i >= 0 && world.biomeNames[i] || ""; };
  world.chunkVersion = function (cx, cz) { var c = chunks.get(key(cx, cz)); return c ? c.ver : -1; };
  /* the block states a section holds, known without decoding it: [state] for a section of one state only (the air above the ground), else the
   * palette the game sent. null: not loaded, already turned into a plain array by a block change, or a palette-less container (unknown). */
  world.palette = function (cx, sy, cz) {
    var c = chunks.get(key(cx, cz));
    if (!c) return null;
    var si = sy - (world.minY >> 4);
    if (si < 0 || si >= c.secs.length) return null;
    var s = c.secs[si];
    if (s.plain) return null;
    return s.single !== undefined ? [s.single] : s.pal;
  };

  /* ---------- changes ---------- */
  function setState(x, y, z, id) {
    var c = chunks.get(key(x >> 4, z >> 4));
    if (!c) return false;
    var si = (y - world.minY) >> 4;
    if (si < 0 || si >= c.secs.length) return false;
    var s = c.secs[si], p = plainOf(s), idx = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15), old = p[idx];
    if (old === id) return false;
    p[idx] = id; c.ver++;
    return old;
  }

  function reset(why) {
    chunks.clear(); world.ready = false;
    emit({ type: "reset", why: why });
  }
  world.reset = reset;

  /* ---------- dimensions: min_y and height come from the configuration registries ---------- */
  function readNbt(r) {                                                   // network NBT: the root compound has no name
    var t = r.u8();
    if (t === 0) return null;
    return payload(r, t);
  }
  function payload(r, t) {
    var n, i, o, a;
    switch (t) {
      case 1: return r.i8();
      case 2: return r.i16();
      case 3: return r.i32();
      case 4: return Number(r.i64());
      case 5: return r.f32();
      case 6: return r.f64();
      case 7: n = r.i32(); r.skip(n); return null;
      case 8: n = r.u16(); return new TextDecoder("utf-8").decode(r.bytes(n));
      case 9: { var et = r.u8(); n = r.i32(); a = []; for (i = 0; i < n; i++) a.push(payload(r, et)); return a; }
      case 10: { o = {}; for (;;) { var tt = r.u8(); if (tt === 0) break; var nm = payload(r, 8); o[nm] = payload(r, tt); } return o; }
      case 11: n = r.i32(); r.skip(n * 4); return null;
      case 12: n = r.i32(); r.skip(n * 8); return null;
      default: throw new Error("bad NBT tag " + t);
    }
  }
  net.onConfig("in", 7, function (r) {                                    // registry data: [registry id][entries: id, has data, nbt]
    var reg = r.string(), dim = reg === "minecraft:dimension_type";
    if (!dim && reg !== "minecraft:worldgen/biome") return;
    var n = r.varint(), names = [];
    if (dim) dimTypes = [];
    for (var i = 0; i < n; i++) {
      var id = r.string(), has = r.bool(), nbt = has ? readNbt(r) : null;
      if (dim) dimTypes.push({ id: id, minY: nbt && typeof nbt.min_y === "number" ? nbt.min_y : -64, height: nbt && typeof nbt.height === "number" ? nbt.height : 384 });
      else names.push(id);                                                // the chunks name a biome by its place in this list
    }
    if (!dim) world.biomeNames = names;
  });

  function enterDimension(typeIndex, name) {
    var t = dimTypes[typeIndex] || { minY: -64, height: 384 };
    chunks.clear();
    world.minY = t.minY; world.height = t.height; world.dim = name || ""; world.ready = true;
    emit({ type: "reset", why: "dimension" });
  }

  /* login: the first packet of the play state carries the dimension */
  net.on("in", CB.login, function (r) {
    r.i32(); r.bool();                                                    // entity id, hardcore
    var n = r.varint(); for (var i = 0; i < n; i++) r.string();           // all dimensions
    r.varint(); r.varint(); r.varint();                                   // max players, view distance, simulation distance
    r.bool(); r.bool(); r.bool();                                         // reduced debug info, show death screen, limited crafting
    var type = r.varint(), dim = r.string();
    world.seed = String(r.i64());                                         // the hashed world seed: tells two singleplayer worlds apart
    enterDimension(type, dim);
  });
  /* a respawn (death, a portal): another dimension starts a new world mirror; the same one keeps what we have, the server sends the chunks again */
  net.on("in", CB.respawn, function (r) {
    var type = r.varint(), dim = r.string();
    if (dim !== world.dim) enterDimension(type, dim);
  });
  net.onState(function (s) { if (s === "none" || s === "login") reset("connection"); });

  /* ---------- chunks ---------- */
  function container(r, entries, maxIndirect) {                           // -> { single } | { bits, pal, data }
    var bits = r.u8();
    if (bits === 0) return { single: r.varint() };
    var pal = null, i;
    if (bits <= maxIndirect) { var pn = r.varint(); pal = new Uint16Array(pn); for (i = 0; i < pn; i++) pal[i] = r.varint(); }
    var per = (64 / bits) | 0, longs = Math.ceil(entries / per);
    return { bits: bits, pal: pal, data: r.bytes(longs * 8).slice() };
  }

  net.on("in", CB.chunkWithLight, function (r) {
    var cx = r.i32(), cz = r.i32();
    var nh = r.varint();
    for (var h = 0; h < nh; h++) { r.varint(); r.skip(r.varint() * 8); }  // height maps
    var size = r.varint(), end = r.p + size;
    var n = world.height >> 4, secs = new Array(n);
    for (var i = 0; i < n; i++) {
      var count = r.i16();                                                // non-air blocks
      r.i16();                                                            // (26.x) a second counter
      var b = container(r, 4096, 8);
      var bio = container(r, 64, 3);                                      // biomes: 4 x 4 x 4 cells
      secs[i] = { count: count, single: b.single, bits: b.bits || 0, pal: b.pal || null, data: b.data || null, plain: null, bio: bio };
    }
    var c = { cx: cx, cz: cz, secs: secs, ver: 0 };
    chunks.set(key(cx, cz), c);
    emit({ type: "chunk", cx: cx, cz: cz });
  });

  net.on("in", CB.forgetChunk, function (r) {                             // a ChunkPos long: z in the high half, x in the low half
    var z = r.i32(), x = r.i32();
    if (chunks.delete(key(x, z))) emit({ type: "unload", cx: x, cz: z });
  });

  function posOf(r) {                                                     // a block position long -> [x, y, z]
    var hi = r.i32(), lo = r.i32();
    return [hi >> 6, (lo << 20) >> 20, (((hi & 0x3f) << 20) | (lo >>> 12)) << 6 >> 6];
  }
  net.on("in", CB.blockUpdate, function (r) {
    var p = posOf(r), id = r.varint(), old = setState(p[0], p[1], p[2], id);
    if (old !== false) emit({ type: "block", x: p[0], y: p[1], z: p[2], id: id, old: old, cx: p[0] >> 4, cz: p[2] >> 4 });
  });
  net.on("in", CB.sectionBlocksUpdate, function (r) {                     // a section position long, then the changed blocks
    var hi = r.i32(), lo = r.i32();
    var sx = hi >> 10, sy = (lo << 12) >> 12, sz = ((((hi & 0x3ff) << 12) | (lo >>> 20)) << 10) >> 10;
    var n = r.varint(), changed = 0;
    for (var i = 0; i < n; i++) {
      var e = r.varlong(), id = Math.floor(e / 4096), loc = e % 4096;
      if (setState(sx * 16 + ((loc >> 8) & 15), sy * 16 + (loc & 15), sz * 16 + ((loc >> 4) & 15), id) !== false) changed++;
    }
    if (changed) emit({ type: "section", cx: sx, sy: sy, cz: sz, count: changed });
  });
})();
