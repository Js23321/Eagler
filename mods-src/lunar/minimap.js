/* ==OneClientMod==
 * @id oc-minimap
 * @name Minimap
 * @version 1.0
 * @author OneClient
 * @description A map of the ground around you in the corner of the screen: terrain colours and relief, water depth, caves, mobs, players and your waypoints.
 * @category HUD
 * @icon map
 * @order 9
 * @needs world
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;
var ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Map" },
  { k: "show", type: "toggle", label: "Show the map", note: "The map key switches this too", def: true },
  { k: "shape", type: "choice", label: "Shape", opts: [["square", "Square"], ["round", "Round"]], def: "square" },
  { k: "size", type: "range", label: "Map size", note: "Width and height of the map", min: 90, max: 280, step: 10, unit: "px", def: 150 },
  { k: "zoom", type: "range", label: "Zoom", note: "Higher shows less ground, closer. The zoom keys change this too", min: 0.5, max: 8, step: 0.25, unit: "x", def: 1.5 },
  { k: "rotate", type: "toggle", label: "Rotate with you", note: "You always face up and the compass letters turn. Off keeps north at the top", def: true },
  { k: "view", type: "choice", label: "View", note: "Automatic switches to the cave view when you are deep underground", opts: [["auto", "Automatic"], ["surface", "Surface"], ["cave", "Cave"]], def: "auto" },
  { type: "section", label: "Terrain" },
  { k: "relief", type: "range", label: "Terrain shading", note: "Light and shadow on slopes", min: 0, max: 100, step: 10, unit: "%", def: 60 },
  { k: "depth", type: "toggle", label: "Water depth", note: "Deeper water is darker, shallow water shows the floor", def: true },
  { k: "bright", type: "range", label: "Brightness", min: 60, max: 160, step: 5, unit: "%", def: 115 },
  { k: "grid", type: "toggle", label: "Chunk grid", note: "Lines at the edge of every 16 by 16 chunk", def: false },
  { type: "section", label: "Markers" },
  { k: "players", type: "toggle", label: "Players", def: true },
  { k: "hostile", type: "toggle", label: "Hostile mobs", def: true },
  { k: "friendly", type: "toggle", label: "Animals and villagers", def: true },
  { k: "items", type: "toggle", label: "Dropped items", def: false },
  { k: "waypoints", type: "toggle", label: "Waypoints", note: "The ones of the Waypoints mod, which has to be on", def: true },
  { k: "cone", type: "toggle", label: "View cone", note: "Shows where you are looking", def: true },
  { type: "section", label: "Extras" },
  { k: "compass", type: "toggle", label: "Compass letters", note: "N, E, S and W around the edge", def: true },
  { k: "coords", type: "toggle", label: "Coordinates", note: "Your block position under the map", def: true },
  { k: "biome", type: "toggle", label: "Biome name", note: "The biome you are in, under the coordinates", def: false }
] }));
api.keys.register({ id: "zoomIn", label: "Zoom the map in", def: "Equal", onDown: function () { zoomBy(1); } });
api.keys.register({ id: "zoomOut", label: "Zoom the map out", def: "Minus", onDown: function () { zoomBy(-1); } });
api.keys.register({ id: "toggle", label: "Show / hide the map", def: "KeyM", onDown: function () { api.settings.set("show", api.settings.get("show") === false); } });
if (api.schemaOnly) return;

var W = api.world, B = api.blocks, S = api.settings, CT = kit.blockColors(), BT = kit.biomeColors();
var MINH = -32768;                                              // "no height here" in the height arrays
var GRASS = [145, 189, 89], FOLIAGE = [119, 171, 47], WATER = [63, 118, 228];        // the tints of the plains: used where the biome is not known
var PLAINS = [145, 189, 89, 119, 171, 47, 63, 118, 228];                             // the same as one list: grass, foliage, water
var CAVE_DEPTH = 24;                                            // how far below you the cave view looks for a floor
var BASE_SPAN = 128;                                            // blocks across the map at zoom 1
var DEG = Math.PI / 180;

/* ---------- what a block looks like from above ----------
 * kinds: 1 nothing to draw (air, plants ...), 2 solid, 3 water, 4 glass (see-through), 5 leaves (solid, but not a roof) */
var KIND = new Uint8Array(49152), COL = new Uint32Array(49152), TN = new Uint8Array(49152);       // per block state; 0 = not looked at yet. TN: 1 grass tint, 2 foliage tint (the colour is then the plain gray)
function pack(r, g, b) { return (0xff000000 | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0; }
function grow(n) { var k = new Uint8Array(n), c = new Uint32Array(n), t = new Uint8Array(n); k.set(KIND); c.set(COL); t.set(TN); KIND = k; COL = c; TN = t; }
function classify(s) {
  if (s < 0) return 1;
  if (s >= KIND.length) grow(Math.max(s + 1, KIND.length * 2));
  var k = 2, tn = 0, r = 128, g = 128, b = 128, info = B.info(s), nm = info && info.name || "", v, f;
  if (nm.indexOf("minecraft:") === 0) v = CT[nm.slice(10)];
  if (v === "x") k = 1;
  else if (typeof v === "string") {
    r = parseInt(v.substr(0, 2), 16); g = parseInt(v.substr(2, 2), 16); b = parseInt(v.substr(4, 2), 16);
    f = v.charAt(6);
    if (f === "w") k = 3;
    else if (f === "g") k = 4;
    else if (f === "f") { k = 5; tn = 2; }
    else if (f === "l") k = 5;
    else if (f === "r") tn = 1;
  }
  KIND[s] = k; COL[s] = pack(r, g, b); TN[s] = tn;
  return k;
}

/* the grass, foliage and water tint of a biome (an index of the biome list the server sent) */
var BIO = [];
function biomeTint(idx) {
  if (idx < 0) return PLAINS;
  var b = BIO[idx], nm, t, k;
  if (b) return b;
  nm = W.biomeName(idx).replace(/^minecraft:/, ""); t = BT[nm]; b = PLAINS;
  if (t) { b = []; for (k = 0; k < 3; k++) b.push(parseInt(t[k].substr(0, 2), 16), parseInt(t[k].substr(2, 2), 16), parseInt(t[k].substr(4, 2), 16)); }
  return (BIO[idx] = b);
}

/* ---------- the map of one chunk ----------
 * c: the colour of each of the 16 x 16 columns before the shading (ABGR, 0 = nothing known), h: the height of the top of each column */
function Tile(cx, cz) {
  this.cx = cx; this.cz = cz;
  this.c = new Uint32Array(256); this.h = new Int16Array(256);
  this.ver = -1; this.stale = true; this.has = false; this.ys = 0; this.d = 0;
}
var secBuf = new Uint16Array(4096);
var done = new Uint8Array(256), wd = new Uint8Array(256), wy = new Int16Array(256), gC = new Uint32Array(256), gy = new Int16Array(256);
var depthOn = true;

/* a column that ends on the block state s at height y (s = -1: on nothing, water to the bottom) with the water and glass that were above it */
function paint(t, i, y, s, cave, ys) {
  var c = t.c, h = t.h, d = wd[i], top = y, r = 0, g = 0, b = 0, a, f, gc, ga = 0.45, k, bt, col, wx = (t.cx << 4) | (i & 15), wz = (t.cz << 4) | (i >> 4);
  if (s >= 0) {
    col = COL[s]; r = col & 255; g = (col >>> 8) & 255; b = (col >>> 16) & 255;
    if (TN[s]) { bt = biomeTint(W.biomeIndex(wx, y, wz)); k = TN[s] === 1 ? 0 : 3; r = r * bt[k] / 255; g = g * bt[k + 1] / 255; b = b * bt[k + 2] / 255; }
  }
  if (d) {
    bt = biomeTint(W.biomeIndex(wx, wy[i], wz));
    a = depthOn && s >= 0 ? Math.min(0.95, 0.4 + 0.13 * d) : 1;
    f = depthOn ? Math.max(0.55, 1 - 0.035 * d) : 1;
    r = r * (1 - a) + bt[6] * f * a; g = g * (1 - a) + bt[7] * f * a; b = b * (1 - a) + bt[8] * f * a;
    top = wy[i];
  }
  if (gC[i]) {
    gc = gC[i];
    if (s < 0 && !d) { r = gc & 255; g = (gc >>> 8) & 255; b = (gc >>> 16) & 255; }
    else { r = r * (1 - ga) + (gc & 255) * ga; g = g * (1 - ga) + ((gc >>> 8) & 255) * ga; b = b * (1 - ga) + ((gc >>> 16) & 255) * ga; }
    top = gy[i];
  }
  if (cave) {                                                   // the wall you are inside of is dim, floors fade with their depth below you
    f = y === ys ? 0.55 : Math.max(0.4, 1 - 0.03 * (ys - y));
    r *= f; g *= f; b *= f;
  }
  c[i] = pack(r, g, b); h[i] = top;
}

/* look down every column of the chunk: from the top of the world (the surface), or from the layer ys (the cave view) */
function scan(t, ys) {
  var cave = ys !== null, minY = W.minY, topY = minY + W.height - 1;
  var yTop = cave ? Math.min(ys, topY) : topY, yBot = cave ? Math.max(ys - CAVE_DEPTH, minY) : minY;
  var c = t.c, h = t.h, left = 256, i, y, sy, base, s, k, pal, vis, sec, ylo;
  c.fill(0); h.fill(MINH); done.fill(0); wd.fill(0); gC.fill(0);
  for (sy = yTop >> 4; sy >= (yBot >> 4) && left > 0; sy--) {
    pal = W.palette(t.cx, sy, t.cz);
    if (pal) {                                                  // a section with nothing to draw in it (the air above the ground) is not even decoded
      vis = false;
      for (i = 0; i < pal.length; i++) if ((KIND[pal[i]] || classify(pal[i])) !== 1) { vis = true; break; }
      if (!vis) continue;
    }
    sec = W.section(t.cx, sy, t.cz, secBuf);
    if (!sec) continue;
    ylo = Math.max(yBot, sy * 16);
    for (y = Math.min(yTop, sy * 16 + 15); y >= ylo && left > 0; y--) {
      base = (y & 15) << 8;
      for (i = 0; i < 256; i++) {
        if (done[i]) continue;
        s = sec[base + i]; k = KIND[s] || classify(s);
        if (k === 1) { if (wd[i] && wd[i] < 255) wd[i]++; continue; }                       // kelp, seagrass and bubbles below the surface still are water
        if (k === 3) {
          if (!wd[i]) wy[i] = y;
          if (wd[i] < 255) wd[i]++;
          if (wd[i] >= 16) { paint(t, i, y, -1, cave, ys); done[i] = 1; left--; }                 // deep enough: the floor would not show anyway
          continue;
        }
        if (k === 4) { if (!gC[i] && !wd[i]) { gC[i] = COL[s]; gy[i] = y; } continue; }
        paint(t, i, y, s, cave, ys);
        done[i] = 1; left--;
      }
    }
  }
  if (left > 0) for (i = 0; i < 256; i++) if (!done[i] && (wd[i] || gC[i])) paint(t, i, MINH, -1, cave, ys);          // water or glass with nothing below it
  t.has = true;
}

/* ---------- state ---------- */
var surf = new Map(), caves = new Map(), queue = [], qi = 0;
var G = 0, gox = 0, goz = 0, gc32 = null, gh16 = null, gimg = null, gimg32 = null, gcv = document.createElement("canvas"), gctx = gcv.getContext("2d");
var composeDirty = true, planDirty = true, anchored = false, lastPlan = 0, lastDraw = 0, lastCompose = 0, lastInfo = 0, lastAuto = 0, lastEnts = 0, lastDemo = 0;
var useCave = false, underground = false, caveY = 0, ents = [], flashUntil = 0, flashText = "", demoOn = false, compKey = "", laidOut = false;
var dpr = 1, SZ = 0, fontFam = "sans-serif", textColor = "#ffffff";
function key(cx, cz) { return cx * 8388608 + cz; }

W.onChange(function (ev) {
  if (ev.type === "reset") { surf.clear(); caves.clear(); queue = []; qi = 0; composeDirty = true; planDirty = true; compKey = ""; wpAt = 0; underground = false; lastAuto = 0; BIO = []; return; }
  if (ev.type === "chunk") {
    var t = surf.get(key(ev.cx, ev.cz)), u = caves.get(key(ev.cx, ev.cz));
    if (t) t.stale = true;
    if (u) u.stale = true;
  }
  planDirty = true;
});

/* ---------- the widget ---------- */
api.dom.style(
  ".ocmm{display:inline-flex;flex-direction:column;align-items:center;gap:5px;color:var(--hk-c,#fff);font:700 11.5px/1 var(--oc-font);letter-spacing:.01em;text-shadow:0 1px 6px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.7)}" +
  ".ocmm[data-noshadow]{text-shadow:none}.ocmm[data-gone]{display:none}" +
  ".ocmm-map{position:relative;box-sizing:border-box;overflow:hidden;width:var(--mm,150px);height:var(--mm,150px);border-radius:var(--hk-r,12px);background:var(--hk-bg,rgba(12,14,20,.46));border:1px solid rgba(255,255,255,.2);box-shadow:0 2px 12px rgba(0,0,0,.3)}" +
  ".ocmm[data-shape=round] .ocmm-map{border-radius:50%}" +
  ".ocmm[data-nobg] .ocmm-map{background:transparent;border-color:transparent;box-shadow:none}" +
  ".ocmm-cv{display:block;width:100%;height:100%}" +
  ".ocmm-info{text-align:center;padding:5px 10px;border-radius:var(--hk-r,12px);background:var(--hk-bg,rgba(12,14,20,.46));border:1px solid rgba(255,255,255,.13);box-shadow:0 2px 12px rgba(0,0,0,.22);font-variant-numeric:tabular-nums;white-space:pre}" +
  ".ocmm-bio{font-size:10.5px;font-weight:600;opacity:.78}.ocmm-xyz+.ocmm-bio{margin-top:3px}" +
  ".ocmm[data-nobg] .ocmm-info{background:transparent;border-color:transparent;box-shadow:none}");
var root = document.createElement("div"), mapEl = document.createElement("div"), cv = document.createElement("canvas"), infoEl = document.createElement("div"), xyzEl = document.createElement("div"), bioEl = document.createElement("div");
root.className = "ocmm"; mapEl.className = "ocmm-map"; cv.className = "ocmm-cv"; infoEl.className = "ocmm-info"; xyzEl.className = "ocmm-xyz"; bioEl.className = "ocmm-bio";
infoEl.appendChild(xyzEl); infoEl.appendChild(bioEl); mapEl.appendChild(cv); root.appendChild(mapEl); root.appendChild(infoEl);
kit.look(root);
var ctx = cv.getContext("2d");
var widget = kit.widget({ id: "main", anchor: "tr", row: 0 }, root);

function num(k, d) { var v = +S.get(k); return isFinite(v) && v > 0 ? v : d; }
function layout() {
  var size = Math.max(80, Math.min(300, num("size", 150)));
  root.style.setProperty("--mm", size + "px");
  root.setAttribute("data-shape", S.get("shape") === "round" ? "round" : "square");
  var wantXyz = S.get("coords") !== false, wantBio = S.get("biome") === true;
  xyzEl.style.display = wantXyz ? "" : "none"; bioEl.style.display = wantBio ? "" : "none"; infoEl.style.display = wantXyz || wantBio ? "" : "none";
  dpr = Math.min(2, window.devicePixelRatio || 1);
  var px = Math.max(40, Math.round((size - 2) * dpr));
  if (cv.width !== px) { cv.width = px; cv.height = px; }
  SZ = px;
  try { fontFam = getComputedStyle(root).fontFamily || "sans-serif"; } catch (e) { fontFam = "sans-serif"; }
  var tc = root.style.getPropertyValue("--hk-c").trim();               // the text colour of the Appearance settings (kit.look)
  textColor = /^#[0-9a-f]{3,8}$/i.test(tc) ? tc : "#ffffff";
  compKey = "";
}
S.onChange(function () { layout(); });
layout();

function zoomBy(d) {
  var z = num("zoom", 1.5), i = 0, best = 1e9, k;
  for (k = 0; k < ZOOMS.length; k++) { var dd = Math.abs(ZOOMS[k] - z); if (dd < best) { best = dd; i = k; } }
  i = Math.max(0, Math.min(ZOOMS.length - 1, i + d));
  S.set("zoom", ZOOMS[i]);
  flashText = ZOOMS[i] + "x"; flashUntil = performance.now() + 1100;
}

/* ---------- where we are ---------- */
function me() {                                                 // { x, y, z, heading (0 north, 90 east), fov } or null
  var cam = api.game.cam, st = api.player.state, p = st && st.pos, fresh = !!p && api.net.active && performance.now() - p.at < 4000, x, y, z, yaw;
  if (fresh) {
    x = p.x; y = p.y; z = p.z; yaw = cam ? cam.yaw : p.yaw;
    if (cam && Math.abs(cam.x - x) < 0.8 && Math.abs(cam.z - z) < 0.8) { x = cam.x; z = cam.z; }       // the camera moves smoothly between the ticks
  } else if (cam) { x = cam.x; y = cam.y - 1.62; z = cam.z; yaw = cam.yaw; }
  else return null;
  if (!isFinite(x + y + z + yaw)) return null;
  var fov = 80;
  if (cam && cam.fov && cam.aspect) fov = Math.max(40, Math.min(150, 2 * Math.atan(Math.tan(cam.fov * DEG / 2) * cam.aspect) / DEG));
  return { x: x, y: y, z: z, heading: (((yaw + 180) % 360) + 360) % 360, fov: fov };
}

/* are you deep below the ground? the highest solid block above your head decides (leaves and glass are not a roof) */
function checkUnderground(p) {
  var x = Math.floor(p.x), z = Math.floor(p.z), eye = Math.floor(p.y + 1.6), top = W.minY + W.height - 1, y, s, roof = null;
  for (y = top; y > eye; y--) {
    s = W.getState(x, y, z);
    if (s < 0) return underground;                              // not loaded: keep what we thought
    if ((KIND[s] || classify(s)) === 2) { roof = y; break; }
  }
  if (roof === null) return false;
  var up = roof - eye;
  return underground ? up > 4 : up >= 8;
}

/* ---------- the ground picture: every tile around you in one raster, shaded in one go ---------- */
function ensureGround(span) {
  var R = span * 0.7072 + 3, n = Math.ceil((2 * R + 24) / 16) * 16;
  if ((n >> 4) % 2) n += 16;                                    // an even number of chunks: the middle is a chunk corner
  if (n === G) return;
  G = n; gcv.width = G; gcv.height = G;
  gc32 = new Uint32Array(G * G); gh16 = new Int16Array(G * G);
  gimg = gctx.createImageData(G, G); gimg32 = new Uint32Array(gimg.data.buffer);
  anchored = false; composeDirty = true; planDirty = true; compKey = "";
}
function anchor(px, pz, span) {                                // the raster is centred on a chunk corner near you and only moves, by whole chunks, when you get near its edge
  var R = span * 0.7072 + 3, cxm = gox + G / 2, czm = goz + G / 2, slack = G / 2 - R - 1;
  if (anchored && Math.abs(px - cxm) <= slack && Math.abs(pz - czm) <= slack) return;
  var ngx = Math.round(px / 16) * 16 - G / 2, ngz = Math.round(pz / 16) * 16 - G / 2;
  anchored = true;
  if (ngx !== gox || ngz !== goz) { gox = ngx; goz = ngz; composeDirty = true; planDirty = true; }
}

function compose(map) {
  var n = G >> 4, c0x = gox >> 4, c0z = goz >> 4, tx, tz, t, r, o, j, src;
  gc32.fill(0); gh16.fill(MINH);
  for (tz = 0; tz < n; tz++) for (tx = 0; tx < n; tx++) {
    t = map.get(key(c0x + tx, c0z + tz));
    if (!t || !t.has) continue;
    for (r = 0; r < 16; r++) {
      o = (tz * 16 + r) * G + tx * 16; src = r * 16;
      for (j = 0; j < 16; j++) { gc32[o + j] = t.c[src + j]; gh16[o + j] = t.h[src + j]; }
    }
  }
}

/* colours -> pixels: brightness, and light from the north west on the slopes (the heights of the neighbours) */
function shade() {
  var relief = num("relief", 60) / 100 * 0.06, bright = num("bright", 115) / 100, x, z, i, c, h0, hl, hr, hu, hd, d, f, r, g, b;
  if (S.get("relief") === 0) relief = 0;
  for (z = 0; z < G; z++) {
    for (x = 0; x < G; x++) {
      i = z * G + x; c = gc32[i];
      if (!c) { gimg32[i] = 0; continue; }
      h0 = gh16[i];
      hl = x > 0 ? gh16[i - 1] : MINH; hr = x < G - 1 ? gh16[i + 1] : MINH; hu = z > 0 ? gh16[i - G] : MINH; hd = z < G - 1 ? gh16[i + G] : MINH;
      if (hl === MINH) hl = h0; if (hr === MINH) hr = h0; if (hu === MINH) hu = h0; if (hd === MINH) hd = h0;
      d = (hr - hl) + (hd - hu);                                // positive: the ground rises to the south east, so it faces the light
      if (d > 8) d = 8; else if (d < -8) d = -8;
      f = bright * (1 + relief * d);
      r = (c & 255) * f; g = ((c >>> 8) & 255) * f; b = ((c >>> 16) & 255) * f;
      gimg32[i] = (0xff000000 | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r)) >>> 0;
    }
  }
  gctx.putImageData(gimg, 0, 0);
}

/* ---------- a made-up landscape for when you are not in a world (the picture on the settings page) ---------- */
function hash2(x, z) { var n = (x * 374761393 + z * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, z) {
  var xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  var a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) { return vnoise(x, z) * 0.55 + vnoise(x * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, z * 4.3) * 0.15; }
function demoGround() {
  var x, z, i, n, wx, wz, col, hh, grass = [GRASS[0] * 147 / 255, GRASS[1] * 147 / 255, GRASS[2] * 147 / 255], leaf = [FOLIAGE[0] * 144 / 255, FOLIAGE[1] * 144 / 255, FOLIAGE[2] * 144 / 255], k, wob;
  for (z = 0; z < G; z++) for (x = 0; x < G; x++) {
    i = z * G + x; wx = gox + x; wz = goz + z;
    n = fbm(wx * 0.03, wz * 0.03); wob = hash2(wx, wz) * 0.12;
    if (n < 0.43) {                                             // water, deeper further from the shore
      k = Math.min(1, (0.43 - n) * 9); col = [219 * (1 - k) + WATER[0] * k * 0.8, 207 * (1 - k) + WATER[1] * k * 0.8, 163 * (1 - k) + WATER[2] * k * 0.8]; hh = 62;
    } else if (n < 0.46) { col = [219, 207, 163]; hh = 63; }
    else if (n < 0.64) { col = grass; hh = 64 + Math.round((n - 0.46) * 30); }
    else if (n < 0.76) { col = wob > 0.07 ? leaf : grass; hh = 66 + Math.round((n - 0.46) * 30) + (wob > 0.07 ? 4 : 0); }
    else if (n < 0.84) { col = [125, 125, 125]; hh = 74 + Math.round((n - 0.6) * 50); }
    else { col = [249, 254, 254]; hh = 84 + Math.round((n - 0.6) * 50); }
    gc32[i] = pack(col[0], col[1], col[2]); gh16[i] = hh;
  }
}

/* ---------- entities and waypoints ---------- */
function words(list) { var o = {}; list.split(" ").forEach(function (n) { o[n] = 1; }); return o; }
var HOSTILE = words("zombie zombie_villager husk drowned zombified_piglin piglin_brute skeleton stray bogged wither_skeleton creeper spider cave_spider enderman endermite silverfish slime magma_cube ghast blaze witch pillager vindicator evoker illusioner ravager vex hoglin zoglin phantom guardian elder_guardian shulker warden breeze creaking ender_dragon wither giant");
var NOT_MOBS = words("area_effect_cloud arrow spectral_arrow trident fireball small_fireball dragon_fireball wither_skull snowball egg ender_pearl eye_of_ender experience_bottle experience_orb splash_potion lingering_potion firework_rocket fishing_bobber wind_charge breeze_wind_charge llama_spit shulker_bullet item_frame glow_item_frame painting armor_stand evoker_fangs marker interaction lightning_bolt falling_block tnt end_crystal leash_knot mannequin");
var catCache = {};
function catOf(name) {                                          // 0 not drawn, 1 player, 2 hostile, 3 animal / villager / golem, 4 dropped item
  var c = catCache[name];
  if (c !== undefined) return c;
  if (name === "player") c = 1;
  else if (HOSTILE[name]) c = 2;
  else if (name === "item") c = 4;
  else if (NOT_MOBS[name] || /(boat|raft|minecart|_display|_projectile)$/.test(name)) c = 0;
  else c = 3;
  return (catCache[name] = c);
}
var CAT_COLOR = ["", "#ffffff", "#ff4d4d", "#7dffb2", "#ffd34d"], CAT_R = [0, 3.4, 3, 2.7, 1.8];

function wsTarget(url) {
  if (!url) return "";
  try { var u = new URL(url), t = u.searchParams.get("target"); return t || u.host; } catch (e) { return ""; }
}
function worldKey() {                                           // the same key the Waypoints mod files its waypoints under
  var ses = api.session();
  if (ses.address) return "srv:" + ses.address;
  var w = window.OneClient && OneClient.world;
  if (api.net.transport === "singleplayer") return "sp:" + (w && w.seed ? w.seed : "unknown");
  return "srv:" + (wsTarget(window.OneClient && OneClient.net && OneClient.net.wsUrl) || "unknown");
}
var wpCache = [], wpAt = 0;
function waypoints() {
  var now = performance.now();
  if (now - wpAt < 1000) return wpCache;
  wpAt = now; wpCache = [];
  try {
    var L = window.OneClient && OneClient.loader, inf = L && L.info("oc-waypoints");
    if (inf && inf.active && S.get("waypoints") !== false) {
      var raw = localStorage.getItem("oneclient.mod.oc-waypoints.wp"), all = raw ? JSON.parse(raw) : {}, list = all[worldKey()] || [], dim = W.dim || "";
      list.forEach(function (w) { if (w && w.on !== false && isFinite(w.x + w.z) && (!w.dim || !dim || w.dim === dim)) wpCache.push(w); });
    }
  } catch (e) { wpCache = []; }
  return wpCache;
}

/* ---------- drawing ---------- */
function outlineText(text, x, y, color, size) {
  ctx.font = "700 " + Math.round(size * dpr) + "px " + fontFam;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function letter(text, x, y, bg) {                               // a small letter on a coloured shape: black or white, whichever reads better
  var n = parseInt(bg.slice(1), 16), lum = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  ctx.font = "800 " + Math.round(8.5 * dpr) + "px " + fontFam;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = lum > 0.55 ? "rgba(0,0,0,.85)" : "#ffffff"; ctx.fillText(text, x, y);
}
function edgePoint(vx, vy, m) {                                 // the point on the map's edge (inset by m) in direction (vx, vy) from the middle
  var h = SZ / 2 - m, len = Math.sqrt(vx * vx + vy * vy) || 1, k;
  vx /= len; vy /= len;
  k = S.get("shape") === "round" ? h : h / Math.max(Math.abs(vx), Math.abs(vy));
  return [SZ / 2 + vx * k, SZ / 2 + vy * k];
}
function arrow(x, y, ang, size, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.78, size * 0.9); ctx.lineTo(0, size * 0.42); ctx.lineTo(-size * 0.78, size * 0.9); ctx.closePath();
  ctx.lineJoin = "round"; ctx.lineWidth = 1.6 * dpr; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.stroke();
  ctx.fillStyle = fill; ctx.fill();
  ctx.restore();
}

function draw(p, span, rot, live) {
  var s = SZ / span, a = rot ? -p.heading * DEG : 0, cos = Math.cos(a), sin = Math.sin(a), mid = SZ / 2, r2 = (span / 2) * (span / 2) * 1.0, round = S.get("shape") === "round", i, e, w, dx, dz, X, Y, sx, sy, c;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SZ, SZ);

  /* the ground */
  ctx.save();
  ctx.translate(mid, mid); ctx.rotate(a); ctx.scale(s, s);
  ctx.imageSmoothingEnabled = s < 2.5; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(gcv, gox - p.x, goz - p.z);
  if (S.get("grid") === true && live) {
    var x0 = Math.floor((p.x - span) / 16) * 16, z0 = Math.floor((p.z - span) / 16) * 16, q;
    ctx.beginPath();
    for (q = x0; q <= p.x + span; q += 16) { ctx.moveTo(q - p.x, -span); ctx.lineTo(q - p.x, span); }
    for (q = z0; q <= p.z + span; q += 16) { ctx.moveTo(-span, q - p.z); ctx.lineTo(span, q - p.z); }
    ctx.lineWidth = 2 * dpr / s; ctx.strokeStyle = "rgba(255,255,255,.16)"; ctx.stroke();
    ctx.lineWidth = dpr / s; ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.stroke();
  }
  ctx.restore();

  /* view cone */
  if (S.get("cone") !== false) {
    var ang = rot ? 0 : p.heading * DEG, half = p.fov * DEG / 2, rad = SZ * 0.36, grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, rad);
    grad.addColorStop(0, "rgba(255,255,255,.30)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath(); ctx.moveTo(mid, mid); ctx.arc(mid, mid, rad, ang - Math.PI / 2 - half, ang - Math.PI / 2 + half); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
  }

  /* waypoints (as a diamond with the first letter, at the edge when too far) and mobs */
  if (live) {
    var wl = waypoints(), lim = span / 2;
    for (i = 0; i < wl.length; i++) {
      w = wl[i]; dx = w.x + 0.5 - p.x; dz = w.z + 0.5 - p.z;
      X = dx * cos - dz * sin; Y = dx * sin + dz * cos;
      sx = mid + X * s; sy = mid + Y * s;
      var out = round ? (X * X + Y * Y > lim * lim * 0.86) : (Math.abs(X) > lim * 0.92 || Math.abs(Y) > lim * 0.92);
      if (out) { var ep = edgePoint(X, Y, 9 * dpr); sx = ep[0]; sy = ep[1]; }
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.PI / 4);
      ctx.globalAlpha = out ? 0.7 : 1;
      var rr = 5.2 * dpr;
      var wcol = /^#[0-9a-f]{6}$/i.test(w.color || "") ? w.color : "#ffe27a";
      ctx.fillStyle = wcol;
      ctx.fillRect(-rr, -rr, rr * 2, rr * 2); ctx.lineWidth = 1.4 * dpr; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.strokeRect(-rr, -rr, rr * 2, rr * 2);
      ctx.restore();
      if (w.name) letter(String(w.name).charAt(0).toUpperCase(), sx, sy + 0.5 * dpr, wcol);
    }
    var want = [false, S.get("players") !== false, S.get("hostile") !== false, S.get("friendly") !== false, S.get("items") === true], self = api.player.state ? api.player.state.entityId : -1;
    for (i = 0; i < ents.length; i++) {
      e = ents[i]; c = catOf(e.name);
      if (!c || !want[c] || e.id === self) continue;
      dx = e.x - p.x; dz = e.z - p.z;
      if (!(dx * dx + dz * dz <= r2 * 2.2)) continue;
      X = dx * cos - dz * sin; Y = dx * sin + dz * cos;
      if (round ? X * X + Y * Y > r2 : (Math.abs(X) > span / 2 || Math.abs(Y) > span / 2)) continue;
      ctx.globalAlpha = Math.abs(e.y - p.y) > 8 ? 0.5 : 1;
      ctx.beginPath(); ctx.arc(mid + X * s, mid + Y * s, CAT_R[c] * dpr, 0, 6.2832);
      ctx.fillStyle = CAT_COLOR[c]; ctx.fill(); ctx.lineWidth = 1.1 * dpr; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* you */
  arrow(mid, mid, rot ? 0 : p.heading * DEG, 6.2 * dpr, "#ffffff");

  /* compass letters: where north (and the others) are, at the edge */
  if (S.get("compass") !== false) {
    var dirs = [["N", sin, -cos, "#ff8f8f"], ["E", cos, sin, textColor], ["S", -sin, cos, textColor], ["W", -cos, -sin, textColor]];
    for (i = 0; i < 4; i++) { var ep2 = edgePoint(dirs[i][1], dirs[i][2], 9 * dpr); outlineText(dirs[i][0], ep2[0], ep2[1], dirs[i][3], i === 0 ? 11.5 : 10); }
  }
  if (useCave && live) outlineText("CAVE", mid, 23 * dpr, "rgba(255,255,255,.8)", 9);                   // below the row of compass letters
  if (performance.now() < flashUntil) outlineText(flashText, mid, SZ - 23 * dpr, "#ffffff", 11);
}

function placeholder(text) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SZ, SZ);
  var lines = text.split("\n"), i;
  for (i = 0; i < lines.length; i++) outlineText(lines[i], SZ / 2, SZ / 2 + (i - (lines.length - 1) / 2) * 15 * dpr, "rgba(255,255,255,.85)", 11);
}

/* ---------- every frame ---------- */
function tick() {
  var now = performance.now(), inWorld = api.game.inWorld, want = S.get("show") !== false;
  if (!laidOut && root.isConnected) { laidOut = true; layout(); }
  widget.visible(want && inWorld);
  if (!want) return;
  var zoom = num("zoom", 1.5), span = Math.min(256, BASE_SPAN / zoom), rot = S.get("rotate") !== false;
  depthOn = S.get("depth") !== false;

  if (!inWorld) {                                               // the menus: a made-up landscape, drawn only now and then (the widget shows while you place it)
    if (now - lastDemo < 400) return;
    lastDemo = now; demoOn = true;
    ensureGround(span); gox = -G / 2; goz = -G / 2;
    demoGround(); shade();
    draw({ x: 0, y: 64, z: 0, heading: 0, fov: 80 }, span, false, false);
    xyzEl.textContent = "X 0   Y 64   Z 0"; bioEl.textContent = "Plains";
    return;
  }
  if (demoOn) { demoOn = false; compKey = ""; composeDirty = true; G = 0; }
  if (!W.ready) { if (now - lastDraw > 500) { lastDraw = now; placeholder(api.net.active ? "Loading the map..." : "No map data\nfrom this server"); xyzEl.textContent = ""; bioEl.textContent = ""; } return; }
  var p = me();
  if (!p) return;

  /* which view */
  var view = S.get("view");
  if (now - lastAuto > 250) { lastAuto = now; underground = view === "auto" ? checkUnderground(p) : false; }
  var cave = view === "cave" || (view === "auto" && underground), ys = Math.floor(p.y + 1);
  if (cave !== useCave) { useCave = cave; composeDirty = true; planDirty = true; compKey = ""; queue = []; qi = 0; caveY = ys; }
  if (cave && Math.abs(ys - caveY) >= 2) { caveY = ys; planDirty = true; }

  /* the ground raster around you, and the chunks that still need their map */
  ensureGround(span);
  anchor(p.x, p.z, span);
  if ((planDirty && qi >= queue.length) || now - lastPlan > 300) { planDirty = false; lastPlan = now; plan(p); }
  var did = work(useCave ? 6 : 4);
  if (did) composeDirty = true;
  var ck = S.get("relief") + "/" + S.get("bright") + "/" + S.get("depth") + "/" + useCave;
  if (ck !== compKey) { compKey = ck; composeDirty = true; }
  if (composeDirty && (did === 0 || now - lastCompose > 100)) { composeDirty = false; lastCompose = now; compose(useCave ? caves : surf); shade(); }

  if (now - lastEnts > 200) { lastEnts = now; ents = api.entities.list(); if (ents.length > 400) ents.length = 400; }
  if (now - lastDraw >= 14) { lastDraw = now; draw(p, span, rot, true); }

  if (now - lastInfo > 100) {
    lastInfo = now;
    if (S.get("coords") !== false) xyzEl.textContent = "X " + Math.floor(p.x) + "   Y " + Math.floor(p.y) + "   Z " + Math.floor(p.z);
    if (S.get("biome") === true) bioEl.textContent = fmt.title(W.biomeAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) || "-");
  }
}

/* the chunks of the ground raster whose map is missing or out of date, nearest first */
function plan(p) {
  var map = useCave ? caves : surf, n = G >> 4, c0x = gox >> 4, c0z = goz >> 4, tx, tz, cx, cz, t, k, list = [], pcx = p.x / 16 - 0.5, pcz = p.z / 16 - 0.5;
  for (tz = 0; tz < n; tz++) for (tx = 0; tx < n; tx++) {
    cx = c0x + tx; cz = c0z + tz;
    if (!W.isLoaded(cx, cz)) continue;
    k = key(cx, cz); t = map.get(k);
    if (!t) { t = new Tile(cx, cz); map.set(k, t); }
    else if (!t.stale && t.ver === W.chunkVersion(cx, cz) && (!useCave || t.ys === caveY)) continue;
    t.d = (cx - pcx) * (cx - pcx) + (cz - pcz) * (cz - pcz);
    list.push(t);
  }
  list.sort(function (a, b) { return a.d - b.d; });
  queue = list; qi = 0;
  if (surf.size > 6000) trim(surf, pcx, pcz);                   // remembered ground of chunks that are gone: the farthest go first
  if (caves.size > 1500) trim(caves, pcx, pcz);
}
function trim(map, pcx, pcz) {
  var all = [];
  map.forEach(function (t, k) { all.push([(t.cx - pcx) * (t.cx - pcx) + (t.cz - pcz) * (t.cz - pcz), k]); });
  all.sort(function (a, b) { return b[0] - a[0]; });
  for (var i = 0; i < 1000 && i < all.length; i++) map.delete(all[i][1]);
}
function work(budget) {
  var t0 = performance.now(), did = 0, t, ver;
  while (qi < queue.length && performance.now() - t0 < budget) {
    t = queue[qi++];
    ver = W.chunkVersion(t.cx, t.cz);
    if (ver < 0) continue;
    scan(t, useCave ? caveY : null);
    t.ver = ver; t.stale = false; t.ys = caveY;
    did++;
  }
  return did;
}

api.events.on("frame", tick);
api.every(250, function () { if (!api.game.inWorld) tick(); });         // the menus may not draw a frame the hook sees: the made-up landscape still wants its picture
