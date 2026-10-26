/* OneClient mod loader.
 *
 * The "Load mods" button (Mods menu) hands the files you pick to OC.loader.addFiles(). What can be loaded:
 *
 *   .js            one-file OneClient mod (optional header comment with @id @name @version @author @description)
 *   .ocmod / .zip  OneClient mod package: oneclient.mod.json + main.js + any files the mod ships (see MODDING.md)
 *   .jar           a real Minecraft mod (Fabric / Quilt / NeoForge / Forge). Java code cannot run inside this WebAssembly
 *                  build, so a jar is read for its metadata and, when OneClient has a port of that mod (Litematica),
 *                  the port is installed and switched on. Anything else is listed with the reason it cannot run.
 *   .litematic .schem .schematic .nbt   content files: delivered to the mod that handles them (the Litematica port)
 *
 * Mods are stored in IndexedDB (database oneclient.mods.v1) and started on every launch, before the game boots, so they can
 * use every hook in OC.sense / OC.glx. Each mod gets its own `api` object; everything a mod registers through it (events, keys,
 * HUD widgets, world-pass hooks, DOM, styles) is tracked and removed again when the mod is switched off.
 * Mods run with full access to the page: only load mods you trust. ASCII-only source. */
(function () {
  "use strict";

  var OC = window.OneClient;
  if (!OC || !window.indexedDB) return;
  var S = OC.S;
  if (!S.modcfg) S.modcfg = {};

  var API_VERSION = 1;
  var DB_NAME = "oneclient.mods.v1";
  var enc = new TextEncoder(), dec = new TextDecoder("utf-8");
  var recs = {};                 // id -> stored record (without file bytes loaded lazily)
  var inst = {};                 // id -> running instance
  var ready = false, readyCbs = [];
  var fileHandlers = [];         // { exts, fn, owner }
  var busSubs = {};              // event name -> [{ fn, owner }]
  var ADAPTERS = {               // known real mods that OneClient has a browser-layer port of
    litematica: { bundle: "litematica", name: "Litematica", exts: ["litematic", "schem", "schematic", "nbt"] }
  };
  var LIBRARIES = {              // jars that are code libraries other mods build on: they do nothing on their own, so they are not listed as mods
    "malilib": "malilib is the shared code library behind Litematica, MiniHUD, Tweakeroo and the other masa mods.",
    "fabric-api": "Fabric API is the code library most Fabric mods are built on.",
    "fabric-language-kotlin": "Fabric Language Kotlin lets Fabric mods written in Kotlin run.",
    "kotlinforforge": "Kotlin for Forge lets Forge mods written in Kotlin run.",
    "cloth-config": "Cloth Config is a settings-screen library for other mods.",
    "architectury": "Architectury API is a cross-loader code library for other mods.",
    "modmenu": "Mod Menu adds a list of mods to the Java game's menu; OneClient has its own Mods menu.",
    "owo": "owo-lib is a code library for other mods.",
    "midnightlib": "MidnightLib is a settings library for other mods.",
    "forgeconfigapiport": "Forge Config API Port is a settings library for other mods.",
    "yet_another_config_lib_v3": "YetAnotherConfigLib is a settings-screen library for other mods.",
    "geckolib": "GeckoLib is an animation library for other mods.",
    "balm": "Balm is a code library for other mods.",
    "bookshelf": "Bookshelf is a code library for other mods.",
    "creativecore": "CreativeCore is a code library for other mods.",
    "puzzleslib": "Puzzles Lib is a code library for other mods."
  };
  function libraryNote(id) {
    if (LIBRARIES[id]) return LIBRARIES[id];
    if (/^fabric-.+-v\d+$/.test(id) || id === "fabric" || id === "fabricloader" || id === "fabric-loader") return LIBRARIES["fabric-api"];
    return "";
  }
  var CONTENT_EXTS = {};         // content file extension -> adapter bundle that handles it when no running mod does
  Object.keys(ADAPTERS).forEach(function (k) { ADAPTERS[k].exts.forEach(function (e) { CONTENT_EXTS[e] = ADAPTERS[k]; }); });

  var L = OC.loader = { ready: false, API_VERSION: API_VERSION };

  /* ---------- small helpers ---------- */
  function clean(id) { return String(id || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 64); }
  function ext(name) { var m = /\.([A-Za-z0-9]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  function baseName(name) { return String(name || "").replace(/^.*[\\\/]/, ""); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toU8(buf) { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); }
  function readFile(file) {
    if (file.arrayBuffer) return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(new Uint8Array(r.result)); }; r.onerror = function () { rej(r.error); }; r.readAsArrayBuffer(file); });
  }
  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
  function dataUrl(u8, mime) { return "data:" + mime + ";base64," + b64(u8); }
  function whenReady(fn) { if (ready) fn(); else readyCbs.push(fn); }
  var silent = 0;                // > 0 while a throwaway instance reads a built-in mod's settings: nothing to announce
  function changed() { if (!silent) OC.emit("loader-changed"); }

  /* ---------- storage ---------- */
  var dbp = null;
  function db() {
    return dbp || (dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains("mods")) d.createObjectStore("mods", { keyPath: "id" });
        if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs", { keyPath: ["id", "name"] });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    }));
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), out = fn(t.objectStore(store));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function putRec(rec) { return tx("mods", "readwrite", function (s) { s.put(rec); }); }
  function delRec(id) {
    return tx("mods", "readwrite", function (s) { s.delete(id); }).then(function () {
      return tx("blobs", "readwrite", function (s) { s.delete(IDBKeyRange.bound([id, ""], [id, "\uffff"])); });
    });
  }
  function allRecs() { return tx("mods", "readonly", function (s) { return s.getAll(); }); }

  /* ---------- zip helpers (OC.zip comes from pack.js) ---------- */
  function openZip(u8) {
    var z = OC.zip.read(u8), byName = {};
    z.entries.forEach(function (e) { byName[e.name] = e; });
    return { u8: u8, z: z, byName: byName, has: function (n) { return !!byName[n]; }, bytes: function (n) { var e = byName[n]; return e ? OC.zip.bytes(u8, z, e).then(toU8) : Promise.reject(new Error("no such file in the package: " + n)); }, text: function (n) { return this.bytes(n).then(function (b) { return dec.decode(b); }); } };
  }

  /* ---------- reading mod packages ---------- */
  function parseHeader(src) {                          // /* ==OneClientMod==  @key value ... ==/OneClientMod== */
    var m = /==OneClientMod==([\s\S]*?)==\/OneClientMod==/.exec(src.slice(0, 8192)), out = {};
    if (!m) return out;
    m[1].split(/\r?\n/).forEach(function (line) {
      var k = /^[\s*\/#]*@([A-Za-z_]+)\s+(.*?)\s*$/.exec(line);
      if (k) out[k[1].toLowerCase()] = k[2];
    });
    return out;
  }

  function fromJs(file, u8) {
    var src = dec.decode(u8), h = parseHeader(src), base = baseName(file.name).replace(/\.js$/i, "");
    var id = clean(h.id || base);
    if (!id) throw new Error("this file has no usable id");
    return { id: id, name: h.name || base, version: h.version || "1.0", author: h.author || "", description: h.description || "", kind: "js", source: src, manifest: { id: id, api: parseInt(h.api || API_VERSION, 10) || API_VERSION }, file: file.name, size: u8.length,
      category: h.category || null, iconKey: h.icon || null, order: parseInt(h.order || "0", 10) || 0, defaultOn: /^(on|true|yes)$/i.test(h["default"] || ""), needs: h.needs || "" };
  }

  function iconFrom(zip, path) {
    if (!path || !zip.has(path)) return Promise.resolve(null);
    return zip.bytes(path).then(function (b) { return b.length <= 262144 ? dataUrl(b, /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png") : null; }, function () { return null; });
  }

  function fromOcZip(file, u8, zip) {
    return zip.text("oneclient.mod.json").then(function (txt) {
      var m = JSON.parse(txt), id = clean(m.id || baseName(file.name).replace(/\.[^.]+$/, "")), main = m.main || "main.js";
      if (!id) throw new Error("oneclient.mod.json has no id");
      if (!zip.has(main)) throw new Error("the package has no " + main);
      if (m.api && m.api > API_VERSION) throw new Error("needs mod API " + m.api + " but this OneClient has " + API_VERSION);
      return iconFrom(zip, m.icon).then(function (icon) {
        return { id: id, name: m.name || id, version: String(m.version || "1.0"), author: Array.isArray(m.authors) ? m.authors.join(", ") : (m.author || ""), description: m.description || "", icon: icon, kind: "oc", main: main, zip: u8.slice().buffer, manifest: m, file: file.name, size: u8.length };
      });
    });
  }

  /* real Minecraft mod jars: read the metadata of every loader that has some */
  function tomlValue(block, key) {
    var m = new RegExp("^\\s*" + key + "\\s*=\\s*(?:'''([\\s\\S]*?)'''|\"\"\"([\\s\\S]*?)\"\"\"|\"([^\"]*)\"|'([^']*)')", "m").exec(block);
    return m ? (m[1] || m[2] || m[3] || m[4] || "").trim() : "";
  }
  function jarInfo(zip) {
    var p = Promise.resolve(null);
    function attempt(name, fn) { p = p.then(function (got) { return got || (zip.has(name) ? zip.text(name).then(function (t) { try { return fn(t); } catch (e) { return null; } }) : null); }); }
    attempt("fabric.mod.json", function (t) {
      var j = JSON.parse(t.replace(/^\ufeff/, "")), authors = (j.authors || []).map(function (a) { return typeof a === "string" ? a : a.name; }).filter(Boolean), ic = j.icon;
      if (ic && typeof ic === "object") { var ks = Object.keys(ic).sort(function (a, b) { return b - a; }); ic = ic[ks[0]]; }
      return { loader: "Fabric", id: j.id, name: j.name || j.id, version: j.version, description: j.description || "", author: authors.join(", "), icon: ic || "", depends: j.depends || {}, environment: j.environment || "*", entry: Object.keys(j.entrypoints || {}) };
    });
    attempt("quilt.mod.json", function (t) {
      var j = JSON.parse(t), q = j.quilt_loader || {}, md = q.metadata || {}, deps = {};
      (q.depends || []).forEach(function (d) { if (d && d.id) deps[d.id] = d.versions || "*"; });
      return { loader: "Quilt", id: q.id, name: md.name || q.id, version: q.version, description: md.description || "", author: Object.keys(md.contributors || {}).join(", "), icon: md.icon || "", depends: deps, environment: "*", entry: Object.keys(q.entrypoints || {}) };
    });
    ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"].forEach(function (name, i) {
      attempt(name, function (t) {
        var mods = t.split(/^\s*\[\[mods\]\]/m)[1] || "", id = tomlValue(mods, "modId");
        if (!id) return null;
        var mc = /modId\s*=\s*["']minecraft["'][\s\S]*?versionRange\s*=\s*["']([^"']+)["']/.exec(t);
        return { loader: i === 0 ? "NeoForge" : "Forge", id: id, name: tomlValue(mods, "displayName") || id, version: tomlValue(mods, "version"), description: tomlValue(mods, "description"), author: tomlValue(mods, "authors") || tomlValue(t, "authors"), icon: tomlValue(mods, "logoFile"), depends: mc ? { minecraft: mc[1] } : {}, environment: "*", entry: [] };
      });
    });
    attempt("mcmod.info", function (t) {
      var j = JSON.parse(t), o = Array.isArray(j) ? j[0] : (j.modList ? j.modList[0] : j);
      return o && o.modid ? { loader: "Forge (legacy)", id: o.modid, name: o.name || o.modid, version: o.version, description: o.description || "", author: (o.authorList || []).join(", "), icon: o.logoFile || "", depends: {}, environment: "*", entry: [] } : null;
    });
    return p;
  }

  function countFolder(zip, prefix) { var n = 0; zip.z.entries.forEach(function (e) { if (e.name.indexOf(prefix) === 0 && e.name.charAt(e.name.length - 1) !== "/") n++; }); return n; }

  function bundled(id) {                               // the embedded port of a known mod: Uint8Array of its .ocmod zip, or null
    var el = document.querySelector('script.oc-mod[data-id="' + id + '"]');
    return el ? OC.zip.b64(el.textContent) : null;
  }

  /* ---------- installing ---------- */
  function validate(pkg) {
    if (!pkg.id) throw new Error("no mod id");
    if (pkg.kind === "oc" && !pkg.zip) throw new Error("empty package");
    if (recs[pkg.id] && recs[pkg.id].builtin && !pkg.builtin) throw new Error("the id \"" + pkg.id + "\" belongs to a mod that is built into OneClient; give your mod another @id");
  }

  function install(pkg, opts) {
    opts = opts || {};
    validate(pkg);
    var old = recs[pkg.id], rec = {
      id: pkg.id, name: pkg.name, version: pkg.version, author: pkg.author, description: pkg.description, icon: pkg.icon || null,
      kind: pkg.kind, main: pkg.main || null, zip: pkg.zip || null, source: pkg.source || null, manifest: pkg.manifest || {},
      file: pkg.file, size: pkg.size, added: Date.now(), updated: old ? Date.now() : 0,
      enabled: old && !old.unsupported ? old.enabled : opts.enabled !== false, via: pkg.via || null, jar: pkg.jar || null, unsupported: !!pkg.unsupported,
      builtin: !!pkg.builtin, builtinHash: pkg.builtinHash || null, category: pkg.category || null, iconKey: pkg.iconKey || null, order: pkg.order || 0, needs: pkg.needs || ""
    };
    if (old && old.added) rec.added = old.added;
    var wasRunning = !!(inst[rec.id] && inst[rec.id].active);
    return putRec(rec).then(function () {
      if (wasRunning) stop(rec.id, true);
      recs[rec.id] = rec;
      S.mods["x:" + rec.id] = !!rec.enabled && !rec.unsupported;
      OC.save();
      if (rec.enabled && !rec.unsupported) start(rec);
      changed();
      return { rec: rec, updated: !!old };
    });
  }

  function remove(id) {
    var rec = recs[id];
    if (!rec || rec.builtin) return Promise.resolve(false);         // a built-in mod can be switched off, not removed
    stop(id, true);
    delete recs[id]; delete inst[id];
    delete S.mods["x:" + id]; delete S.modcfg[id];
    try { for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (k && k.indexOf("oneclient.mod." + id + ".") === 0) localStorage.removeItem(k); } } catch (e) {}
    OC.save();
    return delRec(id).then(function () { changed(); return true; });
  }

  function setEnabled(id, on) {
    var rec = recs[id];
    if (!rec || rec.unsupported) return Promise.resolve(false);
    on = !!on;
    rec.enabled = on;
    S.mods["x:" + id] = on;
    OC.save();
    if (on) start(rec); else stop(id, true);
    changed();
    if (rec.builtin) return Promise.resolve(true);                  // built-in mods live in the page: only the on/off switch (S.mods) is remembered
    if (OC.profiles && OC.profiles.active()) return Promise.resolve(true);     // a server's own settings are in force: its on/off choices are kept with the server, not as the stored state of the mod
    return putRec(rec).then(function () { return true; });
  }

  /* ---------- the files a user hands us ---------- */
  function handleFile(file) {
    var name = baseName(file.name), e = ext(name), rep = { file: name, ok: false, title: name, lines: [], warn: false };
    return readFile(file).then(function (u8) {
      if (e === "js") {
        var pkg = fromJs(file, u8);
        return install(pkg).then(function (r) { rep.ok = true; rep.title = (r.updated ? "Updated " : "Loaded ") + pkg.name + " " + pkg.version; rep.id = pkg.id; return rep; });
      }
      if (e === "ocmod" || e === "zip" || e === "jar") return handleZip(file, u8, rep);
      if (CONTENT_EXTS[e]) return handleContent(file, u8, e, rep);
      rep.title = name; rep.warn = true; rep.lines.push("Not a file OneClient can load. Mods are .js, .ocmod or .jar files; schematics are .litematic, .schem or .nbt.");
      return rep;
    }).catch(function (err) { rep.ok = false; rep.warn = true; rep.title = name; rep.lines.push(String(err && err.message || err)); return rep; });
  }

  function handleZip(file, u8, rep) {
    var zip;
    try { zip = openZip(u8); } catch (e) { throw new Error("not a valid zip file (" + e.message + ")"); }
    if (zip.has("oneclient.mod.json")) {
      return fromOcZip(file, u8, zip).then(function (pkg) {
        return install(pkg).then(function (r) { rep.ok = true; rep.title = (r.updated ? "Updated " : "Loaded ") + pkg.name + " " + pkg.version; rep.id = pkg.id; return rep; });
      });
    }
    return jarInfo(zip).then(function (info) {
      if (!info) {
        if (zip.has("pack.mcmeta")) { rep.warn = true; rep.title = baseName(file.name); rep.lines.push("This is a resource pack, not a mod. Add it in Options > Resource Packs."); return rep; }
        throw new Error("no oneclient.mod.json and no Minecraft mod metadata found in this file");
      }
      return handleJar(file, u8, zip, info, rep);
    });
  }

  function handleJar(file, u8, zip, info, rep) {
    var id = clean(info.id), ad = ADAPTERS[id], mc = info.depends && info.depends.minecraft;
    var assets = countFolder(zip, "assets/"), data = countFolder(zip, "data/");
    rep.title = info.name + " " + (info.version || "") + " (" + info.loader + " mod)";
    return iconFrom(zip, info.icon).then(function (icon) {
      if (ad) {
        var b = bundled(ad.bundle);
        if (!b) throw new Error("OneClient's " + ad.name + " port is missing from this build");
        return fromOcZip({ name: ad.bundle + ".ocmod" }, b, openZip(b)).then(function (pkg) {
          pkg.via = "jar"; pkg.jar = { file: baseName(file.name), name: info.name, version: info.version, loader: info.loader, size: u8.length };
          if (icon && !pkg.icon) pkg.icon = icon;
          return install(pkg).then(function (r) {
            rep.ok = true; rep.id = pkg.id;
            rep.lines.push("OneClient has its own " + ad.name + " port and it is now active. The jar's Java code cannot run inside this WebAssembly build, so the port is what runs.");
            rep.lines.push("Load schematics (" + ad.exts.map(function (x) { return "." + x; }).join(", ") + ") with the same Load mods button, or from the " + ad.name + " page.");
            return rep;
          });
        });
      }
      var note = libraryNote(id);
      if (note) {
        rep.ok = false; rep.warn = true;
        rep.lines.push(note + " It does nothing on its own: other mods need it to run on the Java game.");
        rep.lines.push("OneClient's ports do not use it, so there is nothing to add. This jar was not added to your mods.");
        return rep;
      }
      var pkg = { id: id, name: info.name, version: String(info.version || ""), author: info.author, description: info.description, icon: icon, kind: "jar", manifest: { loader: info.loader, depends: info.depends, environment: info.environment, entrypoints: info.entry, assets: assets, data: data }, file: baseName(file.name), size: u8.length, unsupported: true };
      return install(pkg, { enabled: false }).then(function () {
        rep.ok = false; rep.warn = true; rep.id = id;
        rep.lines.push("Real Minecraft mods are Java code. This client is the game compiled to WebAssembly: there is no Java VM, no class loading and no mixins in it, so the code of " + info.name + " cannot run here.");
        if (assets || data) rep.lines.push("It does ship " + assets + " asset and " + data + " data files; they are not applied automatically.");
        rep.lines.push("Mods written for OneClient (.js / .ocmod) load fine, and OneClient has ports of some popular mods (Litematica).");
        return rep;
      });
    });
  }

  function handleContent(file, u8, e, rep) {
    var h = findHandler(e), ad = CONTENT_EXTS[e];
    function deliver() {                                              // a mod that was just installed or switched on registers its handler a moment later
      return new Promise(function (resolve, reject) {
        var t0 = Date.now();
        (function look() {
          var hh = findHandler(e);
          if (hh) return resolve(hh);
          if (Date.now() - t0 > 8000) return reject(new Error("the mod that handles ." + e + " files did not start"));
          setTimeout(look, 40);
        })();
      }).then(function (hh) {
        rep.ok = true; rep.title = "Opened " + baseName(file.name);
        return Promise.resolve(hh.fn({ name: baseName(file.name), ext: e, bytes: u8, file: file }));
      }).then(function () { return rep; });
    }
    if (h) return deliver();
    var rec = recs[ad.bundle];
    if (rec && rec.enabled) return deliver();                         // enabled but still starting: handler will be there
    var b = bundled(ad.bundle);
    if (!b) throw new Error("no mod handles ." + e + " files");
    return fromOcZip({ name: ad.bundle + ".ocmod" }, b, openZip(b)).then(function (pkg) {
      pkg.via = "content";
      return (rec ? setEnabled(rec.id, true) : install(pkg));
    }).then(function () {
      rep.lines.push(ad.name + " was installed and switched on to open this file.");
      return deliver();
    });
  }
  function findHandler(e) {
    for (var i = 0; i < fileHandlers.length; i++) if (fileHandlers[i].exts.indexOf(e) >= 0) return fileHandlers[i];
    return null;
  }

  /* addFiles(FileList | File[]) -> Promise<[report]> ; each report: { file, ok, warn, title, lines[], id } */
  L.addFiles = function (files) {
    var list = Array.prototype.slice.call(files), out = [], chain = whenReadyP();
    list.forEach(function (f) { chain = chain.then(function () { return handleFile(f); }).then(function (r) { out.push(r); }); });
    return chain.then(function () { return out; });
  };
  function whenReadyP() { return new Promise(function (res) { whenReady(res); }); }

  /* ---------- running mods ---------- */
  function sub(name, fn, owner) {
    var o = { fn: fn, owner: owner };
    (busSubs[name] = busSubs[name] || []).push(o);
    return function () { var l = busSubs[name], i = l ? l.indexOf(o) : -1; if (i >= 0) l.splice(i, 1); };
  }
  function pub(name, a, b, c) {
    var l = busSubs[name];
    if (!l) return;
    for (var i = 0; i < l.length; i++) {
      var o = l[i];
      try { o.fn(a, b, c); } catch (e) { crash(o.owner, e, "event " + name); }
    }
  }
  function crash(id, e, where) {
    var it = inst[id];
    console.error("[OneClient mod " + id + "] error in " + where + ":", e);
    if (!it) return;
    it.log("error", where + ": " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    it.errors++;
    if (it.errors === 8) { it.error = "Switched off after repeated errors: " + (e && e.message || e); setEnabled(id, false); changed(); }
  }

  function cfgStore(id) { return S.modcfg[id] || (S.modcfg[id] = {}); }
  function lsKey(id, k) { return "oneclient.mod." + id + "." + k; }
  var KEYNAME = function (c) { return OC.mods && OC.mods.keyLabel ? OC.mods.keyLabel(c) : c; };

  function makeApi(it) {
    var rec = it.rec, id = rec.id;
    var dispose = it.dispose, settingsSubs = [];
    function track(fn) { dispose.push(fn); return fn; }
    var logs = it.logs;
    it.log = function (level, text) { logs.push(level + ": " + text); if (logs.length > 200) logs.shift(); };
    function logger(level) {
      return function () {
        var args = Array.prototype.slice.call(arguments), line = args.map(function (a) { try { return typeof a === "string" ? a : JSON.stringify(a); } catch (e) { return String(a); } }).join(" ");
        it.log(level, line);
        (level === "error" ? console.error : level === "warn" ? console.warn : console.log).apply(console, ["[" + rec.name + "]"].concat(args));
      };
    }

    /* settings */
    var schema = [];
    function defOf(k) { for (var i = 0; i < schema.length; i++) if (schema[i].k === k) return schema[i].def; return undefined; }
    var settings = {
      define: function (list) {
        schema = (list || []).map(function (st) {
          var o = Object.assign({}, st);
          o.k = st.k || st.key; o.def = st.def !== undefined ? st.def : st["default"];
          if (o.type === "choice") o.opts = (st.opts || st.options || []).map(function (x) { return Array.isArray(x) ? x : [x, String(x)]; });
          return o;
        });
        it.schema = schema; changed();
      },
      get: function (k) { var c = cfgStore(id); return c[k] !== undefined ? c[k] : defOf(k); },
      set: function (k, v) {
        cfgStore(id)[k] = v; OC.save();
        for (var i = 0; i < settingsSubs.length; i++) { try { settingsSubs[i](k, v); } catch (e) { crash(id, e, "settings.onChange"); } }
        OC.emit("cfg-ext", id, k);
      },
      all: function () { var o = {}; schema.forEach(function (st) { if (st.k) o[st.k] = settings.get(st.k); }); return o; },
      onChange: function (fn) { settingsSubs.push(fn); return track(function () { var i = settingsSubs.indexOf(fn); if (i >= 0) settingsSubs.splice(i, 1); }); },
      reset: function () { delete S.modcfg[id]; OC.save(); schema.forEach(function (st) { if (st.k) for (var i = 0; i < settingsSubs.length; i++) { try { settingsSubs[i](st.k, settings.get(st.k)); } catch (e) {} } }); OC.emit("cfg-ext", id, null); }
    };
    /* the stored values were replaced from outside (a server's own settings came in or went out): tell the mod about every value */
    it.refreshSettings = function () {
      schema.forEach(function (st) { if (st.k) for (var i = 0; i < settingsSubs.length; i++) { try { settingsSubs[i](st.k, settings.get(st.k)); } catch (e) { crash(id, e, "settings.onChange"); } } });
    };

    /* storage: small values in localStorage, bigger blobs in IndexedDB */
    var storage = {
      get: function (k, d) { try { var v = localStorage.getItem(lsKey(id, k)); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
      set: function (k, v) { try { localStorage.setItem(lsKey(id, k), JSON.stringify(v)); return true; } catch (e) { return false; } },
      remove: function (k) { try { localStorage.removeItem(lsKey(id, k)); } catch (e) {} },
      keys: function () { var o = [], p = lsKey(id, ""); try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(p) === 0) o.push(k.slice(p.length)); } } catch (e) {} return o; }
    };
    var files = {
      save: function (name, data) { var buf = data instanceof ArrayBuffer ? data : (ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : enc.encode(String(data)).buffer); return tx("blobs", "readwrite", function (s) { s.put({ id: id, name: name, data: buf, size: buf.byteLength, at: Date.now() }); }); },
      load: function (name) { return tx("blobs", "readonly", function (s) { return s.get([id, name]); }).then(function (r) { return r ? r.data : null; }); },
      list: function () { return tx("blobs", "readonly", function (s) { return s.getAll(IDBKeyRange.bound([id, ""], [id, "\uffff"])); }).then(function (l) { return l.map(function (r) { return { name: r.name, size: r.size, at: r.at }; }); }); },
      remove: function (name) { return tx("blobs", "readwrite", function (s) { s.delete([id, name]); }); }
    };

    /* files shipped inside the package */
    var pkgZip = null;
    function zipOf() { if (!pkgZip && rec.zip) pkgZip = openZip(new Uint8Array(rec.zip)); return pkgZip; }
    var assets = {
      list: function () { var z = zipOf(); return z ? z.z.entries.map(function (e) { return e.name; }).filter(function (n) { return n.charAt(n.length - 1) !== "/"; }) : []; },
      has: function (p) { var z = zipOf(); return !!(z && z.has(p)); },
      bytes: function (p) { var z = zipOf(); return z ? z.bytes(p) : Promise.reject(new Error("this mod has no package files")); },
      text: function (p) { return assets.bytes(p).then(function (b) { return dec.decode(b); }); },
      json: function (p) { return assets.text(p).then(function (t) { return JSON.parse(t.replace(/^\ufeff/, "")); }); },
      url: function (p, mime) { return assets.bytes(p).then(function (b) { var u = URL.createObjectURL(new Blob([b], { type: mime || "application/octet-stream" })); track(function () { URL.revokeObjectURL(u); }); return u; }); }
    };

    /* DOM helpers: a click-through layer above the game, and style sheets, both removed with the mod */
    var dom = {
      layer: function (z) {
        var el = document.createElement("div");
        el.setAttribute("data-oc-mod", id);
        el.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:" + (z || 2147482500) + ";";      // just below OneClient's own overlay (2147483000)
        function mount() { (document.body || document.documentElement).appendChild(el); }                    // mods start before the page has a body: wait for it, so the layer sits in the same stacking context as the overlay
        if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
        track(function () { if (el.parentNode) el.parentNode.removeChild(el); });
        return el;
      },
      style: function (css) {
        var el = document.createElement("style");
        el.setAttribute("data-oc-mod", id); el.textContent = css;
        (document.head || document.documentElement).appendChild(el);
        track(function () { if (el.parentNode) el.parentNode.removeChild(el); });
        return el;
      }
    };

    /* key bindings: shown on the mod's settings page, remembered, and only fire while you are playing */
    var keys = {
      register: function (o) {
        var kid = o.id, store = "key:" + kid, binding = { id: kid, label: o.label || kid, def: o.def || o["default"] || "", onDown: o.onDown, onUp: o.onUp, consume: !!o.consume };
        it.keys.push(binding);
        track(function () { var i = it.keys.indexOf(binding); if (i >= 0) it.keys.splice(i, 1); });
        binding.get = function () { var v = cfgStore(id)[store]; return v !== undefined ? v : binding.def; };
        changed();
        return { get: binding.get, name: function () { return KEYNAME(binding.get()); } };
      }
    };

    /* the game */
    var game = {
      get cam() { return OC.sense && OC.sense.cam; },
      get inWorld() { return !!(OC.sense && OC.sense.inWorld); },
      get fps() { return OC.fps; },
      get screen() { return OC.screen; },
      get playing() { return OC.inGame && OC.inGame(); },
      canvas: function () { return document.querySelector("canvas"); },
      project: function (x, y, z) { return OC.sense.project(x, y, z); }
    };
    /* the world the game has loaded, read from the chunk packets it receives (read only; see world.js), the block state table, and the packet layer */
    var W = function () { return OC.world; }, Bk = function () { return OC.blocks; };
    var world = {
      get available() { return !!(OC.world && OC.blocks && OC.blocks.ready && OC.net && OC.net.supported); },
      get ready() { return !!(OC.world && OC.world.ready && OC.net && OC.net.active); },
      get dim() { return OC.world ? OC.world.dim : ""; },
      get minY() { return OC.world ? OC.world.minY : -64; },
      get height() { return OC.world ? OC.world.height : 384; },
      get version() { return OC.world ? OC.world.version : 0; },
      getState: function (x, y, z) { return OC.world ? OC.world.getState(x, y, z) : -1; },
      getBlock: function (x, y, z) { return OC.world ? OC.world.getBlock(x, y, z) : null; },
      isLoaded: function (cx, cz) { return !!OC.world && OC.world.isLoaded(cx, cz); },
      section: function (cx, sy, cz, out) { return OC.world ? OC.world.section(cx, sy, cz, out) : null; },
      palette: function (cx, sy, cz) { return OC.world && OC.world.palette ? OC.world.palette(cx, sy, cz) : null; },
      biomeIndex: function (x, y, z) { return OC.world && OC.world.biomeIndex ? OC.world.biomeIndex(x, y, z) : -1; },
      biomeAt: function (x, y, z) { return OC.world && OC.world.biomeAt ? OC.world.biomeAt(x, y, z) : ""; },
      biomeName: function (i) { return (OC.world && OC.world.biomeNames && OC.world.biomeNames[i]) || ""; },
      chunkVersion: function (cx, cz) { return OC.world ? OC.world.chunkVersion(cx, cz) : -1; },
      chunkKeys: function () { return OC.world ? OC.world.chunkKeys() : []; },
      chunkCount: function () { return OC.world ? OC.world.chunkCount() : 0; },
      onChange: function (fn) { return OC.world ? track(OC.world.onChange(fn)) : function () {}; }
    };
    var blocks = {
      get ready() { return !!(OC.blocks && OC.blocks.ready); },
      get game() { return OC.blocks ? OC.blocks.game : ""; },
      info: function (id) { return Bk() ? Bk().info(id) : null; },
      nameOf: function (id) { return Bk() ? Bk().nameOf(id) : ""; },
      idOf: function (name, props) { return Bk() ? Bk().idOf(name, props) : -1; },
      idOfLoose: function (name, props) { return Bk() ? Bk().idOfLoose(name, props) : -1; },
      defaultId: function (name) { return Bk() ? Bk().defaultId(name) : -1; },
      isAir: function (id) { return !!Bk() && Bk().isAir(id); },
      has: function (name) { return !!Bk() && Bk().has(name); },
      names: function () { return Bk() ? Bk().names() : []; },
      propsOf: function (name) { return Bk() && Bk().propsOf ? Bk().propsOf(name) : []; },
      rangeOf: function (name) { return Bk() && Bk().rangeOf ? Bk().rangeOf(name) : null; }
    };
    var net = {
      get supported() { return !!(OC.net && OC.net.supported); },
      get active() { return !!(OC.net && OC.net.active); },
      get canRewrite() { return !!(OC.net && OC.net.canRewrite); },
      get encrypted() { return !!(OC.net && OC.net.encrypted); },
      get state() { return OC.net ? OC.net.state : "none"; },
      get transport() { return OC.net ? OC.net.transport : ""; },
      get protocol() { return OC.net ? OC.net.protocol : 0; },
      command: function (text) { return !!OC.net && OC.net.command(text); },
      commands: function (list) { return !!OC.net && OC.net.commands(list); },
      chat: function (text) { return !!OC.net && OC.net.chat(text); },
      onPacket: function (dir, packetId, fn) { return OC.net ? track(OC.net.on(dir, packetId, fn)) : function () {}; },
      /* change what the game receives: fn(reader) for each clientbound play packet with this id; return undefined, false (drop) or the new fields */
      rewrite: function (packetId, fn) { return OC.net && OC.net.rewrite ? track(OC.net.rewrite(packetId, fn)) : function () {}; },
      inject: function (packetId, fields) { return !!OC.net && !!OC.net.inject && OC.net.inject(packetId, fields); },
      Writer: OC.net ? OC.net.Writer : null,
      ids: OC.net ? OC.net.IDS : null
    };
    var postOn = {}, fxOn = {};
    var gl = {
      onWorld: function (fn) {
        var off = OC.glx.onWorld(fn, id, function (err) { it.error = "A world-draw hook kept failing: " + (err && err.message || err); changed(); });
        return track(off);
      },
      mat4: OC.glx && OC.glx.mat4,
      /* a batch of lines and quads to draw from a world hook (see gfx.js) */
      batch: function () { return OC.glx.batch(); },
      /* change the game's own projection / fog block as it is uploaded: fn(Float32Array) edits it in place */
      rewrite: function (kind, fn) { return track(OC.glx.rewrite(kind, fn, id)); },
      /* effects on the finished world picture: set("color", { saturation, brightness, contrast }) or set("blur", { amount }); null switches one off */
      post: {
        set: function (name, v) {
          OC.glx.post.set(name, v);
          if (v && !postOn[name]) { postOn[name] = true; track(function () { postOn[name] = false; OC.glx.post.set(name, null); }); }
        }
      },
      /* values of the patches in the game's shaders (block outline, glint, hurt flash ...): see fx.js */
      fx: {
        set: function (name, v) {
          OC.glx.fx.set(name, v);
          if (!fxOn[name]) { fxOn[name] = true; track(function () { fxOn[name] = false; OC.glx.fx.reset(name); }); }
        },
        get: function (name) { return OC.glx.fx.get(name); }
      }
    };

    /* on-screen widgets (draggable in the Right Shift overlay like the built-in ones) */
    var hud = {
      text: function (o) {
        var h = { el: null, widget: null }, wid = "x:" + id + ":" + (o.id || "w" + it.widgets.length), span = document.createElement("span");
        span.className = "oc-chip oc-tag"; span.textContent = o.text || "";
        h.el = span;
        function mount() {
          if (!OC.ui || !OC.ui.addWidget || h.dead) return;
          h.widget = OC.ui.addWidget(wid, "x:" + id, span, function () { return { x: o.x || 10, y: o.y || 200 }; }, false);
        }
        if (OC.ui && OC.ui.built) mount(); else OC.on("ui-built", mount);
        h.set = function (t) { if (span.textContent !== t) span.textContent = t; };
        h.remove = function () { h.dead = true; if (h.widget && OC.ui.removeWidget) OC.ui.removeWidget(wid); };
        it.widgets.push(h);
        track(h.remove);
        return h;
      }
    };

    /* things that open on top of the game */
    var ui = {
      toast: function (msg, bad) { L.toast(msg, bad); },
      pickFiles: function (accept, multiple) { return L.pickFiles(accept, multiple); },
      panel: function (fn) { it.panel = fn; changed(); },
      openSettings: function () { if (OC.ui) OC.ui.openMods(); if (OC.mods && OC.mods.openMod) OC.mods.openMod("x:" + id); },
      refresh: function () { OC.emit("cfg-ext", id, null); }
    };

    var events = {
      on: function (name, fn) { return track(sub(name, fn, id)); }
    };

    /* the player's own state and the entities around, read from the game's packets (see player.js, entities.js) */
    var player = {
      get ready() { return !!(OC.player && OC.net && OC.net.active); },
      get state() { return OC.player || null; },
      onEvent: function (fn) { return OC.player ? track(OC.player.onEvent(fn)) : function () {}; }
    };
    var entities = {
      get ready() { return !!(OC.entities && OC.net && OC.net.active); },
      get: function (eid) { return OC.entities ? OC.entities.get(eid) : undefined; },
      list: function () { return OC.entities ? OC.entities.list() : []; },
      count: function () { return OC.entities ? OC.entities.count() : 0; },
      size: function (name) { return OC.entities ? OC.entities.size(name) : [0.6, 1.8]; },
      typeName: function (t) { return OC.entities ? OC.entities.typeName(t) : "entity_" + t; },
      onChange: function (fn) { return OC.entities ? track(OC.entities.onChange(fn)) : function () {}; }
    };
    /* timers that stop with the mod */
    function every(ms, fn) { var t = setInterval(function () { try { fn(); } catch (e) { crash(id, e, "timer"); } }, ms); return track(function () { clearInterval(t); }); }
    function after(ms, fn) { var t = setTimeout(function () { try { fn(); } catch (e) { crash(id, e, "timer"); } }, ms); return track(function () { clearTimeout(t); }); }
    /* where the player is playing: singleplayer, or the server entry they joined from the Servers page */
    function session() {
      var m = OC.menu && OC.menu.sessionInfo ? OC.menu.sessionInfo() : null;
      return m || { name: "", address: "", mode: "" };
    }

    var api = {
      id: id, name: rec.name, version: rec.version, apiVersion: API_VERSION, manifest: rec.manifest, schemaOnly: false,
      log: logger("info"), info: logger("info"), warn: logger("warn"), error: logger("error"),
      onDisable: function (fn) { dispose.push(fn); },
      every: every, after: after, session: session, player: player, entities: entities,
      get inventory() { return OC.inventory || null; },
      settings: settings, storage: storage, files: files, assets: assets, dom: dom, keys: keys, game: game, gl: gl, hud: hud, ui: ui, events: events, world: world, blocks: blocks, net: net,
      onFile: function (exts, fn) {
        var h = { exts: [].concat(exts).map(function (x) { return String(x).replace(/^\./, "").toLowerCase(); }), fn: fn, owner: id };
        fileHandlers.push(h);
        return track(function () { var i = fileHandlers.indexOf(h); if (i >= 0) fileHandlers.splice(i, 1); });
      },
      get via() { return rec.via; },
      get jar() { return rec.jar; }
    };
    if (OC.kit) api.kit = OC.kit.forMod(api, id, track);
    return api;
  }

  function mainSource(rec) {
    if (rec.kind === "js") return Promise.resolve(rec.source);
    var z = openZip(new Uint8Array(rec.zip));
    return z.text(rec.main || "main.js");
  }

  function start(rec) {
    var old = inst[rec.id];
    if (old && old.active) return;
    var it = inst[rec.id] = { rec: rec, active: false, starting: true, error: null, errors: 0, dispose: [], logs: [], schema: [], keys: [], widgets: [], panel: null, log: function () {} };
    it.api = makeApi(it);
    mainSource(rec).then(function (code) {
      if (inst[rec.id] !== it || it.cancelled) return;
      var fn;
      try { fn = new Function("api", "OneClient", "module", "exports", code + "\n//# sourceURL=oneclient-mod/" + rec.id + "/" + (rec.main || "main.js")); }
      catch (e) { throw new Error("Syntax error: " + e.message); }
      var module = { exports: {} }, ret = fn.call(undefined, it.api, OC, module, module.exports);
      var init = typeof module.exports === "function" ? module.exports : (module.exports && typeof module.exports.init === "function" ? module.exports.init.bind(module.exports) : (typeof ret === "function" ? ret : null));
      return init ? init(it.api) : ret;
    }).then(function () {
      if (inst[rec.id] !== it || it.cancelled) return;
      it.active = true; it.starting = false;
      changed();
    }).catch(function (e) {
      it.starting = false;
      it.error = String(e && e.message || e);
      console.error("[OneClient] mod " + rec.id + " failed to start:", e);
      it.log("error", "start: " + (e && e.stack || e));
      stopDisposers(it);
      changed();
    });
    changed();
  }

  function stopDisposers(it) {
    var d = it.dispose.splice(0).reverse();
    d.forEach(function (fn) { try { fn(); } catch (e) { console.error("[OneClient] cleanup error in " + it.rec.id + ":", e); } });
    it.keys.length = 0; it.widgets.length = 0;
  }
  function stop(id, quiet) {
    var it = inst[id];
    if (!it) return;
    it.cancelled = true;
    stopDisposers(it);
    it.active = false; it.starting = false;
    if (!quiet) changed();
  }

  /* ---------- global input dispatch ---------- */
  function uiBlocks() { return !!((OC.ui && OC.ui.isOpen()) || (OC.menu && OC.menu.blocksKeys && OC.menu.blocksKeys()) || (OC.mods && OC.mods.capturing && OC.mods.capturing())); }
  window.addEventListener("keydown", function (e) {
    if (e.__oc || e.code === "ShiftRight") return;
    var playing = !!(OC.inGame && OC.inGame()) && !uiBlocks();
    pub("key", { code: e.code, key: e.key, repeat: e.repeat, playing: playing, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, event: e });
    if (!playing || e.ctrlKey || e.altKey || e.metaKey) return;
    Object.keys(inst).forEach(function (id) {
      var it = inst[id];
      if (!it.active) return;
      it.keys.forEach(function (b) {
        if (!b.onDown || e.code !== b.get() || !b.get()) return;
        if (e.repeat) { if (b.consume && b.swallowUp) { e.stopImmediatePropagation(); e.preventDefault(); } return; }       // holding the key: the game must not see the repeats either
        try { b.onDown(e); } catch (err) { crash(id, err, "key " + b.id); }
        if (b.consume) { e.stopImmediatePropagation(); e.preventDefault(); b.swallowUp = true; }          // the game must not see the release of a key it never saw pressed
      });
    });
  }, true);
  window.addEventListener("keyup", function (e) {
    if (e.__oc) return;
    pub("keyup", { code: e.code, key: e.key });
    Object.keys(inst).forEach(function (id) {
      var it = inst[id];
      if (!it.active) return;
      it.keys.forEach(function (b) {
        if (!b.get() || e.code !== b.get()) return;
        if (b.onUp) { try { b.onUp(e); } catch (err) { crash(id, err, "key " + b.id); } }
        if (b.swallowUp) { b.swallowUp = false; e.stopImmediatePropagation(); e.preventDefault(); }
      });
    });
  }, true);
  ["mousedown", "mouseup"].forEach(function (t) {
    window.addEventListener(t, function (e) { if (!e.__oc) pub(t, { button: e.button, playing: !!(OC.inGame && OC.inGame()) && !uiBlocks() }); }, true);
  });
  if (OC.sense && OC.sense.onFrame) {
    var wasIn = false;
    OC.sense.onFrame(function (n, world) {
      pub("frame", n, world);
      if (world) pub("world-frame", n);
      if (world !== wasIn) { wasIn = world; pub(world ? "enter-world" : "leave-world"); }
    });
  }
  OC.on("screen", function (s) { pub("screen", s); });
  OC.on("cfg-ext", function (id) { pub("settings:" + id); });

  /* ---------- toast + file picking ---------- */
  var toastEl = null, toastT = 0;
  L.toast = function (msg, bad) {
    if (!document.body) return;
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.id = "oc-modtoast"; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.className = "show" + (bad ? " bad" : "");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.className = ""; }, 4200);
  };
  L.pickFiles = function (accept, multiple) {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file"; input.accept = accept || ""; input.multiple = !!multiple; input.style.display = "none";
      document.body.appendChild(input);
      var done = false;
      function finish(list) { if (done) return; done = true; if (input.parentNode) input.parentNode.removeChild(input); resolve(list); }
      input.addEventListener("change", function () { finish(Array.prototype.slice.call(input.files || [])); });
      input.addEventListener("cancel", function () { finish([]); });
      input.click();
    });
  };

  /* ---------- built-in mods ----------
   * mods-src/lunar/*.js ship inside the page as <script type="text/oc-builtin" data-id="...">: one-file mods like any other, except that
   * they are always there (they can be switched off, not removed), their on/off switch is remembered with the other switches (S.mods)
   * and they are not copied into IndexedDB. Their settings can be shown while they are off: the code runs once with api.schemaOnly set,
   * defines its settings (and key bindings) and returns before it touches the game. */
  var schemaCache = {};
  function cachedSchema(id) {
    var c = schemaCache[id];
    if (c) return c;
    c = schemaCache[id] = { schema: [], keys: [] };
    var rec = recs[id];
    if (!rec || !rec.builtin || rec.unsupported || !rec.source) return c;
    var it = { rec: rec, active: false, starting: false, error: null, errors: 0, dispose: [], logs: [], schema: [], keys: [], widgets: [], panel: null, log: function () {}, schemaOnly: true };
    silent++;
    try {
      var api = makeApi(it);
      api.schemaOnly = true;
      var fn = new Function("api", "OneClient", "module", "exports", rec.source + "\n//# sourceURL=oneclient-mod/" + id + "/settings.js");
      fn.call(undefined, api, OC, { exports: {} }, {});
      c.schema = it.schema.slice();
      c.keys = it.keys.map(function (b) { return { id: b.id, label: b.label, def: b.def }; });
    } catch (e) { console.warn("[OneClient] could not read the settings of " + id + ": " + (e && e.message || e)); }
    finally { try { stopDisposers(it); } catch (e2) {} silent--; }
    return c;
  }
  function schemaDef(id, k) {
    var sc = cachedSchema(id).schema;
    for (var i = 0; i < sc.length; i++) if (sc[i].k === k) return sc[i].def;
    return undefined;
  }
  function loadBuiltins() {
    var els = document.querySelectorAll('script[type="text/oc-builtin"]');
    Array.prototype.forEach.call(els, function (el) {
      try {
        var src = el.textContent, pkg = fromJs({ name: (el.getAttribute("data-id") || "mod") + ".js" }, enc.encode(src)), k = "x:" + pkg.id;
        var on = typeof S.mods[k] === "boolean" ? S.mods[k] : !!pkg.defaultOn;
        recs[pkg.id] = {
          id: pkg.id, name: pkg.name, version: pkg.version, author: pkg.author || "OneClient", description: pkg.description, icon: null, kind: "js", main: null, zip: null, source: src,
          manifest: pkg.manifest, file: "built in", size: src.length, added: 0, updated: 0, enabled: on, via: null, jar: null, unsupported: false,
          builtin: true, builtinHash: el.getAttribute("data-hash") || null, category: pkg.category || "Utility", iconKey: pkg.iconKey || null, order: pkg.order || 0, needs: pkg.needs || ""
        };
        S.mods[k] = on;
      } catch (e) { console.warn("[OneClient] built-in mod " + el.getAttribute("data-id") + " is broken: " + (e && e.message || e)); }
    });
  }

  /* ---------- what the Mods menu shows ---------- */
  L.list = function () {
    return Object.keys(recs).map(function (id) { return L.info(id); }).sort(function (a, b) {
      if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
      if (a.builtin && a.order !== b.order) return a.order - b.order;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
  };
  L.info = function (id) {
    var rec = recs[id], it = inst[id];
    if (!rec) return null;
    return {
      id: id, k: "x:" + id, name: rec.name, version: rec.version, author: rec.author, description: rec.description, icon: rec.icon, kind: rec.kind, file: rec.file, size: rec.size,
      enabled: !!rec.enabled && !rec.unsupported, unsupported: !!rec.unsupported, via: rec.via, jar: rec.jar, manifest: rec.manifest,
      builtin: !!rec.builtin, category: rec.category || null, iconKey: rec.iconKey || null, order: rec.order || 0, needs: rec.needs || "",
      active: !!(it && it.active), starting: !!(it && it.starting), error: (it && it.error) || null,
      schema: it && it.active ? it.schema : (cachedSchema(id).schema), keys: it && it.active ? it.keys : (cachedSchema(id).keys), panel: it ? it.panel : null, logs: it ? it.logs : [], added: rec.added
    };
  };
  L.remove = remove;
  L.setEnabled = setEnabled;
  /* settings of a mod that is not running (a built-in mod switched off) are read and written straight from the stored values and the defaults it declared */
  L.cfgGet = function (id, k) {
    var it = inst[id];
    if (it && it.schema && it.schema.length) return it.api.settings.get(k);
    var c = S.modcfg[id];
    return c && c[k] !== undefined ? c[k] : schemaDef(id, k);
  };
  L.cfgSet = function (id, k, v) {
    var it = inst[id];
    if (it && it.active) it.api.settings.set(k, v);
    else { cfgStore(id)[k] = v; OC.save(); OC.emit("cfg-ext", id, k); }
  };
  L.keyGet = function (id, kid) {
    var c = cfgStore(id)["key:" + kid];
    if (c !== undefined) return c;
    var it = inst[id], list = it && it.keys.length ? it.keys : cachedSchema(id).keys, b = list.filter(function (x) { return x.id === kid; })[0];
    return b ? b.def : "";
  };
  L.keySet = function (id, kid, v) { cfgStore(id)["key:" + kid] = v; OC.save(); OC.emit("cfg-ext", id, "key:" + kid); };
  L.refreshSettings = function (id) { var it = inst[id]; if (it && it.active && it.refreshSettings) it.refreshSettings(); OC.emit("cfg-ext", id, null); };
  L.resetCfg = function (id) { var it = inst[id]; if (it && it.active) it.api.settings.reset(); else { delete S.modcfg[id]; OC.save(); OC.emit("cfg-ext", id, null); } };
  L.bundledAvailable = function (id) { return !!bundled(id); };
  L.adapters = ADAPTERS;
  L.fileHandlers = function () { return fileHandlers.map(function (h) { return { exts: h.exts.slice(), owner: h.owner }; }); };
  L.onChange = function (fn) { OC.on("loader-changed", fn); };

  /* the Mods menu toggles S.mods["x:<id>"] through OC.setMod: follow it */
  OC.on("mod", function (k, on) {
    if (typeof k !== "string" || k.indexOf("x:") !== 0) return;
    var id = k.slice(2), rec = recs[id];
    if (!rec) return;
    if (rec.unsupported) { S.mods[k] = false; OC.save(); changed(); return; }
    if (!!rec.enabled !== !!on) setEnabled(id, on);
  });

  /* ---------- boot: load the stored mods and start the enabled ones ---------- */
  function boot(list) {
    list.forEach(function (rec) { recs[rec.id] = rec; S.mods["x:" + rec.id] = !!rec.enabled && !rec.unsupported; });
    loadBuiltins();                                                  // built-in mods win over a stored mod with the same id
    ready = true; L.ready = true;
    Object.keys(recs).forEach(function (id) { var rec = recs[id]; if (rec.enabled && !rec.unsupported) start(rec); });
    readyCbs.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
    changed();
  }
  allRecs().then(boot, function (e) { console.warn("[OneClient] mod storage unavailable:", e); boot([]); });
})();
