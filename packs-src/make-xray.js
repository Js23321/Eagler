/* Writes the "OneClient X-Ray" resource pack into packs-src/OneClient X-Ray/ (node packs-src/make-xray.js).
 *
 * An original pack: it contains no texture of anybody else. It only says what the game should do with its own blocks:
 *   - the common ground (stone, dirt, grass, sand, gravel, deepslate, netherrack ...) and the wild plants on it get an empty model, so nothing is drawn;
 *   - ores, ancient debris, spawners, vaults ... keep the game's own model, but their faces are never skipped when a neighbour covers them
 *     ("cullface" removed) and they glow at full brightness, so they show through the ground, in the dark, without any other mod.
 * The block list and the models come from the game's own assets (the base page), so the pack follows the game version: rerun this script after the
 * base page changes. Items are not touched (only blockstates are replaced), so hotbar and inventory pictures stay as they are. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const BASE = process.argv[2] || path.join(ROOT, 'eaglercraft-26.2-zeus-skins.html');
const OUT = path.join(__dirname, 'OneClient X-Ray');

/* ---------- the game's asset pack inside the base page (EPK v2: one gzip stream of FILE entries), same reader as build.js ---------- */
function readEpkAll(page) {
  const out = new Map();
  let i = page.indexOf('id="eag-inline-assets"');
  if (i < 0) throw new Error('the base page has no inline asset pack');
  i = page.indexOf('>', i) + 1;
  const b = Buffer.from(page.slice(i, page.indexOf('</script>', i)).replace(/\s+/g, ''), 'base64');
  if (b.toString('latin1', 0, 8) !== 'EAGPKG$$') throw new Error('the inline asset pack is not an EPK');
  let p = 8; p += 1 + b[p]; p += 1 + b[p]; p += 2 + b.readUInt16BE(p); p += 12;
  if (String.fromCharCode(b[p++]) !== 'G') throw new Error('unexpected EPK compression');
  const data = zlib.inflateRawSync(b.subarray(p + 10));
  for (let q = data.indexOf('FILE'); q >= 0 && q + 5 < data.length;) {
    const nl = data[q + 4], name = data.toString('latin1', q + 5, q + 5 + nl), at = q + 5 + nl;
    const start = at + 8, end = start + data.readUInt32BE(at) - 5;
    out.set(name, data.subarray(start, end));
    q = data.indexOf('FILE', end);
  }
  return out;
}
const all = readEpkAll(fs.readFileSync(BASE, 'latin1'));
const J = (n) => { const d = all.get(n); return d ? JSON.parse(Buffer.from(d).toString('utf8')) : null; };
const blocks = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'client/blocks26.json'), 'utf8')).blocks.map((b) => b[0]));
const has = (n) => blocks.has(n);

function tagSet(tag, seen) {                                      // a block tag as a set of bare names (tags inside tags resolved)
  const set = new Set(); seen = seen || new Set();
  if (seen.has(tag)) return set;
  seen.add(tag);
  const j = J('data/minecraft/tags/block/' + tag + '.json');
  for (const v of (j && j.values) || []) {
    const id = typeof v === 'string' ? v : v.id;
    if (id[0] === '#') tagSet(id.slice(1).replace(/^minecraft:/, ''), seen).forEach((x) => set.add(x)); else set.add(id.replace(/^minecraft:/, ''));
  }
  return set;
}

/* ---------- what disappears, what shows ---------- */
const TERRAIN = ['stone', 'granite', 'diorite', 'andesite', 'deepslate', 'tuff', 'calcite', 'dripstone_block', 'smooth_basalt', 'basalt', 'blackstone',
  'netherrack', 'end_stone', 'dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium', 'dirt_path', 'gravel', 'sand', 'red_sand', 'clay',
  'mud', 'moss_block', 'pale_moss_block', 'snow', 'snow_block', 'powder_snow', 'ice', 'packed_ice', 'sandstone', 'red_sandstone', 'soul_sand', 'soul_soil',
  'crimson_nylium', 'warped_nylium', 'sculk', 'sulfur', 'potent_sulfur', 'cinnabar', 'terracotta'];
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
COLORS.forEach((c) => TERRAIN.push(c + '_terracotta'));
const PLANTS = ['short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'bush', 'short_dry_grass', 'tall_dry_grass', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant',
  'sugar_cane', 'leaf_litter', 'pink_petals', 'wildflowers', 'glow_lichen', 'moss_carpet', 'pale_moss_carpet', 'sunflower', 'lilac', 'rose_bush', 'peony',
  'brown_mushroom', 'red_mushroom', 'lily_pad'];
tagSet('small_flowers').forEach((n) => PLANTS.push(n));
const HIDE = TERRAIN.concat(PLANTS).filter(has);

/* shown through everything: the ores of both worlds, ancient debris, gilded blackstone, the raw blocks of the big ore veins, spawners, trial chamber blocks */
const SHOW = [...blocks].filter((n) => /_ore$/.test(n) || /^(ancient_debris|gilded_blackstone|raw_iron_block|raw_copper_block|raw_gold_block|spawner|trial_spawner|vault|budding_amethyst)$/.test(n));

/* ---------- models: the game's own, flattened, never culled, glowing ---------- */
function flatten(id) {
  const textures = {};
  let elements = null, cur = id.replace(/^minecraft:/, '');
  for (let i = 0; i < 12 && cur; i++) {
    const j = J('assets/minecraft/models/' + cur + '.json');
    if (!j) break;
    for (const k in (j.textures || {})) if (!(k in textures)) textures[k] = j.textures[k];
    if (!elements && j.elements) elements = j.elements;
    cur = j.parent ? j.parent.replace(/^minecraft:/, '') : null;
  }
  if (!elements) return null;
  const lit = elements.map((e) => {
    const c = JSON.parse(JSON.stringify(e));
    for (const f in c.faces) delete c.faces[f].cullface;           // drawn even when a block in front of the face would hide it
    c.shade = false; c.light_emission = 15;                        // flat and fully lit: dark rock around it does not darken it
    return c;
  });
  return { ambientocclusion: false, textures, elements: lit };
}
const written = new Map();                                         // flattened model name -> true
function litModel(id) {                                            // "minecraft:block/diamond_ore" -> the id of its X-Ray twin
  const base = id.replace(/^minecraft:/, '').replace(/^block\//, '').replace(/\//g, '_'), name = 'xray/' + base;
  if (!written.has(name)) {
    const m = flatten(id);
    if (!m) return id;                                             // no elements to light (should not happen for a block): keep the game's model
    write('assets/minecraft/models/block/' + name + '.json', JSON.stringify(m, null, 1));
    written.set(name, true);
  }
  return 'minecraft:block/' + name;
}
function mapApply(a) {
  if (Array.isArray(a)) return a.map(mapApply);
  const c = Object.assign({}, a);
  if (c.model) c.model = litModel(c.model);
  return c;
}
function litBlockstate(name) {
  const bs = J('assets/minecraft/blockstates/' + name + '.json');
  if (!bs) return null;
  const out = {};
  if (bs.variants) { out.variants = {}; for (const k of Object.keys(bs.variants)) out.variants[k] = mapApply(bs.variants[k]); }
  if (bs.multipart) out.multipart = bs.multipart.map((p) => Object.assign({}, p, { apply: mapApply(p.apply) }));
  return out;
}

/* ---------- writing ---------- */
function write(rel, data) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
}
fs.rmSync(OUT, { recursive: true, force: true });

write('assets/minecraft/models/block/xray/hidden.json', JSON.stringify({ textures: { particle: 'minecraft:block/stone' } }, null, 1));
for (const n of HIDE) write('assets/minecraft/blockstates/' + n + '.json', JSON.stringify({ multipart: [{ apply: { model: 'minecraft:block/xray/hidden' } }] }, null, 1));
let lit = 0;
for (const n of SHOW) { const bs = litBlockstate(n); if (bs) { write('assets/minecraft/blockstates/' + n + '.json', JSON.stringify(bs, null, 1)); lit++; } }

write('pack.mcmeta', JSON.stringify({
  pack: {
    min_format: [88, 0], max_format: [88, 0],
    description: [{ text: 'OneClient ', color: '#9cd0ff', bold: true }, { text: 'X-Ray', color: '#ffffff', bold: true }, { text: '\nHides the ground, ores glow through it', color: 'gray' }]
  }
}, null, 1));
write('README.txt', [
  'OneClient X-Ray',
  '',
  'Switch it on in Options > Resource Packs when you want it, and off again when you do not. It is never switched on by itself.',
  '',
  'What it does: stone, dirt, grass, sand, gravel, deepslate, netherrack and the other common ground (and the wild plants on it) are not drawn at all.',
  'Ores, ancient debris, spawners and the trial chamber blocks are drawn at full brightness and are never hidden by the blocks around them.',
  'Water, lava, trees, planks, chests and everything people built stay as they are.',
  '',
  'Servers: most multiplayer servers do not allow X-ray. Use it in your own worlds, or where the rules say it is fine.',
  '',
  'This pack is original: it holds no texture from any other pack, only block model files that point at the game\'s own textures.',
  'It is made by packs-src/make-xray.js of OneClient from the game\'s own block list, so it can be rebuilt for a newer game version.',
  ''
].join('\n'));

/* pack.png: a dark grid with a few glowing ores */
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
(function icon() {
  const S = 64, px = Buffer.alloc(S * S * 4), ores = [[14, 15, [77, 232, 224]], [42, 11, [255, 211, 77]], [30, 34, [255, 77, 77]], [11, 47, [77, 255, 122]], [47, 46, [96, 120, 255]]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let r = 16, g = 19, b = 26;
    if (x % 8 === 0 || y % 8 === 0) { r += 9; g += 10; b += 14; }
    for (const [ox, oy, c] of ores) {
      const dx = x - ox, dy = y - oy, cube = Math.max(Math.abs(dx), Math.abs(dy)) <= 4, halo = Math.exp(-(dx * dx + dy * dy) / 70);
      if (cube) { const edge = Math.max(Math.abs(dx), Math.abs(dy)) === 4; r = c[0] * (edge ? 0.7 : 1); g = c[1] * (edge ? 0.7 : 1); b = c[2] * (edge ? 0.7 : 1); }
      else { r += c[0] * halo * 0.45; g += c[1] * halo * 0.45; b += c[2] * halo * 0.45; }
    }
    px.set([Math.min(255, r), Math.min(255, g), Math.min(255, b), 255], (y * S + x) * 4);
  }
  write('pack.png', png(S, S, px));
})();

console.log('OneClient X-Ray: hides ' + HIDE.length + ' blocks, lights ' + lit + ' blocks (' + written.size + ' models) ->', OUT);
