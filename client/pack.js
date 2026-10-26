/* OneClient first-run setup: default resource packs + default settings.
 *
 * Every bundled pack (<script class="oc-pack">) is written into the game's own virtual filesystem
 * exactly the way the in-game "Import Pack" button does (one record per file under
 * resourcepacks/<name>/), then added to the game's saved settings so it is selected. Each pack is
 * installed once per version: after that it is an ordinary pack that players can switch off or
 * delete in Options > Resource Packs, and it is never added back. A pack bundled with "enabled": false
 * (data-enabled="false") is installed the same way but not selected: it waits in the list for the player.
 *
 * The same pass applies a few one-time default settings (GUI scale 2, no multiplayer caution screen).
 *
 * The game keeps its settings in localStorage "_eaglercraftX.g" (gzip + base64 of options.txt); the
 * options.txt copy in the filesystem is only an echo and is ignored at boot, so that is the entry we
 * patch. The game opens its filesystem ~8 s after the WASM starts compiling, so we hold the WASM
 * compile calls until we are done (hard timeout, so a failure can never block the game). */
(function () {
  "use strict";

  var OC = window.OneClient;
  var FS_DB = "_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_worlds";
  var G_KEY = "_eaglercraftX.g";
  var DEFAULTS_FLAG = "oneclient.defaults";      // highest defaults step already applied on this profile
  var DEFAULT_STEPS = [                           // each step is applied once per profile, so a new step never undoes a setting the player changed
    { v: 2, values: { guiScale: "2" } },
    { v: 3, values: { skipMultiplayerWarning: "true" } },  // no "Caution: Third-Party Online Play" screen before Multiplayer
    { v: 4, fresh: true, values: { eaglerPerformanceCounters: "false" } }   // new profiles only: OneClient has its own FPS and TPS widgets, the game's text would sit on top of them
  ];
  var DEFAULTS_VERSION = String(DEFAULT_STEPS[DEFAULT_STEPS.length - 1].v);
  var DEFAULTS = {};      // applied once per profile; the player can change them afterwards
  /* Packs earlier builds installed that are not packs any more: the "OneClient" pack carried the screen markers, which now live in the
   * game's own assets (always on, nothing in the Resource Packs list). Profiles that still have it get it removed once. */
  var RETIRED = ["OneClient"], retired = [];
  var TIMEOUT_MS = 25000;

  OC.zip = { read: readZip, bytes: entryBytes, b64: b64ToBytes };     // shared with menu.js (panorama images)

  /* ---- relays ----
   * Browsers cannot open a TCP socket, so the game reaches a Minecraft server through a "multiplayer relay" (wss://<relay>/minecraft?target=host:port)
   * and shares a LAN world through a "P2P relay". It starts with two relays but only writes its list (localStorage, base64 JSON) once the Relays screen
   * has been closed, so on a new profile the list is empty for everything that reads it (the server dialog said "No multiplayer relay is set up").
   * This is the list the players start with, checked against the live relays: the game's own public 26.2 relay for multiplayer, and two shared-world
   * relays for LAN worlds that answer the relay protocol (the game's own first relay, relay.deev.is, is down, so it is left out; the game also
   * swaps the old Cloudflare relay for the Heroku one by itself, so that one is not used either). It is written once per profile: a new profile gets it,
   * a profile that still has the game's untouched list is upgraded to it, and a list the player changed is left alone. menu.js reads
   * OC.relays.defaults while no list is saved. */
  var RELAY_KEY = "_eaglercraftX.relay.list.v3", RELAY_FLAG = "oneclient.relays", RELAY_STEP = 1;
  var RELAYS = [
    { name: "lax1dude relay #2", address: "wss://relay.lax1dude.net", capability: "singleplayer", detected: "singleplayer", "private": false },
    { name: "Heroku public relay", address: "wss://oxer-26-2-relay-c5f9ad499e09.herokuapp.com", capability: "auto", detected: "both", "private": false },
    { name: "Eagler public relay", address: "wss://relay.shhnowisnottheti.me", capability: "singleplayer", detected: "singleplayer", "private": false }
  ];
  var OLD_DEFAULTS = ["wss://relay.deev.is", "wss://oxer-26-2-relay-c5f9ad499e09.herokuapp.com"];   // the game's own list before anybody touched it
  OC.relays = { key: RELAY_KEY, defaults: RELAYS };
  function relayKey(a) { return String(a || "").trim().toLowerCase().replace(/\/+$/, ""); }
  function seedRelays() {
    try {
      if ((parseInt(localStorage.getItem(RELAY_FLAG) || "0", 10) || 0) >= RELAY_STEP) return;
      var raw = localStorage.getItem(RELAY_KEY), list = null, i;
      if (raw) {
        var bin = atob(raw), u8 = new Uint8Array(bin.length);
        for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        list = JSON.parse(new TextDecoder("utf-8").decode(u8));
        if (!Array.isArray(list)) return;                                         // not a list we understand: leave it alone
      }
      var untouched = !!list && list.length === OLD_DEFAULTS.length && list.every(function (r, n) { return r && relayKey(r.address) === OLD_DEFAULTS[n]; });
      if (list && !untouched) { localStorage.setItem(RELAY_FLAG, String(RELAY_STEP)); return; }     // the player's own list
      var bytes = new TextEncoder().encode(JSON.stringify(RELAYS)), s = "";
      for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      localStorage.setItem(RELAY_KEY, btoa(s));
      localStorage.setItem(RELAY_FLAG, String(RELAY_STEP));
    } catch (e) { /* no storage, or odd contents: the menus fall back to OC.relays.defaults */ }
  }
  seedRelays();

  if (typeof DecompressionStream !== "function" || typeof CompressionStream !== "function" || !window.indexedDB) return;

  /* which packs / defaults still need installing on this profile? */
  var packs = [], needDefaults = false;
  try {
    var legacy = localStorage.getItem("oneclient.pack.seeded");   // v1 builds installed just Vanilla+
    [].forEach.call(document.querySelectorAll("script.oc-pack"), function (el) {
      var name = el.getAttribute("data-name"), id = el.getAttribute("data-id"), key = "oneclient.pack." + name;
      if (legacy && legacy === id && localStorage.getItem(key) !== id) localStorage.setItem(key, id);
      if (localStorage.getItem(key) !== id) packs.push({ el: el, name: name, id: id, key: key, on: el.getAttribute("data-enabled") !== "false" });
    });
    var applied = parseInt(localStorage.getItem(DEFAULTS_FLAG) || "0", 10) || 0;
    DEFAULT_STEPS.forEach(function (st) { if (st.v > applied && (!st.fresh || applied === 0)) Object.keys(st.values).forEach(function (k) { DEFAULTS[k] = st.values[k]; }); });
    needDefaults = Object.keys(DEFAULTS).length > 0;
    RETIRED.forEach(function (n) { if (localStorage.getItem("oneclient.pack." + n)) retired.push(n); });
  } catch (e) { return; }
  if (!packs.length && !needDefaults && !retired.length) return;

  OC.pack = { state: "installing", packs: packs.map(function (p) { return p.name; }), defaults: needDefaults };

  var enc = new TextEncoder(), dec = new TextDecoder("utf-8");

  /* ---- minimal zip reader (central directory; stored + deflate) ---- */
  function readZip(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), eocd = -1, i;
    for (i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("zip: end of central directory not found");
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    var utf8 = new TextDecoder("utf-8"), out = [];
    for (i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip: bad central header");
      var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      out.push({
        name: utf8.decode(u8.subarray(p + 46, p + 46 + nl)),
        method: dv.getUint16(p + 10, true),
        csize: dv.getUint32(p + 20, true),
        local: dv.getUint32(p + 42, true)
      });
      p += 46 + nl + xl + cl;
    }
    return { entries: out, dv: dv };
  }

  function pipe(bytes, transform) {
    return new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer();
  }

  function entryBytes(u8, zip, e) {
    var dv = zip.dv, lh = e.local;
    if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error("zip: bad local header for " + e.name);
    var start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
    var comp = u8.subarray(start, start + e.csize);
    if (e.method === 0) return Promise.resolve(comp.slice().buffer);
    if (e.method !== 8) throw new Error("zip: unsupported compression " + e.method);
    return pipe(comp, new DecompressionStream("deflate-raw"));
  }

  function b64ToBytes(b64) {
    var bin = atob(b64.replace(/\s+/g, "")), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s);
  }

  /* A pack that says it only supports an older format would be flagged "incompatible" and dropped
   * from the player's settings. Our bundled packs are known to work, so declare them compatible. */
  function fixMcmeta(buf) {
    try {
      var j = JSON.parse(dec.decode(buf)), p = j.pack || {}, mx = p.max_format;
      var major = Array.isArray(mx) ? mx[0] : (typeof mx === "number" ? mx : null);
      if (major === null && typeof p.pack_format === "number") { p.min_format = [p.pack_format, 0]; major = 0; }
      if (major !== null && major < 1000) {
        p.max_format = [1000, 0];
        delete p.supported_formats;
        j.pack = p;
        return enc.encode(JSON.stringify(j)).buffer;
      }
    } catch (e) { /* leave it as shipped */ }
    return buf;
  }

  function packRecords(p) {
    var u8 = b64ToBytes(p.el.textContent);
    var zip = readZip(u8), dir = "resourcepacks/" + p.name + "/", records = [], chain = Promise.resolve();
    var files = zip.entries.filter(function (e) {
      var n = e.name, base = n.slice(n.lastIndexOf("/") + 1);
      return n.charAt(n.length - 1) !== "/" && n.charAt(0) !== "/" && n.split("/").indexOf("..") < 0
        && base.charAt(0) !== "." && n.indexOf("__MACOSX/") < 0;   // skip macOS junk (.DS_Store, ._*) the game would log errors for
    });
    for (var b = 0; b < files.length; b += 24) {          // small batches: never hold hundreds of streams open at once
      (function (batch) {
        chain = chain.then(function () {
          return Promise.all(batch.map(function (e) {
            return entryBytes(u8, zip, e).then(function (buf) {
              records.push({ path: dir + e.name, data: e.name === "pack.mcmeta" ? fixMcmeta(buf) : buf });
            });
          }));
        });
      })(files.slice(b, b + 24));
    }
    return chain.then(function () { records.push({ path: dir + ".eaglerfsdir", data: new ArrayBuffer(0) }); return records; });
  }

  function openFs() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(FS_DB);                   // no version: use whatever the game created
      req.onupgradeneeded = function () {                // fresh profile: create the store the game expects
        if (!req.result.objectStoreNames.contains("filesystem")) {
          req.result.createObjectStore("filesystem", { keyPath: ["path"] });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("filesystem db blocked")); };
    });
  }

  function writeRecords(all) {
    return openFs().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("filesystem", "readwrite"), st = tx.objectStore("filesystem");
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error("install transaction failed")); };
        st.put({ path: "resourcepacks/.eaglerfsdir", data: new ArrayBuffer(0) });
        all.forEach(function (r) { st.put(r); });
      });
    });
  }

  /* ---- settings: select our packs (right above "vanilla", in order, so packs the player adds later
   * still win) and apply the one-time defaults ---- */
  function applySettings(text, entries, defaults, drop) {
    var lines = text ? text.split("\n") : [];
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    function find(key) { for (var i = 0; i < lines.length; i++) if (lines[i].indexOf(key + ":") === 0) return i; return -1; }
    if (drop && drop.length) {                           // packs that are gone: out of the selected list and the "incompatible" list
      ["resourcePacks", "incompatibleResourcePacks"].forEach(function (key) {
        var at = find(key);
        if (at < 0) return;
        try {
          var arr = JSON.parse(lines[at].slice(key.length + 1));
          if (Array.isArray(arr)) lines[at] = key + ":" + JSON.stringify(arr.filter(function (n) { return drop.indexOf(n) < 0; }));
        } catch (e) { /* unreadable line: leave it */ }
      });
    }
    if (entries.length) {
      var idx = find("resourcePacks"), list = ["vanilla"];
      if (idx >= 0) {
        try { var parsed = JSON.parse(lines[idx].slice("resourcePacks:".length)); if (Array.isArray(parsed)) list = parsed; }
        catch (e) { return null; }                       // unreadable line: leave the player's settings alone
      }
      if (list.indexOf("vanilla") < 0) list.unshift("vanilla");
      var at = list.indexOf("vanilla") + 1;
      entries.forEach(function (en) {
        var have = list.indexOf(en);
        if (have < 0) list.splice(at++, 0, en); else at = have + 1;
      });
      var line = "resourcePacks:" + JSON.stringify(list);
      if (idx >= 0) lines[idx] = line; else lines.push(line);
    }
    if (defaults) Object.keys(defaults).forEach(function (k) {
      var i = find(k), l = k + ":" + defaults[k];
      if (i >= 0) lines[i] = l; else lines.push(l);
    });
    return lines.join("\n") + "\n";
  }

  function updateSettings(entries, defaults, drop) {
    var stored = null;
    try { stored = localStorage.getItem(G_KEY); } catch (e) { return Promise.resolve(); }
    var current = stored
      ? pipe(b64ToBytes(stored), new DecompressionStream("gzip")).then(function (buf) { return dec.decode(buf); })
      : Promise.resolve("version:4903\nincompatibleResourcePacks:[]\n");   // fresh profile: minimal settings
    return current.then(function (text) {
      var next = applySettings(text, entries, defaults, drop);
      if (!next || next === text) return;
      return pipe(enc.encode(next), new CompressionStream("gzip")).then(function (gz) {
        localStorage.setItem(G_KEY, bytesToB64(new Uint8Array(gz)));
      });
    });
  }

  /* delete a pack's folder from the game's filesystem (keys are [path]; every file of the pack sits below "resourcepacks/<name>/") */
  function retirePacks(names) {
    return openFs().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("filesystem", "readwrite"), st = tx.objectStore("filesystem"), top = String.fromCharCode(0xffff);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || new Error("removing the old pack failed")); };
        names.forEach(function (n) { st.delete(IDBKeyRange.bound(["resourcepacks/" + n + "/"], ["resourcepacks/" + n + "/" + top])); });
      });
    });
  }

  function install() {
    return (retired.length ? retirePacks(retired) : Promise.resolve()).then(function () {
      return Promise.all(packs.map(packRecords));
    }).then(function (lists) {
      var all = [].concat.apply([], lists);
      return all.length ? writeRecords(all) : null;
    }).then(function () {
      return updateSettings(packs.filter(function (p) { return p.on; }).map(function (p) { return "file/" + p.name; }), needDefaults ? DEFAULTS : null, retired.map(function (n) { return "file/" + n; }));
    }).then(function () {
      packs.forEach(function (p) { localStorage.setItem(p.key, p.id); });
      retired.forEach(function (n) { localStorage.removeItem("oneclient.pack." + n); });
      if (needDefaults) localStorage.setItem(DEFAULTS_FLAG, DEFAULTS_VERSION);
    });
  }

  var gate = new Promise(function (resolve) {
    var done = false;
    function finish(state) { if (!done) { done = true; OC.pack.state = state; resolve(); } }
    setTimeout(function () { finish("timeout"); }, TIMEOUT_MS);
    try {
      install().then(function () { finish("done"); }, function (err) { console.warn("[OneClient] setup failed:", err); finish("failed"); });
    } catch (err) { console.warn("[OneClient] setup failed:", err); finish("failed"); }
  });

  ["compileStreaming", "compile", "instantiateStreaming", "instantiate"].forEach(function (name) {
    var orig = WebAssembly[name];
    if (typeof orig !== "function") return;
    WebAssembly[name] = function () {
      var self = this, args = arguments;
      return gate.then(function () { return orig.apply(self, args); });
    };
  });
})();
