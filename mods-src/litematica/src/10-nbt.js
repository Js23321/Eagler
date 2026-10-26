/* NBT reader (big-endian, optionally gzip / zlib compressed). Long arrays keep their bits as a little-endian bit string so entries that
 * straddle two longs (Litematica's packing) can be read with plain byte arithmetic. */
var NBT = (function () {
  var dec = new TextDecoder("utf-8");

  function inflate(u8, format) {
    return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream(format))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  /* bytes of a .nbt-like file -> Promise<Uint8Array of raw NBT> */
  function unpack(u8) {
    if (!u8 || u8.length < 4) return Promise.reject(new Error("the file is empty"));
    var damaged = function () { throw new Error("the file is damaged (it could not be decompressed)"); };
    if (u8[0] === 0x1f && u8[1] === 0x8b) return inflate(u8, "gzip").catch(damaged);
    if (u8[0] === 0x78 && ((u8[0] << 8) | u8[1]) % 31 === 0) return inflate(u8, "deflate").catch(damaged);
    return Promise.resolve(u8);
  }

  function parseRaw(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 0;
    function str() { var l = dv.getUint16(p); p += 2; var s = dec.decode(u8.subarray(p, p + l)); p += l; return s; }
    function payload(t) {
      var n, i, a;
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: p += 2; return dv.getInt16(p - 2);
        case 3: p += 4; return dv.getInt32(p - 4);
        case 4: { var hi = dv.getInt32(p), lo = dv.getUint32(p + 4); p += 8; return hi * 4294967296 + lo; }
        case 5: p += 4; return dv.getFloat32(p - 4);
        case 6: p += 8; return dv.getFloat64(p - 8);
        case 7: n = dv.getInt32(p); p += 4; if (n < 0 || n > u8.length) throw new RangeError("length"); a = new Int8Array(u8.buffer, u8.byteOffset + p, n); p += n; return a;
        case 8: return str();
        case 9: {
          var et = dv.getInt8(p++); n = dv.getInt32(p); p += 4; if (n < 0 || n > u8.length) throw new RangeError("length");
          var l = new Array(n);
          for (i = 0; i < n; i++) l[i] = payload(et);
          return l;
        }
        case 10: {
          var o = {};
          for (;;) { var tt = dv.getInt8(p++); if (tt === 0) break; var k = str(); o[k] = payload(tt); }
          return o;
        }
        case 11: { n = dv.getInt32(p); p += 4; if (n < 0 || n * 4 > u8.length) throw new RangeError("length"); var ia = new Int32Array(n); for (i = 0; i < n; i++) ia[i] = dv.getInt32(p + i * 4); p += n * 4; return ia; }
        case 12: {
          n = dv.getInt32(p); p += 4;
          if (n < 0 || n * 8 > u8.length) throw new RangeError("length");
          var bits = new Uint8Array(n * 8);
          for (i = 0; i < n; i++) for (var k2 = 0; k2 < 8; k2++) bits[i * 8 + k2] = u8[p + i * 8 + 7 - k2];
          p += n * 8;
          return { longs: n, bits: bits };
        }
        default: throw new Error("bad NBT tag type " + t + " at byte " + p);
      }
    }
    var rootType = dv.getInt8(p++);
    if (rootType !== 10) throw new Error("this is not a schematic (it does not contain NBT data)");
    str();
    return payload(10);
  }

  function parse(u8) {
    try { return parseRaw(u8); }
    catch (e) { if (e instanceof RangeError) throw new Error("the file is damaged (it ends too early)"); throw e; }
  }

  /* entries of `bits` bits each, read from a long array: Uint16Array (or Uint32Array when the palette is huge) */
  function unpackBits(longArray, bits, count, big) {
    var out = big ? new Uint32Array(count) : new Uint16Array(count), bytes = longArray.bits, mask = (bits >= 31 ? 0x7fffffff : (1 << bits) - 1), pos = 0, i;
    if (count * bits < 2147483647) {
      for (i = 0; i < count; i++, pos += bits) {
        var bi = pos >> 3, sh = pos & 7;
        out[i] = (((bytes[bi] | (bytes[bi + 1] << 8) | (bytes[bi + 2] << 16) | (bytes[bi + 3] << 24)) >>> sh) | (bits + sh > 32 ? (bytes[bi + 4] << (32 - sh)) : 0)) & mask;
      }
    } else {
      for (i = 0; i < count; i++) {
        var p0 = i * bits, b0 = Math.floor(p0 / 8), s0 = p0 - b0 * 8, v = 0, got = 0;
        while (got < bits) { v += ((bytes[b0] >>> s0) & ((1 << Math.min(8 - s0, bits - got)) - 1)) * Math.pow(2, got); got += 8 - s0; s0 = 0; b0++; }
        out[i] = v;
      }
    }
    return out;
  }

  /* ---------- writing ---------- */
  /* values are tagged: NBT.byte(1), NBT.int(2), NBT.long(3), NBT.string("x"), NBT.longs(Uint8Array of big-endian longs), NBT.list(typeId, [values]), NBT.compound({ ... }) */
  var tag = {
    byte: function (v) { return { t: 1, v: v }; }, int: function (v) { return { t: 3, v: v }; }, long: function (v) { return { t: 4, v: v }; },
    string: function (v) { return { t: 8, v: String(v) }; }, longs: function (v) { return { t: 12, v: v }; },
    list: function (type, v) { return { t: 9, et: type, v: v }; }, compound: function (v) { return { t: 10, v: v }; }
  };
  function write(rootCompound) {                                       // -> Uint8Array of raw NBT (root named "")
    var chunks = [], size = 0, enc = new TextEncoder();
    function put(u8) { chunks.push(u8); size += u8.length; }
    function u8(n) { put(Uint8Array.of(n & 255)); }
    function i16(n) { put(Uint8Array.of((n >> 8) & 255, n & 255)); }
    function i32(n) { put(Uint8Array.of((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255)); }
    function i64(n) { var hi = Math.floor(n / 4294967296), lo = n - hi * 4294967296; i32(hi | 0); i32(lo >>> 0 | 0); }
    function str(s) { var b = enc.encode(s); i16(b.length); put(b); }
    function payload(t, v, et) {
      switch (t) {
        case 1: u8(v); break;
        case 3: i32(v); break;
        case 4: i64(v); break;
        case 8: str(v); break;
        case 9: u8(et); i32(v.length); v.forEach(function (x) { payload(et, x.v !== undefined && x.t !== undefined ? x.v : x, x.et); }); break;
        case 10: Object.keys(v).forEach(function (k) { u8(v[k].t); str(k); payload(v[k].t, v[k].v, v[k].et); }); u8(0); break;
        case 12: i32(v.length / 8); put(v); break;
        default: throw new Error("cannot write NBT tag " + t);
      }
    }
    u8(10); str(""); payload(10, rootCompound);
    var out = new Uint8Array(size), p = 0;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }
  /* entries of `bits` bits each, packed into a long array the way Litematica does (little-endian bit order, entries may straddle two longs); big-endian bytes */
  function packBits(values, bits) {
    var n = values.length, longs = Math.ceil(n * bits / 64), words = new Uint32Array(longs * 2 + 1), i, bitPos, w, off, v;
    for (i = 0; i < n; i++) {
      bitPos = i * bits; w = bitPos >>> 5; off = bitPos & 31; v = values[i];
      words[w] |= v << off;
      if (off + bits > 32) words[w + 1] |= v >>> (32 - off);
    }
    var out = new Uint8Array(longs * 8);
    for (i = 0; i < longs; i++) {
      var lo = words[i * 2], hi = words[i * 2 + 1], o = i * 8;
      out[o] = hi >>> 24; out[o + 1] = (hi >>> 16) & 255; out[o + 2] = (hi >>> 8) & 255; out[o + 3] = hi & 255;
      out[o + 4] = lo >>> 24; out[o + 5] = (lo >>> 16) & 255; out[o + 6] = (lo >>> 8) & 255; out[o + 7] = lo & 255;
    }
    return out;
  }
  function gzip(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }

  return { unpack: unpack, parse: parse, unpackBits: unpackBits, read: function (u8) { return unpack(u8).then(parse); }, tag: tag, write: write, packBits: packBits, gzip: gzip };
})();
