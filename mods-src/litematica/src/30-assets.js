/* The game's block assets (blockstates, block models, block textures, colour maps) come with this mod, copied out of the game's own
 * asset pack at build time. This file loads them on demand and packs the textures a schematic needs into one atlas. */
var Assets = (function () {
  var jsonCache = {}, textures = [], texIndex = {}, atlas = { version: 0, canvas: null, rects: new Float32Array(0), width: 0, height: 0, dirty: false };
  var tintMaps = { grass: null, foliage: null };
  var packs = [], packKey = "", packGen = 0, fsdb = null;   // enabled resource packs, lowest priority first: their textures replace the game's own

  function strip(id) { return String(id).replace(/^minecraft:/, ""); }

  function json(path) {
    if (jsonCache[path] !== undefined) return jsonCache[path];
    var p = api.assets.has(path) ? api.assets.json(path).catch(function () { return null; }) : Promise.resolve(null);
    jsonCache[path] = p;
    return p.then(function (v) { jsonCache[path] = Promise.resolve(v); jsonCache[path + "#v"] = v; return v; });
  }
  function jsonSync(path) { return jsonCache[path + "#v"]; }
  function blockstate(name) { return json("assets/minecraft/blockstates/" + strip(name) + ".json"); }
  function blockstateSync(name) { return jsonSync("assets/minecraft/blockstates/" + strip(name) + ".json"); }
  function hasBlockstate(name) { try { return !!api.assets.has("assets/minecraft/blockstates/" + strip(name) + ".json"); } catch (e) { return false; } }    // does this game version know the block?
  function modelPath(id) { return "assets/minecraft/models/" + strip(id) + ".json"; }
  function model(id) { return json(modelPath(id)); }
  function modelSync(id) { return jsonSync(modelPath(id)); }

  /* ---------- textures ---------- */
  function texId(name) {                                   // "minecraft:block/stone" / "block/stone" -> stable integer id
    name = strip(name);
    var i = texIndex[name];
    if (i === undefined) { i = texIndex[name] = textures.length; textures.push({ name: name, bmp: null, w: 16, h: 16, alpha: 0, loaded: false, missing: false }); atlas.dirty = true; }
    return i;
  }
  function loadTexture(i) {
    var t = textures[i];
    if (t.loaded) return Promise.resolve(t);
    if (t.loading) return t.loading;
    var path = "assets/minecraft/textures/" + t.name + ".png", myGen = packGen;
    t.loading = fromPacks(path).then(function (bytes) {
      return bytes || (api.assets.has(path) ? api.assets.bytes(path) : Promise.reject(new Error("missing")));
    }).then(function (bytes) {
      return createImageBitmap(new Blob([bytes], { type: "image/png" }));
    }).then(function (bmp) {
      if (myGen !== packGen) return loadTexture(i);                 // the packs changed while this was loading: start over with the new ones
      var w = bmp.width, h = Math.min(bmp.height, bmp.width);   // animated textures are tall strips of square frames: keep the first
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(bmp, 0, 0, w, h, 0, 0, w, h);
      t.canvas = c; t.w = w; t.h = h;
      var px = x.getImageData(0, 0, w, h).data, partial = 0, clear = 0, n = w * h, r = 0, g = 0, b = 0, cnt = 0;
      for (var k = 0; k < n; k++) {
        var a = px[k * 4 + 3];
        if (a < 12) clear++; else if (a < 245) partial++;
        if (a > 200) { r += px[k * 4]; g += px[k * 4 + 1]; b += px[k * 4 + 2]; cnt++; }
      }
      t.alpha = partial > n * 0.04 ? 2 : (clear > 0 || partial > 0 ? 1 : 0);      // 0 opaque, 1 cut out, 2 translucent
      t.avg = cnt ? [r / cnt / 255, g / cnt / 255, b / cnt / 255] : [0.5, 0.5, 0.5];
      t.loaded = true;
      return t;
    }).catch(function () {
      if (myGen !== packGen) return loadTexture(i);
      t.missing = true; t.loaded = true; t.w = t.h = 16; t.alpha = 0; t.avg = [1, 0, 1];
      var c = document.createElement("canvas"); c.width = c.height = 16;
      var x = c.getContext("2d");
      x.fillStyle = "#000"; x.fillRect(0, 0, 16, 16); x.fillStyle = "#f0f"; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
      t.canvas = c;
      return t;
    });
    return t.loading;
  }
  function textureSync(i) { return textures[i]; }

  /* resource packs: the game keeps imported packs as files in its own IndexedDB filesystem (resourcepacks/<name>/...) and lists the
   * enabled ones in its saved options (lowest priority first). A pack's block textures win over the game's own. */
  function openFs() {
    return fsdb || (fsdb = new Promise(function (res, rej) {
      var r = indexedDB.open("_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_worlds");
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    }));
  }
  function readFs(key) {
    return openFs().then(function (db) {
      return new Promise(function (res) {
        try { var q = db.transaction("filesystem", "readonly").objectStore("filesystem").get([key]); q.onsuccess = function () { res(q.result ? new Uint8Array(q.result.data) : null); }; q.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    }, function () { return null; });
  }
  function fromPacks(path) {
    var i = packs.length - 1;
    function next() {
      if (i < 0) return Promise.resolve(null);
      var p = packs[i--];
      return readFs("resourcepacks/" + p + "/" + path).then(function (b) { return b || next(); });
    }
    return next();
  }
  /* names of the enabled packs from the game's saved options; a change reloads every texture */
  function setPacks(list) {
    var key = JSON.stringify(list);
    if (key === packKey) return false;
    packKey = key; packs = list.slice(); packGen++;
    textures.forEach(function (t) { t.loaded = false; t.loading = null; t.packed = false; t.missing = false; });
    atlas.dirty = true;
    return true;
  }
  function closeFs() { if (fsdb) { fsdb.then(function (db) { try { db.close(); } catch (e) {} }, function () {}); fsdb = null; } }
  /* read the enabled packs (saved option resourcePacks: ["vanilla","file/<pack name>",...], lowest priority first); Promise<changed?> */
  function syncPacks() {
    var N = window.OneClient && window.OneClient.native;
    return (N && N.readOptions ? N.readOptions() : Promise.resolve(null)).then(function (o) {
      var list = [];
      try {
        JSON.parse(((o || (N && N.opts) || {}).resourcePacks) || "[]").forEach(function (e) { if (typeof e === "string" && e.indexOf("file/") === 0) list.push(e.slice(5)); });
      } catch (e) { list = []; }
      return setPacks(list);
    }, function () { return false; });
  }

  /* make sure every listed texture is loaded and packed: Promise<atlas> (the same object, rects/version updated) */
  function ensure(ids) {
    return Promise.all(ids.map(loadTexture)).then(function () {
      var need = false;
      for (var i = 0; i < textures.length; i++) if (textures[i].loaded && !textures[i].packed) need = true;
      if (need || atlas.dirty) pack();
      return atlas;
    });
  }

  /* shelf packing with a 1px replicated border around each texture */
  function pack() {
    var list = [], i;
    for (i = 0; i < textures.length; i++) if (textures[i].loaded && textures[i].canvas) list.push(i);
    list.sort(function (a, b) { return textures[b].h - textures[a].h || a - b; });
    var W = 1024, x = 0, y = 0, rowH = 0, place = {};
    list.forEach(function (id) {
      var t = textures[id], w = t.w + 2, h = t.h + 2;
      if (x + w > W) { x = 0; y += rowH; rowH = 0; }
      place[id] = [x + 1, y + 1]; x += w; if (h > rowH) rowH = h;
    });
    var H = 16; while (H < y + rowH) H *= 2;
    var c = document.createElement("canvas"); c.width = W; c.height = H;
    var cx = c.getContext("2d");
    cx.imageSmoothingEnabled = false;
    var rects = new Float32Array(textures.length * 4);
    list.forEach(function (id) {
      var t = textures[id], p = place[id], px = p[0], py = p[1];
      cx.drawImage(t.canvas, px, py);
      cx.drawImage(t.canvas, 0, 0, 1, t.h, px - 1, py, 1, t.h); cx.drawImage(t.canvas, t.w - 1, 0, 1, t.h, px + t.w, py, 1, t.h);     // left / right border
      cx.drawImage(t.canvas, 0, 0, t.w, 1, px, py - 1, t.w, 1); cx.drawImage(t.canvas, 0, t.h - 1, t.w, 1, px, py + t.h, t.w, 1);     // top / bottom border
      cx.drawImage(t.canvas, 0, 0, 1, 1, px - 1, py - 1, 1, 1); cx.drawImage(t.canvas, t.w - 1, 0, 1, 1, px + t.w, py - 1, 1, 1);
      cx.drawImage(t.canvas, 0, t.h - 1, 1, 1, px - 1, py + t.h, 1, 1); cx.drawImage(t.canvas, t.w - 1, t.h - 1, 1, 1, px + t.w, py + t.h, 1, 1);
      rects[id * 4] = px / W; rects[id * 4 + 1] = py / H; rects[id * 4 + 2] = (px + t.w) / W; rects[id * 4 + 3] = (py + t.h) / H;
      t.packed = true;
    });
    atlas.canvas = c; atlas.rects = rects; atlas.width = W; atlas.height = H; atlas.version++; atlas.dirty = false;
  }

  /* ---------- biome tint maps: plains (temperature 0.8, downfall 0.4) ---------- */
  function loadTint(kind) {
    var path = "assets/minecraft/textures/colormap/" + kind + ".png";
    if (tintMaps[kind]) return Promise.resolve(tintMaps[kind]);
    return (api.assets.has(path) ? api.assets.bytes(path) : Promise.reject(new Error("no colormap"))).then(function (b) { return createImageBitmap(new Blob([b], { type: "image/png" })); }).then(function (bmp) {
      var c = document.createElement("canvas"); c.width = c.height = 256;
      var x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(bmp, 0, 0, 256, 256);
      var d = x.getImageData(51, 173, 1, 1).data;                // temperature 0.8, downfall 0.4: (1 - t) * 255, (1 - t * d) * 255
      tintMaps[kind] = [d[0] / 255, d[1] / 255, d[2] / 255];
      return tintMaps[kind];
    }).catch(function () { tintMaps[kind] = kind === "grass" ? [0.569, 0.741, 0.349] : [0.467, 0.671, 0.184]; return tintMaps[kind]; });
  }
  function tints() { return Promise.all([loadTint("grass"), loadTint("foliage")]).then(function () { return tintMaps; }); }

  return { json: json, jsonSync: jsonSync, blockstate: blockstate, blockstateSync: blockstateSync, hasBlockstate: hasBlockstate, model: model, modelSync: modelSync, texId: texId, textureSync: textureSync, ensure: ensure, setPacks: setPacks, syncPacks: syncPacks, closeFs: closeFs, _fromPacks: fromPacks, _readFs: readFs, _openFs: openFs, atlas: atlas, textures: textures, tints: tints, tintMaps: tintMaps, strip: strip };
})();
