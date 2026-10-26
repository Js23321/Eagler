/* OneClient Java accounts: play on online-mode servers (donutsmp.net ...) with a Microsoft / Mojang account.
 *
 * A web page can neither call Minecraft's account servers (no CORS) nor open TCP connections. Two ways round that, one provider each:
 *   "browser"  (default, nothing to install)  client/mcauth.js does the Microsoft sign-in and the Mojang calls inside the page: client/tls.js is a
 *              TLS 1.3 client and client/wisp.js carries its bytes to Microsoft's / Mojang's servers through a Wisp tunnel (a public Wisp server by
 *              default, yours if you set one). The TLS is end to end, so the tunnel's operator sees only encrypted bytes.
 *   "bridge"   a small program on the player's computer (bridge/oneclient-bridge.js, Node.js) does the same, signs in to the server on the game's
 *              behalf (so OneClient's packet mods can read the server) and offers the tunnel from the player's own connection.
 * This file is OneClient's side of both:
 *   - It defines the object the game looks for (globalThis.wispcraft: authstore, wispUrl, setWispUrl, showSettingsUI). With it the game offers its
 *     "Wisp" connection mode (we call it "Java account"), checks the account with a profile request, and connects through the tunnel.
 *     authstore.yggToken is only a stand-in string; the real token stays in mcauth.js / the bridge.
 *   - It sends the two Mojang calls the game makes (profile, session join) to the provider instead of the internet (the page cannot).
 *   - It gives the menus the state to show.
 *
 * OC.account.state()          { provider, bridge: "unknown" | "off" | "unpaired" | "wrongcode" | "ready", version, accounts [{ id, name, session }], active, clientId, clientLocked (the page was built with its own app ID), mode ("quick" | "own" | "" for the bridge), login, readable }
 *                             (bridge is always "ready" for the browser provider)
 * OC.account.poll()           ask the provider again (a promise of the state)
 * OC.account.provider() / setProvider("browser" | "bridge")        browserAvailable()
 * OC.account.pair(code), unpair(), setPort(n)                      (the bridge only)
 * OC.account.signIn(clientId), cancel(), use(id), signOut(id), verify(id)
 * OC.account.ready()          { ok: true } or { ok: false, why, message }      OC.account.ensure()  poll, check the account, then ready()
 * OC.account.check(cached)    ask the provider whether the account in use still signs in (state().problem says why not)
 * OC.account.wispUrl()        the tunnel address the game saves in Java-account servers
 * OC.account.wispAddress(target) / parseWisp(ip)   the "ip" of a saved Java-account server: eagler-wisp:<tunnel>?target=<host:port>
 * OC.account.openStream(target)    a WebSocket-like stream to host:port through the tunnel (server status)
 * OC.account.wispCustom() / setWispCustom(url) / testWisp(url)     the Wisp server of the browser provider
 * OC.account.onChange(fn)
 * ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC || typeof window.fetch !== "function") return;
  var A = OC.account = {}, KEY = "oneclient.bridge.v1";
  var nativeFetch = window.fetch.bind(window);
  var PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile", JOIN_URL = "https://sessionserver.mojang.com/session/minecraft/join";

  /* what is remembered between visits: which provider, and for the bridge where it listens, the pairing code, the tunnel address part */
  var cfg = { provider: "", port: 8742, pair: "", tunnel: "" };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (saved && typeof saved === "object") {
      if (saved.provider === "bridge" || saved.provider === "browser") cfg.provider = saved.provider;
      if (saved.port >= 1 && saved.port <= 65535) cfg.port = saved.port | 0;
      if (/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(saved.pair || "")) cfg.pair = saved.pair;
      if (/^[A-Za-z0-9_-]{10,40}$/.test(saved.tunnel || "")) cfg.tunnel = saved.tunnel;
    }
  } catch (e) { /* no storage: nothing is remembered */ }
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } }

  function browserOk() { return !!(OC.msauth && OC.https && OC.wisp && OC.tls && OC.tls.available); }
  function bakedId() { return OC.msauth && OC.msauth.builtInClientId ? OC.msauth.builtInClientId() : ""; }          // the Azure app this page was built with ("" = none)
  function prov() { return cfg.provider === "bridge" || !browserOk() ? "bridge" : "browser"; }
  A.browserAvailable = browserOk;
  A.provider = prov;

  var st = { provider: prov(), bridge: prov() === "browser" ? "ready" : "unknown", version: "", accounts: [], active: null, clientId: "", clientLocked: false, mode: "", login: { state: "none" }, readable: true, allowPrivate: false, error: "", at: 0 };
  var subs = [];
  A.state = function () { st.provider = prov(); return st; };
  A.onChange = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };
  A.port = function () { return cfg.port; };
  A.paired = function () { return prov() === "browser" || !!cfg.pair; };
  function emit() { st.provider = prov(); syncStore(); subs.slice().forEach(function (fn) { try { fn(st); } catch (e) { /* a listener's problem */ } }); }
  function active() { for (var i = 0; i < st.accounts.length; i++) if (st.accounts[i].id === st.active) return st.accounts[i]; return null; }
  A.active = active;

  /* ---------- asking the provider ---------- */
  function base() { return "http://127.0.0.1:" + cfg.port; }
  function bridgeCall(path, method, body, opts) {                                 // { status, json }; rejects with { offline: true } when nothing answers
    opts = opts || {};
    var ctl = typeof AbortController === "function" ? new AbortController() : null, t = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || 6000);
    var h = { "Content-Type": "application/json" };
    if (!opts.noAuth) h.Authorization = "Bearer " + (opts.pair || cfg.pair);
    return nativeFetch(base() + path, { method: method || "GET", headers: h, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined, credentials: "omit", cache: "no-store" }).then(function (r) {
      clearTimeout(t);
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j || {} }; });
    }, function (e) { clearTimeout(t); throw { offline: true, error: e }; });
  }
  /* the same questions, answered by the page itself (client/mcauth.js) */
  async function localCall(path, method, body) {
    var M = OC.msauth, ok = function (j) { return { status: 200, json: j }; };
    body = body || {};
    try {
      if (path === "/account") return ok(M.view());
      if (path === "/account/login") { await M.startLogin(body.clientId); return ok(M.view()); }
      if (path === "/account/cancel") return ok(await M.cancel());
      if (path === "/account/use") return ok(await M.use(body.id));
      if (path === "/account/logout") return ok(await M.logout(body.id));
      if (path === "/account/verify") return ok(await M.verify(body.id));
      if (path === "/account/client") return ok(await M.setClientId(body.clientId));
      if (path === "/account/mode") return ok(await M.setMode(body.mode));
      return { status: 404, json: { error: "notfound", message: "Not found." } };
    } catch (e) {
      return { status: e.code === "signin" ? 401 : e.code === "clientid" ? 400 : e.user ? 502 : 500, json: { error: e.code || "error", message: e.user ? e.message : "Internal error: " + (e && e.message || e) } };
    }
  }
  function call(path, method, body, opts) { return prov() === "browser" ? localCall(path, method, body) : bridgeCall(path, method, body, opts); }

  function take(v) {                                                              // an account view from the provider
    st.bridge = "ready"; st.error = "";
    if (v.boot !== st.boot) { st.boot = v.boot; st.verifiedAt = 0; st.problem = ""; }                // a restarted bridge / a reloaded page: the account has to be checked again
    st.version = v.version || st.version; st.accounts = Array.isArray(v.accounts) ? v.accounts : []; st.active = v.active || null;
    var baked = bakedId();                                                                                // a page built with --client-id: its app, whichever provider signs in
    st.clientId = baked || v.clientId || ""; st.clientLocked = !!(baked || v.clientLocked); st.mode = typeof v.mode === "string" ? v.mode : ""; st.login = v.login || { state: "none" }; st.readable = v.readable !== false; st.allowPrivate = !!v.allowPrivate;
    if (st.login.state === "done") { st.problem = ""; st.verifiedAt = 0; }                                // a fresh sign-in mends an old problem
    if (typeof v.tunnel === "string" && v.tunnel !== cfg.tunnel && /^[A-Za-z0-9_-]{10,40}$/.test(v.tunnel)) { cfg.tunnel = v.tunnel; saveCfg(); }
  }
  var polling = null, loginTimer = 0;
  A.poll = function () {
    if (polling) return polling;
    if (prov() === "browser") {
      polling = Promise.resolve().then(function () { take(OC.msauth.view()); st.version = "built-in"; }).then(function () {
        polling = null; st.at = Date.now(); emit(); watchLogin(); return st;
      });
      return polling;
    }
    polling = bridgeCall("/status", "GET", null, { noAuth: true, timeout: 2500 }).then(function (r) {
      if (!(r.status === 200 && r.json && r.json.bridge === "oneclient")) throw { offline: true };
      st.version = r.json.version || "";
      if (!cfg.pair) { st.bridge = "unpaired"; st.accounts = []; st.active = null; return; }
      return bridgeCall("/account").then(function (a) {
        if (a.status === 401) { st.bridge = "wrongcode"; st.accounts = []; st.active = null; return; }
        if (a.status !== 200) { st.bridge = "off"; st.error = (a.json && a.json.message) || "The bridge answered with an error."; return; }
        take(a.json);
      });
    }).catch(function () { st.bridge = "off"; st.accounts = []; st.active = null; st.login = { state: "none" }; }).then(function () {
      polling = null; st.at = Date.now(); emit(); watchLogin(); return st;
    });
    return polling;
  };
  function watchLogin() {                                                         // while a sign-in is running, look at it every 1.5 s
    var on = st.bridge === "ready" && (st.login.state === "waiting" || st.login.state === "working");
    if (on && !loginTimer) loginTimer = setInterval(function () { A.poll(); }, 1500);
    else if (!on && loginTimer) { clearInterval(loginTimer); loginTimer = 0; }
  }
  function act(path, body) {                                                      // an action that answers with the new account view
    return call(path, "POST", body || {}).then(function (r) {
      if (r.status === 200) { take(r.json); if (path !== "/account/verify") st.verifiedAt = 0; emit(); watchLogin(); return st; }
      if (r.status === 401 && r.json && r.json.error === "pairing") { st.bridge = "wrongcode"; emit(); }
      throw { message: (r.json && r.json.message) || "That was refused (" + r.status + ")." };
    }, function () { st.bridge = "off"; emit(); throw { message: "OneClient Bridge is not running." }; });
  }
  A.setProvider = function (p) {
    p = p === "bridge" ? "bridge" : "browser";
    if (p === "browser" && !browserOk()) return Promise.reject({ message: "The built-in sign-in needs a secure page (https:// or a file opened from your computer) with web crypto." });
    cfg.provider = p; saveCfg();
    st.accounts = []; st.active = null; st.login = { state: "none" }; st.bridge = p === "browser" ? "ready" : "unknown"; st.problem = ""; st.verifiedAt = 0;
    emit();
    return A.poll();
  };
  A.pair = function (code) {
    code = String(code || "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(code)) return Promise.reject({ message: "The pairing code looks like ABCD-EFGH-JKMN (12 letters and digits)." });
    return bridgeCall("/account", "GET", null, { pair: code }).then(function (r) {
      if (r.status === 401) throw { message: "That is not the code the bridge shows. Look at its window again." };
      if (r.status !== 200) throw { message: (r.json && r.json.message) || "The bridge refused (" + r.status + ")." };
      cfg.pair = code; saveCfg(); take(r.json); emit(); return st;
    }, function () { throw { message: "OneClient Bridge is not running (nothing answers on port " + cfg.port + ")." }; });
  };
  A.unpair = function () { cfg.pair = ""; saveCfg(); st.bridge = "unpaired"; st.accounts = []; st.active = null; emit(); };
  A.setPort = function (n) { n = n | 0; if (n >= 1 && n <= 65535 && n !== cfg.port) { cfg.port = n; cfg.tunnel = ""; saveCfg(); st.bridge = "unknown"; emit(); return A.poll(); } return Promise.resolve(st); };
  A.signIn = function (clientId) { return act("/account/login", { clientId: bakedId() || String(clientId || "").trim() }); };
  A.setMode = function (mode) { return act("/account/mode", { mode: mode }); };           // built-in sign-in only: "quick" (no Azure app) or "own" (your approved app)
  A.cancel = function () { return act("/account/cancel"); };
  A.use = function (id) { return act("/account/use", { id: id }); };
  A.signOut = function (id) { return act("/account/logout", { id: id }); };
  A.verify = function (id) { return act("/account/verify", { id: id }); };

  /* ---------- can a Java-account server be joined right now? ---------- */
  A.ready = function () {
    var b = st.bridge;
    if (prov() === "bridge") {
      if (b === "unknown" || b === "off") return { ok: false, why: "off", message: "OneClient Bridge is not running. Start it (bridge folder, OneClient Bridge.bat), or switch to the built-in sign-in on the Java account page." };
      if (b === "unpaired") return { ok: false, why: "unpaired", message: "OneClient is not paired with the bridge yet. Type the pairing code from its window on the Java account page." };
      if (b === "wrongcode") return { ok: false, why: "wrongcode", message: "The bridge does not accept the saved pairing code. Pair again on the Java account page." };
    }
    if (!active()) return { ok: false, why: "noaccount", message: "Sign in to a Java account first." };
    return { ok: true };
  };
  /* Is the account in use still good? The tokens renew themselves; a sign-in that Microsoft has ended shows up here (st.problem). */
  A.check = function (cached) {
    var a = active();
    if (!a || st.bridge !== "ready") return Promise.resolve(st);
    if (cached && st.problemId === a.id && !st.problem && Date.now() - (st.verifiedAt || 0) < 600000) return Promise.resolve(st);
    return call("/account/verify", "POST", { id: a.id }, { timeout: 25000 }).then(function (r) {
      st.problemId = a.id;
      st.problem = r.status === 200 ? "" : (r.json && r.json.message) || "The account could not be checked.";
      if (r.status === 200) { take(r.json); st.verifiedAt = Date.now(); }
      emit();
      return st;
    }, function () { return st; });
  };
  A.ensure = function () {
    return A.poll().then(function () {
      var r = A.ready();
      if (!r.ok) return r;
      return A.check(true).then(function () { return st.problem && st.problemId === st.active ? { ok: false, why: "problem", message: st.problem } : r; });
    });
  };

  /* ---------- the object the game looks for ---------- */
  var store = { yggToken: undefined, user: undefined };
  function syncStore() {
    var a = st.bridge === "ready" ? active() : null;
    store.yggToken = a ? a.session : undefined;                                   // a stand-in: the provider swaps it for the real token
    store.user = a ? { id: a.id, name: a.name } : undefined;
  }
  /* the Wisp server of the browser provider: yours if you set one, else the one that worked last, else the built-in ones (client/wisp.js) */
  A.wispCustom = function () { return OC.wisp ? OC.wisp.custom() : ""; };
  A.setWispCustom = function (url) { OC.wisp.setCustom(url); emit(); };
  A.testWisp = function (url) { return OC.https.test(url); };
  A.wispUrl = function () {
    if (prov() === "browser") return (OC.wisp.servers()[0]) || "";
    return cfg.tunnel ? "ws://127.0.0.1:" + cfg.port + "/wisp/" + cfg.tunnel + "/" : "";
  };
  var wc = {
    version: "oneclient",
    authstore: store,
    setWispUrl: function () { /* the endpoint is OneClient's: a link or a script cannot point the game's connections elsewhere */ },
    showSettingsUI: function () { try { if (OC.menu && OC.menu.openAccount) OC.menu.openAccount(); } catch (e) { /* menu not ready */ } }
  };
  Object.defineProperty(wc, "wispUrl", { enumerable: true, get: function () { return A.wispUrl() || undefined; } });
  /* The game opens its Wisp connection with the constructor in globalThis.__eaglerNativeWebSocket, and falls back to the browser's own WebSocket
   * when that is the same object as the current global one. A second proxy of OneClient's (net.js) proxy is a different object that still goes through
   * net.js, so the packet layer keeps hearing the connection. */
  window.__eaglerNativeWebSocket = new Proxy(window.WebSocket, {});
  window.wispcraft = wc;
  A.wispAddress = function (target) { var w = A.wispUrl(); return w ? "eagler-wisp:" + encodeURIComponent(w) + "?target=" + encodeURIComponent(target) : ""; };
  A.parseWisp = function (ip) {
    var m = /^eagler-wisp:([^?]*)\?target=(.*)$/.exec(String(ip || ""));
    if (!m) return null;
    try { return { base: decodeURIComponent(m[1]), target: decodeURIComponent(m[2]) }; } catch (e) { return null; }
  };

  /* The game's two Mojang calls (the profile before it connects, the session join when a server asks for encryption) cannot be made from a
   * web page: they go to the provider, which holds the real token. Everything else is left alone. */
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : String(input);
    if (url !== PROFILE_URL && url !== JOIN_URL) return nativeFetch(input, init);
    init = init || {};
    var join = url === JOIN_URL, auth = "";
    try { auth = new Headers(init.headers || (input && input.headers) || {}).get("authorization") || ""; } catch (e) { /* no headers */ }
    if (prov() === "browser") {
      var q;
      try { q = join ? OC.msauth.join(JSON.parse(String(init.body || "{}"))) : OC.msauth.profile(auth.replace(/^Bearer\s+/i, "")); } catch (e) { return Promise.reject(new TypeError("bad request")); }
      return q.then(function (r) { return new Response(r.status === 204 ? null : r.text, { status: r.status, headers: { "Content-Type": "application/json" } }); });
    }
    if (!cfg.pair) return Promise.reject(new TypeError("OneClient Bridge is not paired"));
    var headers = { Authorization: "Bearer " + cfg.pair }, opts = { method: join ? "POST" : "GET", headers: headers, credentials: "omit", cache: "no-store", signal: init.signal };
    if (join) { headers["Content-Type"] = "application/json"; opts.body = init.body; }
    else headers["X-OC-Session"] = auth.replace(/^Bearer\s+/i, "");
    return nativeFetch(base() + (join ? "/mojang/join" : "/mojang/profile"), opts);
  };

  /* ---------- a stream to host:port through the tunnel (server status) ----------
   * It looks like a WebSocket (onopen, onmessage, onerror, onclose, send, close) so the status code can use it like the relay's. */
  A.openStream = function (target) {
    var m = /^(.*):(\d{1,5})$/.exec(String(target)), host = m ? m[1].replace(/^\[|\]$/g, "") : String(target), port = m ? parseInt(m[2], 10) : 25565, url = A.wispUrl();
    if (!url) throw new Error("not paired");
    var s = { binaryType: "arraybuffer", onopen: null, onmessage: null, onerror: null, onclose: null, readyState: 0 }, over = false;
    function finish() { if (over) return; over = true; s.readyState = 3; if (s.onclose) s.onclose({}); }
    if (prov() === "browser") {                                                   // a stream of a shared Wisp session (client/wisp.js)
      var inner = null;
      OC.wisp.connectVia(url, host, port).then(function (stream) {
        if (over) { stream.close(); return; }
        inner = stream;
        stream.onmessage = function (u8) { if (s.onmessage) s.onmessage({ data: u8.slice().buffer }); };
        stream.onclose = function () { finish(); };
        s.readyState = 1;
        if (s.onopen) s.onopen({});
      }, function () { if (s.onerror) s.onerror({}); finish(); });
      s.send = function (data) { if (inner) inner.send(data instanceof ArrayBuffer ? new Uint8Array(data) : data); };
      s.close = function () { over = true; s.readyState = 3; if (inner) inner.close(); };
      return s;
    }
    var ws = OC.net && OC.net.openQuiet ? OC.net.openQuiet(url) : new WebSocket(url), greeted = false;     // Wisp v1: the server greets (CONTINUE on stream 0), we CONNECT stream 1, bytes are DATA frames
    ws.binaryType = "arraybuffer";
    function frame(type, payload) { var b = new Uint8Array(5 + payload.length); b[0] = type; b[1] = 1; b.set(payload, 5); return b; }       // stream id 1 (u32 little endian)
    ws.onmessage = function (ev) {
      if (!(ev.data instanceof ArrayBuffer)) return;
      var u = new Uint8Array(ev.data);
      if (u.length < 5) return;
      var id = (u[1] | (u[2] << 8) | (u[3] << 16) | (u[4] << 24)) >>> 0;
      if (u[0] === 3 && id === 0 && !greeted) {
        greeted = true;
        var h = new TextEncoder().encode(host), c = new Uint8Array(3 + h.length);
        c[0] = 1; c[1] = port & 255; c[2] = (port >> 8) & 255; c.set(h, 3);
        ws.send(frame(1, c));
        s.readyState = 1;
        if (s.onopen) s.onopen({});
      } else if (u[0] === 2 && id === 1) { if (s.onmessage) s.onmessage({ data: u.slice(5).buffer }); }
      else if (u[0] === 4 && id === 1) { try { ws.close(); } catch (e) { /* closed */ } finish(); }
    };
    ws.onerror = function () { if (s.onerror) s.onerror({}); };
    ws.onclose = function () { finish(); };
    s.send = function (data) { var u = data instanceof ArrayBuffer ? new Uint8Array(data) : data; ws.send(frame(2, u)); };
    s.close = function () { try { ws.close(); } catch (e) { /* closed */ } finish(); };
    return s;
  };

  /* The built-in provider is ready at once. The bridge is looked at once the page is up, but only for players who use it
   * (a fetch to the local network can make a browser ask for permission). */
  if (prov() === "browser") setTimeout(function () { A.poll(); }, 0);
  else if (cfg.pair) setTimeout(function () { A.poll(); }, 1500);
})();
