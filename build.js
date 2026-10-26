// OneClient build script.
//   node build.js                 -> OneClient-26.2.html  (base game + client + default packs)
//   node build.js --no-pack       -> same, without any bundled resource packs
//   node build.js --shim          -> OneClient-test.html with a pointer-lock simulator (testing only)
//   node build.js --base=other.html --out=Other.html
//   node build.js --client-id=<Application (client) ID>   -> the Java-account sign-in comes with that Azure app (env ONECLIENT_CLIENT_ID works too), so players only press Sign in
// Bundled packs are listed in client/packs.json: { "file": "x.zip" } or { "dir": "folder", "name": "Pack" }; "enabled": false installs a pack without switching it on.
// The mods are injected at the very top of <head> so they run before the game does.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const args = process.argv.slice(2);
const flag = (k) => args.includes('--' + k);
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };

const BASE = opt('base') || 'eaglercraft-26.2-zeus-skins.html';
const OUT = opt('out') || (flag('shim') ? 'OneClient-test.html' : 'OneClient-26.2.html');
const abs = (f) => (path.isAbsolute(f) ? f : path.join(ROOT, f));
const read = (f) => fs.readFileSync(abs(f), 'utf8');

/* The Azure app (client ID) the Java-account sign-in uses. Minecraft's servers only accept apps that Mojang approved (https://aka.ms/mce-reviewappid), and
 * every client that signs you in with one click carries the ID of an app its own author registered. Nothing is bundled here: pass the ID of YOUR app. */
const MS_CLIENT = (opt('client-id') || process.env.ONECLIENT_CLIENT_ID || '').trim().toLowerCase();
if (MS_CLIENT && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(MS_CLIENT)) {
  console.error('--client-id has to be the Application (client) ID of an Azure app: 36 letters and digits with dashes, like 11111111-2222-3333-4444-555555555555');
  process.exit(1);
}

/* ---------- tiny PNG + ZIP writers (no dependencies) ---------- */
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

function packIcon() {                       // 128x128: rounded gradient square with a white ring
  const S = 128, px = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cx = x + 0.5 - S / 2, cy = y + 0.5 - S / 2;
    const q = Math.hypot(Math.max(Math.abs(cx) - (S / 2 - 22), 0), Math.max(Math.abs(cy) - (S / 2 - 22), 0)) - 22;   // rounded-box distance
    const a = Math.min(1, Math.max(0, 0.5 - q));
    const t = (x + y) / (2 * S);
    let r = 156 + (95 - 156) * t, g = 208 + (123 - 208) * t, b = 255;
    const d = Math.hypot(cx, cy), ring = Math.max(0, 1 - Math.abs(d - 32) / 7.5), dot = Math.max(0, Math.min(1, 9.5 - d));
    const w = Math.min(1, ring + dot);
    r += (255 - r) * w; g += (255 - g) * w; b += (255 - b) * w;
    px.set([r, g, b, 255 * a], (y * S + x) * 4);
  }
  return png(S, S, px);
}

function zipFiles(entries) {                // entries: [{ name, data }] -> zip Buffer (deterministic)
  const parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), crc = zlib.crc32(e.data) >>> 0;
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const method = deflated.length < e.data.length ? 8 : 0, body = method ? deflated : e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* Screen markers: a 2x2-pixel glyph (two near-black colours side by side) appended to a screen's title
 * through the game's language file + a private-use font glyph (both baked into the game's assets, see patchEpk). detect.js finds it in the rendered frame. */
const markers = fs.existsSync(abs('client/markers.json')) ? JSON.parse(read('client/markers.json')) : [];
markers.forEach((m) => { if (!m.keys) m.keys = { [m.key]: m.text || '' }; });      // { "lang key": "original text" }: every key of a marker gets the same glyph
const markerChar = (i) => String.fromCodePoint(0xF0000 + i);                    // plane-15 private use: no other font uses it
const markerText = (m, i, text) => m.prefix ? markerChar(i) + text : text + markerChar(i);       // "prefix": the glyph comes before the text (a toast at the top right cannot cover it there)
function markerFont() {
  const cell = 8, w = cell * markers.length, px = Buffer.alloc(w * cell * 4);
  markers.forEach((m, i) => [[0, m.a], [1, m.b]].forEach(([dx, c]) => [3, 4].forEach((y) => px.set([...(m.tint ? c.map((v) => Math.round(v * 255 / m.tint)) : c), 255], (y * w + i * cell + dx) * 4))));
  return {
    texture: png(w, cell, px),
    definition: JSON.stringify({ providers: [{ type: 'bitmap', file: 'minecraft:font/oneclient_markers.png', ascent: 7, height: 8, chars: [markers.map((m, i) => markerChar(i)).join('')] }] })
  };
}

function zipDirectory(dir, generated) {
  const out = (generated || []).slice();
  (function walk(d, rel) {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n), r = rel ? rel + '/' + n : n;
      if (!fs.statSync(p).isDirectory()) { if (!out.some((e) => e.name === r)) out.push({ name: r, data: fs.readFileSync(p) }); }
      else walk(p, r);
    }
  })(dir, '');
  if (!out.some((e) => e.name === 'pack.png')) out.push({ name: 'pack.png', data: packIcon() });
  return zipFiles(out);
}

/* ---------- the game's own asset pack (EPK v2 inside the page): every file, for mods that need vanilla assets ---------- */
let epkCache = null;
function readEpkAll(page) {
  if (epkCache) return epkCache;
  const out = new Map();
  let i = page.indexOf('id="eag-inline-assets"');
  if (i < 0) return (epkCache = out);
  i = page.indexOf('>', i) + 1;
  const b = Buffer.from(page.slice(i, page.indexOf('</script>', i)).replace(/\s+/g, ''), 'base64');
  if (b.toString('latin1', 0, 8) !== 'EAGPKG$$') return (epkCache = out);
  let p = 8; p += 1 + b[p]; p += 1 + b[p]; p += 2 + b.readUInt16BE(p); p += 12;
  if (String.fromCharCode(b[p++]) !== 'G' || b[p] !== 0x1f || b[p + 1] !== 0x8b || b[p + 3] !== 0) return (epkCache = out);
  const data = zlib.inflateRawSync(b.subarray(p + 10));
  for (let q = data.indexOf('FILE'); q >= 0 && q + 5 < data.length;) {
    const nl = data[q + 4], name = data.toString('latin1', q + 5, q + 5 + nl), at = q + 5 + nl;
    const start = at + 8, end = start + data.readUInt32BE(at) - 5;
    out.set(name, data.subarray(start, end));
    q = data.indexOf('FILE', end);
  }
  return (epkCache = out);
}
/* ---------- the game's own assets, edited: the OneClient screen markers live in them (no resource pack to see, switch off or lose) ----------
 * EPK v2: "EAGPKG$$", version, name, comment, 8 byte stamp, u32 entry count, "G", ONE gzip stream, ":::YEE:>". The stream is a list of
 *   HEAD <u8 name length> <name> <u32 value length> <value> ">"
 *   FILE <u8 name length> <name> <u32 length> <u32 crc32> <length - 5 bytes> ":>"
 * and ends with "END$". The page keeps it as base64 in <script id="eag-inline-assets" data-size="...">, and the same size is also written
 * into the bootstrap of the integrated server's worker, so both have to follow a change. Everything is checked while reading. */
function epkParse(page) {
  const idAt = page.indexOf('id="eag-inline-assets"');
  if (idAt < 0) throw new Error('the base page has no inline asset pack');
  const bodyStart = page.indexOf('>', idAt) + 1, bodyEnd = page.indexOf('</script>', bodyStart);
  const b = Buffer.from(page.slice(bodyStart, bodyEnd).replace(/\s+/g, ''), 'base64');
  if (b.toString('latin1', 0, 8) !== 'EAGPKG$$') throw new Error('the inline asset pack is not an EPK');
  let p = 8; p += 1 + b[p]; p += 1 + b[p]; p += 2 + b.readUInt16BE(p);
  const head = b.subarray(0, p), stamp = b.subarray(p, p + 8), count = b.readUInt32BE(p + 8);
  p += 12;
  if (String.fromCharCode(b[p++]) !== 'G') throw new Error('unexpected EPK compression');
  const gz = b.subarray(p);
  if (gz[0] !== 0x1f || gz[1] !== 0x8b || gz[3] !== 0 || gz.toString('latin1', gz.length - 8) !== ':::YEE:>') throw new Error('unexpected EPK container');
  const raw = zlib.inflateRawSync(gz.subarray(10, gz.length - 16));
  if (gz.readUInt32LE(gz.length - 16) !== (zlib.crc32(raw) >>> 0) || gz.readUInt32LE(gz.length - 12) !== raw.length) throw new Error('the EPK gzip trailer does not match');
  const entries = [];
  for (let q = 0;;) {
    const tag = raw.toString('latin1', q, q + 4);
    if (tag === 'END$') { if (q + 4 !== raw.length) throw new Error('data after the end of the EPK'); break; }
    const nl = raw[q + 4], name = raw.toString('latin1', q + 5, q + 5 + nl), at = q + 5 + nl;
    if (tag === 'HEAD') {
      const vl = raw.readUInt32BE(at);
      if (raw[at + 4 + vl] !== 0x3e) throw new Error('bad EPK header entry ' + name);
      entries.push({ tag, name, data: raw.subarray(at + 4, at + 4 + vl) }); q = at + 5 + vl;
    } else if (tag === 'FILE') {
      const len = raw.readUInt32BE(at), crc = raw.readUInt32BE(at + 4), data = raw.subarray(at + 8, at + 3 + len);
      if (raw[at + 3 + len] !== 0x3a || raw[at + 4 + len] !== 0x3e) throw new Error('bad EPK file entry ' + name);
      if ((zlib.crc32(data) >>> 0) !== crc) throw new Error('EPK checksum mismatch for ' + name);
      entries.push({ tag, name, data }); q = at + 5 + len;
    } else throw new Error('unknown EPK block "' + tag + '" at ' + q);
  }
  if (entries.length !== count) throw new Error('the EPK holds ' + entries.length + ' entries, its header says ' + count);
  return { idAt, bodyStart, bodyEnd, size: b.length, head, stamp, gzHead: gz.subarray(0, 10), entries, raw };
}
function epkRaw(entries) {
  const u32 = (n) => { const x = Buffer.alloc(4); x.writeUInt32BE(n >>> 0); return x; }, parts = [];
  for (const e of entries) {
    const nm = Buffer.from(e.name, 'latin1');
    if (e.tag === 'HEAD') parts.push(Buffer.from('HEAD'), Buffer.from([nm.length]), nm, u32(e.data.length), e.data, Buffer.from('>'));
    else parts.push(Buffer.from('FILE'), Buffer.from([nm.length]), nm, u32(e.data.length + 5), u32(zlib.crc32(e.data) >>> 0), e.data, Buffer.from(':>'));
  }
  parts.push(Buffer.from('END$'));
  return Buffer.concat(parts);
}
function epkPack(parsed, raw) {
  const trailer = Buffer.alloc(8), count = Buffer.alloc(4);
  trailer.writeUInt32LE(zlib.crc32(raw) >>> 0, 0); trailer.writeUInt32LE(raw.length >>> 0, 4);
  count.writeUInt32BE(parsed.entries.length);
  return Buffer.concat([parsed.head, parsed.stamp, count, Buffer.from('G'), parsed.gzHead, zlib.deflateRawSync(raw, { level: 9 }), trailer, Buffer.from(':::YEE:>')]);
}
/* edits: { 'path in the pack': (old Buffer | null) => new Buffer }; the page comes back with the changed pack (and its size) in place */
function patchEpk(page, edits) {
  const parsed = epkParse(page);
  if (!epkRaw(parsed.entries).equals(parsed.raw)) throw new Error('writing the EPK back does not give the same bytes: not touching the game assets');
  const byName = new Map(parsed.entries.map((e) => [e.name, e]));
  for (const name of Object.keys(edits)) {
    const e = byName.get(name), data = edits[name](e ? e.data : null);
    if (e) e.data = data; else { const n = { tag: 'FILE', name, data }; parsed.entries.push(n); byName.set(name, n); }
  }
  const packed = epkPack(parsed, epkRaw(parsed.entries));
  const tagStart = page.lastIndexOf('<script', parsed.idAt), oldSize = String(parsed.size);
  const tag = page.slice(tagStart, parsed.bodyStart).replace('data-size="' + oldSize + '"', 'data-size="' + packed.length + '"');
  if (tag === page.slice(tagStart, parsed.bodyStart)) throw new Error('the inline asset pack has no data-size of ' + oldSize);
  const tail = page.slice(parsed.bodyEnd), sizeText = 'var size = ' + oldSize + ';', hits = tail.split(sizeText).length - 1;
  if (hits !== 1) throw new Error('expected the server worker bootstrap to name the asset size once, found ' + hits);
  return page.slice(0, tagStart) + tag + '\n' + packed.toString('base64') + '\n' + tail.replace(sizeText, 'var size = ' + packed.length + ';');
}
function globRe(pattern) {                                  // "assets/**/*.png": ** = any depth, * = inside one path segment
  const s = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*');
  return new RegExp('^' + s + '$');
}

/* ---------- mods: ports of real Minecraft mods (and the examples) shipped inside the client ----------
 * mods-src/<id>/oneclient.mod.json + main.js (or src/*.js, joined in file name order into main.js), optional build.json
 * { "bundles": { "main.js": ["src/*.js"], "worker.js": ["worker/*.js"] } } and any other files the mod ships.
 * Each becomes mods/<id>.ocmod and is embedded in the page (script.oc-mod) so uploading the matching real jar can switch it on. */
function globFiles(dir, pattern) {                          // "src/*.js" -> sorted file list (one directory level, * only)
  const slash = pattern.lastIndexOf('/'), sub = slash >= 0 ? pattern.slice(0, slash) : '', base = pattern.slice(slash + 1);
  const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const d = path.join(dir, sub);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => re.test(n) && fs.statSync(path.join(d, n)).isFile()).sort().map((n) => path.join(sub, n)) : [];
}
function buildMod(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'oneclient.mod.json'), 'utf8'));
  const cfg = fs.existsSync(path.join(dir, 'build.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')) : {};
  const bundles = cfg.bundles || (fs.existsSync(path.join(dir, 'src')) ? { 'main.js': ['src/*.js'] } : {});
  const entries = [], skip = new Set(['build.json']);
  if (cfg.epk && cfg.epk.length) {                           // vanilla files copied out of the game's asset pack, under the same paths
    const all = readEpkAll(fs.readFileSync(abs(BASE), 'utf8')), res = cfg.epk.map(globRe);
    let n = 0;
    for (const [name, data] of all) if (res.some((r) => r.test(name))) { entries.push({ name, data: Buffer.from(data) }); n++; }
    if (!n) throw new Error(path.basename(dir) + ': no game assets matched ' + cfg.epk.join(', '));
  }
  for (const out of Object.keys(bundles)) {
    const parts = [];
    for (const pat of bundles[out]) for (const f of globFiles(dir, pat)) { parts.push('/* ---- ' + f.replace(/\\/g, '/') + ' ---- */\n' + fs.readFileSync(path.join(dir, f), 'utf8')); skip.add(f.replace(/\\/g, '/')); }
    if (!parts.length) throw new Error(path.basename(dir) + ': nothing matched for ' + out);
    entries.push({ name: out, data: Buffer.from(parts.join('\n'), 'utf8') });
  }
  (function walk(d, rel) {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n), r = rel ? rel + '/' + n : n;
      if (fs.statSync(p).isDirectory()) { if (!(r === 'src' && bundles['main.js'])) walk(p, r); continue; }
      if (skip.has(r) || entries.some((e) => e.name === r)) continue;
      entries.push({ name: r, data: fs.readFileSync(p) });
    }
  })(dir, '');
  return { manifest, zip: zipFiles(entries) };
}
const modBundles = [];
if (fs.existsSync(abs('mods-src'))) {
  for (const id of fs.readdirSync(abs('mods-src')).sort()) {
    const dir = abs('mods-src/' + id);
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, 'oneclient.mod.json'))) continue;
    try { const b = buildMod(dir); modBundles.push({ id: b.manifest.id || id, zip: b.zip, manifest: b.manifest }); }
    catch (e) { console.warn('! mod ' + id + ' skipped:', e.message); }
  }
  if (modBundles.length) {
    fs.mkdirSync(abs('mods'), { recursive: true });
    for (const b of modBundles) fs.writeFileSync(abs('mods/' + b.id + '.ocmod'), b.zip);
  }
  if (fs.existsSync(abs('mods-src/examples'))) {                    // plain .js example mods: copied as they are, to be loaded with "Load mods"
    fs.mkdirSync(abs('mods/examples'), { recursive: true });
    for (const n of fs.readdirSync(abs('mods-src/examples'))) if (/\.(js|ocmod)$/i.test(n)) fs.copyFileSync(abs('mods-src/examples/' + n), abs('mods/examples/' + n));
  }
}

if (flag('mods-only')) {                                    // quick loop while working on a mod: just refresh mods/*.ocmod
  console.log('built mods:', modBundles.map((b) => b.id + ' (' + (b.zip.length / 1024).toFixed(0) + ' KB)').join(', ') || 'none');
  process.exit(0);
}

/* ---------- built-in mods: mods-src/lunar/*.js are one-file mods that ship inside the page (loaded by modloader.js) ---------- */
const builtins = [];
if (fs.existsSync(abs('mods-src/lunar'))) {
  for (const n of fs.readdirSync(abs('mods-src/lunar')).sort()) {
    if (!/\.js$/.test(n) || n.startsWith('_')) continue;
    const src = fs.readFileSync(abs('mods-src/lunar/' + n), 'utf8');
    const head = /==OneClientMod==([\s\S]*?)==\/OneClientMod==/.exec(src.slice(0, 8192)), idm = head && /@id\s+(\S+)/.exec(head[1]);
    const id = idm ? idm[1] : n.replace(/\.js$/, '');
    if (/<\/script/i.test(src)) throw new Error(n + ': the source contains "</script"');
    if (/[^\x00-\x7f]/.test(src)) console.warn('! ' + n + ' contains non-ASCII characters');
    if (builtins.some((b) => b.id === id)) throw new Error('two built-in mods share the id ' + id);
    builtins.push({ id, src, hash: crypto.createHash('sha1').update(src).digest('hex').slice(0, 10) });
  }
}

/* ---------- packs ---------- */
const safeName = (s) => s.replace(/[^A-Za-z0-9 ._+()-]/g, '_').trim();
const packs = [];
if (!flag('no-pack')) {
  const list = fs.existsSync(abs('client/packs.json')) ? JSON.parse(read('client/packs.json')) : [];
  for (const p of list) {
    let zip, name;
    if (p.file) {
      if (!fs.existsSync(abs(p.file))) { console.warn('! pack not found, skipped:', p.file); continue; }
      zip = fs.readFileSync(abs(p.file)); name = safeName(p.name || path.basename(p.file).replace(/\.zip$/i, ''));
    } else if (p.dir) {
      zip = zipDirectory(abs(p.dir), []); name = safeName(p.name || path.basename(p.dir));
    } else continue;
    packs.push({ name, zip, id: crypto.createHash('sha1').update(zip).digest('hex').slice(0, 10), on: p.enabled !== false });       // "enabled": false = installed in Resource Packs but not switched on
  }
}

/* ---------- page shell rebranding (visible text only; each edit is checked) ---------- */
let html = fs.readFileSync(abs(BASE), 'utf8');
/* The screen markers (detect.js), the brand text and the marker font are part of the game's own built-in assets: always on, and nothing
 * shows up in the game's Resource Packs list. (They used to be a resource pack called "OneClient".) */
const langOverrides = fs.existsSync(abs('client/lang-overrides.json')) ? JSON.parse(read('client/lang-overrides.json')) : {};
if (markers.length || Object.keys(langOverrides).length) {
  const edits = {
    'assets/minecraft/lang/en_us.json': (old) => {
      const lang = JSON.parse(old.toString('utf8'));
      Object.assign(lang, langOverrides);
      markers.forEach((m, i) => Object.keys(m.keys).forEach((k) => { lang[k] = markerText(m, i, m.keys[k]); }));
      return Buffer.from(JSON.stringify(lang, null, 2));
    }
  };
  if (markers.length) {
    const font = markerFont();
    edits['assets/minecraft/font/default.json'] = (old) => {         // our glyphs first, the game's own font providers after them
      const def = JSON.parse(old.toString('utf8'));
      def.providers = JSON.parse(font.definition).providers.concat(def.providers);
      return Buffer.from(JSON.stringify(def, null, 4));
    };
    edits['assets/minecraft/textures/font/oneclient_markers.png'] = () => font.texture;
  }
  html = patchEpk(html, edits);
  const check = epkParse(html), lang = JSON.parse(check.entries.filter((e) => e.name === 'assets/minecraft/lang/en_us.json')[0].data.toString('utf8'));
  markers.forEach((m, i) => Object.keys(m.keys).forEach((k) => { if (lang[k] !== markerText(m, i, m.keys[k])) throw new Error('marker text missing after patching the game assets: ' + k); }));
}
function edit(label, re, to) {
  if (!re.test(html)) { console.warn('! rebrand step matched nothing:', label); return; }
  html = html.replace(re, to);
}
const wordmark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bfe0ff"/><stop offset="1" stop-color="#7aa7ff"/></linearGradient></defs>' +
  '<g font-family="Segoe UI Variable Display,Segoe UI,system-ui,-apple-system,Roboto,sans-serif" text-anchor="middle">' +
  '<text x="256" y="262" font-size="84" font-weight="700" fill="#ffffff" letter-spacing="-1">One<tspan fill="url(#g)">Client</tspan></text>' +
  '<text x="256" y="306" font-size="22" font-weight="500" fill="#7d8596" letter-spacing="7">26.2</text></g></svg>';
edit('title', /<title>[^<]*<\/title>/, '<title>OneClient 26.2</title>');
edit('boot image', /(<img id="boot_image" src=")data:image\/png;base64,[A-Za-z0-9+\/=]+(" alt=")[^"]*(")/,
  (m, a, b, c) => a + 'data:image/svg+xml,' + encodeURIComponent(wordmark) + b + 'OneClient' + c);
edit('loading text', /Loading Eaglercraft 26\.2 runtime[^<]*/, 'Loading OneClient 26.2&hellip;');
edit('boot status text', /st\.textContent = text;/, 'st.textContent = String(text).replace(/Eaglercraft/g, "OneClient");');
edit('rotate text', /Eaglercraft requires landscape mode/, 'OneClient requires landscape mode');
edit('loading background', /(id="loading_screen" style="[^"]*?)background-color:white;/, '$1background-color:#0b0d12;');
edit('status colour', /(#boot_status \{[^}]*?)color: #4a4a4a;/, '$1color: #8b93a3;');
edit('boot image sizing', /image-rendering: pixelated;\n\t\t\}\n\t\t#boot_status/, 'image-rendering: auto;\n\t\t}\n\t\t#boot_status');

/* ---------- default skins: the game's own 24 preset skins, read from its inline asset pack (EPK v2) ----------
 * The Profile page shows them as previews; the game itself still does the selecting. */
function presetSkins(page) {
  try {
    let i = page.indexOf('id="eag-inline-assets"');
    if (i < 0) return [];
    i = page.indexOf('>', i) + 1;
    const b = Buffer.from(page.slice(i, page.indexOf('</script>', i)).replace(/\s+/g, ''), 'base64');
    if (b.toString('latin1', 0, 8) !== 'EAGPKG$$') return [];
    let p = 8; p += 1 + b[p]; p += 1 + b[p]; p += 2 + b.readUInt16BE(p); p += 12;        // version, file name, comment, timestamp + file count
    if (String.fromCharCode(b[p++]) !== 'G' || b[p] !== 0x1f || b[p + 1] !== 0x8b || b[p + 3] !== 0) return [];   // one gzip stream follows
    const data = zlib.inflateRawSync(b.subarray(p + 10)), out = [];
    for (let q = data.indexOf('FILE'); q >= 0 && q + 5 < data.length;) {                  // FILE <u8 name length> <name> <u32 length> <u32 crc> <length-5 bytes> ":>"
      const nl = data[q + 4], name = data.toString('latin1', q + 5, q + 5 + nl), at = q + 5 + nl;
      const start = at + 8, end = start + data.readUInt32BE(at) - 5;
      const m = /^assets\/eagler\/skins\/(\d+)\.([a-z_]+)\.png$/.exec(name);
      if (m && data.readUInt32BE(start) === 0x89504e47) out.push({ i: +m[1], n: m[2].split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), d: 'data:image/png;base64,' + data.subarray(start, end).toString('base64') });
      q = data.indexOf('FILE', end);
    }
    return out.sort((x, y) => x.i - y.i).map(({ n, d }) => ({ n, d }));
  } catch (e) { console.warn('! could not read the default skins:', e.message); return []; }
}

/* ---------- block colours for the Minimap mod: one colour per block, from the game's own textures ----------
 * Every block of client/blocks26.json: the first model of its blockstate, followed up through its parents to the element with the biggest
 * top face (any other face when there is none, the model's particle texture when there are no elements), the texture's pixels averaged (the
 * first square frame of an animated one, weighted by alpha). The table is { "stone": "7e7e7e", "grass_block": "939393r", "short_grass": "x" ... }:
 * six hex digits and an optional kind letter: r grass tint, f foliage tint, l leaves with a fixed colour, g glass (see-through), w water,
 * v lava, x nothing to draw (plants, torches, signs, doors ... the map shows what is below them). Read by client/hudkit.js: kit.blockColors(). */
function decodePng(buf) {                                      // non-interlaced PNG of any colour type / bit depth -> { w, h, rgba }
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0, pal = null, trns = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; inter = data[12]; }
    else if (type === 'PLTE') pal = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (inter) throw new Error('interlaced PNG');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error('bad PNG colour type ' + ctype);
  const bpp = Math.max(1, (channels * depth) >> 3), stride = (w * channels * depth + 7) >> 3;
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {                                  // undo the scanline filters
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const out = Buffer.alloc(w * h * 4), maxv = (1 << Math.min(depth, 8)) - 1;
  const sample = (row, i) => {                                   // the i-th sample of a row (channels interleaved); 16 bit: the high byte
    if (depth === 8) return px[row + i];
    if (depth === 16) return px[row + i * 2];
    const bit = i * depth; return (px[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxv;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const row = y * stride, o = (y * w + x) * 4;
    let r, g, b, a = 255;
    if (ctype === 6) { r = sample(row, x * 4); g = sample(row, x * 4 + 1); b = sample(row, x * 4 + 2); a = sample(row, x * 4 + 3); }
    else if (ctype === 2) {
      r = sample(row, x * 3); g = sample(row, x * 3 + 1); b = sample(row, x * 3 + 2);
      if (trns && trns.length >= 6) { const k = depth === 16 ? 0 : 1; if (r === trns[k] && g === trns[2 + k] && b === trns[4 + k]) a = 0; }       // a colour that stands for "transparent"
    } else if (ctype === 0) {
      const v = sample(row, x);
      r = g = b = v * (depth < 8 ? 255 / maxv : 1);
      if (trns && trns.length >= 2 && v === (depth === 16 ? trns[0] : trns[1])) a = 0;                                                        // a grey that stands for "transparent" (the grass overlay)
    }
    else if (ctype === 4) { r = g = b = sample(row, x * 2); a = sample(row, x * 2 + 1); }
    else { const i = sample(row, x); r = pal[i * 3]; g = pal[i * 3 + 1]; b = pal[i * 3 + 2]; if (trns && i < trns.length) a = trns[i]; }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return { w, h, rgba: out };
}

/* the game's block models, read from its asset pack: the first model of a blockstate, a model with its parents folded in, a texture reference as a path */
function modelTools(all) {
  const J = (n) => { const d = all.get(n); return d ? JSON.parse(Buffer.from(d).toString('utf8')) : null; };
  const modelOf = (name) => {                                    // the first model of a blockstate (the first variant, or the first part)
    const bs = J('assets/minecraft/blockstates/' + name + '.json');
    if (!bs) return null;
    let m = bs.variants ? bs.variants[Object.keys(bs.variants)[0]] : bs.multipart ? bs.multipart[0].apply : null;
    if (Array.isArray(m)) m = m[0];
    return m && m.model ? m.model.replace(/^minecraft:/, '') : null;
  };
  const resolve = (model) => {                                   // textures (child first) and the elements of the nearest model that has some
    const textures = {};
    let elements = null, cur = model;
    for (let i = 0; i < 12 && cur; i++) {
      const j = J('assets/minecraft/models/' + cur.replace(/^minecraft:/, '') + '.json');
      if (!j) break;
      for (const k in (j.textures || {})) if (!(k in textures)) textures[k] = j.textures[k];
      if (!elements && j.elements) elements = j.elements;
      cur = j.parent || null;
    }
    return { textures, elements };
  };
  const texRef = (textures, ref) => {                            // "#top" -> "block/grass_block_top"; a texture can also be { sprite: ... }
    for (let i = 0; i < 8; i++) {
      if (ref && typeof ref === 'object') ref = ref.sprite || ref.texture || null;
      if (typeof ref !== 'string') return null;
      if (ref[0] === '#') ref = textures[ref.slice(1)];
      else if (!/[:/]/.test(ref) && textures[ref] !== undefined) ref = textures[ref];
      else return ref;
    }
    return null;
  };
  return { J, modelOf, resolve, texRef };
}

function blockColors(all) {
  const { J, modelOf, resolve, texRef } = modelTools(all);
  const names = JSON.parse(read('client/blocks26.json')).blocks.map((b) => b[0]);
  const tagSet = (tag, seen) => {                                // a block tag as a set of bare names, tags inside tags followed
    const set = new Set(); seen = seen || new Set();
    if (seen.has(tag)) return set;
    seen.add(tag);
    const j = J('data/minecraft/tags/block/' + tag + '.json');
    for (const v of (j && j.values) || []) {
      const id = typeof v === 'string' ? v : v.id;
      if (id[0] === '#') tagSet(id.slice(1).replace(/^minecraft:/, ''), seen).forEach((x) => set.add(x)); else set.add(id.replace(/^minecraft:/, ''));
    }
    return set;
  };
  const tags = {};
  for (const t of ['replaceable', 'small_flowers', 'flowers', 'saplings', 'rails', 'buttons', 'pressure_plates', 'all_signs', 'banners', 'candles', 'fire', 'coral_plants', 'wall_corals', 'lightning_rods', 'lanterns', 'speleothems', 'cave_vines', 'climbable', 'leaves']) tags[t] = tagSet(t);
  const avgs = new Map();
  const average = (tex) => {                                     // -> [r, g, b] over the opaque-ish pixels of the first square frame
    tex = tex.replace(/^minecraft:/, '');
    if (avgs.has(tex)) return avgs.get(tex);
    const d = all.get('assets/minecraft/textures/' + tex + '.png');
    let res = null;
    if (d) {
      try {
        const im = decodePng(Buffer.from(d)), n = im.w * Math.min(im.h, im.w);
        let r = 0, g = 0, b = 0, a = 0;
        for (let i = 0; i < n; i++) { const al = im.rgba[i * 4 + 3]; r += im.rgba[i * 4] * al; g += im.rgba[i * 4 + 1] * al; b += im.rgba[i * 4 + 2] * al; a += al; }
        res = a > 0 ? [r / a, g / a, b / a] : null;
      } catch (e) { res = null; }
    }
    avgs.set(tex, res);
    return res;
  };
  const hex = (c) => c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  /* things the map should look through: plants, lights, signs, doors ... (the rest of the "no top face" models is caught below) */
  const SKIP = /(^|_)(torch|sign|button|pressure_plate|lever|repeater|comparator|tripwire|tripwire_hook|redstone_wire|rail|banner|candle|candle_cake|end_rod|lightning_rod|ladder|vine|vines|lichen|sapling|propagule|tulip|orchid|allium|bluet|daisy|cornflower|wither_rose|dandelion|poppy|torchflower|pitcher_plant|pitcher_crop|sunflower|lilac|rose_bush|peony|short_grass|tall_grass|fern|dead_bush|bush|short_dry_grass|tall_dry_grass|fungus|sprouts|kelp|kelp_plant|seagrass|tall_seagrass|sea_pickle|coral_fan|coral_wall_fan|sugar_cane|bamboo|bamboo_sapling|sweet_berry_bush|cocoa|turtle_egg|sniffer_egg|frogspawn|fire|cobweb|chain|amethyst_cluster|amethyst_bud|pointed_dripstone|sulfur_spike|spore_blossom|small_dripleaf|big_dripleaf_stem|pale_hanging_moss|petals|wildflowers|leaf_litter|firefly_bush|eyeblossom|cactus_flower|resin_clump|sculk_vein|light|barrier|structure_void|air|moving_piston|piston_head|skull|head|door|lily_pad|end_portal|end_gateway|nether_portal|conduit|copper_golem_statue|brown_mushroom|red_mushroom|glow_lichen)$/;
  const SKIP2 = /^potted_|^flower_pot$|^(crimson|warped)_roots$|^hanging_roots$|^(attached_)?(pumpkin|melon)_stem$|^(tube|brain|bubble|fire|horn)_coral$|^dead_(tube|brain|bubble|fire|horn)_coral$/;
  const KEEP = /^(azalea|flowering_azalea|wheat|carrots|potatoes|beetroots|nether_wart|brown_mushroom_block|red_mushroom_block|mushroom_stem|cactus|scaffolding|moss_carpet|pale_moss_carpet|(.*_)?shulker_box|chest|trapped_chest|ender_chest|(.*_)?copper_chest|decorated_pot|iron_bars|.*_pane)$/;
  const skipTag = (n) => (tags.replaceable.has(n) && !/^(snow|water|lava|bubble_column)$/.test(n)) || tags.small_flowers.has(n) || (tags.flowers.has(n) && !/leaves|chorus/.test(n)) || tags.saplings.has(n) || tags.rails.has(n) || tags.buttons.has(n) || tags.pressure_plates.has(n) || tags.all_signs.has(n) || tags.banners.has(n) || tags.candles.has(n) || tags.fire.has(n) || tags.coral_plants.has(n) || tags.wall_corals.has(n) || tags.lightning_rods.has(n) || tags.lanterns.has(n) || tags.speleothems.has(n) || tags.cave_vines.has(n) || (tags.climbable.has(n) && n !== 'scaffolding');
  const out = {};
  for (const name of names) {
    if (name === 'water' || name === 'bubble_column') { out[name] = '3f76e4w'; continue; }
    if (name === 'lava') { const a = average('block/lava_still'); out[name] = a ? hex(a) + 'v' : 'd9691av'; continue; }
    const m = modelOf(name), r = m ? resolve(m) : { textures: {}, elements: null };
    let up = null, any = null;
    for (const e of r.elements || []) for (const f of ['up', 'north', 'south', 'east', 'west', 'down']) {
      if (!e.faces || !e.faces[f]) continue;
      const area = f === 'up' ? (e.to[0] - e.from[0]) * (e.to[2] - e.from[2]) : 1, cand = { area, tex: e.faces[f].texture };
      if (f === 'up') { if (!up || area > up.area) up = cand; } else if (!any) any = cand;
    }
    const flat = r.elements && (!up || up.area < 0.5);           // a model with parts but no top face: a plant, a pane of a vine ...
    if ((SKIP.test(name) || SKIP2.test(name) || skipTag(name) || flat) && !KEEP.test(name)) { out[name] = 'x'; continue; }
    const pick = up || any;
    let tex = pick ? texRef(r.textures, pick.tex) : null;
    if (!tex) tex = texRef(r.textures, '#particle');
    let a = tex ? average(tex) : null;
    if (!a) { out[name] = 'x'; continue; }
    let flag = '';
    if (/(^|_)glass(_pane)?$/.test(name)) flag = 'g';
    else if (name === 'grass_block') flag = 'r';
    else if (/^(oak|jungle|acacia|dark_oak|mangrove)_leaves$/.test(name)) flag = 'f';
    else if (name === 'birch_leaves') { a = [a[0] * 0x80 / 255, a[1] * 0xa7 / 255, a[2] * 0x55 / 255]; flag = 'l'; }
    else if (name === 'spruce_leaves') { a = [a[0] * 0x61 / 255, a[1] * 0x99 / 255, a[2] * 0x61 / 255]; flag = 'l'; }
    else if (tags.leaves.has(name)) flag = 'l';
    out[name] = hex(a) + flag;
  }
  return out;
}

/* the tints of every biome, the way the game works them out: the grass and foliage colour maps looked up by temperature and rainfall, unless the biome
 * names its own colour, then the swamp / dark forest modifiers; the water colour as the biome says. { "plains": ["91bd59" grass, "77ab2f" foliage, "3f76e4" water] } */
function biomeColors(all) {
  const maps = {};
  for (const n of ['grass', 'foliage']) {
    const d = all.get('assets/minecraft/textures/colormap/' + n + '.png');
    if (!d) return {};
    maps[n] = decodePng(Buffer.from(d));
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const pick = (m, t, rain) => {
    t = clamp01(t); rain = clamp01(rain) * t;
    const o = (Math.floor((1 - rain) * 255) * m.w + Math.floor((1 - t) * 255)) * 4;
    return [m.rgba[o], m.rgba[o + 1], m.rgba[o + 2]];
  };
  const parse = (h) => (typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h) ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] : null);
  const hex = (c) => c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const out = {};
  for (const [name, d] of all) {
    const m = /^data\/minecraft\/worldgen\/biome\/([a-z_]+)\.json$/.exec(name);
    if (!m) continue;
    const j = JSON.parse(Buffer.from(d).toString('utf8')), e = j.effects || {};
    const t = typeof j.temperature === 'number' ? j.temperature : 0.5, rain = typeof j.downfall === 'number' ? j.downfall : 0.5;
    let grass = parse(e.grass_color), foliage = parse(e.foliage_color) || pick(maps.foliage, t, rain);
    if (!grass) {
      grass = pick(maps.grass, t, rain);
      if (e.grass_color_modifier === 'dark_forest') { const c = (grass[0] << 16) | (grass[1] << 8) | grass[2], v = ((c & 0xfefefe) + 0x28340a) >> 1; grass = [v >> 16 & 255, v >> 8 & 255, v & 255]; }
      else if (e.grass_color_modifier === 'swamp') grass = [0x6a, 0x70, 0x39];
    }
    out[m[1]] = [hex(grass), hex(foliage), hex(parse(e.water_color) || [0x3f, 0x76, 0xe4])];
  }
  return out;
}

/* A picture for every block item that has no flat item texture (cobblestone, dirt, planks, stairs, slabs ...): the block seen the way the game draws it in a
 * slot, top face lit fully, the east face (left) and the north face (right) a little darker. The faces come from the block's model (first blockstate model; the
 * layers of the full cubes in it, so the grass strip of a grass block is on top of its side), the height from the model (slabs and carpets are low), the
 * grass and leaf textures are tinted green like on the plains. 32 x 32 PNGs as data URLs, keyed by item name. */
function blockIcons(all, itemNames, haveFlat) {
  const { modelOf, resolve, texRef } = modelTools(all);
  const blocks = new Set(JSON.parse(read('client/blocks26.json')).blocks.map((b) => b[0]));
  const texs = new Map();
  const tex = (id) => {                                          // the first square frame of a texture, or null
    id = id.replace(/^minecraft:/, '');
    if (texs.has(id)) return texs.get(id);
    const d = all.get('assets/minecraft/textures/' + id + '.png');
    let im = null;
    if (d) { try { im = decodePng(Buffer.from(d)); if (im.h > im.w) im = { w: im.w, h: im.w, rgba: im.rgba.subarray(0, im.w * im.w * 4) }; } catch (e) { im = null; } }
    texs.set(id, im);
    return im;
  };
  const GRASS = [145, 189, 89], FOLIAGE = [119, 171, 47];
  const tintOf = (name) => (name === 'grass_block' ? GRASS : /^(oak|jungle|acacia|dark_oak|mangrove)_leaves$/.test(name) ? FOLIAGE : null);
  const layersOf = (name, r, dir) => {                           // the textures drawn on one side, bottom layer first: [{ im, tint }]
    const els = r.elements || [], full = els.filter((e) => e.from[0] <= 0.01 && e.from[1] <= 0.01 && e.from[2] <= 0.01 && e.to[0] >= 15.99 && e.to[1] >= 15.99 && e.to[2] >= 15.99);
    const use = full.length ? full : els.slice().sort((a, b) => vol(b) - vol(a)).slice(0, 1), out = [];
    for (const e of use) {
      const f = e.faces && e.faces[dir];
      if (!f) continue;
      const t = texRef(r.textures, f.texture), im = t && tex(t);
      if (im) out.push({ im, tint: f.tintindex !== undefined ? tintOf(name) : null });
    }
    return out;
  };
  const vol = (e) => (e.to[0] - e.from[0]) * (e.to[1] - e.from[1]) * (e.to[2] - e.from[2]);
  const pixelOf = (layers, u, v) => {                            // the colour of a side at (u, v) in 0..1, layers composited
    let R = 0, G = 0, B = 0, A = 0;
    for (const L of layers) {
      const x = Math.min(L.im.w - 1, Math.max(0, Math.floor(u * L.im.w))), y = Math.min(L.im.h - 1, Math.max(0, Math.floor(v * L.im.h))), o = (y * L.im.w + x) * 4;
      let r = L.im.rgba[o], g = L.im.rgba[o + 1], b = L.im.rgba[o + 2];
      const a = L.im.rgba[o + 3] / 255;
      if (L.tint) { r = r * L.tint[0] / 255; g = g * L.tint[1] / 255; b = b * L.tint[2] / 255; }
      R = r * a + R * (1 - a); G = g * a + G * (1 - a); B = b * a + B * (1 - a); A = a + A * (1 - a);
    }
    return A > 0.02 ? [R, G, B, A] : null;
  };
  const cube = (up, east, north, h) => {                         // 32 x 32 RGBA of an isometric block of height h (0..1)
    const S = 32, px = Buffer.alloc(S * S * 4), off = 14 * (1 - h), T = [16, 1 + off];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const X = x + 0.5, Y = y + 0.5, dx = X - T[0], dy = Y - T[1], a = (dx / 14 + dy / 7) / 2, b = (dy / 7 - dx / 14) / 2;
      let c = null, shade = 1;
      if (a >= 0 && a <= 1 && b >= 0 && b <= 1) c = pixelOf(up, b, 1 - a);
      else if (X >= 2 && X < 16) { const top = 8 + off + (X - 2) / 14 * 7, v = (Y - top) / (14 * h); if (v >= 0 && v <= 1) { c = pixelOf(east, (X - 2) / 14, v); shade = 0.8; } }
      else if (X >= 16 && X < 30) { const top = 15 + off - (X - 16) / 14 * 7, v = (Y - top) / (14 * h); if (v >= 0 && v <= 1) { c = pixelOf(north, (X - 16) / 14, v); shade = 0.62; } }
      if (c) px.set([Math.round(c[0] * shade), Math.round(c[1] * shade), Math.round(c[2] * shade), Math.round(c[3] * 255)], (y * S + x) * 4);
    }
    return png(S, S, px);
  };
  const out = {};
  for (const name of itemNames) {
    if (name === 'air' || haveFlat[name] || !blocks.has(name)) continue;
    const m = modelOf(name);
    if (!m) continue;
    const r = resolve(m);
    let up = layersOf(name, r, 'up'), east = layersOf(name, r, 'east'), north = layersOf(name, r, 'north');
    if (!up.length || !east.length || !north.length) {            // a model without parts (chests, beds ...): its particle texture on every side
      const p = texRef(r.textures, '#particle'), im = p && tex(p);
      if (!im) continue;
      if (!up.length) up = [{ im, tint: null }]; if (!east.length) east = [{ im, tint: null }]; if (!north.length) north = [{ im, tint: null }];
    }
    let lo = 16, hi = 0;
    for (const e of r.elements || []) { lo = Math.min(lo, e.from[1]); hi = Math.max(hi, e.to[1]); }
    const h = r.elements && r.elements.length ? Math.max(0.0625, Math.min(1, (hi - lo) / 16)) : 1;
    out[name] = 'data:image/png;base64,' + cube(up, east, north, h).toString('base64');
  }
  return out;
}

/* ---------- assemble ---------- */
const css =[read('client/style.css'), fs.existsSync(abs('client/menu.css')) ? read('client/menu.css') : ''].join('\n');
const extras = (opt('extra') || '').split(',').filter(Boolean).map((f) => fs.readFileSync(path.resolve(f), 'utf8'));   // test-only scripts (probes), run before everything else
const mods = ['window.__OC_MARKERS = ' + JSON.stringify(markers.map(({ id, where, a, b }) => ({ id, where, a, b }))) + ';'].concat(extras).concat(flag('shim') ? [read('client/test-lockshim.js')] : []).concat(['core.js', 'sense.js', 'fx.js', 'gfx.js', 'net.js', 'tls.js', 'wisp.js', 'mcauth.js', 'account.js', 'gate.js', 'blocks.js', 'world.js', 'player.js', 'entities.js', 'inventory.js', 'hudkit.js', 'pack.js', 'modloader.js', 'ui.js', 'mods.js', 'profiles.js', 'detect.js', 'status.js', 'worlds.js', 'menu.js'].filter((f) => fs.existsSync(abs('client/' + f))).map((f) => read('client/' + f))).join('\n');
let inject = '\n<meta charset="UTF-8">\n<style id="oc-style">' + css + '</style>\n';
for (const p of packs) {
  inject += '<script type="application/octet-stream" class="oc-pack" data-id="' + p.id + '" data-name="' + p.name + '"' + (p.on ? '' : ' data-enabled="false"') + '>' + p.zip.toString('base64') + '</script>\n';
}
const icons = { effects: {}, items: {}, hud: {}, blocks: {} };
(function () {
  const all = readEpkAll(html), url = (d) => 'data:image/png;base64,' + Buffer.from(d).toString('base64');
  for (const [name, data] of all) {
    let m;
    if ((m = /^assets\/minecraft\/textures\/mob_effect\/([a-z_]+)\.png$/.exec(name))) icons.effects[m[1]] = url(data);
    else if ((m = /^assets\/minecraft\/textures\/item\/([a-z0-9_]+)\.png$/.exec(name)) && data.length <= 4096 && !/_overlay$/.test(m[1])) icons.items[m[1]] = url(data);
    else if ((m = /^assets\/minecraft\/textures\/gui\/sprites\/hud\/(heart\/(?:full|half|container)|food_(?:full|half|empty)|armor_(?:full|half|empty))\.png$/.exec(name))) icons.hud[m[1].replace('/', '_')] = url(data);
  }
})();
if (fs.existsSync(abs('client/items26.json'))) icons.blocks = blockIcons(readEpkAll(html), JSON.parse(read('client/items26.json')).names, icons.items);      // block items have no flat texture: a cube of the block (Shulker Tooltip)
const lang = { block: {}, item: {}, entity: {}, effect: {}, enchant: {} };       // display names of the game's things, for the mods' labels
(function () {
  const raw = readEpkAll(html).get('assets/minecraft/lang/en_us.json');
  if (!raw) return;
  const j = JSON.parse(Buffer.from(raw).toString('utf8')), map = { block: 'block', item: 'item', entity: 'entity', effect: 'effect', enchantment: 'enchant' };
  for (const k of Object.keys(j)) {
    const m = /^(block|item|entity|effect|enchantment)\.minecraft\.([a-z0-9_]+)$/.exec(k);
    if (m && typeof j[k] === 'string') lang[map[m[1]]][m[2]] = j[k];
  }
})();
const skins = presetSkins(html);
if (skins.length) inject += '<script type="application/json" id="oc-skins">' + JSON.stringify(skins) + '</script>\n';
if (Object.keys(icons.effects).length) inject += '<script type="application/json" id="oc-icons">' + JSON.stringify(icons) + '</script>' + '\n';      // the game's own potion effect / armor / HUD pictures (client/hudkit.js: kit.icons())
if (Object.keys(lang.block).length) inject += '<script type="application/json" id="oc-lang">' + JSON.stringify(lang) + '</script>\n';      // display names (client/hudkit.js: kit.name())
if (fs.existsSync(abs('client/registries26.json'))) inject += '<script type="application/json" id="oc-registries">' + JSON.stringify(JSON.parse(read('client/registries26.json'))) + '</script>\n';      // entity types and potion effects of the game (client/player.js, entities.js)
if (fs.existsSync(abs('client/items26.json'))) inject += '<script type="application/json" id="oc-items">' + JSON.stringify(JSON.parse(read('client/items26.json'))) + '</script>' + '\n';      // the game's item table (client/inventory.js)
if (fs.existsSync(abs('client/blocks26.json'))) inject += '<script type="application/json" id="oc-blocks">' + JSON.stringify(JSON.parse(read('client/blocks26.json'))) + '</script>\n';     // the game's block state table (client/blocks.js)
{ const bio = biomeColors(readEpkAll(html)); if (Object.keys(bio).length) inject += '<script type="application/json" id="oc-biomecolors">' + JSON.stringify(bio) + '</script>\n'; }      // grass / foliage / water tint of every biome (client/hudkit.js: kit.biomeColors())
if (fs.existsSync(abs('client/blocks26.json'))) { const bc = blockColors(readEpkAll(html)); if (Object.keys(bc).length) inject += '<script type="application/json" id="oc-blockcolors">' + JSON.stringify(bc) + '</script>\n'; }      // one colour per block, from the game's textures (client/hudkit.js: kit.blockColors(), the Minimap mod)
if (MS_CLIENT) inject += '<script type="application/json" id="oc-msclient">' + JSON.stringify({ clientId: MS_CLIENT }) + '</script>\n';      // the Azure app of the built-in sign-in (client/mcauth.js)
for (const b of modBundles) inject += '<script type="application/octet-stream" class="oc-mod" data-id="' + b.id + '">' + b.zip.toString('base64') + '</script>\n';
for (const b of builtins) inject += '<script type="text/oc-builtin" data-id="' + b.id + '" data-hash="' + b.hash + '">' + b.src + '</script>\n';
inject += '<script id="oneclient">' + mods + '</script>\n';

const at = html.indexOf('<head>');
if (at < 0) throw new Error('no <head> in ' + BASE);
fs.writeFileSync(abs(OUT), html.slice(0, at + 6) + inject + html.slice(at + 6));
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log('built', OUT, mb(fs.statSync(abs(OUT)).size), '| packs:', packs.map((p) => p.name + ' (' + mb(p.zip.length) + ', ' + p.id + ')').join(', ') || 'none', '| default skins:', skins.length, '| mods:', modBundles.map((b) => b.id + ' (' + (b.zip.length / 1024).toFixed(0) + ' KB)').join(', ') || 'none', '| built-in mods:', builtins.length, MS_CLIENT ? '| sign-in app ID: ' + MS_CLIENT : '| sign-in app ID: none (Quick sign-in, or players type their own)');
