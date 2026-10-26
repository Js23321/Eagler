/* OneClient menus: modern DOM skins over the game's own screens.
 *
 *   native title screen        -> Home page      (Singleplayer / Multiplayer / Options / Mods / Profile)
 *   Home > Multiplayer         -> Servers page   (our list, stored in the game's own servers.dat)
 *   Servers > Join             -> Joining page   (the game's buttons are pressed behind it; its own screens never show)
 *   native Edit Profile        -> Profile page   (username + the game's skin list + upload your own skin)
 *
 * The game stays the source of truth: we know which screen it is showing from the marker glyphs
 * (detect.js), and every action is performed on the real screen through OC.native. Our cover goes up in the
 * same frame a screen we skin first shows, and stays up while we drive the game between screens, so the game's
 * own menus never flash. If detection ever fails the page simply stays out of the way and the native screens
 * work as normal. ASCII-only source (the host page declares its charset late). */
(function () {
  "use strict";

  var OC = window.OneClient, N = OC.native, S = OC.S;
  if (!N || !window.indexedDB) return;

  var FS_DB = "_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_worlds";
  var DEFAULT_ADDR = "wss://arch.mc";     // the game adds this server to its list itself unless a saved server has this address
  var M = OC.menu = { page: null, visible: false };
  var root, built = false;
  var userPage = "home";                  // which DOM page the player picked while the native title screen is up
  var booting = true, sawScreen = false;
  var disabled = /[?&]native(&|$)/.test(location.search);        // ?native in the URL keeps the game's own menus
  var holds = { skip: false, back: null, leave: null, away: null };   // reasons to keep the cover up while the game changes screens
  var join = null;                        // a server join in progress, or the card that says it failed
  var session = null;                     // { entry }: joined from the Servers page, now playing on it
  var servers = { list: [], exists: false }, editing = null;
  var profile = { name: "", mine: [], pending: null, sel: 0, nativeSel: 0, busy: false };
  var presets = [];                       // the game's 24 default skins, in the game's order
  var discBtnY = null;                    // where the game's Disconnected screen has its button (GUI units), once seen
  var wrun = null;                        // an action on the game's world screens: { kind: "delete" | "edit" | "more", stage: "working" | "native", left }
  var worlds = { list: [], loaded: false, q: "" };          // the Singleplayer page's data (client/worlds.js)

  var ICONS = {
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    warn: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
    cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
    refresh: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z"/>',
    chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.2 15.7a5.5 5.5 0 0 1 7.6 0M12 19.2h.01"/>',
    exit: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    speaker: '<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
    mouse: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v6"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    dots: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    folder: '<path d="M3.5 6.5h6l2 2.5h9v9.5h-17z"/>'
  };
  function icon(n, cls) { return '<svg class="' + (cls || "oc-ic") + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + "</svg>"; }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function now() { return performance.now(); }
  function trace(tag) { var T = window.__ocTrace; if (T) T.push(Math.round(performance.now()) + " f" + N.frameCount() + " " + tag + " scr=" + OC.screen + " vis=" + M.visible + " pg=" + M.page); }
  function waitUntil(test, ms) {
    return new Promise(function (resolve) {
      var t0 = now();
      (function tick() { if (test()) return resolve(true); if (now() - t0 > ms) return resolve(false); setTimeout(tick, 100); })();
    });
  }

  /* ---------- where the game's own buttons are (GUI units; measured on the real screens) ---------- */
  function pos(name, i) {
    var g = N.gui(), cx = g.w / 2, h4 = g.h / 4, h6 = g.h / 6;
    switch (name) {
      case "title.singleplayer": return [cx, h4 + 58];
      case "title.multiplayer": return [cx, h4 + 82];
      case "title.profile": return [cx - 24, h4 + 104];
      case "title.options": return [cx - 52, h4 + 129];
      case "mp.row": return [cx - 40, 53 + 36 * i];
      case "mp.join": return [cx - 106, g.h - 42];
      case "mp.back": return [cx + 116, g.h - 18];
      case "mp.relays": return [20, 10];                          // the "Relays" link in the corner of the game's server list
      case "connect.cancel": return [cx, h4 + 141];
      case "disc.back": return [cx, discBtnY != null ? discBtnY : g.h / 2 + 28];
      case "pause.leave": return [cx, h4 + 95.6];                 // "Save and Quit to Title" / "Disconnect": 204 x 20
      case "pause.back": return [cx, h4 + 24];                    // "Back to Game"
      case "pause.adv": return [cx - 53, h4 + 48];                // Advancements | Statistics
      case "pause.stats": return [cx + 53, h4 + 48];
      case "pause.options": return [cx - 53, h4 + 72];            // Options... | Open to LAN
      case "pause.lan": return [cx + 53, h4 + 72];
      case "busy.cancel": return [cx, g.h / 2 + 17.5];            // "Cancel Task" on the game's world loading screen
      case "create.cancel": return [cx + 79, g.h - 16];           // Cancel on the game's Create New World screen
      case "name.continue": return [cx, h6 + 152];                   // "Continue Anyway" on the game's "Default Username Detected" dialog
      case "profile.username": return [cx + 50, h6 + 34];
      case "profile.skinarrow": return [cx + 110, h6 + 92];
      case "profile.skinrow": return [cx + 10, h6 + 111 + 10 * i];   // row i of the open skin list (scrolled to the top)
      case "profile.addskin": return [cx + 14, h6 + 119];
      case "profile.clear": return [cx + 86, h6 + 119];
      case "profile.done": return [cx, h6 + 178];
      case "profile.steve": return [cx - 56, h4 + 133];
      case "profile.alex": return [cx + 54, h4 + 133];
      default: throw new Error("unknown native widget " + name);
    }
  }
  M.pos = pos;

  /* ---------- storage helpers ---------- */
  function fsOpen() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(FS_DB);
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function fsGet(path) {
    return fsOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var q = db.transaction("filesystem", "readonly").objectStore("filesystem").get([path]);
        q.onsuccess = function () { db.close(); resolve(q.result || null); };
        q.onerror = function () { db.close(); reject(q.error); };
      });
    });
  }
  function fsPut(path, bytes) {
    return fsOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("filesystem", "readwrite");
        tx.objectStore("filesystem").put({ path: path, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  /* servers.dat: { servers: [ { connectionMode, ip, hidden, name, ... } ] }  (uncompressed NBT) */
  var NB = OC.nbt;
  function sameAddr(a, b) { return String(a).trim().toLowerCase().replace(/\/+$/, "") === String(b).trim().toLowerCase().replace(/\/+$/, ""); }
  function readServers() {
    return fsGet("servers.dat").then(function (rec) {
      if (!rec) return { list: [], exists: false };
      try {
        var r = NB.read(new Uint8Array(rec.data)), tag = NB.get(r.tag, "servers"), list = [], fixed = false;
        (tag ? tag.v : []).forEach(function (c) {
          var nm = NB.get(c, "name"), ip = NB.get(c, "ip"), md = NB.get(c, "connectionMode"), hd = NB.get(c, "hidden");
          var s = { name: nm ? nm.v : "", ip: ip ? ip.v : "", mode: md ? md.v : "eaglerx", hidden: hd ? hd.v : 0, raw: c };
          if (sameAddr(s.ip, DEFAULT_ADDR) && s.mode === "relay" && s.name === "ArchMC") { s.mode = "eaglerx"; fixed = true; }   // older builds saved the default server with the wrong mode
          s.rel = parseRelay(s.ip);
          if (!s.rel && s.mode === "relay" && fixRelayEntry(s)) fixed = true;
          s.wisp = s.mode === "wisp" && OC.account ? OC.account.parseWisp(s.ip) : null;
          if (s.wisp && OC.account.wispUrl() && s.wisp.base !== OC.account.wispUrl()) {          // the bridge's address changed (new install, other port): the game only joins Java-account servers that use the current one
            s.ip = OC.account.wispAddress(s.wisp.target); s.wisp = OC.account.parseWisp(s.ip); fixed = true;
          }
          list.push(s);
        });
        if (fixed) writeServers(list).catch(function () {});
        return { list: list, exists: true };
      } catch (e) { console.warn("[OneClient] could not read servers.dat:", e); return { list: [], exists: false }; }
    });
  }
  function writeServers(list) {
    var items = list.map(function (s) {
      var c = s.raw ? { t: 10, v: s.raw.v.slice() } : { t: 10, v: [] };
      NB.set(c, "connectionMode", { t: 8, v: s.mode });
      NB.set(c, "ip", { t: 8, v: s.ip });
      NB.set(c, "hidden", { t: 1, v: s.hidden ? 1 : 0 });
      NB.set(c, "name", { t: 8, v: s.name });
      s.raw = c;
      return c;
    });
    var rootTag = { t: 10, v: [["servers", { t: 9, et: 10, v: items }]] };
    return fsPut("servers.dat", NB.write({ name: "", tag: rootTag })).then(function () { servers.exists = true; });
  }
  /* The rows of the game's own list: it shows its default server first unless a saved server already has that
   * address, so our list (and the row numbers we press) must be built the same way. */
  var DEFAULT_ROW = { name: "ArchMC", ip: DEFAULT_ADDR, mode: "eaglerx", hidden: 0, raw: null, virtual: true };
  function serverRows() {
    var has = servers.list.some(function (s) { return sameAddr(s.ip, DEFAULT_ADDR); });
    return has ? servers.list.slice() : [DEFAULT_ROW].concat(servers.list);
  }
  function canonAddr(ip) { return sameAddr(ip, DEFAULT_ADDR) ? DEFAULT_ADDR : ip; }

  /* ---------- how the game saves a server address, per connection mode ----------
   * Measured in the game's own Add / Edit Server screens:
   *   EaglerX  the endpoint itself:                       wss://play.example.com   (a ws:// or wss:// address typed in any mode is EaglerX)
   *   Relay    the multiplayer relay + the server to reach:  wss://<relay>/minecraft?target=play.example.com%3A25565
   * The relay is the game's "Multiplayer default": the first relay in its Relays list that can carry multiplayer.
   * What you type for a Relay server is only the Minecraft server (host or host:port), never a wss:// address. */
  var RELAY_PATH = "/minecraft?target=";
  var RELAY_RE = /^(wss?:\/\/.+?)\/minecraft\?target=([^&]*)$/i;
  var TARGET_RE = /^(?:\[[0-9a-f:.]+\]|[a-z0-9_](?:[a-z0-9_.-]*[a-z0-9_])?)(?::(\d{1,5}))?$/i;
  function relayList() {                                       // the game keeps its relays in localStorage as base64 JSON
    try {
      var raw = localStorage.getItem("_eaglercraftX.relay.list.v3");
      if (!raw) return OC.relays && OC.relays.defaults ? OC.relays.defaults.slice() : [];       // not saved yet (a new profile): the relays the game starts with (pack.js)
      var bin = atob(raw), u8 = new Uint8Array(bin.length), i;
      for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var list = JSON.parse(new TextDecoder().decode(u8));
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function defaultRelay() {
    var list = relayList();
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r.address !== "string" || !/^wss?:\/\//i.test(r.address)) continue;
      var cap = !r.capability || r.capability === "auto" ? r.detected : r.capability;
      if (cap === "multiplayer" || cap === "both") return { name: r.name || r.address, base: r.address.replace(/\/+$/, "") };
    }
    return null;
  }
  function relayName(base) {
    var list = relayList();
    for (var i = 0; i < list.length; i++) if (list[i] && typeof list[i].address === "string" && sameAddr(list[i].address, base)) return list[i].name || base;
    return base.replace(/^wss?:\/\//i, "");
  }
  function parseRelay(ip) {                                    // { base, target } for a saved relay address, else null
    var m = RELAY_RE.exec(String(ip || ""));
    if (!m) return null;
    try { return { base: m[1], target: decodeURIComponent(m[2]) }; } catch (e) { return null; }
  }
  function cleanTarget(text) {                                 // "play.example.com:25565" or null when it is not a server address
    var t = String(text).trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, ""), m = TARGET_RE.exec(t);
    return m && !(m[1] && (+m[1] < 1 || +m[1] > 65535)) ? t : null;
  }
  /* what was typed in an Address field -> { mode, ip, label } to save, or { error } */
  function buildAddress(text, mode, base) {
    text = String(text).trim();
    if (mode === "wisp") {                                                                  // Java account: the server to reach through OneClient Bridge
      if (/^(wss?|https?):\/\//i.test(text)) return { error: "A ws:// or wss:// address is an EaglerX server: pick EaglerX." };
      var wt = cleanTarget(text.replace(/^java:\/\//i, ""));
      if (!wt) return { error: "Type the server like donutsmp.net or play.example.com:25565." };
      var wip = OC.account ? OC.account.wispAddress(wt) : "";
      if (!wip) return { error: "OneClient is not paired with the bridge yet: open the Java account page first." };
      return { mode: "wisp", ip: wip, label: wt };
    }
    var full = parseRelay(text);
    if (full) return { mode: "relay", ip: text, label: full.target };                      // a complete relay address, pasted as it is
    var ws = /^(wss?|https?):\/\/(.*)$/i.exec(text);
    if (ws || mode === "eaglerx") {
      var rest = ws ? ws[2] : text.replace(/^\/+/, "");
      if (!rest || /\s/.test(rest)) return { error: "Type the address like wss://play.example.com." };
      var ip = canonAddr((ws && /^(ws|http)$/i.test(ws[1]) ? "ws" : "wss") + "://" + rest);
      return { mode: "eaglerx", ip: ip, label: ip.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "") };
    }
    var target = cleanTarget(text);
    if (!target) return { error: "Type the server like play.example.com or play.example.com:25565." };
    base = base || (defaultRelay() || {}).base;
    if (!base) return { error: "No multiplayer relay is set up. Add one with Relays, or switch to EaglerX." };
    return { mode: "relay", ip: base + RELAY_PATH + encodeURIComponent(target), label: target };
  }
  /* Older OneClient builds saved Relay servers as plain wss://host, which the game does not read as a relay route.
   * Turn those into the real relay address, once a relay is available. */
  function fixRelayEntry(s) {
    var m = /^wss?:\/\/([^\/?#]+)\/?$/i.exec(s.ip), dr = defaultRelay(), t = m && cleanTarget(m[1]);
    if (!t || !dr || sameAddr(s.ip, DEFAULT_ADDR)) return false;
    s.ip = dr.base + RELAY_PATH + encodeURIComponent(t);
    s.rel = parseRelay(s.ip);
    return true;
  }

  /* ---------- panorama (the Moss pack's 6 faces, drawn by the browser) ---------- */
  function loadPanorama(cube) {
    var el = document.querySelector('script.oc-pack[data-name="Moss Panorama"]');
    if (!el || !OC.zip) return;
    try {
      var u8 = OC.zip.b64(el.textContent), zip = OC.zip.read(u8);
      zip.entries.forEach(function (e) {
        var m = /textures\/gui\/title\/background\/panorama_([0-5])\.png$/.exec(e.name);
        if (!m) return;
        OC.zip.bytes(u8, zip, e).then(function (buf) {
          cube.querySelector(".f" + m[1]).style.backgroundImage = "url(" + URL.createObjectURL(new Blob([buf], { type: "image/png" })) + ")";
        });
      });
    } catch (err) { console.warn("[OneClient] panorama unavailable:", err); }
  }

  /* ---------- the game's default skins (extracted from its asset pack at build time) ---------- */
  function loadPresets() {
    var el = document.getElementById("oc-skins");
    if (!el) return;
    try {
      JSON.parse(el.textContent).forEach(function (s) {
        var im = new Image(), p = { kind: "preset", name: s.n, slim: /alex$/i.test(s.n), src: im };
        im.onload = function () { clearTimeout(loadPresets.t); loadPresets.t = setTimeout(function () { if (built) { renderSkins(); updatePreview(); refreshAccount(true); } }, 40); };
        im.src = s.d;
        presets.push(p);
      });
    } catch (e) { console.warn("[OneClient] default skins unavailable:", e); }
  }

  /* ---------- the player's profile, as the game saved it ---------- */
  function currentName() {
    try { var v = localStorage.getItem("_eaglercraftX.username"); return v ? atob(v) : ""; } catch (e) { return ""; }
  }
  function hue(str) { var n = 0; for (var i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) % 360; return n; }

  /* _eaglercraftX.p: { username, skins: [{ model, data (64x64 RGBA), name }], presetSkin, customSkin }.
   * The game's skin list is your own skins first, then the 24 defaults; `sel` is the position in that list. */
  function readProfileData() {
    try {
      var raw = localStorage.getItem("_eaglercraftX.p");
      if (!raw) return null;
      var bin = atob(raw), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var t = NB.read(u8).tag;
      var un = NB.get(t, "username"), sk = NB.get(t, "skins"), skins = [];
      function num(k, d) { var e = NB.get(t, k); return e ? Number(e.v) : d; }
      (sk ? sk.v : []).forEach(function (c) {
        var nm = NB.get(c, "name"), md = NB.get(c, "model"), dt = NB.get(c, "data");
        skins.push({ name: nm ? nm.v : "Custom skin", slim: !!(md && md.v === 1), data: dt ? dt.v : null });
      });
      var preset = num("presetSkin", 0), custom = num("customSkin", -1);
      return { username: un ? un.v : "", skins: skins, sel: preset >= 0 ? skins.length + preset : custom };
    } catch (e) { return null; }
  }
  function rgbaCanvas(data) {
    var c = document.createElement("canvas"); c.width = 64; c.height = 64;
    try {
      var px = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
      c.getContext("2d").putImageData(new ImageData(px, 64, 64), 0, 0);
    } catch (e) { /* leave it empty */ }
    return c;
  }
  function skinList() { return profile.mine.concat(profile.pending ? [profile.pending] : []).concat(presets); }

  function profileLoad() {
    var d = readProfileData();
    profile.mine = d ? d.skins.map(function (s) { return { kind: "custom", name: s.name, slim: s.slim, src: rgbaCanvas(s.data) }; }) : [];
    profile.pending = null;
    profile.nativeSel = d ? d.sel : 0;
    profile.sel = Math.max(0, Math.min(skinList().length - 1, profile.nativeSel));
    profile.name = (d && d.username) || currentName();
    if (!built) return;
    var inp = root.querySelector("#ocm-user");
    if (document.activeElement !== inp) inp.value = profile.name;
    renderSkins(); updatePreview(); syncArms();
    idleStatus();
  }

  /* ---------- build the DOM ---------- */
  function build() {
    if (built || !document.body) return;
    built = true;
    root = h("div"); root.id = "oc-menu"; root.setAttribute("data-page", "boot");

    var pano = h("div", "ocm-pano"), cube = h("div", "ocm-cube");
    for (var f = 0; f < 6; f++) cube.appendChild(h("div", "ocm-face f" + f));
    pano.appendChild(cube);
    root.appendChild(pano);
    root.appendChild(h("div", "ocm-shade"));
    loadPanorama(cube);

    root.appendChild(h("div", "ocm-brand", '<span class="w">One<b>Client</b></span><em>26.2</em>'));
    var acct = h("button", "ocm-acct", '<span class="ocm-avatar"></span><span class="nm"></span>');
    acct.type = "button"; acct.tabIndex = -1;
    acct.addEventListener("click", function () { openProfile(); });
    root.appendChild(acct);
    root.appendChild(h("div", "ocm-foot", "OneClient 26.2 (Junsheng13)"));
    root.appendChild(h("div", "ocm-credit", "Panorama: Moss by AREKKUZZERA (CC BY 4.0)"));

    /* boot cover */
    root.appendChild(h("div", "ocm-page ocm-boot", '<div class="ocm-spin"></div><p>Starting OneClient&hellip;</p>'));

    /* home */
    var home = h("div", "ocm-page ocm-home");
    home.appendChild(h("div", "ocm-logo", "One<b>Client</b>"));
    var stack = h("div", "ocm-stack");
    stack.appendChild(btn("big", "play", "Singleplayer", "sp"));
    stack.appendChild(btn("big", "globe", "Multiplayer", "mp"));
    var row = h("div", "ocm-row");
    row.appendChild(btn("", "gear", "Options", "options"));
    row.appendChild(btn("", "grid", "Mods", "mods"));
    row.appendChild(btn("", "user", "Profile", "profile"));
    stack.appendChild(row);
    home.appendChild(stack);
    root.appendChild(home);

    /* servers */
    var sv = h("div", "ocm-page ocm-servers");
    var head = h("div", "ocm-head");
    head.appendChild(iconBtn("back", "back"));
    head.appendChild(h("h2", null, "Multiplayer"));
    var rf = iconBtn("refresh", "refresh"); rf.title = "Check the servers again"; head.appendChild(rf);
    head.appendChild(btn("small", "globe", "Relays", "relays"));
    if (OC.account) head.appendChild(btn("small ocm-acbtn", "key", "Java account", "account"));
    head.appendChild(btn("small primary", "plus", "Add server", "add"));
    sv.appendChild(head);
    var panel = h("div", "ocm-panel");
    var direct = h("div", "ocm-direct");
    direct.innerHTML = '<input class="ocm-input" id="ocm-direct" placeholder="Direct connect: play.example.com or wss://server.address" spellcheck="false" autocomplete="off">';
    direct.appendChild(btn("small primary", "bolt", "Join", "direct"));
    panel.appendChild(direct);
    panel.appendChild(h("div", "ocm-list"));
    panel.appendChild(h("div", "ocm-note", "Servers are saved in the game, so they also show in its own list."));
    sv.appendChild(panel);
    var dlg = h("div", "ocm-dlg");
    dlg.innerHTML = '<div class="ocm-panel"><h3>Add server</h3>' +
      '<div class="ocm-field"><label>Name</label><input class="ocm-input" id="ocm-sname" maxlength="40" spellcheck="false" autocomplete="off" placeholder="My server"></div>' +
      '<div class="ocm-field"><label>Address</label><input class="ocm-input" id="ocm-sip" spellcheck="false" autocomplete="off" placeholder="play.example.com:25565"></div>' +
      '<div class="ocm-field"><label>Connection</label><div class="ocm-seg ocm-modeseg"><button type="button" data-m="relay">Relay</button><button type="button" data-m="eaglerx">EaglerX</button>' + (OC.account ? '<button type="button" data-m="wisp">Java account</button>' : '') + '</div><div class="ocm-hint" id="ocm-hint"></div></div>' +
      '<div class="ocm-actions"></div></div>';
    var acts = dlg.querySelector(".ocm-actions");
    acts.appendChild(btn("small", "", "Cancel", "dlg-cancel"));
    acts.appendChild(btn("small primary", "", "Save", "dlg-save"));
    sv.appendChild(dlg);
    root.appendChild(sv);

    /* profile */
    var pf = h("div", "ocm-page ocm-profile");
    var phead = h("div", "ocm-head");
    phead.appendChild(iconBtn("back", "pback"));
    phead.appendChild(h("h2", null, "Profile"));
    pf.appendChild(phead);
    var pp = h("div", "ocm-panel ocm-pcard");
    pp.innerHTML = '<div class="ocm-skin"><canvas id="ocm-skin" width="16" height="32"></canvas><small id="ocm-skinnote"></small></div>' +
      '<div class="ocm-form">' +
      '<div class="ocm-field"><label>Username</label><input class="ocm-input" id="ocm-user" maxlength="16" spellcheck="false" autocomplete="off" placeholder="Your username"></div>' +
      '<div class="ocm-field"><label>Skin</label><div class="ocm-skins" id="ocm-skins"></div></div>' +
      '<div class="ocm-field ocm-model" id="ocm-model"><label>Arms</label><div class="ocm-seg ocm-armseg"><button type="button" data-arms="classic">Classic</button><button type="button" data-arms="slim">Slim</button></div></div>' +
      '<div class="ocm-status" id="ocm-pstatus"></div><div class="acts"></div></div>';
    var pa = pp.querySelector(".acts");
    pa.appendChild(btn("", "", "Remove my skins", "clear-skins"));
    pa.appendChild(btn("primary", "", "Apply", "apply"));
    pf.appendChild(pp);
    var file = h("input"); file.type = "file"; file.id = "ocm-file"; file.accept = "image/png"; file.hidden = true;
    pf.appendChild(file);
    root.appendChild(pf);

    /* Java account: OneClient Bridge, the Microsoft sign-in (client/account.js) */
    if (OC.account) {
      var ac = h("div", "ocm-page ocm-account");
      var ahead = h("div", "ocm-head");
      ahead.appendChild(iconBtn("back", "acc-back"));
      ahead.appendChild(h("h2", null, "Java account"));
      ahead.appendChild(btn("small", "refresh", "Check again", "acc-check"));
      ac.appendChild(ahead);
      var abody = h("div", "ocm-panel ocm-abody");
      abody.innerHTML =
        '<section class="ocm-asec" data-sec="bridge"><div class="ocm-aline"><i class="ocm-dot" id="ocm-abdot"></i><b id="ocm-abtitle"></b><button type="button" class="ocm-link" data-act="acc-unpair" id="ocm-abunpair" tabindex="-1">Unpair</button></div>' +
        '<p class="ocm-atext" id="ocm-abtext"></p>' +
        '<div class="ocm-arow" id="ocm-abpair"><input class="ocm-input" id="ocm-apair" placeholder="ABCD-EFGH-JKMN" maxlength="16" spellcheck="false" autocomplete="off"></div>' +
        '<div class="ocm-arow ocm-aport" id="ocm-abport"><label for="ocm-aport">Bridge port</label><input class="ocm-input" id="ocm-aport" maxlength="5" spellcheck="false" autocomplete="off"></div>' +
        '<div class="ocm-arow ocm-awisp" id="ocm-abwisp"><input class="ocm-input" id="ocm-awisp" placeholder="Your own Wisp server, like wss://wisp.example.com/ (empty: the built-in ones)" maxlength="200" spellcheck="false" autocomplete="off"></div>' +
        '<div class="ocm-atext ocm-awres" id="ocm-awres"></div>' +
        '<label class="ocm-check ocm-agate" id="ocm-agate"><input type="checkbox" id="ocm-agateon"><span><b>Let mods read Java-account servers</b> OneClient handles the login encryption with the server itself, so mods that read the connection (minimap, shulker tooltip, armor, potions ...) work there. Turn it off if a server will not let you in.</span></label>' +
        '<div class="ocm-atext ocm-agatemsg" id="ocm-agatemsg"></div>' +
        '<div class="ocm-arow ocm-aprov"><button type="button" class="ocm-link" data-act="acc-prov" id="ocm-abprov" tabindex="-1"></button></div></section>' +
        '<section class="ocm-asec" data-sec="acct" id="ocm-asacct"><h4>Microsoft account</h4><div class="ocm-alist" id="ocm-alist"></div><div class="ocm-alogin" id="ocm-alogin"></div>' +
        '<div class="ocm-aadd" id="ocm-aadd"><div class="ocm-amode" id="ocm-amode"><div class="ocm-seg"><button type="button" data-act="acc-mode" data-mode="quick">Quick sign-in</button><button type="button" data-act="acc-mode" data-mode="own">My own Azure app</button></div><p class="ocm-atext" id="ocm-amodetext"></p></div><div class="ocm-field"><label for="ocm-aclient">Azure app client ID</label><input class="ocm-input" id="ocm-aclient" placeholder="11111111-2222-3333-4444-555555555555" maxlength="40" spellcheck="false" autocomplete="off"></div>' +
        '<details class="ocm-help"><summary>Where do I get a client ID?</summary><ol>' +
        '<li>On <b>portal.azure.com</b> open <b>App registrations</b> and choose <b>New registration</b>. Any name; account type <b>Personal Microsoft accounts only</b> (no redirect address needed).</li>' +
        '<li>Under <b>Authentication</b> turn <b>Allow public client flows</b> on.</li>' +
        '<li>Copy the <b>Application (client) ID</b> of the Overview page into the box above.</li>' +
        '<li>Mojang has to approve the app for Minecraft once: send its ID with the form at <b>aka.ms/mce-reviewappid</b>. Until it is approved the sign-in ends with a message about a 403.</li></ol>' +
        '<p>This is also why other clients sign you in with one click: their authors did these steps once and ship the ID. No Azure subscription? The free Azure sign-up only verifies you with a phone or card (Microsoft says it does not charge), students can use <b>Azure for Students</b> (school email, no card), or ask someone you trust who has Azure to do steps 1 to 3 and send you just the ID: an ID is not a password and does not open your account. Or switch to Quick sign-in above, which needs no app.</p></details>' +
        '<div class="ocm-arow"></div></div><div class="ocm-aquick" id="ocm-aquick"><span>Add a server that needs a Java account:</span></div></section>' +
        '<section class="ocm-asec ocm-aabout" data-sec="about"><p>Your Microsoft password never enters OneClient: you sign in on microsoft.com. What is kept afterwards (a renewable sign-in) stays in this browser, or inside the bridge if you use it, and you can sign out any time. Java-account servers show a <b>Java</b> tag in the list; add one with <b>Add server</b> &gt; <b>Java account</b>.</p>' +
        '<p>Some servers do not allow modified clients or certain mods. Read a server\u2019s rules before you use OneClient\u2019s mods there; your account is yours to look after.</p></section>';
      abody.querySelector("#ocm-abpair").appendChild(btn("small primary", "", "Pair", "acc-pair"));
      abody.querySelector("#ocm-abwisp").appendChild(btn("small", "", "Save", "acc-wisp-save"));
      abody.querySelector("#ocm-abwisp").appendChild(btn("small", "wifi", "Test", "acc-wisp-test"));
      abody.querySelector("#ocm-aadd .ocm-arow").appendChild(btn("small primary", "key", "Sign in with Microsoft", "acc-signin"));
      abody.querySelector("#ocm-aquick").appendChild(btn("small", "plus", "DonutSMP", "acc-donut"));
      ac.appendChild(abody);
      root.appendChild(ac);
    }

    /* singleplayer: the saved worlds of the game */
    var wp = h("div", "ocm-page ocm-worlds");
    var whead = h("div", "ocm-head");
    whead.appendChild(iconBtn("back", "wback"));
    whead.appendChild(h("h2", null, "Singleplayer"));
    whead.appendChild(btn("small", "folder", "Import or LAN", "wmore"));
    whead.appendChild(btn("small primary", "plus", "Create world", "wcreate"));
    wp.appendChild(whead);
    var wpanel = h("div", "ocm-panel");
    wpanel.innerHTML = '<div class="ocm-wsearch"><input class="ocm-input" id="ocm-wq" placeholder="Search your worlds" spellcheck="false" autocomplete="off"></div><div class="ocm-list ocm-wlist"></div><div class="ocm-note">Worlds are saved in this browser.</div>';
    wp.appendChild(wpanel);
    wp.appendChild(h("div", "ocm-wbusy", '<div class="ocm-spin"></div><p></p>'));
    var cd = h("div", "ocm-dlg ocm-wdlg");
    cd.innerHTML = '<div class="ocm-panel"><h3>Create world</h3>' +
      '<div class="ocm-field"><label>World name</label><input class="ocm-input" id="ocm-wname" maxlength="60" spellcheck="false" autocomplete="off" placeholder="New World"></div>' +
      '<div class="ocm-field"><label>Game mode</label><div class="ocm-seg" data-seg="mode"><button type="button" data-v="survival">Survival</button><button type="button" data-v="creative">Creative</button><button type="button" data-v="hardcore">Hardcore</button></div></div>' +
      '<div class="ocm-field"><label>Difficulty</label><div class="ocm-seg" data-seg="difficulty"><button type="button" data-v="peaceful">Peaceful</button><button type="button" data-v="easy">Easy</button><button type="button" data-v="normal">Normal</button><button type="button" data-v="hard">Hard</button></div></div>' +
      '<div class="ocm-field"><label>World type</label><div class="ocm-seg" data-seg="type"><button type="button" data-v="default">Default</button><button type="button" data-v="superflat">Superflat</button><button type="button" data-v="large">Large biomes</button><button type="button" data-v="amplified">Amplified</button></div></div>' +
      '<div class="ocm-field"><label>Seed (optional)</label><input class="ocm-input" id="ocm-wseed" maxlength="40" spellcheck="false" autocomplete="off" placeholder="Leave empty for a random world"></div>' +
      '<div class="ocm-wchecks"><label class="ocm-check"><input type="checkbox" id="ocm-wcheats">Allow cheats</label><label class="ocm-check"><input type="checkbox" id="ocm-wstruct" checked>Structures</label><label class="ocm-check"><input type="checkbox" id="ocm-wbonus">Bonus chest</label></div>' +
      '<div class="ocm-actions"></div></div>';
    var ca = cd.querySelector(".ocm-actions");
    ca.appendChild(btn("small", "", "Cancel", "wc-cancel"));
    ca.appendChild(btn("small primary", "", "Create world", "wc-go"));
    wp.appendChild(cd);
    var dd = h("div", "ocm-dlg ocm-wdel");
    dd.innerHTML = '<div class="ocm-panel"><h3>Delete this world?</h3><p class="ocm-wdtext"></p><div class="ocm-actions"></div></div>';
    var da = dd.querySelector(".ocm-actions");
    da.appendChild(btn("small", "", "Cancel", "wd-cancel"));
    da.appendChild(btn("small danger", "trash", "Delete", "wd-go"));
    wp.appendChild(dd);
    root.appendChild(wp);

    /* joining a server: progress, failure card, click to play */
    var cn = h("div", "ocm-page ocm-connect", '<div class="ocm-spin"></div><h2 class="ocm-ctitle"></h2><p class="ocm-cstatus"></p>');
    cn.appendChild(btn("small", "", "Cancel", "cancel-join"));
    root.appendChild(cn);
    var er = h("div", "ocm-page ocm-error", '<div class="ocm-eicon">' + icon("warn") + '</div><h2 class="ocm-etitle"></h2><div class="ocm-ereason"></div>');
    var ea = h("div", "ocm-eacts");
    ea.appendChild(btn("", "", "Back to servers", "dismiss"));
    if (OC.account) {
      ea.appendChild(btn("", "key", "Java account", "err-account"));
      er.insertBefore(h("p", "ocm-ehint", "This is a Java-account server. If the message above is about your account, open the Java account page: are you signed in, and does the connection pass its Test?"), er.querySelector(".ocm-ereason").nextSibling);
    }
    ea.appendChild(btn("primary", "", "Try again", "retry"));
    er.appendChild(ea);
    root.appendChild(er);
    var pl = h("div", "ocm-page ocm-play", '<div class="ocm-sico ocm-pico"></div><h2 class="ocm-ptitle"></h2><p class="ocm-pnote">Joined. The game is ready for your mouse.</p>');
    pl.appendChild(btn("big primary", "cursor", "Click to play", "play"));
    root.appendChild(pl);

    root.appendChild(h("div", "ocm-toast"));
    document.body.appendChild(root);

    wire();
    loadPresets();
    refreshAccount();
  }

  function btn(cls, ic, label, act) {
    var b = h("button", "ocm-btn " + cls, (ic ? icon(ic) : "") + "<span>" + label + "</span>" + (cls.indexOf("big") >= 0 ? icon("chev", "chev") : ""));
    b.type = "button"; b.tabIndex = -1; b.setAttribute("data-act", act);
    b.addEventListener("mousedown", function (e) { if (e.target.tagName !== "INPUT") e.preventDefault(); });
    return b;
  }
  function iconBtn(ic, act, cls) {
    var b = h("button", "ocm-iconbtn " + (cls || ""), icon(ic));
    b.type = "button"; b.tabIndex = -1; b.setAttribute("data-act", act);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    return b;
  }
  function toast(msg, bad) {
    if (!built) return;
    var t = root.querySelector(".ocm-toast");
    t.textContent = msg;
    t.className = "ocm-toast show" + (bad ? " bad" : "");
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.className = "ocm-toast"; }, 5000);
  }

  /* ---------- visibility ---------- */
  var hideTimer = 0;
  function setPage(p) {
    if (!built) return;
    root.setAttribute("data-page", p);
    M.page = p;
    if (p === "home") { var s = root.querySelector(".ocm-stack"), l = root.querySelector(".ocm-logo"); [l, s].forEach(function (el, k) { el.classList.remove("ocm-in"); void el.offsetWidth; el.classList.add("ocm-in"); el.style.setProperty("--i", k); }); Array.prototype.forEach.call(s.children, function (c, k) { c.style.setProperty("--i", k + 1); }); }
  }
  /* Going up is instant (no fade), so none of the game's screen shows through; only going away fades. */
  function showMenu(p) {
    build();
    if (!built) return;
    if (root.getAttribute("data-ctx") !== "menu") root.setAttribute("data-ctx", "menu");
    if (M.page !== p) setPage(p);
    if (!M.visible) {
      trace("show " + p);
      M.visible = true;
      clearTimeout(hideTimer);
      root.classList.add("on", "snap");
      document.body.classList.add("oc-menu-on");
      void root.offsetWidth;
      root.classList.add("show");
      requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove("snap"); }); });
    }
  }
  function hideMenu() {
    if (!built || !M.visible) return;
    trace("hide");
    M.visible = false;
    root.classList.remove("show");
    document.body.classList.remove("oc-menu-on");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (!M.visible) root.classList.remove("on"); }, 380);
    if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
  }
  M.blocksKeys = function () { return M.visible; };

  /* ---------- what the cover shows ---------- */
  function joinPage() {
    var j = join;
    if (!j || j.reveal) return null;
    if (j.stage === "failed") return "error";
    if (j.stage === "ready" && OC.lockDeferred) return "play";
    return "connect";
  }
  function pageFor(p) { return p === "servers" ? "servers" : p === "account" ? "account" : p === "profile" ? "profile" : p === "worlds" ? "worlds" : "home"; }
  function holdPage() {
    var t = now();
    ["back", "leave", "away"].forEach(function (k) { if (holds[k] && t > holds[k].until) holds[k] = null; });
    var jp = joinPage();
    if (jp) return jp;
    if (relaysRun && relaysRun.stage === "opening") return pageFor(userPage);
    if (profile.busy) return "profile";
    if (wrun && wrun.stage !== "native") return "worlds";
    if (holds.skip) return "boot";
    if (holds.back || holds.leave || holds.away) return pageFor(userPage);
    return null;
  }
  var WORLD_SCREENS = { worlds: 1, worldmenu: 1, createworld: 1 };

  function render() {
    if (disabled) return;
    var scr = OC.screen, page = holdPage();
    N.fastScan = !!(page || booting);
    if (page) { showMenu(page); return; }
    if (scr === "multiplayer") { startBack("servers"); return; }               // the game's own list: ours is nicer, step back to the title
    if (scr === "title") { showMenu(pageFor(userPage)); return; }
    if (WORLD_SCREENS[scr]) {                                                   // the game's own Singleplayer screens: our page covers them (or the player is using one directly)
      if (wrun && wrun.stage === "native") { hideMenu(); return; }
      if (!wrun && !join) { startBack("worlds"); return; }
      showMenu("worlds");
      return;
    }
    if (scr === "profile") { userPage = "home"; showMenu("profile"); return; }
    if (booting) { showMenu("boot"); return; }                                  // up from the very first frame, so the game's own loading splash never flashes
    hideMenu();
  }

  function hold(name, ms) {
    var o = holds[name] = { until: now() + ms };
    setTimeout(function () { if (holds[name] === o) { holds[name] = null; render(); } }, ms + 60);
    return o;
  }

  /* Bring the game back to its title screen, whatever it is showing (a connecting screen, its server list, a
   * disconnected screen ...), pressing the right button on each. Resolves when the title is up (or on timeout).
   * Only one of these runs at a time. */
  var titleRun = null;
  function goTitle(ms) {
    if (titleRun) return titleRun;
    var t0 = now(), busy = false;
    titleRun = new Promise(function (resolve) {
      (function tick() {
        var s = OC.screen;
        if (s === "title") return resolve(true);
        if (now() - t0 > ms) return resolve(false);
        if (!busy) {
          var p = s === "multiplayer" ? pos("mp.back") : s === "connect" ? pos("connect.cancel") : s === "disconnected" ? pos("disc.back") : s === "busy" ? pos("busy.cancel") : s === "createworld" ? pos("create.cancel") : null;
          if (p) { busy = true; N.click(p[0], p[1]).then(function () { return N.frames(8); }).then(function () { busy = false; }); }
          else if (WORLD_SCREENS[s]) { busy = true; N.escape().then(function () { return N.frames(10); }).then(function () { busy = false; }); }      // Escape closes the game's Singleplayer screens
        }
        setTimeout(tick, 150);
      })();
    }).then(function (v) { titleRun = null; return v; });
    return titleRun;
  }
  function startBack(page) {
    if (holds.back) return;
    userPage = page;
    var o = hold("back", 14000);
    render();
    goTitle(14000).then(function () { if (holds.back === o) holds.back = null; render(); });
  }

  /* leaving the Esc menu's "Save and Quit" / "Disconnect": cover before the game's title or server list can show.
   * Which button was pressed is not guessed from where the click landed (the Esc menu has more or fewer rows depending on where you are):
   * a click in the Esc menu starts a short watch, and only if the game really stops talking to its server / world do we cover. */
  var leaveWatch = false;
  function leaveTarget() { return session && "world" in session ? "worlds" : session ? "servers" : "home"; }       // the page you came from: the world list, the server list, or Home
  function watchLeave() {
    var t0 = now();
    leaveWatch = true;
    (function poll() {
      if (disabled || !OC.net || !OC.net.connected) { leaveWatch = false; return; }
      if (OC.net.leftAt >= t0) {                              // the game said goodbye to its world / server
        leaveWatch = false;
        userPage = leaveTarget();
        var o = hold("leave", 9000);
        render();
        setTimeout(function () { if (holds.leave === o && OC.screen === "pause") { holds.leave = null; render(); } }, 2500);
        return;
      }
      if (now() - t0 > 2500) { leaveWatch = false; return; }  // no goodbye: that click did something else (Options, Back to Game ...)
      setTimeout(poll, 40);
    })();
  }
  window.addEventListener("mousedown", function (e) {
    if (disabled || e.__oc || e.button !== 0 || OC.screen !== "pause" || M.visible || holds.leave) return;
    if (OC.net && OC.net.canWatch && OC.net.canWatch()) { if (!leaveWatch) watchLeave(); return; }
    var pt = N.fromClient(e.clientX, e.clientY), c = pos("pause.leave");
    if (Math.abs(pt[0] - c[0]) > 102 || Math.abs(pt[1] - c[1]) > 10) return;
    userPage = leaveTarget();
    var o = hold("leave", 9000);
    render();
    setTimeout(function () { if (holds.leave === o && OC.screen === "pause") { holds.leave = null; render(); } }, 2500);   // the click did not leave: back to the pause menu
  }, true);

  /* The game's own Edit World and Create New World screens crash the whole game when they get the Escape key (a bug in the game, measured; their
   * Cancel buttons are fine). Escape presses Cancel there instead: on Edit World Shift+Tab goes to the last button and Enter presses it, on Create
   * New World the button is clicked. (Our own create flow, which has the loading card up, is stopped through the card.) */
  window.addEventListener("keydown", function (e) {
    if (disabled || e.__oc || e.code !== "Escape") return;
    var edit = !!(wrun && wrun.kind === "edit" && wrun.stage === "native"), create = OC.screen === "createworld" && !join;
    if (!edit && !create) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (create) { var p = pos("create.cancel"); N.click(p[0], p[1]); }
    else N.key("Tab", "Tab", 9, { shiftKey: true }).then(function () { return N.key("Enter", "Enter", 13); });
  }, true);

  /* the game shows Edit Profile at every start. Players who already picked a real name do not need it. */
  function isDefaultName(n) { return /^(yeeish|yee|yeer|yeeler|eagler|eagl|darver|darvler|vool|vigg|deev|yigg|yeeg){2}\d{2,4}$/i.test(n || ""); }
  /* Done on the game's profile screen. With an auto-generated name the game first asks "Default Username Detected":
   * answer it (Continue Anyway) behind the cover. Resolves true once the title screen is up. */
  function pressDone() {
    var d = pos("profile.done");
    return N.click(d[0], d[1]).then(function () {
      return waitUntil(function () { return OC.screen === "title" || OC.screen === "defaultname"; }, 12000);
    }).then(function (ok) {
      if (!ok) return false;
      if (OC.screen === "title") return true;
      return N.frames(6).then(function () { var c = pos("name.continue"); return N.click(c[0], c[1]); }).then(function () {
        return waitUntil(function () { return OC.screen === "title"; }, 10000);
      });
    });
  }
  function skipStartupProfile() {
    holds.skip = true;
    render();
    N.frames(10).then(pressDone).then(function () { holds.skip = false; render(); });
  }

  OC.on("screen", function (s) {
    trace("screen " + s);
    var first = !sawScreen;
    if (s) { booting = false; sawScreen = true; }
    if (s === "profile" && first && currentName() && !isDefaultName(currentName()) && !profile.busy && !disabled) { skipStartupProfile(); return; }
    if (s === "title") { session = null; refreshAccount(); if (userPage === "worlds") loadWorlds(); }
    if (wrun && wrun.stage === "native") {                                                      // the player is on one of the game's world screens (Edit World, the import box)
      if (s === "title" || (s === "worlds" && wrun.left)) { wrun = null; loadWorlds(); }          // back on the list (or the title): ours again
      else if (s !== "worlds") wrun.left = true;
    }
    if (s === "multiplayer" && relaysRun && relaysRun.stage === "native") relaysRun = null;     // back from the game's Relays screen
    if (s === "profile" && !profile.busy) { profileLoad(); refreshAccount(); }
    if (holds.away && s !== "title") holds.away = null;                                   // the game left the title: what we pressed opened
    if (holds.back && s === "title") holds.back = null;
    if (holds.leave && (s === "title" || s === "multiplayer" || s === "disconnected")) holds.leave = null;
    if (s === "disconnected") onDisconnected();
    else if (join) joinOnScreen(s);
    render();
  });
  var bootStart = 0;
  setInterval(function () {                                   // boot cover + safety net
    if (!built) return;
    if (booting && window.__eaglerGameReady) {
      if (!bootStart) bootStart = now();
      if (!OC.screen && (now() - bootStart > 240000 || (N.isBroken && N.isBroken()))) { booting = false; render(); }   // never saw a known screen (or detection is down): step aside
      else if (!M.visible) render();
    }
  }, 500);

  /* ---------- account chip: the head of the skin you are using ---------- */
  function headCanvas(skin) {
    var c = document.createElement("canvas"); c.width = 8; c.height = 8;
    var x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    try { x.drawImage(skin.src, 8, 8, 8, 8, 0, 0, 8, 8); x.drawImage(skin.src, 40, 8, 8, 8, 0, 0, 8, 8); } catch (e) { /* not loaded yet */ }
    return c;
  }
  function refreshAccount(headOnly) {
    if (!built) return;
    var d = readProfileData(), n = (d && d.username) || currentName() || "Player", av = root.querySelector(".ocm-avatar"), skin = null;
    if (!headOnly) root.querySelector(".ocm-acct .nm").textContent = n;
    if (d) {
      if (d.sel >= 0 && d.sel < d.skins.length && d.skins[d.sel].data) skin = { src: rgbaCanvas(d.skins[d.sel].data) };
      else if (d.sel >= d.skins.length && presets[d.sel - d.skins.length] && presets[d.sel - d.skins.length].src.complete) skin = presets[d.sel - d.skins.length];
    }
    av.textContent = "";
    if (skin) av.appendChild(headCanvas(skin)); else av.textContent = n.charAt(0).toUpperCase();
  }

  /* ---------- events ---------- */
  function wire() {
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (b) act(b.getAttribute("data-act"), b);
      else if (M.page === "play" && join) act("play");               // anywhere on the Click to play screen
    });
    root.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    root.querySelector(".ocm-modeseg").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var m = b.getAttribute("data-m"), ip = root.querySelector("#ocm-sip");
      if (m === "relay") ip.value = ip.value.replace(/^(wss?|https?):\/\//i, "");        // a relay server is the plain Minecraft server, not a ws:// endpoint
      if (m === "wisp") ip.value = ip.value.replace(/^(java|wss?|https?):\/\//i, "");
      setMode(m);
    });
    root.querySelector(".ocm-armseg").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b && profile.pending) { profile.pending.slim = b.getAttribute("data-arms") === "slim"; syncArms(); updatePreview(); }
    });
    root.querySelector("#ocm-skins").addEventListener("click", function (e) {
      var t = e.target.closest("[data-i]");
      if (t) chooseSkin(parseInt(t.getAttribute("data-i"), 10));
      else if (e.target.closest("[data-add]")) root.querySelector("#ocm-file").click();
    });
    root.querySelector("#ocm-file").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) loadUpload(f); });
    var pf = root.querySelector(".ocm-profile");
    pf.addEventListener("dragover", function (e) { e.preventDefault(); });
    pf.addEventListener("drop", function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadUpload(f); });
    // the game must not see what is typed into our fields
    ["keypress", "keyup"].forEach(function (t) { window.addEventListener(t, function (e) { if (M.visible && !e.__oc) e.stopPropagation(); }, true); });
    window.addEventListener("keydown", function (e) {
      if (!M.visible || e.__oc || e.__ocUi) return;                                  // __ocUi: the Mods menu / overlay took this key (core.js)
      if (e.code === "Escape" && !e.repeat) {
        if (OC.ui && OC.ui.isOpen && OC.ui.isOpen()) return;                       // the Mods menu is open on top: it takes the key
        if (join) { if (join.stage === "failed") dismissJoin(false); else if (join.stage === "open" || join.stage === "connecting" || (join.kind === "world" && join.stage === "loading")) cancelJoin(); }
        else if (dlgOpen(".ocm-wdlg")) closeCreate();
        else if (dlgOpen(".ocm-wdel")) closeDelete();
        else if (dialogOpen()) closeDialog();
        else if (M.page === "servers") act("back");
        else if (M.page === "account") act("acc-back");
        else if (M.page === "worlds") { if (!wrun) act("wback"); }
        else if (M.page === "profile" && !profile.busy) act("pback");
      } else if (e.code === "Enter" && !e.repeat) {
        var id = e.target && e.target.id;
        if (id === "ocm-direct") act("direct"); else if (id === "ocm-user") act("apply");
        else if (id === "ocm-apair") act("acc-pair"); else if (id === "ocm-aclient") act("acc-signin"); else if (id === "ocm-aport") act("acc-port"); else if (id === "ocm-awisp") act("acc-wisp-save");
        else if (dialogOpen() && (id === "ocm-sname" || id === "ocm-sip")) act("dlg-save");
        else if (dlgOpen(".ocm-wdlg") && (id === "ocm-wname" || id === "ocm-wseed")) act("wc-go");
      }
    }, true);
    root.addEventListener("input", function (e) {
      if (e.target.id === "ocm-sip") {                                                   // like the game: a ws:// or wss:// address means EaglerX
        if (dialogMode() === "relay" && /^(wss?|https?):\/\//i.test(e.target.value)) setMode("eaglerx"); else syncHint();
        return;
      }
      if (e.target.id === "ocm-aclient" || e.target.id === "ocm-awisp") { e.target._touched = true; return; }
      if (e.target.id === "ocm-agateon") { if (OC.gate) OC.gate.setEnabled(e.target.checked); return; }
      if (e.target.id === "ocm-user") { profile.name =e.target.value.replace(/[^A-Za-z0-9_]/g, ""); if (e.target.value !== profile.name) e.target.value = profile.name; if (statusIdle) idleStatus(); }
      if (e.target.id === "ocm-wq") { worlds.q = e.target.value; renderWorlds(); }
    });
    root.querySelector(".ocm-wdlg").addEventListener("click", function (e) {            // Create world: the segmented choices
      var b = e.target.closest(".ocm-seg button");
      if (b) setCreateChoice(b.parentNode.getAttribute("data-seg"), b.getAttribute("data-v"));
    });
    if (OC.status) OC.status.onChange(function (k) {                                  // an answer from a server: update its card in place
      Array.prototype.forEach.call(root.querySelectorAll(".ocm-card"), function (c) { if (c._srv && OC.status.key(c._srv) === k) paintCard(c, c._srv); });
    });
    var lastBridge = "";
    if (OC.gate) OC.gate.onChange(function () { if (M.page === "account") renderAccount(); });
    if (OC.account) OC.account.onChange(function (s) {
      paintAccountBtn();
      if (M.page === "account") renderAccount();
      if (dialogOpen() && dialogMode() === "wisp") syncHint();
      if (s.bridge !== lastBridge) {                                                    // the bridge came or went: ask the Java-account servers again
        lastBridge = s.bridge;
        if (M.page === "servers" && OC.status) { OC.status.refresh(serverRows().filter(function (x) { return x.wisp; }), true); repaintCards(); }
      }
    });
  }

  function act(a, el) {
    switch (a) {
      case "account": openAccount(); break;
      case "err-account": dismissJoin(false); openAccount(); render(); break;                 // from a failed Java-account join: back to servers, on the account page
      case "acc-back": userPage = "servers"; setPage("servers"); break;
      case "acc-check": if (OC.account) { OC.account.poll(); toast("Looking for OneClient Bridge..."); } break;
      case "acc-pair": accountPair(); break;
      case "acc-prov": accountProvider(); break;
      case "acc-wisp-save": wispSave(); break;
      case "acc-wisp-test": wispTest(); break;
      case "acc-unpair": if (OC.account) OC.account.unpair(); break;
      case "acc-port": accountPort(); break;
      case "acc-signin": accountSignIn(); break;
      case "acc-mode": if (el && OC.account) OC.account.setMode(el.getAttribute("data-mode")).catch(accountFail); break;
      case "acc-cancel": accountCancel(); break;
      case "acc-copy": accountCopy(); break;
      case "acc-open": accountOpenLink(); break;
      case "acc-donut": addJavaServer("DonutSMP", "donutsmp.net"); break;
      case "acc-use": if (el && OC.account) OC.account.use(el.getAttribute("data-id")).catch(accountFail); break;
      case "acc-out": if (el && OC.account) OC.account.signOut(el.getAttribute("data-id")).catch(accountFail); break;
      case "sp": if (OC.worlds) openWorlds(); else goNative("title.singleplayer"); break;
      case "options": goNative("title.options"); break;                                       // the game's own Options screen
      case "wback": if (!wrun) { userPage = "home"; setPage("home"); } break;
      case "wcreate": openCreate(); break;
      case "wmore": worldsMore(); break;
      case "wc-cancel": closeCreate(); break;
      case "wc-go": saveCreate(); break;
      case "wd-cancel": closeDelete(); break;
      case "wd-go": confirmDelete(); break;
      case "mods": OC.ui.openMods(); break;
      case "profile": openProfile(); break;
      case "mp": openServers(); break;
      case "back": userPage = "home"; setPage("home"); break;
      case "pback": closeProfile(); break;
      case "add": openDialog(null); break;
      case "refresh": refreshStatus(true); break;
      case "relays": openRelays(); break;
      case "direct": directConnect(); break;
      case "dlg-cancel": closeDialog(); break;
      case "dlg-save": saveDialog(); break;
      case "apply": apply(); break;
      case "clear-skins": clearSkins(); break;
      case "cancel-join": cancelJoin(); break;
      case "dismiss": dismissJoin(false); break;
      case "retry": dismissJoin(true); break;
      case "play": startPlay(); break;
    }
  }

  /* Singleplayer / Options are the game's own screens: keep the cover until the title is really gone, then reveal them */
  function goNative(name) {
    var o = hold("away", 4000), p = pos(name);
    render();
    N.click(p[0], p[1]);
    return o;
  }

  /* ---------- servers page ---------- */
  function openServers() {
    userPage = "servers";
    setPage("servers");
    readServers().then(function (r) { servers = r; renderServers(); refreshStatus(false); });
    if (OC.account && OC.account.paired()) OC.account.poll().then(function () { paintAccountBtn(); if (M.page === "servers") refreshStatus(false); });
    paintAccountBtn();
    if (!statusTimer) statusTimer = setInterval(function () { if (M.page === "servers" && M.visible && !join) refreshStatus(false); }, 15000);
  }
  /* ---- what the servers say about themselves (client/status.js): the picture, the players and the speed on each card ---- */
  var statusTimer = 0;
  function refreshStatus(force) {
    if (!OC.status) return;
    OC.status.refresh(serverRows(), !!force);
    repaintCards();
  }
  function pingClass(ms) { return ms <= 90 ? "q3" : ms <= 220 ? "q2" : "q1"; }
  function bars(q) { return '<s class="ocm-bars"><i class="on"></i><i' + (q !== "q1" ? ' class="on"' : "") + "></i><i" + (q === "q3" ? ' class="on"' : "") + "></i></s>"; }
  function paintCard(card, s) {
    var st = OC.status ? OC.status.get(s) : null, ico = card.querySelector(".ocm-sico"), line = card.querySelector(".ocm-meta span"), stat = card.querySelector(".ocm-stat");
    var icon = st && st.icon ? st.icon : "";
    if (icon) {                                                                       // the server's own picture instead of the first letter
      if (ico.getAttribute("data-icon") !== icon) { ico.textContent = ""; var im = document.createElement("img"); im.alt = ""; im.draggable = false; im.src = icon; ico.appendChild(im); ico.setAttribute("data-icon", icon); }
      ico.classList.add("has-img");
    } else if (ico.hasAttribute("data-icon") || !ico.textContent) {
      ico.removeAttribute("data-icon"); ico.classList.remove("has-img"); ico.textContent = (s.name || shown(s) || "?").charAt(0).toUpperCase();
    }
    var motd = st && st.motd ? st.motd.split("\n").map(function (t) { return t.trim(); }).filter(Boolean)[0] : "";
    line.textContent = motd || (s.hidden ? "Address hidden" : shown(s));
    line.title = s.rel && !s.hidden ? "Through " + relayName(s.rel.base) : s.wisp && !s.hidden ? "Signs in with your Java account" : "";
    var html = "", cls = "ocm-stat";
    if (st && (st.state === "online" || st.state === "stale")) {
      var q = st.ping ? pingClass(st.ping) : "q2";
      html = '<b class="pl">' + (st.online | 0) + "<i> / " + (st.max | 0) + "</i></b>" + '<span class="pg ' + q + '">' + bars(q) + (st.ping ? st.ping + " ms" : "") + "</span>";
      if (st.state === "stale") cls += " stale";
    } else if (st && st.state === "offline") html = '<span class="pg q0">Offline</span>';
    else if (st && (st.state === "pending" || st.querying)) html = '<span class="pg dim">Checking...</span>';
    else if (st && st.state === "unknown") html = '<span class="pg dim">' + (s.wisp && st.error ? "Bridge off" : "No status") + "</span>";
    stat.className = cls; stat.innerHTML = html;
    var tip = [];
    if (st && st.motd) tip.push(st.motd.split("\n").map(function (t) { return t.replace(/\s+/g, " ").trim(); }).filter(Boolean).join(" | "));
    if (st && st.version) tip.push("Version " + st.version);
    if (st && st.sample && st.sample.length) tip.push("Players: " + st.sample.join(", "));
    if (st && st.state === "offline" && st.error) tip.push("Could not connect (" + st.error + ")");
    if (st && st.state === "unknown" && s.wisp && st.error) tip.push(st.error + ": start it to see this server\u2019s status");
    card.title = tip.join("\n");
  }
  function repaintCards() { Array.prototype.forEach.call(root.querySelectorAll(".ocm-card"), function (c) { if (c._srv) paintCard(c, c._srv); }); }
  function modeLabel(s) { var m = s.rel ? "relay" : s.mode; return m === "relay" ? "Relay" : m === "wisp" ? "Java" : m === "tcp" ? "TCP" : "EaglerX"; }
  function shown(s) { return s.rel ? s.rel.target : s.wisp ? s.wisp.target : s.ip; }      // a relay or Java-account server is listed by the server it reaches, not by the long address the game saves

  function renderServers() {
    var list = root.querySelector(".ocm-list"), rows = serverRows();
    list.innerHTML = "";
    rows.forEach(function (s, i) {
      var hu = hue(s.name || shown(s)), card = h("div", "ocm-card");
      card.style.setProperty("--i", i);
      card.innerHTML = '<div class="ocm-sico" style="--c1:hsl(' + hu + ',78%,76%);--c2:hsl(' + ((hu + 40) % 360) + ',72%,66%)">' + esc((s.name || "?").charAt(0).toUpperCase()) + "</div>" +
        '<div class="ocm-meta"><b>' + esc(s.name || shown(s)) + "</b><span>" + (s.hidden ? "Address hidden" : esc(shown(s))) + '</span></div><div class="ocm-stat"></div><span class="ocm-chip">' + modeLabel(s) + '</span><div class="ocm-acts"></div>';
      card._srv = s;
      paintCard(card, s);
      var acts = card.querySelector(".ocm-acts"), j = btn("small primary", "", "Join", "x");
      j.removeAttribute("data-act");
      j.addEventListener("click", function (e) { e.stopPropagation(); joinServer(s); });
      acts.appendChild(j);
      if (!s.virtual) {                                          // the game's default server is not ours to edit or remove
        var ed = iconBtn("edit", "x"), del = iconBtn("trash", "x", "danger");
        ed.removeAttribute("data-act"); del.removeAttribute("data-act");
        ed.addEventListener("click", function (e) { e.stopPropagation(); openDialog(s); });
        del.addEventListener("click", function (e) { e.stopPropagation(); servers.list.splice(servers.list.indexOf(s), 1); writeServers(servers.list).then(renderServers); });
        acts.appendChild(ed); acts.appendChild(del);
      }
      list.appendChild(card);
    });
    if (M.page === "servers") refreshStatus(false);                 // new or changed entries get asked, the others keep their answer for a while
  }

  function dialogOpen() { return root.querySelector(".ocm-dlg").classList.contains("open"); }
  function dialogMode() { var on = root.querySelector(".ocm-modeseg button.on"); return on ? on.getAttribute("data-m") : "relay"; }
  function setMode(m) {
    Array.prototype.forEach.call(root.querySelectorAll(".ocm-modeseg button"), function (b) { b.classList.toggle("on", b.getAttribute("data-m") === m); });
    syncHint();
  }
  /* the line under the mode buttons: what the chosen mode does with the address (or what is wrong with it) */
  function syncHint(bad) {
    var m = dialogMode(), hint = root.querySelector("#ocm-hint");
    root.querySelector("#ocm-sip").placeholder = m === "eaglerx" ? "wss://example.com" : m === "wisp" ? "donutsmp.net" : "play.example.com:25565";
    if (bad) { hint.className = "ocm-hint bad"; hint.textContent = bad; return; }
    if (m === "wisp") {
      var acc = OC.account, who = acc && acc.active();
      if (acc && acc.state().bridge === "ready" && who) { hint.className = "ocm-hint"; hint.innerHTML = "Signs in as <b>" + esc(who.name) + "</b>, like the normal game does. Type the Minecraft server, like donutsmp.net."; }
      else if (!acc || !acc.wispUrl()) { hint.className = "ocm-hint warn"; hint.innerHTML = "Pair OneClient with the bridge first (<b>Java account</b> page), then add the server."; }
      else { hint.className = "ocm-hint warn"; hint.innerHTML = "You can save the server now. To join it, sign in on the <b>Java account</b> page (and start OneClient Bridge if you use it)."; }
      return;
    }
    if (m === "eaglerx") { hint.className = "ocm-hint"; hint.innerHTML = "Direct connection to an EaglerX server: <b>wss://</b> address (<b>ws://</b> for local servers)."; return; }
    var rel = editing && editing.rel ? { name: relayName(editing.rel.base) } : defaultRelay();
    if (rel) { hint.className = "ocm-hint"; hint.innerHTML = "Goes through the multiplayer relay <b>" + esc(rel.name) + "</b>. Type the Minecraft server, like play.example.com:25565."; }
    else { hint.className = "ocm-hint warn"; hint.innerHTML = "No multiplayer relay is set up. Add one with <b>Relays</b> on this page, or use EaglerX."; }
  }
  function openDialog(s) {
    editing = s;
    var d = root.querySelector(".ocm-dlg"), ws = !!s && !s.rel && !s.wisp && /^wss?:\/\//i.test(s.ip);
    d.querySelector("h3").textContent = s ? "Edit server" : "Add server";
    root.querySelector("#ocm-sname").value = s ? s.name : "";
    root.querySelector("#ocm-sip").value = !s ? "" : s.rel ? s.rel.target : s.wisp ? s.wisp.target : s.ip;
    setMode(ws ? "eaglerx" : s && s.wisp ? "wisp" : "relay");                      // new servers start on Relay, like the game
    d.classList.add("open");
    setTimeout(function () { root.querySelector("#ocm-sname").focus(); }, 60);
  }
  function closeDialog() { root.querySelector(".ocm-dlg").classList.remove("open"); editing = null; }
  function saveDialog() {
    var name = root.querySelector("#ocm-sname").value.trim(), text = root.querySelector("#ocm-sip").value.trim();
    if (!text) { root.querySelector("#ocm-sip").focus(); return; }
    var r = buildAddress(text, dialogMode(), editing && editing.rel ? editing.rel.base : null);   // an edited relay server keeps its relay
    if (r.error) { syncHint(r.error); root.querySelector("#ocm-sip").focus(); return; }
    if (!name) name = r.label;
    var wp = r.mode === "wisp" && OC.account ? OC.account.parseWisp(r.ip) : null;
    if (editing) { editing.name = name; editing.ip = r.ip; editing.mode = r.mode; editing.rel = parseRelay(r.ip); editing.wisp = wp; }
    else servers.list.push({ name: name, ip: r.ip, mode: r.mode, hidden: 0, raw: null, rel: parseRelay(r.ip), wisp: wp });
    writeServers(servers.list).then(function () { closeDialog(); renderServers(); });
  }

  /* Direct connect: a ws:// or wss:// address is an EaglerX server, anything else is a Minecraft server reached
   * through the multiplayer relay (the game's own Direct Connection screen starts on Relay too). */
  function directConnect() {
    var input = root.querySelector("#ocm-direct"), text = input.value.trim();
    if (!text) { input.focus(); return; }
    var r = buildAddress(text, "relay");
    if (r.error) { toast(r.error, true); input.focus(); return; }
    var existing = serverRows().filter(function (s) { return sameAddr(s.ip, r.ip); })[0];
    if (existing) { joinServer(existing); return; }
    var entry = { name: r.label, ip: r.ip, mode: r.mode, hidden: 0, raw: null, rel: parseRelay(r.ip) };
    servers.list.push(entry);
    writeServers(servers.list).then(function () { input.value = ""; renderServers(); joinServer(entry); });
  }

  /* ---------- Java account page (client/account.js: OneClient Bridge and the Microsoft sign-in) ---------- */
  var accTimer = 0, accTick = 0, accClearing = false;
  function accountFail(e) { toast((e && e.message) || "That did not work.", true); }
  function openAccount() {
    if (!OC.account || !built) return;
    userPage = "account";
    setPage("account");
    renderAccount();
    OC.account.poll().then(function () { OC.account.check(); });
    clearInterval(accTimer);
    accTick = 0;
    accTimer = setInterval(function () {
      if (M.page !== "account" || !M.visible) { clearInterval(accTimer); accTimer = 0; return; }
      renderCountdown();
      if (++accTick % 4 === 0) OC.account.poll();
    }, 1000);
  }
  function paintAccountBtn() {
    var b = root && OC.account && root.querySelector('[data-act="account"]');
    if (!b) return;
    var st = OC.account.state(), who = OC.account.active(), ok = st.bridge === "ready" && !!who;
    b.classList.toggle("ok", ok);
    b.classList.toggle("warn", !ok && st.bridge !== "unknown");
    b.title = ok ? "Signed in as " + who.name : "Sign in with a Java account to join online-mode servers";
  }
  function renderAccount() {
    if (!built || !OC.account) return;
    var A = OC.account, st = A.state(), b = st.bridge, ready = b === "ready", q = function (sel) { return root.querySelector(sel); };
    var title = q("#ocm-abtitle"), text = q("#ocm-abtext"), builtin = st.provider === "browser";
    q("#ocm-abdot").className = "ocm-dot " + (ready ? "ok" : b === "unpaired" || b === "wrongcode" ? "warn" : b === "unknown" ? "" : "bad");
    if (builtin) {
      title.textContent = "Sign-in runs in this page";
      var tun = A.wispUrl();
      text.innerHTML = "Nothing to install: OneClient talks to Microsoft and Mojang through a Wisp tunnel (" + (tun ? "now <b>" + esc(tun.replace(/^wss?:\/\//i, "").replace(/\/$/, "")) + "</b>" : "none set") + "), and the secure connection to them is made here, end to end, so the tunnel only carries scrambled bytes. Your Microsoft password is only ever typed on microsoft.com.";
    } else if (ready) {
      title.textContent = "OneClient Bridge is connected";
      text.innerHTML = "Version " + esc(st.version) + ", port " + A.port() + ". Keep its window open while you play." + (st.readable ? "" : " It is set to leave the encryption to the game: OneClient\u2019s mods cannot read online-mode servers.");
    } else if (b === "unpaired") {
      title.textContent = "Pair OneClient with the bridge";
      text.innerHTML = "The bridge window shows a pairing code like <b>ABCD-EFGH-JKMN</b>. Type it here once; OneClient remembers it.";
    } else if (b === "wrongcode") {
      title.textContent = "The pairing code does not match";
      text.innerHTML = "The bridge was reset or this is another bridge. Type the code its window shows now.";
    } else if (b === "unknown") {
      title.textContent = "Looking for OneClient Bridge...";
      text.textContent = "";
    } else {
      title.textContent = "OneClient Bridge was not found";
      text.innerHTML = "The bridge is a small program that runs on this computer. It does the Microsoft sign-in and the server connection for OneClient, which a web page cannot do itself. Start <b>OneClient Bridge.bat</b> from the <b>bridge</b> folder next to this file (it needs Node.js 18 or newer), keep its window open, then press <b>Check again</b>. If your browser asks to let this page reach devices on your local network, choose Allow." + (st.error ? " (" + esc(st.error) + ")" : "");
    }
    q("#ocm-abpair").style.display = !builtin && (b === "unpaired" || b === "wrongcode") ? "" : "none";
    q("#ocm-abunpair").style.display = !builtin && (ready || b === "wrongcode") ? "" : "none";
    q("#ocm-abport").style.display = !builtin && (b === "off" || b === "unknown") ? "" : "none";
    q("#ocm-abwisp").style.display = builtin ? "" : "none";
    q("#ocm-awres").style.display = builtin ? "" : "none";
    var gt = builtin && OC.gate ? OC.gate.state() : null;                                     // the login gate: mods can read Java-account servers
    q("#ocm-agate").style.display = gt ? "" : "none";
    q("#ocm-agatemsg").style.display = gt ? "" : "none";
    if (gt) {
      q("#ocm-agateon").checked = gt.on;
      q("#ocm-agatemsg").textContent = !gt.on ? "Off: the game does the login encryption, mods that read the connection show nothing on Java-account servers."
        : gt.failed.length ? "Left to the game after a problem on " + gt.failed.join(", ") + " (mods cannot read it). Switch this off and on to try again."
        : gt.last && gt.last.state === "failed" ? "The last login could not be taken over: " + gt.last.message
        : gt.last && gt.last.state === "reading" ? "Mods can read " + gt.last.server + " right now." : "";
    }
    var pt = q("#ocm-aport"), wi = q("#ocm-awisp"), pv = q("#ocm-abprov");
    if (document.activeElement !== pt) pt.value = A.port();
    if (document.activeElement !== wi && !wi._touched) wi.value = A.wispCustom();
    pv.style.display = builtin || A.browserAvailable() ? "" : "none";
    pv.textContent = builtin ? "Use OneClient Bridge instead (advanced, needs Node.js on a computer)" : "Use the built-in sign-in instead";
    q("#ocm-asacct").style.display = ready ? "" : "none";
    if (!ready) return;

    var list = q("#ocm-alist"), lsig = st.provider + "#" + st.accounts.map(function (a) { return a.id + ":" + a.name + ":" + (a.id === st.active ? 1 : 0) + ":" + (st.problemId === a.id ? st.problem : ""); }).join("|");
    if (list._sig !== lsig) { list._sig = lsig; paintAccountList(list, st); }
    paintAccountLogin(q("#ocm-alogin"), st);
    var L = st.login || { state: "none" }, busy = L.state === "waiting" || L.state === "working";
    q("#ocm-aadd").style.display = busy || L.state === "error" ? "none" : "";
    q("#ocm-aquick").style.display = st.active && !busy ? "" : "none";
    var ci = q("#ocm-aclient");
    if (document.activeElement !== ci && !ci._touched) ci.value = st.clientId || "";
    var modeBox = q("#ocm-amode"), showMode = builtin && !st.clientLocked && !!st.mode;                        // the choice exists for the built-in sign-in, unless the page came with its own app ID
    modeBox.style.display = showMode ? "" : "none";
    if (showMode) {
      Array.prototype.forEach.call(modeBox.querySelectorAll("button"), function (b) { b.classList.toggle("on", b.getAttribute("data-mode") === st.mode); });
      q("#ocm-amodetext").innerHTML = st.mode === "quick"
        ? "No Azure app needed. OneClient signs in the way <b>Mineflayer</b> and <b>prismarine-auth</b> do, as Minecraft on a Nintendo Switch, so the Microsoft page names that app and not OneClient. Microsoft and Mojang do not offer this for third-party clients, so it could stop working; your own Azure app is the supported way."
        : "Uses an Azure app of your own that Mojang approved (the supported way). Paste its ID below.";
    }
    q("#ocm-aadd .ocm-field").style.display = q("#ocm-aadd .ocm-help").style.display = st.clientLocked || (showMode && st.mode === "quick") ? "none" : "";      // the ID box: your own app only
  }
  function paintAccountList(list, st) {
    list.innerHTML = "";
    if (!st.accounts.length) list.appendChild(h("div", "ocm-aempty", "No Microsoft account is signed in yet."));
    st.accounts.forEach(function (a) {
      var hu = hue(a.name), row = h("div", "ocm-arec" + (a.id === st.active ? " on" : "")), bad = st.problemId === a.id && st.problem ? st.problem : "";
      row.innerHTML = '<div class="ocm-sico" style="--c1:hsl(' + hu + ',78%,76%);--c2:hsl(' + ((hu + 40) % 360) + ',72%,66%)">' + esc(a.name.charAt(0).toUpperCase()) + '</div><div class="ocm-meta"><b>' + esc(a.name) + "</b><span" + (bad ? ' class="bad"' : "") + ">" + (bad ? esc(bad) : (a.id === st.active ? "In use" : "Signed in") + " (" + (st.provider === "bridge" ? "saved by the bridge" : "saved in this browser") + ")") + '</span></div><div class="ocm-acts"></div>';
      var acts = row.querySelector(".ocm-acts");
      if (a.id !== st.active) { var u = btn("small", "", "Use", "acc-use"); u.setAttribute("data-id", a.id); acts.appendChild(u); }
      var o = btn("small", "", "Sign out", "acc-out"); o.setAttribute("data-id", a.id); acts.appendChild(o);
      list.appendChild(row);
    });
  }
  function paintAccountLogin(lg, st) {                                                  // the sign-in in progress: only rebuilt when it changes (the code stays selectable)
    var L = st.login || { state: "none" }, sig = L.state + "|" + (L.userCode || "") + "|" + (L.message || "");
    if (lg._sig === sig) { renderCountdown(); return; }
    lg._sig = sig;
    lg.className = "ocm-alogin " + L.state;
    lg.innerHTML = "";
    if (L.state === "waiting") {
      lg.innerHTML = '<div class="ocm-lstep">Open <b>microsoft.com/link</b> in your browser, sign in, and enter this code:</div><div class="ocm-acode">' + esc(L.userCode || "") + '</div><div class="ocm-arow"></div><div class="ocm-lnote" id="ocm-acount"></div>';
      var ar = lg.querySelector(".ocm-arow");
      ar.appendChild(btn("small primary", "", "Open the page", "acc-open"));
      ar.appendChild(btn("small", "", "Copy code", "acc-copy"));
      ar.appendChild(btn("small", "", "Cancel", "acc-cancel"));
      renderCountdown();
    } else if (L.state === "working") {
      lg.innerHTML = '<div class="ocm-spin"></div><div class="ocm-lnote">' + esc(L.message || "Signing in...") + "</div>";
    } else if (L.state === "done") {
      if (!accClearing) {                                                              // tell the player once, then let the bridge forget the finished sign-in
        accClearing = true;
        toast("Signed in as " + ((L.account && L.account.name) || "your account") + ". It is saved, so you will not need the code again.");
        A.cancel().catch(function () {}).then(function () { accClearing = false; });
      }
    } else if (L.state === "error") {
      lg.innerHTML = '<div class="ocm-lerr"></div><div class="ocm-arow"></div>';
      lg.querySelector(".ocm-lerr").textContent = L.message || "The sign-in did not work.";
      lg.querySelector(".ocm-arow").appendChild(btn("small", "", "Try again", "acc-cancel"));
    }
  }
  function renderCountdown() {
    var el = root && root.querySelector("#ocm-acount");
    if (!el || !OC.account) return;
    var st = OC.account.state(), L = st.login || {}, left = Math.max(0, Math.round((L.expiresIn || 0) - (Date.now() - st.at) / 1000));
    el.textContent = "Waiting for you to finish... the code works for " + Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2) + " more.";
  }
  function accountPair() {
    var inp = root.querySelector("#ocm-apair"), v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    OC.account.pair(v).then(function () { inp.value = ""; toast("Paired with OneClient Bridge."); }).catch(accountFail);
  }
  function accountPort() {
    var v = parseInt(root.querySelector("#ocm-aport").value, 10);
    if (!(v >= 1 && v <= 65535)) { toast("Type the port the bridge listens on (default 8742).", true); return; }
    OC.account.setPort(v);
  }
  function accountSignIn() {
    var inp = root.querySelector("#ocm-aclient");
    OC.account.signIn(inp.value.trim()).then(function () { inp._touched = false; renderAccount(); }).catch(accountFail);
  }
  function accountCancel() { OC.account.cancel().catch(accountFail); }
  function accountProvider() {                                                         // built-in sign-in <-> OneClient Bridge
    var A = OC.account, to = A.provider() === "browser" ? "bridge" : "browser";
    A.setProvider(to).then(function () { renderAccount(); toast(to === "browser" ? "Using the built-in sign-in." : "Using OneClient Bridge."); }).catch(accountFail);
  }
  function wispSave() {
    var inp = root.querySelector("#ocm-awisp");
    try { OC.account.setWispCustom(inp.value); inp._touched = false; toast(inp.value.trim() ? "Wisp server saved." : "Using the built-in Wisp servers."); renderAccount(); }
    catch (e) { accountFail(e); }
  }
  function wispTest() {                                                                // can the Wisp server(s) carry an HTTPS request to Mojang?
    var A = OC.account, res = root.querySelector("#ocm-awres"), inp = root.querySelector("#ocm-awisp"), typed = inp.value.trim();
    var list = typed ? [typed] : OC.wisp.defaults.slice();
    res.textContent = "Testing...";
    var chain = Promise.resolve();
    list.forEach(function (u, i) {
      chain = chain.then(function () {
        var line = h("div", "ocm-awline", ""), name = u.replace(/^wss?:\/\//i, "").replace(/\/$/, "");
        line.textContent = name + " ...";
        if (i === 0) res.textContent = ""; res.appendChild(line);
        return A.testWisp(u).then(function (r) { line.className = "ocm-awline " + (r.ok ? "ok" : "bad"); line.textContent = name + (r.ok ? " works (" + (r.ms / 1000).toFixed(1) + " s)" : " failed: " + r.error); });
      });
    });
  }
  function addJavaServer(name, target) {                                              // a one-click Java-account server (the Servers page then shows it)
    var ip = OC.account && OC.account.wispAddress(target);
    if (!ip) { toast("Pair OneClient with the bridge first.", true); return; }
    readServers().then(function (r) {
      servers = r;
      if (servers.list.some(function (s) { return s.wisp && s.wisp.target === target; })) return null;
      servers.list.push({ name: name, ip: ip, mode: "wisp", hidden: 0, raw: null, rel: null, wisp: OC.account.parseWisp(ip) });
      return writeServers(servers.list);
    }).then(function (wrote) { openServers(); toast(wrote === null ? name + " is in your list already." : "Added " + name + ". Press Join."); });
  }
  function accountCopy() {
    var L = OC.account.state().login || {}, code = L.userCode || "";
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(function () { toast("Code copied."); }, function () { toast("Select the code and copy it by hand.", true); });
    else toast("Select the code and copy it by hand.", true);
  }
  function accountOpenLink() {
    var L = OC.account.state().login || {}, u = String(L.verificationUri || "https://www.microsoft.com/link");
    if (!/^https:\/\/([a-z0-9-]+\.)*(microsoft\.com|live\.com|microsoftonline\.com)(\/|$)/i.test(u)) u = "https://www.microsoft.com/link";
    window.open(u, "_blank", "noopener");
  }

  /* The game's Relays screen (where its multiplayer relays are added, reordered and removed) is the game's own:
   * open it behind the cover (title > Multiplayer > Relays), then let the game show itself until it is back on its
   * server list, where the cover takes over again. */
  var relaysRun = null;
  function openRelays() {
    if (join || profile.busy || holds.skip || relaysRun || OC.screen !== "title") return;
    var run = relaysRun = { stage: "opening" };
    function fail(msg) { if (relaysRun === run) relaysRun = null; toast(msg, true); render(); }
    render();
    var p = pos("title.multiplayer");
    N.click(p[0], p[1]).then(function () {
      return waitUntil(function () { return relaysRun !== run || OC.screen === "multiplayer"; }, 20000);
    }).then(function (ok) {
      if (relaysRun !== run) return null;
      if (!ok) { fail("The game did not open its server list."); return null; }
      return N.frames(8).then(function () { var r = pos("mp.relays"); return N.click(r[0], r[1]); }).then(function () {
        return waitUntil(function () { return relaysRun !== run || OC.screen !== "multiplayer"; }, 6000);
      }).then(function (left) {
        if (relaysRun !== run) return null;
        if (!left) { fail("Could not open the game's Relays screen."); return null; }
        return N.frames(4).then(function () { if (relaysRun === run) { run.stage = "native"; render(); } });
      });
    });
  }

  /* ---------- joining a server ----------
   * We press the game's own buttons (title > Multiplayer > the row > Join Server) behind an opaque cover that shows
   * our own progress, so the game's menus, connecting screen and errors never appear. */
  function joinText(j, text) { j.status = text; if (built) root.querySelector(".ocm-cstatus").textContent = text; }
  function joinView() {
    var j = join;
    if (!j || !built) return;
    var isWorld = j.kind === "world", nm = isWorld ? (j.title || "the game") : j.entry ? (j.entry.name || shown(j.entry)) : "the server", hu = hue(nm);
    root.querySelector(".ocm-ctitle").textContent = isWorld ? (j.create ? "Creating " : "Loading ") + nm : "Joining " + nm;
    root.querySelector(".ocm-cstatus").textContent = j.status || "";
    root.querySelector('[data-act="cancel-join"]').disabled = !(j.stage === "open" || (isWorld ? (j.stage === "connecting" || j.stage === "loading") && OC.screen === "busy" : j.stage === "connecting"));
    root.querySelector(".ocm-etitle").textContent = j.kind === "kicked" ? "Disconnected" : isWorld ? "Couldn\u2019t load " + nm : "Couldn\u2019t join " + nm;
    var rs = root.querySelector(".ocm-ereason");
    rs.textContent = "";
    if (j.snap) rs.appendChild(j.snap.canvas); else rs.textContent = j.msg || "";
    root.querySelector('[data-act="retry"]').style.display = j.entry || (isWorld && !j.create) ? "" : "none";
    var jacct = !!(OC.account && j.entry && j.entry.wisp), eh = root.querySelector(".ocm-ehint"), eb = root.querySelector('[data-act="err-account"]');
    if (eh) eh.style.display = jacct ? "" : "none";
    if (eb) eb.style.display = jacct ? "" : "none";
    root.querySelector('[data-act="dismiss"] span').textContent = isWorld ? "Back to worlds" : "Back to servers";
    root.querySelector(".ocm-ptitle").textContent = isWorld ? "You\u2019re in " + nm : "You\u2019re in on " + nm;
    root.querySelector(".ocm-pnote").textContent = isWorld ? "The world is ready for your mouse." : "Joined. The game is ready for your mouse.";
    var pico = root.querySelector(".ocm-pico"), pst = OC.status && j.entry ? OC.status.get(j.entry) : null;
    pico.textContent = nm.charAt(0).toUpperCase();
    pico.style.cssText = "--c1:hsl(" + hu + ",78%,76%);--c2:hsl(" + ((hu + 40) % 360) + ",72%,66%)";
    pico.classList.toggle("has-img", !!(pst && pst.icon));
    if (pst && pst.icon) { pico.textContent = ""; pico.style.backgroundImage = "url(" + pst.icon + ")"; }
  }
  function alive(j) { return join === j && !j.cancelled && j.stage !== "failed"; }

  function joinServer(entry) {
    if (join || profile.busy || holds.skip || relaysRun) return;
    if (entry.wisp) {                                                // a Java-account server: the bridge and an account have to be ready before the game is even asked
      if (!OC.account) { toast("This build has no Java account support.", true); return; }
      OC.account.ensure().then(function (r) {
        if (!r.ok) { toast(r.message, true); openAccount(); return; }
        var cur = OC.account.wispUrl();                           // the tunnel that just worked may be another one than the entry saved: the game only joins entries that name the current one
        if (cur && entry.wisp.base !== cur) {
          entry.ip = OC.account.wispAddress(entry.wisp.target); entry.wisp = OC.account.parseWisp(entry.ip);
          writeServers(servers.list).then(function () { startJoin(entry); }, function () { startJoin(entry); });
          return;
        }
        startJoin(entry);
      });
      return;
    }
    startJoin(entry);
  }
  function startJoin(entry) {
    if (join || profile.busy || holds.skip || relaysRun) return;
    var idx = serverRows().indexOf(entry);
    if (idx < 0) return;
    var j = join = { kind: "join", entry: entry, idx: idx, stage: "open", cancelled: false, t0: now(), snap: null, sawNative: false, nullSince: 0, status: "Opening the server list\u2026" };
    userPage = "servers";
    joinView();
    render();
    runJoin(j);
  }

  /* press row n of the game's server list: click the first row (selects it and focuses the list), then Down n times,
   * which also scrolls rows below the fold into view */
  function selectRow(n) {
    var p0 = pos("mp.row", 0), chain = N.click(p0[0], p0[1]);
    function down() { return N.key("ArrowDown", "ArrowDown", 40); }
    for (var i = 0; i < n; i++) chain = chain.then(down);
    return chain.then(function () { return N.frames(4); });
  }

  function runJoin(j) {
    var p = pos("title.multiplayer");
    N.click(p[0], p[1]).then(function () {
      return waitUntil(function () { return !alive(j) || OC.screen === "multiplayer"; }, 20000);
    }).then(function () {
      if (!alive(j)) return null;
      if (OC.screen !== "multiplayer") { failJoin(j, "Couldn\u2019t open the game\u2019s server list. Try again."); return null; }
      return N.frames(6).then(function () { return alive(j) ? selectRow(j.idx) : null; }).then(function () {
        if (!alive(j)) return null;
        j.stage = "connecting";
        joinText(j, "Connecting\u2026");
        joinView();
        var b = pos("mp.join");
        return N.click(b[0], b[1]);
      });
    }).then(function () { if (alive(j)) armJoinWatch(j); });
  }

  function armJoinWatch(j) {
    j.clickedAt = now();
    j.timer = setInterval(function () {
      if (join !== j) return clearInterval(j.timer);
      var t = now() - j.clickedAt, s = OC.screen;
      if (j.stage !== "connecting" && j.stage !== "loading") return;
      if (s === "multiplayer" && t > 3500) { failJoin(j, "Couldn\u2019t start the connection. Try again."); return; }   // Join never went through
      if (s === null) {
        if (!j.nullSince) j.nullSince = now();
        if (!j.reveal && now() - j.nullSince > 9000) { j.reveal = true; render(); }          // an unknown screen and no progress: maybe a prompt that needs you, show the game
      } else { j.nullSince = 0; if (j.reveal) { j.reveal = false; render(); } }
    }, 250);
  }

  function joinOnScreen(s) {
    var j = join;
    if (j && s) { j.reveal = false; j.nullSince = 0; }                          // a screen we know is up again: cover it
    if (!j || j.stage === "failed") return;
    if (s && s !== "title") j.sawNative = true;
    if (j.kind === "world") joinView();                                          // the card's Cancel only works on the game's loading screen
    var loading = j.stage === "connecting" || j.stage === "loading";
    if (s === "connect" && j.stage === "connecting") joinText(j, "Connecting\u2026");
    else if (s === "terrain" && loading) { j.stage = "loading"; joinText(j, "Loading world\u2026"); joinView(); }
    else if (s === "busy" && loading && j.kind === "world") { j.stage = "loading"; joinText(j, "Loading the world\u2026"); joinView(); }
    else if (s === "pause" && loading) joinReady(j);
    else if (s === "title" && j.sawNative && !j.cancelled && j.stage !== "ready") failJoin(j, "The game went back to its title screen.");
    else if (j.kind === "world" && j.played && WORLD_SCREENS[s] && !j.cancelled && j.stage !== "ready") failJoin(j, "The game went back to its world list.");
  }

  /* the game asked for the mouse: the world is loaded (or the Esc menu was closed) */
  var LOCKY = { join: 1, world: 1 };
  OC.wantDeferLock = function () { return !!(join && LOCKY[join.kind] && (join.stage === "connecting" || join.stage === "loading")); };
  OC.on("lockrequest", function () {
    var j = join;
    if (j && LOCKY[j.kind] && (j.stage === "connecting" || j.stage === "loading")) joinReady(j);
  });
  function joinReady(j) {
    if (join !== j || j.stage === "ready" || j.stage === "failed") return;
    clearInterval(j.timer);
    j.stage = "ready"; j.reveal = false;
    if (j.kind === "join") session = { entry: j.entry };
    else if (j.kind === "world") session = { world: j.world };
    if (OC.lockDeferred) { joinView(); render(); return; }                       // "Click to play": the click gives the browser the gesture it wants
    setTimeout(function () { if (join === j) { join = null; render(); } }, 350);  // the game has the mouse already: let go of the cover
  }
  function startPlay() {
    var j = join;
    if (!j || j.stage !== "ready") return;
    OC.restoreLock();                                                              // inside this click: takes the mouse the game believes it holds
    join = null;
    render();
  }

  function failJoin(j, msg) {
    if (join !== j || j.stage === "failed") return;
    clearInterval(j.timer);
    j.stage = "failed"; j.msg = msg; j.reveal = false;
    joinView();
    render();
    goTitle(15000);                                                                // park the game on its title screen behind the card
  }

  /* The game's Disconnected screen (failed to connect, kicked, connection lost): copy its message off the frame
   * as a picture so the real reason shows on our card, without parsing anything and in any language.
   * The screen is centred: a title, the reason, and a button. Text is white; bright specks of the blurred
   * background are ignored by only keeping wide, centred lines. */
  function captureReason() {
    try {
      var c = N.canvas, k = N.scale();
      var y0 = Math.max(0, Math.round(c.height / 2 - 150 * k)), y1 = Math.min(c.height, Math.round(c.height / 2 + 120 * k));
      var shot = N.grab(0, y0, c.width, y1 - y0);
      if (!shot) return null;
      var W = shot.w, H = shot.h, d = shot.data, rows = new Int32Array(H), y, x, mid = W / 2;
      var bright = function (i) { return Math.max(d[i], d[i + 1], d[i + 2]) >= 185 && d[i] + d[i + 1] + d[i + 2] >= 330; };
      for (y = 0; y < H; y++) { var n = 0; for (x = 0; x < W; x++) if (bright((y * W + x) * 4)) n++; rows[y] = n; }
      var need = 3 * k, groups = [], start = -1, gap = 0;                         // rows of text, merged into blocks (title / reason lines / button label)
      for (y = 0; y < H; y++) {
        if (rows[y] >= need) { if (start < 0) start = y; gap = 0; }
        else if (start >= 0 && ++gap > 3 * k) { groups.push({ a: start, b: y - gap }); start = -1; gap = 0; }
      }
      if (start >= 0) groups.push({ a: start, b: H - 1 });
      function extent(a, b) {                                                     // x range holding almost all of the bright pixels of rows a..b, and their mean x
        var cnt = new Int32Array(W), total = 0, sum = 0, xx, yy;
        for (yy = a; yy <= b; yy++) for (xx = 0; xx < W; xx++) if (bright((yy * W + xx) * 4)) { cnt[xx]++; total++; sum += xx; }
        if (!total) return null;
        var acc = 0, lo = 0, hi = W - 1;
        for (xx = 0; xx < W; xx++) { acc += cnt[xx]; if (acc >= total * 0.0005) { lo = xx; break; } }
        acc = 0;
        for (xx = W - 1; xx >= 0; xx--) { acc += cnt[xx]; if (acc >= total * 0.0005) { hi = xx; break; } }
        return { x0: lo, x1: hi, mean: sum / total, n: total };
      }
      groups = groups.filter(function (g) {
        if (g.b - g.a < 2 * k) return false;
        var e = g.e = extent(g.a, g.b);
        return !!e && e.n >= 40 && e.x1 - e.x0 >= 8 * k && Math.abs(e.mean - mid) <= 14 * k;
      });
      if (groups.length < 2) return null;                                         // need the title/message and the button label
      var btn = groups.pop();                                                     // the last text is the button's label: not part of the message
      discBtnY = (y0 + (btn.a + btn.b) / 2) / k;
      var top = groups[0].a, bottom = groups[groups.length - 1].b, minX = W, maxX = 0;
      groups.forEach(function (g) { if (g.e.x0 < minX) minX = g.e.x0; if (g.e.x1 > maxX) maxX = g.e.x1; });
      minX = Math.max(0, minX - 3 * k); maxX = Math.min(W - 1, maxX + 3 * k);
      if (maxX <= minX) return null;
      var pad = 3, ow = maxX - minX + 1 + pad * 2, oh = bottom - top + 1 + pad * 2;
      var out = document.createElement("canvas"); out.width = ow; out.height = oh;
      var ctx = out.getContext("2d"), img = ctx.createImageData(ow, oh);
      groups.forEach(function (g) {
        for (y = g.a; y <= g.b; y++) for (x = minX; x <= maxX; x++) {
          var si = (y * W + x) * 4, di = ((y - top + pad) * ow + (x - minX + pad)) * 4;
          if (bright(si)) { img.data[di] = d[si]; img.data[di + 1] = d[si + 1]; img.data[di + 2] = d[si + 2]; img.data[di + 3] = 255; }
        }
      });
      ctx.putImageData(img, 0, 0);
      var dpr = window.devicePixelRatio || 1;
      out.style.width = (ow / dpr * Math.max(1, Math.round(2 * dpr / k))) + "px";          // small GUI scales: draw the text bigger so it stays readable
      return { canvas: out };
    } catch (e) { console.warn("[OneClient] could not read the disconnect message:", e); return null; }
  }

  function onDisconnected() {
    var j = join;
    if (j && j.stage === "failed") return;
    if (!j) j = join = { kind: "kicked", entry: session && session.entry, t0: now() };
    clearInterval(j.timer);
    j.stage = "failed"; j.reveal = false;
    j.snap = captureReason();                                                      // the frame is still in the buffer: we are inside the game's frame callback
    j.msg = j.snap ? "" : (j.kind === "kicked" ? "You were disconnected from the server." : "The game couldn\u2019t connect to that server.");
    session = null;
    joinView();
    goTitle(15000);
  }

  function cancelJoin() {
    var j = join;
    if (!j || j.stage === "failed" || j.stage === "ready" || j.cancelled) return;
    j.cancelled = true;
    clearInterval(j.timer);
    joinText(j, "Cancelling\u2026");
    joinView();
    goTitle(15000).then(function () {
      if (join !== j) return;
      join = null;
      userPage = j.kind === "world" ? "worlds" : "servers";
      if (j.kind === "world") loadWorlds();
      render();
    });
  }

  function dismissJoin(retry) {
    var j = join;
    if (!j) return;
    clearInterval(j.timer);
    var entry = j.entry, world = j.kind === "world" && !j.create ? j.world : null;
    join = null;
    userPage = j.kind === "world" ? "worlds" : "servers";
    function again() { if (retry && entry) joinServer(entry); else if (retry && world) playWorld(world); }
    if (OC.screen !== "title") {
      var o = hold("back", 15000);
      goTitle(15000).then(function () { if (holds.back === o) holds.back = null; render(); again(); });
    } else if (retry && (entry || world)) { render(); again(); return; }
    if (userPage === "worlds") loadWorlds();
    render();
  }

  /* ---------- profile page ---------- */
  function openProfile() {
    userPage = "profile";
    profileLoad();
    setPage("profile");
    if (OC.screen === "title") N.click.apply(null, pos("title.profile")).then(function () { return N.frames(4); });
    setTimeout(function () { if (userPage === "profile" && OC.screen === "title") { userPage = "home"; render(); } }, 6000);   // native screen never opened: give up
  }
  function closeProfile() {
    if (profile.busy) return;
    userPage = "home";
    if (OC.screen === "profile") {
      var o = hold("back", 20000);
      render();
      pressDone().then(function () { if (holds.back === o) holds.back = null; render(); });
    } else setPage("home");
  }
  var statusIdle = true;
  function setStatus(msg, cls) { statusIdle = false; var s = root.querySelector("#ocm-pstatus"); s.textContent = msg; s.className = "ocm-status" + (cls ? " " + cls : ""); }
  function idleStatus() {                                                        // the resting hint under the form
    var s = root.querySelector("#ocm-pstatus");
    statusIdle = true;
    s.textContent = isDefaultName(profile.name) ? "That name was made up by the game. Type your own to make it yours." : "Change your username or pick a skin, then press Apply.";
    s.className = "ocm-status";
  }

  /* the skin tiles: your own skins, a pending upload, then the game's defaults, in the game's own order */
  function renderSkins() {
    if (!built) return;
    var box = root.querySelector("#ocm-skins"), list = skinList(), i;
    box.textContent = "";
    var add = h("button", "ocm-tile add", icon("upload") + "<span>Upload skin</span>");
    add.type = "button"; add.tabIndex = -1; add.setAttribute("data-add", "1");
    box.appendChild(add);
    function tile(s, idx) {
      var t = h("button", "ocm-tile" + (idx === profile.sel ? " on" : ""));
      t.type = "button"; t.tabIndex = -1; t.setAttribute("data-i", idx); t.title = s.name;
      t.appendChild(headCanvas(s));
      t.appendChild(h("span", null, esc(s.name.replace(/\.png$/i, ""))));
      return t;
    }
    var nMine = profile.mine.length + (profile.pending ? 1 : 0);
    if (nMine) box.appendChild(h("div", "ocm-sub", "Your skins"));
    for (i = 0; i < nMine; i++) box.appendChild(tile(list[i], i));
    box.appendChild(h("div", "ocm-sub", "Default skins"));
    for (i = nMine; i < list.length; i++) box.appendChild(tile(list[i], i));
    root.querySelector('[data-act="clear-skins"]').style.display = profile.mine.length ? "" : "none";
  }
  function chooseSkin(i) {
    var list = skinList();
    if (i < 0 || i >= list.length) return;
    profile.sel = i;
    Array.prototype.forEach.call(root.querySelectorAll("#ocm-skins .ocm-tile[data-i]"), function (t) { t.classList.toggle("on", parseInt(t.getAttribute("data-i"), 10) === i); });
    updatePreview(); syncArms();
  }
  function syncArms() {
    if (!built) return;
    var sk = skinList()[profile.sel], show = !!(sk && sk.kind === "pending");
    root.querySelector("#ocm-model").style.display = show ? "" : "none";
    Array.prototype.forEach.call(root.querySelectorAll(".ocm-armseg button"), function (b) { b.classList.toggle("on", show && (b.getAttribute("data-arms") === "slim") === !!sk.slim); });
  }
  function updatePreview() { if (built) drawSkin(skinList()[profile.sel]); }

  /* front-facing 2D render of a 64x64 (or legacy 64x32) skin */
  function drawSkin(skin) {
    var cv = root.querySelector("#ocm-skin"), g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    root.querySelector("#ocm-skinnote").textContent = skin ? skin.name.replace(/\.png$/i, "") : "";
    if (!skin) return;
    var bmp = skin.src, legacy = (bmp.naturalHeight || bmp.height) < 64, aw = skin.slim ? 3 : 4;
    g.imageSmoothingEnabled = false;
    function part(sx, sy, w, hh, dx, dy) { try { g.drawImage(bmp, sx, sy, w, hh, dx, dy, w, hh); } catch (e) { /* not loaded yet */ } }
    part(8, 8, 8, 8, 4, 0); part(40, 8, 8, 8, 4, 0);                                     // head + hat
    part(20, 20, 8, 12, 4, 8); if (!legacy) part(20, 36, 8, 12, 4, 8);                   // body + jacket
    part(44, 20, aw, 12, 4 - aw, 8); if (!legacy) part(44, 36, aw, 12, 4 - aw, 8);       // right arm (viewer's left)
    if (legacy) { g.save(); g.translate(12 + aw, 0); g.scale(-1, 1); try { g.drawImage(bmp, 44, 20, aw, 12, 0, 8, aw, 12); } catch (e) { /* not loaded yet */ } g.restore(); }
    else { part(36, 52, aw, 12, 12, 8); part(52, 52, aw, 12, 12, 8); }                   // left arm
    part(4, 20, 4, 12, 4, 20); if (!legacy) part(4, 36, 4, 12, 4, 20);                   // right leg
    if (legacy) { g.save(); g.translate(12, 0); g.scale(-1, 1); try { g.drawImage(bmp, 4, 20, 4, 12, 0, 20, 4, 12); } catch (e) { /* not loaded yet */ } g.restore(); }
    else { part(20, 52, 4, 12, 8, 20); part(4, 52, 4, 12, 8, 20); }                      // left leg
  }

  /* an uploaded skin: 64x64 (or old 64x32, converted the way the game does) PNG */
  function legacyConvert(x) {
    function copy(sx, sy, ox, oy, w, hh) {                                               // block at (sx,sy) -> (sx+ox, sy+oy), mirrored left-right
      var src = x.getImageData(sx, sy, w, hh), dst = x.createImageData(w, hh);
      for (var j = 0; j < hh; j++) for (var i = 0; i < w; i++) {
        var a = (j * w + i) * 4, b = (j * w + (w - 1 - i)) * 4;
        dst.data[b] = src.data[a]; dst.data[b + 1] = src.data[a + 1]; dst.data[b + 2] = src.data[a + 2]; dst.data[b + 3] = src.data[a + 3];
      }
      x.putImageData(dst, sx + ox, sy + oy);
    }
    [[4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4], [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12], [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12],
     [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4], [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12]].forEach(function (a) { copy.apply(null, a); });
  }
  function loadUpload(file) {
    if (profile.busy) return;
    if (file.size > 2097152) { setStatus("That file is too big to be a skin.", "bad"); return; }
    createImageBitmap(file).then(function (bmp) {
      if (bmp.width !== 64 || (bmp.height !== 64 && bmp.height !== 32)) throw new Error("size");
      var c = document.createElement("canvas"); c.width = 64; c.height = 64;
      var x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(bmp, 0, 0);
      var legacy = bmp.height === 32;
      if (legacy) legacyConvert(x);
      var img = x.getImageData(0, 0, 64, 64), px = img.data;
      // slim skins leave the last column of each arm unused (transparent); check before the base layer is made opaque
      var slim = !legacy && (px[(24 * 64 + 55) * 4 + 3] === 0 || px[(56 * 64 + 47) * 4 + 3] === 0);
      [[0, 0, 32, 16], [0, 16, 64, 32], [16, 48, 48, 64]].forEach(function (r) {         // the base layer is never see-through, as in the game
        for (var yy = r[1]; yy < r[3]; yy++) for (var xx = r[0]; xx < r[2]; xx++) px[(yy * 64 + xx) * 4 + 3] = 255;
      });
      x.putImageData(img, 0, 0);
      return new Promise(function (res) { c.toBlob(function (b) { res({ c: c, blob: b, slim: slim }); }, "image/png"); });
    }).then(function (r) {
      var nm = String(file.name || "skin.png").replace(/^.*[\\/]/, "").slice(0, 40);
      if (!/\.png$/i.test(nm)) nm += ".png";
      profile.pending = { kind: "pending", name: nm, slim: r.slim, src: r.c, png: r.blob };
      profile.sel = profile.mine.length;
      renderSkins(); updatePreview(); syncArms();
      setStatus("Added " + nm + ". Check the arms below, then press Apply.", "ok");
    }).catch(function (err) {
      setStatus(err && err.message === "size" ? "Skins are 64 x 64 pixel PNG files (old 64 x 32 skins work too)." : "That file isn\u2019t a usable PNG.", "bad");
    });
  }

  /* ---------- driving the game's Edit Profile screen ---------- */
  function addSkinNative(pend) {
    var file = new File([pend.png], pend.name, { type: "image/png" });
    N.pickFile(file);
    var p = pos("profile.addskin");
    return N.click(p[0], p[1])
      .then(function () { return waitUntil(function () { return OC.screen !== "profile"; }, 10000); })       // the game asks Steve or Alex
      .then(function (asked) {
        if (!asked) throw new Error("skin");
        var m = pos(pend.slim ? "profile.alex" : "profile.steve");
        return N.frames(6).then(function () { return N.click(m[0], m[1]); });
      })
      .then(function () { return waitUntil(function () { return OC.screen === "profile"; }, 10000); })
      .then(function (back) { if (!back) throw new Error("skin"); return N.frames(6); });
  }

  /* Choose entry n of the game's skin list: open it, scroll to the top, then down in steps of 3 rows if the entry
   * is below the part of the list that fits on screen, and click it. Checked afterwards against the saved profile. */
  function selectSkinNative(n, total) {
    var g = N.gui(), arrow = pos("profile.skinarrow");
    var fits = Math.max(4, Math.min(total, Math.floor((5 * g.h / 6 - 112) / 10)));
    var wx = g.w / 2 + 50, wy = g.h / 6 + 140, row = n, ticks = 0, i;
    var chain = N.click(arrow[0], arrow[1]).then(function () { return N.frames(6); });
    function up() { return N.wheel(wx, wy, -100); }
    function down() { return N.wheel(wx, wy, 100); }
    for (i = 0; i < Math.ceil(total / 3) + 1; i++) chain = chain.then(up);
    if (n >= fits) {
      ticks = Math.ceil((n - fits + 1) / 3);
      row = n - Math.min(3 * ticks, total - fits);
      for (i = 0; i < ticks; i++) chain = chain.then(down);
    }
    return chain.then(function () { var r = pos("profile.skinrow", row); return N.click(r[0], r[1]); }).then(function () { return N.frames(6); });
  }

  function forwardDelete(n) {
    var chain = Promise.resolve();
    function del() { return N.key("Delete", "Delete", 46); }
    for (var i = 0; i < n; i++) chain = chain.then(del);
    return chain;
  }

  function setApplying(on) {
    var b = root.querySelector('[data-act="apply"]');
    b.disabled = on; root.querySelector('[data-act="clear-skins"]').disabled = on;
    b.querySelector("span").textContent = on ? "Applying\u2026" : "Apply";
  }

  /* leave the profile screen (Done), wait for the title, and tell what the game saved */
  function finishProfile() {
    var o = hold("back", 24000);
    userPage = "home";
    return pressDone().then(function () {
      return N.frames(6);
    }).then(function () { if (holds.back === o) holds.back = null; return readProfileData(); });
  }

  function apply() {
    if (profile.busy) return;
    var name = profile.name;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { setStatus("Usernames are 3 to 16 letters, numbers or underscores.", "bad"); return; }
    if (OC.screen !== "profile") { setStatus("The game\u2019s profile screen is still opening. Try again in a moment.", "bad"); return; }
    var list = skinList(), total = list.length, target = profile.sel, pend = profile.pending;
    var nameChanged = (name !== (readProfileData() || {}).username && name !== currentName()) || isDefaultName(name);   // an auto-generated name may differ in the game's memory: type it
    // Before the first Done the game holds a random name AND skin in memory that differ from what is saved: then force both
    var unsure = isDefaultName((readProfileData() || {}).username || currentName());
    var cur = pend ? profile.mine.length : (unsure ? -1 : profile.nativeSel);           // an added skin becomes the game's choice
    if (!nameChanged && !pend && target === cur) { closeProfile(); return; }
    profile.busy = true; setApplying(true); setStatus("Applying\u2026"); render();
    var chain = Promise.resolve();
    if (nameChanged) chain = chain.then(function () {                                    // the click puts the cursor wherever it landed: empty the field on both sides
      var p = pos("profile.username");
      return N.click(p[0], p[1]).then(function () { return N.key("End", "End", 35); }).then(function () { return N.backspace(18); }).then(function () { return forwardDelete(18); }).then(function () { return N.type(name); });
    });
    if (pend) chain = chain.then(function () { setStatus("Adding your skin\u2026"); return addSkinNative(pend); });
    chain = chain.then(function () { if (target === cur) return null; setStatus("Choosing the skin\u2026"); return selectSkinNative(target, total); });
    chain.then(finishProfile).then(function (saved) {
      profile.busy = false; setApplying(false);
      refreshAccount();
      if (saved && nameChanged && saved.username !== name) toast("The game didn\u2019t take that username. Open Profile and try again.", true);
      else if (saved && saved.sel !== target) toast("The game didn\u2019t take that skin. Open Profile and try again.", true);
      else toast("Profile saved.");
      render();
    }).catch(function (err) {
      profile.busy = false; setApplying(false);
      N.cancelPick();
      setStatus(err && err.message === "skin" ? "The game didn\u2019t accept that skin. Try again." : "Something went wrong applying that. Try again.", "bad");
      render();
    });
  }

  function clearSkins() {
    if (profile.busy || !profile.mine.length) return;
    if (OC.screen !== "profile") { setStatus("The game\u2019s profile screen is still opening. Try again in a moment.", "bad"); return; }
    profile.busy = true; setApplying(true); setStatus("Removing your skins\u2026"); render();
    var p = pos("profile.clear");
    N.click(p[0], p[1]).then(function () { return N.frames(6); }).then(finishProfile).then(function () {
      profile.busy = false; setApplying(false);
      refreshAccount();
      toast("Your skins were removed.");
      render();
    }).catch(function () { profile.busy = false; setApplying(false); setStatus("Something went wrong. Try again.", "bad"); render(); });
  }

  /* ================= singleplayer: the worlds of the game ================= */
  var MODE_NAME = { survival: "Survival", creative: "Creative", hardcore: "Hardcore", adventure: "Adventure", spectator: "Spectator" };
  var deleting = null;                                                // the world waiting for the delete confirmation
  var createSel = { mode: "survival", difficulty: "normal", type: "default" };
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function agoText(ms) {
    if (!ms) return "never played";
    var m = Math.max(0, Math.floor((Date.now() - ms) / 60000)), d;
    if (m < 1) return "played just now";
    if (m < 60) return "played " + m + " min ago";
    if (m < 1440) return "played " + Math.floor(m / 60) + " h ago";
    if (m < 43200) { d = Math.floor(m / 1440); return "played " + d + (d === 1 ? " day" : " days") + " ago"; }
    return "played " + new Date(ms).toLocaleDateString();
  }
  function dlgOpen(sel) { return !!root && root.querySelector(sel).classList.contains("open"); }
  function worldBusy() { return !!(join || wrun || profile.busy || holds.skip || relaysRun); }
  function setWorldBusy(msg) {
    if (!built) return;
    root.setAttribute("data-wbusy", msg ? "1" : "");
    root.querySelector(".ocm-wbusy p").textContent = msg || "";
  }

  function openWorlds() {
    userPage = "worlds";
    worlds.q = "";
    var q = root.querySelector("#ocm-wq");
    if (q) q.value = "";
    setPage("worlds");
    renderWorlds();
    loadWorlds();
  }
  function loadWorlds() {
    if (!built || !OC.worlds) return Promise.resolve();
    return OC.worlds.load().then(function (r) { worlds.list = r.list || []; worlds.loaded = true; renderWorlds(); }).catch(function () { worlds.loaded = true; renderWorlds(); });
  }
  function worldCard(w, i) {
    var hu = hue(w.name), card = h("div", "ocm-card ocm-wcard"), sub = [MODE_NAME[w.mode] || "Survival"];
    if (w.difficulty && w.mode !== "hardcore") sub.push(cap(w.difficulty));
    if (w.version) sub.push(w.version);
    sub.push(agoText(w.last));
    var ico = w.icon ? '<img alt="" draggable="false" src="' + w.icon + '">' : esc((w.name || "?").charAt(0).toUpperCase());
    card.style.setProperty("--i", i);
    card.innerHTML = '<div class="ocm-sico' + (w.icon ? " has-img" : "") + '" style="--c1:hsl(' + hu + ',70%,72%);--c2:hsl(' + ((hu + 50) % 360) + ',68%,60%)">' + ico + "</div>" +
      '<div class="ocm-meta"><b>' + esc(w.name) + "</b><span>" + esc(sub.join(" \u00b7 ")) + "</span></div>" +
      (w.hardcore ? '<span class="ocm-chip hard">Hardcore</span>' : "") + (w.cheats ? '<span class="ocm-chip">Cheats</span>' : "") +
      (w.newer ? '<span class="ocm-chip warn" title="Made with a newer version of the game">Newer</span>' : "") + '<div class="ocm-acts"></div>';
    var acts = card.querySelector(".ocm-acts"), pl = btn("small primary", "", "Play", "x"), ed = iconBtn("edit", "x"), del = iconBtn("trash", "x", "danger");
    [pl, ed, del].forEach(function (b) { b.removeAttribute("data-act"); });
    ed.title = "Edit in the game"; del.title = "Delete";
    pl.addEventListener("click", function (e) { e.stopPropagation(); playWorld(w); });
    ed.addEventListener("click", function (e) { e.stopPropagation(); editWorld(w); });
    del.addEventListener("click", function (e) { e.stopPropagation(); askDelete(w); });
    acts.appendChild(pl); acts.appendChild(ed); acts.appendChild(del);
    return card;
  }
  function renderWorlds() {
    if (!built) return;
    var box = root.querySelector(".ocm-wlist"), q = worlds.q.trim().toLowerCase();
    box.innerHTML = "";
    root.querySelector(".ocm-wsearch").style.display = worlds.list.length > 5 ? "" : "none";
    if (!worlds.loaded) { box.appendChild(h("div", "ocm-empty", "Loading your worlds\u2026")); return; }
    var shown = worlds.list.filter(function (w) { return !q || w.name.toLowerCase().indexOf(q) >= 0 || w.dir.toLowerCase().indexOf(q) >= 0; });
    if (!shown.length) {
      var e = h("div", "ocm-empty", worlds.list.length ? "No world matches that." : "<b>No worlds yet</b><br>Create one to start playing.");
      if (!worlds.list.length) e.appendChild(btn("small primary ocm-ebtn", "plus", "Create world", "wcreate"));
      box.appendChild(e);
      return;
    }
    shown.forEach(function (w, i) { box.appendChild(worldCard(w, i)); });
  }

  /* Play / Create: the game's own screens are pressed behind our loading card (Singleplayer > the world > Play Selected World),
   * and the card follows the game's loading screens until the world asks for the mouse. */
  function newWorldJoin(title, extra) {
    var j = { kind: "world", world: null, title: title, stage: "open", cancelled: false, t0: now(), snap: null, sawNative: false, played: false, nullSince: 0, status: "Starting the game\u2019s world server\u2026" };
    for (var k in (extra || {})) j[k] = extra[k];
    return j;
  }
  function playWorld(w) {
    if (worldBusy() || OC.screen !== "title") return;
    var idx = worlds.list.indexOf(w);
    if (idx < 0) return;
    var j = join = newWorldJoin(w.name, { world: w });
    userPage = "worlds";
    joinView(); render();
    OC.worlds.open().then(function (s) {
      if (!alive(j)) return null;
      if (s !== "worlds") { failJoin(j, "The game didn\u2019t open its world list. Try again."); return null; }
      joinText(j, "Opening " + w.name + "\u2026");
      return OC.worlds.play(idx).then(function (ok) {
        if (!alive(j)) return null;
        if (!ok) { failJoin(j, "The game didn\u2019t take that world. Try again."); return null; }
        j.stage = "connecting"; j.played = true;
        joinText(j, "Loading " + w.name + "\u2026"); joinView();
        armJoinWatch(j);
      });
    });
  }
  function createWorld(o) {
    if (worldBusy() || OC.screen !== "title") return;
    var j = join = newWorldJoin(o.name, { world: { name: o.name }, create: true });
    userPage = "worlds";
    closeCreate(); joinView(); render();
    OC.worlds.open().then(function (s) {
      if (!alive(j)) return null;
      if (s !== "worlds" && s !== "worldmenu") { failJoin(j, "The game didn\u2019t open its world list. Try again."); return null; }
      joinText(j, "Creating " + o.name + "\u2026");
      return OC.worlds.create(o).then(function (ok) {
        if (!alive(j)) return null;
        if (!ok) { failJoin(j, "The game didn\u2019t let us create that world. Try again."); return null; }
        j.stage = "connecting"; j.played = true;
        joinText(j, "Loading " + o.name + "\u2026"); joinView();
        armJoinWatch(j);
      });
    });
  }

  /* Delete: our own confirmation, then the game's Delete button and its confirmation, behind the page */
  function askDelete(w) {
    if (worldBusy()) return;
    deleting = w;
    root.querySelector(".ocm-wdtext").innerHTML = "<b>" + esc(w.name) + "</b> and everything in it will be gone for good.";
    root.querySelector(".ocm-wdel").classList.add("open");
  }
  function closeDelete() { if (built) root.querySelector(".ocm-wdel").classList.remove("open"); deleting = null; }
  function confirmDelete() {
    var w = deleting;
    closeDelete();
    if (!w || worldBusy() || OC.screen !== "title") return;
    var idx = worlds.list.indexOf(w);
    if (idx < 0) return;
    var run = wrun = { kind: "delete", stage: "working", left: false };
    setWorldBusy("Deleting " + w.name + "\u2026");
    userPage = "worlds"; render();
    OC.worlds.open().then(function (s) {
      if (wrun !== run) return null;
      if (s !== "worlds") throw new Error("list");
      return OC.worlds.remove(idx);
    }).then(function (ok) {
      if (wrun !== run) return null;
      if (!ok) throw new Error("delete");
      return OC.worlds.back();
    }).then(function () {
      if (wrun !== run) return;
      wrun = null; setWorldBusy("");
      return loadWorlds().then(function () {
        var gone = !worlds.list.some(function (x) { return x.dir === w.dir; });
        toast(gone ? "Deleted " + w.name + "." : "The game kept " + w.name + ".", !gone);
        render();
      });
    }).catch(function () {
      if (wrun !== run) return;
      wrun = null; setWorldBusy(""); toast("Couldn\u2019t delete that world.", true); loadWorlds(); render();
    });
  }

  /* Edit World and the import / LAN box are the game's own screens: the player uses them directly, we step back in when they are closed */
  function nativeWorldRun(kind, text, open, until) {
    if (worldBusy() || OC.screen !== "title") return;
    var run = wrun = { kind: kind, stage: "working", left: false };
    setWorldBusy(text);
    userPage = "worlds"; render();
    OC.worlds.open().then(function (s) {
      if (wrun !== run) return null;
      if (!s) throw new Error("list");
      return open(s);
    }).then(function (ok) {
      if (wrun !== run) return null;
      if (!ok) throw new Error("open");
      return waitUntil(function () { return wrun !== run || until(OC.screen); }, 4000);
    }).then(function (moved) {
      if (wrun !== run) return;
      if (!moved) throw new Error("screen");
      setWorldBusy(""); run.stage = "native"; run.left = true; render();
    }).catch(function () {
      if (wrun !== run) return;
      wrun = null; setWorldBusy(""); toast("The game didn\u2019t open that screen.", true); render();
    });
  }
  function editWorld(w) {
    var idx = worlds.list.indexOf(w);
    if (idx < 0) return;
    nativeWorldRun("edit", "Opening " + w.name + "\u2026", function (s) { return s === "worlds" ? OC.worlds.edit(idx) : false; }, function (s) { return s !== "worlds"; });
  }
  function worldsMore() {
    nativeWorldRun("more", "Opening the game\u2019s world options\u2026", function () { return OC.worlds.more(); }, function (s) { return s === "worldmenu"; });
  }

  /* Create world dialog */
  function uniqueWorldName(base) {
    var names = {};
    worlds.list.forEach(function (w) { names[w.name.toLowerCase()] = 1; names[w.dir.toLowerCase()] = 1; });
    if (!names[base.toLowerCase()]) return base;
    for (var i = 2; i < 100; i++) if (!names[(base + " (" + i + ")").toLowerCase()]) return base + " (" + i + ")";
    return base;
  }
  function paintCreate() {
    ["mode", "difficulty", "type"].forEach(function (g) {
      Array.prototype.forEach.call(root.querySelectorAll('.ocm-wdlg [data-seg="' + g + '"] button'), function (b) {
        b.classList.toggle("on", b.getAttribute("data-v") === createSel[g]);
        b.disabled = g === "difficulty" && createSel.mode === "hardcore";
      });
    });
    var ck = root.querySelector("#ocm-wcheats");
    ck.disabled = createSel.mode === "hardcore";
    if (ck.disabled) ck.checked = false;
  }
  function setCreateChoice(group, v) {
    if (!group) return;
    createSel[group] = v;
    if (group === "mode" && v === "hardcore") createSel.difficulty = "hard";
    paintCreate();
  }
  function openCreate() {
    if (worldBusy()) return;
    createSel = { mode: "survival", difficulty: "normal", type: "default" };
    root.querySelector("#ocm-wname").value = uniqueWorldName("New World");
    root.querySelector("#ocm-wseed").value = "";
    root.querySelector("#ocm-wcheats").checked = false;
    root.querySelector("#ocm-wstruct").checked = true;
    root.querySelector("#ocm-wbonus").checked = false;
    paintCreate();
    root.querySelector(".ocm-wdlg").classList.add("open");
    setTimeout(function () { var i = root.querySelector("#ocm-wname"); i.focus(); i.select(); }, 60);
  }
  function closeCreate() { if (built) root.querySelector(".ocm-wdlg").classList.remove("open"); }
  function saveCreate() {
    createWorld({
      name: root.querySelector("#ocm-wname").value.trim() || "New World", mode: createSel.mode, difficulty: createSel.difficulty, type: createSel.type,
      seed: root.querySelector("#ocm-wseed").value.trim(), cheats: root.querySelector("#ocm-wcheats").checked,
      structures: root.querySelector("#ocm-wstruct").checked, bonus: root.querySelector("#ocm-wbonus").checked
    });
  }

  /* boot */
  function init() { build(); render(); }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);

  M.disable = function () { disabled = true; hideMenu(); };
  M.openAccount = function () { if (!disabled && OC.screen === "title") { openAccount(); render(); } };       // the game's "Wisp Settings" button (client/account.js)
  if (window.__lockshim) M.test = { setJoin: function (j) { join = j; render(); }, getJoin: function () { return join; }, arm: function (j) { armJoinWatch(j); }, view: function () { joinView(); } };      // test builds only
  /* where the player is playing right now, for mods: the server entry they joined from the Servers page (null: singleplayer, or a server joined in the game's own list) */
  M.sessionInfo = function () {
    var e = session && session.entry;
    return e ? { name: e.name || "", address: shown(e), mode: modeLabel(e) } : null;
  };
  M.state = function () { return { page: M.page, visible: M.visible, userPage: userPage, screen: OC.screen, join: join && { stage: join.stage, kind: join.kind }, holds: { skip: holds.skip, back: !!holds.back, leave: !!holds.leave, away: !!holds.away }, session: !!session, busy: profile.busy, world: wrun && { kind: wrun.kind, stage: wrun.stage }, ctx: root && root.getAttribute("data-ctx") }; };
})();
