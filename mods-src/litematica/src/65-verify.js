/* The verifier: compares the schematic with the blocks the game has loaded (api.world) and keeps, per 16x16x16 world section, the list of cells that
 * are not right. Kinds: 1 missing (the world has air where the schematic has a block), 2 wrong block, 3 wrong state (same block, other properties),
 * 4 extra (a block where the schematic has air). Work is spread over frames (a few milliseconds each), nearest sections first, and redone for a
 * section whenever the game changes a block in it. The renderer draws the cells as coloured boxes. */
var Verify = (function () {
  var secs = new Map(), queue = [], queued = new Set(), maps = null, sig = "", stamp = 0, epoch = 0, scratch = new Uint16Array(4096);
  var totals = { correct: 0, missing: 0, wrong: 0, state: 0, extra: 0, unknown: 0 };
  var info = { on: false, reason: "", cells: 0, verified: 0, pending: 0 };
  var lastUi = 0;

  function key(cx, sy, cz) { return cx + "," + sy + "," + cz; }
  function placeXZ(x, z, rot, mx, mz) {                               // the same mapping the mesher uses: mirror, then clockwise turns
    if (mx) x = -x; if (mz) z = -z;
    switch (rot) { case 1: return [-z, x]; case 2: return [-x, -z]; case 3: return [z, -x]; default: return [x, z]; }
  }

  /* ---------- what the schematic expects under the current placement ---------- */
  function prepare() {
    var S = LM.schem, pl = LM.placement;
    maps = null; info.cells = 0;
    if (!S || !api.world.available) return;
    var rot = pl.rot, mx = pl.mirrorX, mz = pl.mirrorZ, list = [];
    S.regions.forEach(function (r) {
      if (LM.hidden[r.name]) return;
      var n = r.palette.length, expect = new Int32Array(n), canonE = new Int32Array(n), skip = new Uint8Array(n), air = new Uint8Array(n), names = new Array(n), i;
      for (i = 0; i < n; i++) {
        var st = r.palette[i], e = States.expectedId(st, rot, mx, mz);
        names[i] = st.name;
        if (e === -3) { air[i] = 1; skip[i] = 1; expect[i] = 0; canonE[i] = 0; }
        else if (e < 0) { skip[i] = 2; expect[i] = -1; canonE[i] = -1; }           // a block this game version does not have
        else { expect[i] = e; canonE[i] = States.canon(e); }
      }
      var cx = [r.min[0], r.min[0] + r.dim[0] - 1], cz = [r.min[2], r.min[2] + r.dim[2] - 1], wx0 = 1e9, wx1 = -1e9, wz0 = 1e9, wz1 = -1e9;
      cx.forEach(function (x) { cz.forEach(function (z) { var m = placeXZ(x, z, rot, mx, mz); wx0 = Math.min(wx0, pl.x + m[0]); wx1 = Math.max(wx1, pl.x + m[0]); wz0 = Math.min(wz0, pl.z + m[1]); wz1 = Math.max(wz1, pl.z + m[1]); }); });
      list.push({ r: r, expect: expect, canonE: canonE, skip: skip, air: air, names: names, wx0: wx0, wx1: wx1, wz0: wz0, wz1: wz1, wy0: pl.y + r.min[1], wy1: pl.y + r.min[1] + r.dim[1] - 1 });
      info.cells += r.blocks || 0;
    });
    maps = list.length ? list : null;
  }

  function overlaps(cx, sy, cz) {
    if (!maps) return false;
    var bx = cx * 16, by = sy * 16, bz = cz * 16;
    for (var i = 0; i < maps.length; i++) { var m = maps[i]; if (bx + 15 >= m.wx0 && bx <= m.wx1 && by + 15 >= m.wy0 && by <= m.wy1 && bz + 15 >= m.wz0 && bz <= m.wz1) return true; }
    return false;
  }

  /* ---------- checking one section ---------- */
  function check(cx, sy, cz) {
    var ids = api.world.section(cx, sy, cz, scratch);
    if (!ids) return null;
    var pl = LM.placement, rot = pl.rot, mx = pl.mirrorX, mz = pl.mirrorZ, extraOn = LM.set("vExtra");
    var pos = [], kind = [], counts = [0, 0, 0, 0, 0, 0], need = {}, bx = cx * 16, by = sy * 16, bz = cz * 16;
    for (var mi = 0; mi < maps.length; mi++) {
      var m = maps[mi], r = m.r;
      var xa = Math.max(0, m.wx0 - bx), xb = Math.min(15, m.wx1 - bx), ya = Math.max(0, m.wy0 - by), yb = Math.min(15, m.wy1 - by), za = Math.max(0, m.wz0 - bz), zb = Math.min(15, m.wz1 - bz);
      if (xa > xb || ya > yb || za > zb) continue;
      var data = r.data, dx = r.dim[0], dz = r.dim[2], minx = r.min[0], minz = r.min[2], miny = r.min[1];
      for (var ly = ya; ly <= yb; ly++) {
        var ry = by + ly - pl.y - miny;
        for (var lz = za; lz <= zb; lz++) {
          var pz = bz + lz - pl.z;
          for (var lx = xa; lx <= xb; lx++) {
            var px = bx + lx - pl.x, x, z;                              // placement space -> region space (undo the turn, then the mirror)
            switch (rot) { case 1: x = pz; z = -px; break; case 2: x = -px; z = -pz; break; case 3: x = -pz; z = px; break; default: x = px; z = pz; }
            if (mx) x = -x; if (mz) z = -z;
            var rx = x - minx, rz = z - minz;
            if (rx < 0 || rx >= dx || rz < 0 || rz >= dz || ry < 0 || ry >= r.dim[1]) continue;
            var p = data[(ry * dz + rz) * dx + rx], W = ids[(ly << 8) | (lz << 4) | lx];
            if (m.skip[p]) {
              if (m.skip[p] === 2) counts[5]++;
              else if (extraOn && !api.blocks.isAir(W)) { pos.push((ly << 8) | (lz << 4) | lx); kind.push(4); counts[4]++; }
              continue;
            }
            var E = m.expect[p];
            if (W === E || States.canon(W) === m.canonE[p]) { counts[0]++; continue; }
            var k;
            if (api.blocks.isAir(W)) { k = 1; counts[1]++; }
            else if (States.blockOf(W) !== States.blockOf(E)) { k = 2; counts[2]++; }
            else { k = 3; counts[3]++; }
            pos.push((ly << 8) | (lz << 4) | lx); kind.push(k);
            var nm = m.names[p]; need[nm] = (need[nm] || 0) + 1;
          }
        }
      }
    }
    return { cx: cx, sy: sy, cz: cz, pos: Uint16Array.from(pos), kind: Uint8Array.from(kind), counts: counts, need: need, gl: null, glMask: -1, v: stamp };
  }

  function add(res, sign) {
    totals.correct += sign * res.counts[0]; totals.missing += sign * res.counts[1]; totals.wrong += sign * res.counts[2];
    totals.state += sign * res.counts[3]; totals.extra += sign * res.counts[4]; totals.unknown += sign * res.counts[5];
  }
  function drop(k) { var old = secs.get(k); if (old) { add(old, -1); if (old.gl) Verify.free.push(old.gl); secs.delete(k); } }

  function enqueue(cx, sy, cz, front) {
    if (!overlaps(cx, sy, cz) || !api.world.isLoaded(cx, cz)) return;
    var k = key(cx, sy, cz);
    if (queued.has(k)) return;
    queued.add(k); if (front) queue.unshift([cx, sy, cz, k]); else queue.push([cx, sy, cz, k]);
  }

  /* every loaded section that touches the schematic, nearest to the camera first */
  function queueAll() {
    queue = []; queued = new Set();
    if (!maps) return;
    var c = api.game.cam, list = [], seen = {};
    maps.forEach(function (m) {
      for (var sy = m.wy0 >> 4; sy <= (m.wy1 >> 4); sy++) for (var cz = m.wz0 >> 4; cz <= (m.wz1 >> 4); cz++) for (var cx = m.wx0 >> 4; cx <= (m.wx1 >> 4); cx++) {
        if (!api.world.isLoaded(cx, cz)) continue;
        var k = key(cx, sy, cz); if (seen[k]) continue; seen[k] = 1;
        var d = c ? Math.pow(cx * 16 + 8 - c.x, 2) + Math.pow(sy * 16 + 8 - c.y, 2) + Math.pow(cz * 16 + 8 - c.z, 2) : 0;
        list.push([cx, sy, cz, k, d]);
      }
    });
    list.sort(function (a, b) { return a[4] - b[4]; });
    list.forEach(function (e) { queue.push(e); queued.add(e[3]); });
  }

  function reset() {
    secs.forEach(function (s) { if (s.gl) Verify.free.push(s.gl); });
    secs.clear(); queue = []; queued = new Set();
    totals.correct = totals.missing = totals.wrong = totals.state = totals.extra = totals.unknown = 0;
    stamp++;
  }

  /* ---------- the frame step ---------- */
  function step(ms) {
    var want = api.world.ready && LM.schem && LM.set("verify") && api.world.available;
    var s = (want ? "1" : "0") + "|" + LM.fileName + "|" + LM.placement.x + "," + LM.placement.y + "," + LM.placement.z + "," + LM.placement.rot + LM.placement.mirrorX + LM.placement.mirrorZ + "|" + Object.keys(LM.hidden).join(",") + "|" + LM.set("vStrict") + "|" + LM.set("vExtra") + "|" + (LM.schem ? LM.schem.regions.length : 0) + "|" + epoch;
    if (s !== sig) {
      sig = s; reset(); info.on = !!want;
      info.reason = !LM.schem ? "Load a schematic first." : !api.world.available ? "This game build has no world access." : !api.world.ready ? "Join a world to compare it with the schematic." : !LM.set("verify") ? "The verifier is switched off." : "";
      States.setStrict(LM.set("vStrict"));
      try { if (want) { prepare(); queueAll(); } else maps = null; }
      catch (e) { maps = null; info.on = false; info.reason = "The verifier stopped: " + (e && e.message || e); api.error("verifier: " + (e && e.stack || e)); }
      LM.changed();
    }
    if (!want || !maps) return;
    var t0 = performance.now(), n = 0;
    while (queue.length && performance.now() - t0 < ms) {
      var q = queue.shift(); queued.delete(q[3]);
      var res = check(q[0], q[1], q[2]);
      drop(q[3]);
      if (res) { secs.set(q[3], res); add(res, 1); }
      n++;
    }
    info.pending = queue.length;
    if ((n || lastUi === 0) && performance.now() - lastUi > 400) { lastUi = performance.now(); LM.changed(); }
  }

  /* the game changed blocks: recheck what is affected */
  api.world.onChange(function (ev) {
    if (ev.type === "reset") { epoch++; return; }
    if (!maps) return;
    if (ev.type === "block") enqueue(ev.x >> 4, ev.y >> 4, ev.z >> 4, true);
    else if (ev.type === "section") enqueue(ev.cx, ev.sy, ev.cz, true);
    else if (ev.type === "chunk") { for (var sy = -4; sy < 20; sy++) enqueue(ev.cx, sy, ev.cz, false); }
    else if (ev.type === "unload") { for (var sy2 = -4; sy2 < 20; sy2++) drop(key(ev.cx, sy2, ev.cz)); }
  });

  /* ---------- for the renderer and the panel ---------- */
  var COLORS = [null, [64, 166, 255, 235], [255, 56, 56, 235], [255, 160, 30, 235], [230, 60, 230, 235]];
  function kindOn(k) { return k === 1 ? LM.set("vMissing") : k === 2 ? LM.set("vWrong") : k === 3 ? LM.set("vState") : k === 4 ? LM.set("vExtra") : false; }
  function mask() { return (LM.set("vMissing") ? 1 : 0) | (LM.set("vWrong") ? 2 : 0) | (LM.set("vState") ? 4 : 0) | (LM.set("vExtra") ? 8 : 0); }

  /* the boxes of one section as GL line data: [x y z (float32), r g b a (uint8)] x 24 per cell, positions relative to the section corner */
  function lines(res) {
    var n = 0, i, k;
    for (i = 0; i < res.kind.length; i++) if (kindOn(res.kind[i])) n++;
    var buf = new ArrayBuffer(n * 24 * 16), f = new Float32Array(buf), u = new Uint32Array(buf), o = 0, e = 0.004;
    var EDGES = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
    for (i = 0; i < res.kind.length; i++) {
      k = res.kind[i]; if (!kindOn(k)) continue;
      var p = res.pos[i], x = p & 15, z = (p >> 4) & 15, y = p >> 8, c = COLORS[k], rgba = ((c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
      for (var j = 0; j < 12; j++) {
        var ed = EDGES[j];
        for (var q = 0; q < 2; q++) {
          f[o] = x + (ed[q * 3] ? 1 + e : -e); f[o + 1] = y + (ed[q * 3 + 1] ? 1 + e : -e); f[o + 2] = z + (ed[q * 3 + 2] ? 1 + e : -e); u[o + 3] = rgba; o += 4;
        }
      }
    }
    return { data: buf, count: n * 24 };
  }

  function missingByName() {                                          // block name -> how many are still to place (missing + wrong), from the verified sections
    var out = {};
    secs.forEach(function (s) { Object.keys(s.need).forEach(function (nm) { out[nm] = (out[nm] || 0) + s.need[nm]; }); });
    return out;
  }
  function summary() {
    var t = totals, checked = t.correct + t.missing + t.wrong + t.state;
    return { on: info.on, reason: info.reason, correct: t.correct, missing: t.missing, wrong: t.wrong, state: t.state, extra: t.extra, unknown: t.unknown, cells: info.cells, checked: checked, pending: info.pending };
  }

  return { step: step, sections: secs, lines: lines, mask: mask, summary: summary, missingByName: missingByName, free: [], debug: function () { return { sig: sig, maps: maps && maps.map(function (m) { return [m.wx0, m.wx1, m.wy0, m.wy1, m.wz0, m.wz1]; }), queue: queue.length, secs: secs.size, info: info }; }, active: function () { return info.on && !!maps; } };
})();
