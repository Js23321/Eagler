/* Mesher worker: palette-indexed region volumes + baked block models -> vertex buffers per 16x16x16 section.
 *
 * job: { type:"mesh", id, regions:[{ min:[x,y,z], dim:[sx,sy,sz], data:Uint16Array (ids into the shared palette; 0 = air) }],
 *        models:[{ n, quads:Float32Array(n*27), opaque, cullSame, group }] (index = id), rot:0..3, mirrorX, mirrorZ, rects:Float32Array(textures*4) }
 * quad (27 floats): cull dir, texture id, shade on (0/1), tint r, g, b, alpha, then 4 vertices of (x, y, z, u, v) in 0..1 block units.
 * Placement transform (applied to cells, then to the geometry): mirror, then rotate clockwise by rot * 90 degrees around the origin cell,
 * the same mapping as Minecraft's BlockPos.rotate / mirror. Output messages:
 *   { type:"section", id, cx, cy, cz, quads, verts:ArrayBuffer }   vertices are 6 words: x y z u v (float32) + rgba (uint32), positions
 *                                                                   relative to the section corner at (cx, cy, cz) * 16 in placement space
 *   { type:"progress", id, done, total }   sections looked at so far / all sections, about every 120 ms
 *   { type:"done", id, bounds:{ min:[...], max:[...] }, quads, sections }      { type:"error", id, message } */
"use strict";

var SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
var DIR_V = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

function mapXZ(x, z, rot, mx, mz) {
  if (mx) x = -x;
  if (mz) z = -z;
  switch (rot) { case 1: return [-z, x]; case 2: return [-x, -z]; case 3: return [z, -x]; default: return [x, z]; }
}
function nearestDir(nx, ny, nz) {
  var ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) return ny < 0 ? 0 : 1;
  if (az >= ax) return nz < 0 ? 2 : 3;
  return nx < 0 ? 4 : 5;
}
function dirMap(d, rot, mx, mz) {                           // direction of a face after the placement transform
  if (d < 2) return d;
  var v = DIR_V[d], m = mapXZ(v[0], v[2], rot, mx, mz);
  return nearestDir(m[0], 0, m[1]);
}

/* transform a baked model's quads for this placement: positions about the block centre, mirror flips the winding */
function transformModel(model, rot, mx, mz) {
  var n = model.n, src = model.quads, out = new Float32Array(src.length), q, i, o;
  var flip = (mx ? 1 : 0) ^ (mz ? 1 : 0);
  for (q = 0; q < n; q++) {
    o = q * 27;
    out[o] = src[o] >= 0 ? dirMap(src[o], rot, mx, mz) : -1;
    for (i = 1; i < 7; i++) out[o + i] = src[o + i];
    var vs = [];
    for (i = 0; i < 4; i++) {
      var b = o + 7 + i * 5, m = mapXZ(src[b] - 0.5, src[b + 2] - 0.5, rot, mx, mz);
      vs.push([m[0] + 0.5, src[b + 1], m[1] + 0.5, src[b + 3], src[b + 4]]);
    }
    if (flip) vs = [vs[0], vs[3], vs[2], vs[1]];
    for (i = 0; i < 4; i++) { var t = o + 7 + i * 5; out[t] = vs[i][0]; out[t + 1] = vs[i][1]; out[t + 2] = vs[i][2]; out[t + 3] = vs[i][3]; out[t + 4] = vs[i][4]; }
    // recompute the shade from the final facing of the quad
    if (src[o + 2] > 0.5) {
      var p0 = o + 7, ax = out[p0 + 5] - out[p0], ay = out[p0 + 6] - out[p0 + 1], az = out[p0 + 7] - out[p0 + 2];
      var bx = out[p0 + 10] - out[p0], by = out[p0 + 11] - out[p0 + 1], bz = out[p0 + 12] - out[p0 + 2];
      out[o + 2] = SHADE[nearestDir(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)];
    } else out[o + 2] = 1;
  }
  return { n: n, quads: out, opaque: model.opaque, cullSame: model.cullSame, group: model.group };
}

self.onmessage = function (e) {
  var job = e.data;
  if (!job || job.type !== "mesh") return;
  try { run(job); } catch (err) { self.postMessage({ type: "error", id: job.id, message: String(err && err.message || err) }); }
};

function run(job) {
  var rot = job.rot | 0, mx = !!job.mirrorX, mz = !!job.mirrorZ, regions = job.regions, i, r;
  // bounds of everything in placement space
  var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  regions.forEach(function (rg) {
    [0, 1].forEach(function (a) { [0, 1].forEach(function (c) {
      var m = mapXZ(rg.min[0] + (a ? rg.dim[0] - 1 : 0), rg.min[2] + (c ? rg.dim[2] - 1 : 0), rot, mx, mz);
      lo[0] = Math.min(lo[0], m[0]); hi[0] = Math.max(hi[0], m[0] + 1); lo[2] = Math.min(lo[2], m[1]); hi[2] = Math.max(hi[2], m[1] + 1);
    }); });
    lo[1] = Math.min(lo[1], rg.min[1]); hi[1] = Math.max(hi[1], rg.min[1] + rg.dim[1]);
  });
  var W = hi[0] - lo[0], H = hi[1] - lo[1], D = hi[2] - lo[2], total = W * H * D;
  if (total > 400000000) throw new Error("this schematic is too large to display (" + W + " x " + H + " x " + D + ")");
  var vol = new Uint16Array(total), count = 0;
  regions.forEach(function (rg) {
    var sx = rg.dim[0], sy = rg.dim[1], sz = rg.dim[2], data = rg.data, y, z, x, idx = 0;
    for (y = 0; y < sy; y++) for (z = 0; z < sz; z++) for (x = 0; x < sx; x++, idx++) {
      var id = data[idx];
      if (!id) continue;
      var m = mapXZ(rg.min[0] + x, rg.min[2] + z, rot, mx, mz);
      vol[((rg.min[1] + y - lo[1]) * D + (m[1] - lo[2])) * W + (m[0] - lo[0])] = id;
      count++;
    }
  });
  var models = job.models.map(function (m) { return m && m.n ? transformModel(m, rot, mx, mz) : null; });
  var groups = job.models.map(function (m) { return m ? m.group : -1; });
  var rects = job.rects, quadsTotal = 0, sections = 0;

  var cap = 1 << 16, buf = new Float32Array(cap * 6), u32 = new Uint32Array(buf.buffer), nv = 0;
  function reserve(n) {
    if ((nv + n) * 6 <= buf.length) return;
    var nb = new Float32Array(Math.max(buf.length * 2, (nv + n) * 6));
    nb.set(buf.subarray(0, nv * 6));
    buf = nb; u32 = new Uint32Array(buf.buffer);
  }

  var SX = Math.ceil(W / 16), SY = Math.ceil(H / 16), SZ = Math.ceil(D / 16), cx, cy, cz, visited = 0, lastTick = Date.now();
  function at(x, y, z) { return (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) ? 0 : vol[(y * D + z) * W + x]; }
  for (cy = 0; cy < SY; cy++) for (cz = 0; cz < SZ; cz++) for (cx = 0; cx < SX; cx++) {
    nv = 0;
    if (++visited % 64 === 0 && Date.now() - lastTick > 120) { lastTick = Date.now(); self.postMessage({ type: "progress", id: job.id, done: visited, total: SX * SY * SZ }); }
    var x0 = cx * 16, y0 = cy * 16, z0 = cz * 16, x1 = Math.min(W, x0 + 16), y1 = Math.min(H, y0 + 16), z1 = Math.min(D, z0 + 16), x, y, z;
    for (y = y0; y < y1; y++) for (z = z0; z < z1; z++) for (x = x0; x < x1; x++) {
      var id = vol[(y * D + z) * W + x];
      if (!id) continue;
      var model = models[id];
      if (!model) continue;
      var qs = model.quads, nq = model.n, q;
      for (q = 0; q < nq; q++) {
        var o = q * 27, c = qs[o];
        if (c >= 0) {
          var v = DIR_V[c], nid = at(x + v[0], y + v[1], z + v[2]);
          if (nid) {
            var nm = models[nid];
            if (nm && (nm.opaque || (model.cullSame && groups[nid] === groups[id]))) continue;
          }
        }
        reserve(4);
        var tex = qs[o + 1], rr = tex * 4, ru0 = rects[rr], rv0 = rects[rr + 1], ru1 = rects[rr + 2], rv1 = rects[rr + 3];
        var sh = qs[o + 2], cr = Math.min(255, Math.round(qs[o + 3] * sh * 255)), cg = Math.min(255, Math.round(qs[o + 4] * sh * 255)), cb = Math.min(255, Math.round(qs[o + 5] * sh * 255)), ca = Math.round(qs[o + 6] * 255);
        var rgba = (ca << 24 | cb << 16 | cg << 8 | cr) >>> 0, k;
        for (k = 0; k < 4; k++) {
          var s = o + 7 + k * 5, d = nv * 6;
          buf[d] = x - x0 + qs[s]; buf[d + 1] = y - y0 + qs[s + 1]; buf[d + 2] = z - z0 + qs[s + 2];
          buf[d + 3] = ru0 + qs[s + 3] * (ru1 - ru0); buf[d + 4] = rv0 + qs[s + 4] * (rv1 - rv0);
          u32[d + 5] = rgba;
          nv++;
        }
      }
    }
    if (nv) {
      var out = buf.slice(0, nv * 6);
      quadsTotal += nv / 4; sections++;
      self.postMessage({ type: "section", id: job.id, cx: cx, cy: cy, cz: cz, quads: nv / 4, verts: out.buffer }, [out.buffer]);
    }
  }
  self.postMessage({ type: "done", id: job.id, bounds: { min: lo, max: hi }, quads: quadsTotal, sections: sections, blocks: count });
}
