/* OneClient server profiles: a server can have mod settings of its own.
 *
 * A profile is the set of mod choices you made for one server (which mods are on, their options, where the HUD widgets sit, the zoom strength).
 * While you are on a server that has its own settings they are in force: everything you change in the Mods menu or the HUD editor is kept with
 * that server. When you leave, your everywhere settings come back, exactly as they were. The saved settings file (oneclient.settings.v2) always
 * holds the everywhere settings, even while a profile is in force (core.js asks OC.persistView), so a closed tab never turns a server's settings
 * into your defaults. The server is the one in the game's handshake (host and port, found by client/net.js); singleplayer has no profile.
 *
 * OC.profiles.info()        { connected, key, label, own (this server has its own settings in force), has (it has saved ones) }
 * OC.profiles.setOwn(on)    give the server you are on its own settings (the first time: a copy of what is in force now), or take them away again
 * OC.profiles.active()      is a server's own settings in force?       OC.profiles.list()  [{ key, label, on }]      OC.profiles.forget(key)
 * OC.on("profiles", fn)     something changed (a profile came into or went out of force, or was switched on or off)
 * ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC || !OC.S || !OC.net || typeof OC.net.onState !== "function" || typeof OC.setMod !== "function") return;
  var S = OC.S, KEY = "oneclient.serverprofiles.v1", P = OC.profiles = {}, FIELDS = ["mods", "zoomFactor", "layout", "cfg", "modcfg"];
  var store = { profiles: {} }, base = null, cur = null;           // base: the everywhere settings while a profile is in force; cur: its key
  try {
    var sv = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (sv && sv.profiles && typeof sv.profiles === "object") store.profiles = sv.profiles;
  } catch (e) { /* no storage: nothing is remembered */ }
  function saveStore() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* storage blocked */ } }

  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function snapshot() { var o = {}; FIELDS.forEach(function (f) { o[f] = clone(S[f]); }); return o; }
  function keyOf(s) { return String(s.host).toLowerCase() + ":" + s.port; }
  function labelOf(s) { return String(s.host).toLowerCase() + (s.port && s.port !== 25565 ? ":" + s.port : ""); }
  function connected() {
    var s = OC.net.server;
    return !!(s && s.transport === "server" && (OC.net.state === "login" || OC.net.state === "config" || OC.net.state === "play"));
  }
  function notice(msg) { try { if (OC.loader && typeof OC.loader.toast === "function") OC.loader.toast(msg); } catch (e) { /* no toast */ } }
  function merged(a, b) { return Object.assign(clone(a || {}), clone(b || {})); }
  function replaceIn(target, src) { Object.keys(target).forEach(function (k) { delete target[k]; }); Object.assign(target, clone(src || {})); }

  /* make the settings in force equal to `eff` (whole objects), then tell everybody who listens the way a change from the menu would */
  function put(eff) {
    var prevCfg = clone(S.cfg), prevExt = clone(S.modcfg), same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    replaceIn(S.cfg, eff.cfg); replaceIn(S.modcfg, eff.modcfg); replaceIn(S.layout, eff.layout);
    if (typeof eff.zoomFactor === "number") S.zoomFactor = eff.zoomFactor;
    Object.keys(eff.mods).forEach(function (k) { OC.setMod(k, eff.mods[k]); });             // starts and stops mods, and only for the ones that really change
    Object.keys(OC.CFG_DEF).forEach(function (m) { if (!same(prevCfg[m], S.cfg[m])) OC.emit("cfg", m, null); });
    OC.emit("cfg", "zoom", "factor");
    var ids = {};
    Object.keys(prevExt).concat(Object.keys(S.modcfg)).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) { if (!same(prevExt[id], S.modcfg[id]) && OC.loader && OC.loader.refreshSettings) OC.loader.refreshSettings(id); });
    if (OC.ui && OC.ui.relayout) OC.ui.relayout();
  }
  function capture() {                                              // what is in force now belongs to the profile
    var p = store.profiles[cur];
    if (p) { p.data = snapshot(); p.at = Date.now(); }
  }
  /* core.js saves through this: the file always gets the everywhere settings, and the profile gets what is in force */
  OC.persistView = function (s) {
    if (!cur || !base) return s;
    try { capture(); saveStore(); } catch (e) { /* the profile is not saved this time */ }
    var o = Object.assign({}, s);
    FIELDS.forEach(function (f) { o[f] = base[f]; });
    return o;
  };

  function activate(key) {
    var p = store.profiles[key];
    if (!p || !p.on || !p.data || cur === key) return false;
    if (cur) deactivate();
    base = snapshot(); cur = key;
    var d = p.data;
    put({ mods: merged(base.mods, d.mods), cfg: merged(base.cfg, d.cfg), modcfg: merged(base.modcfg, d.modcfg), layout: merged(base.layout, d.layout), zoomFactor: typeof d.zoomFactor === "number" ? d.zoomFactor : base.zoomFactor });
    notice("Using the mod settings of " + p.name);
    OC.emit("profiles");
    return true;
  }
  function deactivate() {
    if (!cur) return;
    try { capture(); saveStore(); } catch (e) { /* kept as it was */ }
    var restore = base;
    cur = null; base = null;                                        // from here the stored mod states may change again, and the file gets what is in force
    put(restore);
    OC.save();
    notice("Back to your normal mod settings");
    OC.emit("profiles");
  }

  P.active = function () { return !!cur; };
  P.info = function () {
    var s = OC.net.server, on = connected(), key = on ? keyOf(s) : "", p = key ? store.profiles[key] : null;
    return { connected: on, key: key, label: on ? labelOf(s) : "", own: !!(on && cur === key), has: !!(p && p.data) };
  };
  P.list = function () { return Object.keys(store.profiles).map(function (k) { var p = store.profiles[k]; return { key: k, label: p.name || k, on: !!p.on && !!p.data }; }); };
  P.forget = function (key) { if (cur === key) deactivate(); delete store.profiles[key]; saveStore(); OC.emit("profiles"); };
  P.setOwn = function (on) {                                        // for the server you are on
    if (!connected()) return false;
    var s = OC.net.server, key = keyOf(s), p = store.profiles[key];
    if (on) {
      if (!p) p = store.profiles[key] = { name: labelOf(s), data: null, on: true, at: Date.now() };
      p.on = true;
      if (cur !== key) {
        if (cur) deactivate();
        if (p.data) activate(key);
        else { p.data = snapshot(); base = snapshot(); cur = key; }  // first time: a copy of what is in force now (nothing changes yet)
      }
    } else {
      if (cur === key) deactivate();
      if (p) p.on = false;
    }
    saveStore();
    OC.emit("profiles");
    return true;
  };

  /* follow the connection: a server's own settings come in when you join it and go out when you leave */
  OC.net.onState(function (state, prev) {
    var s = OC.net.server;
    if (state === "login" && s && s.transport === "server") {
      var key = keyOf(s);
      if (cur && cur !== key) deactivate();
      activate(key);
    } else if ((state === "none" || state === "status") && cur && (prev === "login" || prev === "config" || prev === "play")) deactivate();
    OC.emit("profiles");
  });
})();
