/* OneClient built-in sign-in: the Microsoft / Xbox / Minecraft sign-in and the session join, run inside the page (no helper program).
 *
 * It does what OneClient Bridge does (bridge/oneclient-bridge.js) with the same steps and the same answers, but the HTTPS requests go
 * through OC.https (client/wisp.js: TLS in the page over a Wisp tunnel) instead of a program on your computer. client/account.js asks
 * this file the same questions it would ask the bridge, so the menus do not care which one answers.
 *
 *   1. Device-code sign-in: Microsoft shows a code, you enter it on microsoft.com/link, OneClient waits.
 *   2. Xbox Live -> XSTS -> Minecraft services: the Microsoft token becomes a Minecraft access token (valid a day); the Microsoft refresh
 *      token renews it. The account is only usable when the Azure app (client ID) is approved by Mojang (https://aka.ms/mce-reviewappid).
 *   3. The game's two Mojang calls (profile, session join): the game holds a stand-in string (made fresh at every page load), and the real
 *      token is put in here.
 *
 * The refresh token and the Minecraft token are kept in this browser's storage (localStorage, key oneclient.msauth.v1), like any web app
 * would; scripts of this page (mods are scripts of this page) can read them. Sign out removes them.
 *
 * OC.msauth.view()                           the account view (same shape as the bridge's: accounts, active, clientId, login ... plus clientLocked: the page was built with its own app ID)
 * OC.msauth.startLogin(clientId)             -> Promise of the view    cancel()   use(id)   logout(id)   verify(id)  (each a Promise of the view)
 * OC.msauth.profile(stand-in)                -> Promise { status, text }      OC.msauth.join(body) -> Promise { status, text }
 * OC.msauth.token(acct)                      -> Promise of the real Minecraft access token (renewed when old)      OC.msauth.active()
 * OC.msauth.fetcher                          the function the HTTPS requests go through (tests replace it)
 * ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC || !OC.https) return;
  var M = OC.msauth = {}, KEY = "oneclient.msauth.v1", SCOPE = "XboxLive.signin offline_access";
  var EP = M.endpoints = {
    deviceCode: "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
    token: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    xbl: "https://user.auth.xboxlive.com/user/authenticate",
    xsts: "https://xsts.auth.xboxlive.com/xsts/authorize",
    mcLogin: "https://api.minecraftservices.com/authentication/login_with_xbox",
    mcProfile: "https://api.minecraftservices.com/minecraft/profile",
    mcJoin: "https://sessionserver.mojang.com/session/minecraft/join",
    liveDeviceCode: "https://login.live.com/oauth20_connect.srf",                    // quick sign-in only (see "quick sign-in" below)
    liveToken: "https://login.live.com/oauth20_token.srf",
    xblDevice: "https://device.auth.xboxlive.com/device/authenticate",
    xblTitle: "https://title.auth.xboxlive.com/title/authenticate"
  };
  /* Quick sign-in: the sign-in that Mineflayer / prismarine-auth ("live" flow) use. No Azure app of yours is involved: OneClient signs in as Minecraft on a
   * Nintendo Switch (Microsoft's own app ID for that game, 00000000441cc96b, a device token of type Nintendo, and a title token), which is why Microsoft's
   * page names that app and not OneClient. Microsoft and Mojang do not offer this for third-party clients, so it may stop working; an Azure app of your
   * own that Mojang approved is the supported way (mode "own"). login.live.com only speaks TLS 1.2, so those requests ask for it (tls: { tls12: true }). */
  var QUICK = { id: "00000000441cc96b", scope: "service::user.auth.xboxlive.com::MBI_SSL", deviceType: "Nintendo", tls: { tls12: true } };
  M.fetcher = function (url, init) { return OC.https.request(url, init); };
  var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var BOOT = Math.random().toString(36).slice(2, 10);
  /* The Azure app that came with the page (node build.js --client-id=...): then nobody has to type one and the menu only shows "Sign in".
   * Nothing is bundled by default; Mojang approves apps one by one, so the ID has to be one its owner registered and got approved. */
  var BAKED = "";
  try { var bk = JSON.parse((document.getElementById("oc-msclient") || {}).textContent || "{}"); if (bk && typeof bk.clientId === "string" && GUID.test(bk.clientId)) BAKED = bk.clientId.toLowerCase(); } catch (e) { /* none */ }
  M.builtInClientId = function () { return BAKED; };                                 // "" when the page came without one (also what the bridge provider uses)

  /* ---------- what is remembered ---------- */
  var state = { clientId: "", mode: "quick", active: null, accounts: [] };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (saved && typeof saved === "object") {
      if (typeof saved.clientId === "string") state.clientId = saved.clientId;
      state.mode = saved.mode === "own" || saved.mode === "quick" ? saved.mode : state.clientId ? "own" : "quick";      // quick sign-in unless an app ID of your own was set up
      state.accounts = (Array.isArray(saved.accounts) ? saved.accounts : []).filter(function (a) { return a && typeof a.id === "string" && /^[0-9a-f]{32}$/.test(a.id) && typeof a.refresh === "string" && typeof a.clientId === "string" && typeof a.name === "string"; });
      state.active = state.accounts.some(function (a) { return a.id === saved.active; }) ? saved.active : state.accounts.length ? state.accounts[0].id : null;
    }
  } catch (e) { /* no storage: nothing is remembered */ }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ clientId: state.clientId, mode: state.mode, active: state.active, accounts: state.accounts.map(function (a) { return { id: a.id, name: a.name, clientId: a.clientId, flow: a.flow === "live" ? "live" : undefined, refresh: a.refresh, mc: a.mc || null }; }) }));
    } catch (e) { /* storage blocked */ }
  }
  state.accounts.forEach(function (a) { var s = null; try { s = (JSON.parse(localStorage.getItem(KEY)).accounts.filter(function (x) { return x.id === a.id; })[0] || {}).mc; } catch (e) { /* none */ } if (s && typeof s.token === "string" && s.exp > Date.now()) a.mc = s; });

  function userErr(message, code) { var e = new Error(message); e.user = true; e.code = code || "error"; return e; }
  var undash = function (s) { return String(s || "").replace(/-/g, "").toLowerCase(); };
  function byId(id) { for (var i = 0; i < state.accounts.length; i++) if (state.accounts[i].id === id) return state.accounts[i]; return null; }
  M.active = function () { return byId(state.active); };

  /* the stand-in the game holds for an account (new at every page load; only this file knows what it stands for) */
  var standIns = {};
  function randomToken() {
    var a = new Uint8Array(30), bin = "";
    window.crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
    return "ocs_" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function standIn(a) { return standIns[a.id] || (standIns[a.id] = randomToken()); }
  function accountFor(session) { for (var i = 0; i < state.accounts.length; i++) if (standIn(state.accounts[i]) === session) return state.accounts[i]; return null; }

  /* ---------- web requests ---------- */
  async function web(url, init) {
    var r;
    try { r = await M.fetcher(url, init || {}); }
    catch (e) {
      if (e && e.cert) throw userErr("The secure connection to " + new URL(url).host + " could not be trusted: " + e.message, "cert");
      throw userErr("Could not reach " + new URL(url).host + " (" + (e && e.message || "network error") + "). The Wisp tunnel may be down: check the connection settings on the Java account page.", "network");
    }
    var text = r.text(), json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: json || {}, text: text, headers: r.headers || {} };
  }
  function form(fields) { return Object.keys(fields).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(fields[k]); }).join("&"); }
  function postForm(url, fields, extra) {                                           // extra: { tls, headers } (quick sign-in: TLS 1.2 and a cookie)
    extra = extra || {};
    var h = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    Object.keys(extra.headers || {}).forEach(function (k) { h[k] = extra.headers[k]; });
    return web(url, { method: "POST", headers: h, body: form(fields), tls: extra.tls });
  }
  function postJson(url, obj) { return web(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" }, body: JSON.stringify(obj) }); }

  var XERR = {
    2148916227: "This Xbox account is banned.",
    2148916229: "This account is restricted and its guardian has not allowed online play. A guardian can change that at account.microsoft.com/family.",
    2148916233: "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com (or start the Minecraft launcher) to create it, then try again.",
    2148916234: "This account has not accepted Xbox's terms of service yet. Sign in once at xbox.com and accept them, then try again.",
    2148916235: "Xbox Live is not available in your country or region.",
    2148916236: "This account needs adult verification on the Xbox site before it can sign in.",
    2148916237: "This account needs adult verification on the Xbox site before it can sign in.",
    2148916238: "This is a child account. An adult has to add it to a Microsoft family before it can sign in."
  };
  async function chain(msAccess) {                                                  // Xbox Live -> XSTS -> Minecraft services
    var x = await postJson(EP.xbl, { Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=" + msAccess }, RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" });
    var xc = x.json && x.json.DisplayClaims && x.json.DisplayClaims.xui && x.json.DisplayClaims.xui[0];
    if (!x.ok || !x.json.Token || !xc || !xc.uhs) throw userErr("Xbox Live did not accept the sign-in (" + x.status + ").", "xbox");
    var s = await postJson(EP.xsts, { Properties: { SandboxId: "RETAIL", UserTokens: [x.json.Token] }, RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT" });
    if (!s.ok) throw userErr(XERR[s.json && s.json.XErr] || "Xbox Live refused the Minecraft sign-in (" + s.status + (s.json && s.json.XErr ? ", code " + s.json.XErr : "") + ").", "xsts");
    var sc = s.json.DisplayClaims && s.json.DisplayClaims.xui && s.json.DisplayClaims.xui[0];
    return mcLogin((sc && sc.uhs) || xc.uhs, s.json.Token, false);
  }
  async function mcLogin(uhs, xstsToken, quick) {                                    // the XSTS token becomes a Minecraft access token (valid a day)
    var m = await postJson(EP.mcLogin, { identityToken: "XBL3.0 x=" + uhs + ";" + xstsToken });
    if (m.status === 403) {
      var detail = m.json && typeof m.json.errorMessage === "string" ? ": " + m.json.errorMessage.slice(0, 160) : ".";
      throw userErr(quick ? "Minecraft services refused the quick sign-in (403)" + detail + " Mojang may have stopped allowing this way of signing in: use an Azure app of your own instead (see the Java account page)."
        : "Mojang has not approved this app's client ID for Minecraft yet (the form is https://aka.ms/mce-reviewappid). Until it is approved Minecraft's servers answer 403" + detail, quick ? "refused" : "unapproved");
    }
    if (m.status === 429) throw userErr("Mojang is limiting sign-ins right now. Wait a few minutes and try again.", "ratelimit");
    if (!m.ok || typeof m.json.access_token !== "string") throw userErr("Minecraft services did not accept the sign-in (" + m.status + ").", "minecraft");
    return { token: m.json.access_token, exp: Date.now() + (m.json.expires_in > 0 ? m.json.expires_in : 86400) * 1000 };
  }

  /* ---------- quick sign-in (see QUICK above): live.com sign-in, then Xbox's signed requests (user, device and title tokens) ---------- */
  function bytes() {
    var n = 0, i, o, p = 0;
    for (i = 0; i < arguments.length; i++) n += arguments[i].length;
    o = new Uint8Array(n);
    for (i = 0; i < arguments.length; i++) { o.set(arguments[i], p); p += arguments[i].length; }
    return o;
  }
  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function uuid4() {
    var a = new Uint8Array(16), h = "";
    window.crypto.getRandomValues(a);
    a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128;
    for (var i = 0; i < 16; i++) { h += (a[i] < 16 ? "0" : "") + a[i].toString(16); if (i === 3 || i === 5 || i === 7 || i === 9) h += "-"; }
    return h;
  }
  /* Xbox wants its requests signed: an ECDSA P-256 key whose public half travels in the request, and a Signature header over
   * policy 1, the Windows time, POST, the path, an empty authorization and the body (each part ended by a zero byte). */
  async function proofKey() {
    var kp = await window.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    var j = await window.crypto.subtle.exportKey("jwk", kp.publicKey);
    return { priv: kp.privateKey, jwk: { kty: "EC", crv: "P-256", x: j.x, y: j.y, alg: "ES256", use: "sig" } };
  }
  M.xblSign = async function (key, url, body, nowMs) {
    var enc = new TextEncoder(), path = new URL(url).pathname;
    var ts = (BigInt(Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000)) + BigInt("11644473600")) * BigInt("10000000"), tsb = new Uint8Array(8), i;      // Windows epoch, 100 ns units
    for (i = 7; i >= 0; i--) { tsb[i] = Number(ts & BigInt(255)); ts = ts >> BigInt(8); }
    var policy = new Uint8Array([0, 0, 0, 1]), zero = new Uint8Array([0]);
    var data = bytes(policy, zero, tsb, zero, enc.encode("POST"), zero, enc.encode(path), zero, zero, enc.encode(body), zero);
    var sig = new Uint8Array(await window.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.priv, data));
    return b64(bytes(policy, tsb, sig));
  };
  M.newProofKey = proofKey;
  async function xblSigned(url, obj, contract, key) {
    var body = JSON.stringify(obj);
    return web(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": contract, "Cache-Control": "no-store, must-revalidate, no-cache", Signature: await M.xblSign(key, url, body) }, body: body });
  }
  async function liveChain(msAccess) {                                               // live.com token -> Xbox user + device + title tokens -> XSTS -> Minecraft services
    var key = await proofKey(), A = "http://auth.xboxlive.com";
    var ut = await xblSigned(EP.xbl, { RelyingParty: A, TokenType: "JWT", Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "t=" + msAccess } }, "2", key);
    if (!ut.ok || !ut.json.Token) throw userErr("Xbox Live did not accept the sign-in (user token, " + ut.status + ").", "xbox");
    var dt = await xblSigned(EP.xblDevice, { Properties: { AuthMethod: "ProofOfPossession", Id: "{" + uuid4() + "}", DeviceType: QUICK.deviceType, SerialNumber: "{" + uuid4() + "}", Version: "0.0.0", ProofKey: key.jwk }, RelyingParty: A, TokenType: "JWT" }, "1", key);
    if (!dt.ok || !dt.json.Token) throw userErr("Xbox Live did not accept the sign-in (device token, " + dt.status + ").", "xbox");
    var tt = await xblSigned(EP.xblTitle, { Properties: { AuthMethod: "RPS", DeviceToken: dt.json.Token, RpsTicket: "t=" + msAccess, SiteName: "user.auth.xboxlive.com", ProofKey: key.jwk }, RelyingParty: A, TokenType: "JWT" }, "1", key);
    if (!tt.ok || !tt.json.Token) throw userErr("Xbox Live did not accept the sign-in (title token, " + tt.status + ").", "xbox");
    var s = await xblSigned(EP.xsts, { RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT", Properties: { UserTokens: [ut.json.Token], DeviceToken: dt.json.Token, TitleToken: tt.json.Token, ProofKey: key.jwk, SandboxId: "RETAIL" } }, "1", key);
    if (!s.ok) throw userErr(XERR[s.json && s.json.XErr] || "Xbox Live refused the Minecraft sign-in (" + s.status + (s.json && s.json.XErr ? ", code " + s.json.XErr : "") + ").", "xsts");
    var sc = s.json.DisplayClaims && s.json.DisplayClaims.xui && s.json.DisplayClaims.xui[0];
    if (!sc || !sc.uhs || !s.json.Token) throw userErr("Xbox Live returned a sign-in OneClient cannot use.", "xsts");
    return mcLogin(sc.uhs, s.json.Token, true);
  }
  async function fetchProfile(token) {
    var r = await web(EP.mcProfile, { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
    if (r.status === 404) throw userErr("This Microsoft account does not own Minecraft: Java Edition (it has no Minecraft profile).", "noprofile");
    if (!r.ok) throw userErr("Minecraft services did not return the profile (" + r.status + ").", "profile");
    var id = undash(r.json.id);
    if (!/^[0-9a-f]{32}$/.test(id) || typeof r.json.name !== "string" || !/^[A-Za-z0-9_]{1,16}$/.test(r.json.name)) throw userErr("Minecraft services returned a profile OneClient cannot use.", "profile");
    return { id: id, name: r.json.name };
  }

  /* the real Minecraft token of an account, renewed with the Microsoft refresh token when it is old */
  var refreshing = {};
  M.token = function (acct) {
    if (acct.mc && acct.mc.exp - Date.now() > 120000) return Promise.resolve(acct.mc.token);
    if (refreshing[acct.id]) return refreshing[acct.id];
    var p = (async function () {
      var live = acct.flow === "live";                                                // a quick sign-in account renews through live.com
      var r = live ? await postForm(EP.liveToken, { scope: QUICK.scope, client_id: QUICK.id, grant_type: "refresh_token", refresh_token: acct.refresh }, { tls: QUICK.tls })
        : await postForm(EP.token, { grant_type: "refresh_token", client_id: acct.clientId, refresh_token: acct.refresh, scope: SCOPE });
      if (!r.ok || typeof r.json.access_token !== "string") {
        var gone = r.json && (r.json.error === "invalid_grant" || r.json.error === "interaction_required");
        throw userErr(gone ? "The Microsoft sign-in of " + acct.name + " has expired. Sign in again." : "Microsoft did not renew the sign-in (" + r.status + (r.json && r.json.error ? ", " + r.json.error : "") + ").", gone ? "signin" : "refresh");
      }
      if (typeof r.json.refresh_token === "string" && r.json.refresh_token !== acct.refresh) { acct.refresh = r.json.refresh_token; save(); }
      acct.mc = await (live ? liveChain(r.json.access_token) : chain(r.json.access_token));
      save();
      return acct.mc.token;
    })();
    refreshing[acct.id] = p;
    var clear = function () { delete refreshing[acct.id]; };
    p.then(clear, clear);
    return p;
  };

  /* ---------- the device-code sign-in in progress (one at a time) ---------- */
  var login = { state: "none" };
  function loginView() {
    var l = login;
    if (l.state === "none") return { state: "none" };
    return { state: l.state, userCode: l.userCode, verificationUri: l.verificationUri, expiresIn: l.expiresAt ? Math.max(0, Math.round((l.expiresAt - Date.now()) / 1000)) : 0, message: l.message || "", account: l.account || null };
  }
  M.view = function () {
    return {
      version: "built-in", boot: BOOT, clientId: BAKED || state.clientId, clientLocked: !!BAKED, mode: BAKED ? "own" : state.mode, active: state.active, allowPrivate: false, tunnel: "", readable: true,
      accounts: state.accounts.map(function (a) { return { id: a.id, name: a.name, session: standIn(a) }; }),
      login: loginView()
    };
  };
  M.setClientId = function (id) {
    id = String(id || "").trim();
    if (BAKED) return Promise.resolve(M.view());                                      // the page came with its own app
    if (id && !GUID.test(id)) return Promise.reject(userErr("That is not a client ID (36 characters with dashes).", "clientid"));
    state.clientId = id; save();
    return Promise.resolve(M.view());
  };
  M.setMode = function (mode) {                                                      // "quick" (no Azure app) or "own" (your approved Azure app)
    if (BAKED) return Promise.resolve(M.view());
    if (mode !== "quick" && mode !== "own") return Promise.reject(userErr("Unknown sign-in mode.", "mode"));
    state.mode = mode; save();
    return Promise.resolve(M.view());
  };
  async function startQuick() {
    if (login.state === "waiting" || login.state === "working") login.cancelled = true;
    var r = await postForm(EP.liveDeviceCode, { scope: QUICK.scope, client_id: QUICK.id, response_type: "device_code" }, { tls: QUICK.tls });
    if (!r.ok || typeof r.json.device_code !== "string" || typeof r.json.user_code !== "string") {
      var d = (r.json && (r.json.error_description || r.json.error)) || ("status " + r.status);
      throw userErr("Microsoft did not start the sign-in: " + String(d).split("\r\n")[0].slice(0, 300), "devicecode");
    }
    var cookie = String((r.headers && r.headers["set-cookie"]) || "").split(";")[0];       // live.com wants its cookie back while we wait for you
    var l = login = { state: "waiting", flow: "live", clientId: QUICK.id, cookie: cookie, deviceCode: r.json.device_code, userCode: r.json.user_code, verificationUri: r.json.verification_uri || "https://www.microsoft.com/link", interval: Math.max(2, r.json.interval | 0 || 5), expiresAt: Date.now() + (r.json.expires_in > 0 ? r.json.expires_in : 900) * 1000, message: "" };
    poll(l);
    return M.view();
  }
  M.startLogin = async function (clientId) {
    if (!BAKED && state.mode === "quick") return startQuick();
    clientId = BAKED || String(clientId || state.clientId || "").trim();
    if (!GUID.test(clientId)) throw userErr("Enter the Application (client) ID of your Azure app first: 36 letters and digits with dashes, like 11111111-2222-3333-4444-555555555555.", "clientid");
    if (login.state === "waiting" || login.state === "working") login.cancelled = true;
    var r = await postForm(EP.deviceCode, { client_id: clientId, scope: SCOPE });
    if (!r.ok || typeof r.json.device_code !== "string" || typeof r.json.user_code !== "string") {
      var d = (r.json && (r.json.error_description || r.json.error)) || ("status " + r.status);
      throw userErr("Microsoft did not start the sign-in: " + String(d).split("\r\n")[0].slice(0, 300), "devicecode");
    }
    if (clientId !== state.clientId) { state.clientId = clientId; save(); }
    var l = login = { state: "waiting", clientId: clientId, deviceCode: r.json.device_code, userCode: r.json.user_code, verificationUri: r.json.verification_uri || "https://www.microsoft.com/link", interval: Math.max(2, r.json.interval | 0 || 5), expiresAt: Date.now() + (r.json.expires_in > 0 ? r.json.expires_in : 900) * 1000, message: "" };
    poll(l);
    return M.view();
  };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function poll(l) {
    var dead = function () { return login !== l || l.cancelled; }, live = l.flow === "live";
    while (!dead() && l.state === "waiting") {
      await sleep(l.interval * 1000);
      if (dead()) return;
      if (Date.now() > l.expiresAt) { l.state = "error"; l.message = "The code expired. Start the sign-in again."; return; }
      var r;
      try {
        r = live ? await postForm(EP.liveToken + "?client_id=" + QUICK.id, { client_id: QUICK.id, device_code: l.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }, { tls: QUICK.tls, headers: l.cookie ? { Cookie: l.cookie } : {} })
          : await postForm(EP.token, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: l.clientId, device_code: l.deviceCode });
      }
      catch (e) { continue; }                                                     // a hiccup: try again at the next tick
      if (dead()) return;
      if (r.ok && typeof r.json.access_token === "string") {
        l.state = "working"; l.message = "Signing in to Xbox and Minecraft...";
        try {
          var mc = await (live ? liveChain(r.json.access_token) : chain(r.json.access_token)), prof = await fetchProfile(mc.token), a = byId(prof.id);
          if (!a) { a = { id: prof.id, name: prof.name, clientId: l.clientId, refresh: "" }; state.accounts.push(a); }
          a.name = prof.name; a.clientId = l.clientId; a.flow = live ? "live" : undefined; a.refresh = r.json.refresh_token || a.refresh; a.mc = mc;
          state.active = a.id;
          save();
          if (dead()) return;
          l.state = "done"; l.account = { id: a.id, name: a.name };
        } catch (e) {
          if (dead()) return;
          l.state = "error"; l.message = e.user ? e.message : "Sign-in failed: " + e.message;
        }
        return;
      }
      var err = r.json && r.json.error;
      if (err === "authorization_pending") continue;
      if (err === "slow_down") { l.interval += 5; continue; }
      l.state = "error";
      l.message = ({ authorization_declined: "The sign-in was declined.", expired_token: "The code expired. Start the sign-in again.", bad_verification_code: "Microsoft did not recognise the code." })[err] || String((r.json && (r.json.error_description || r.json.error)) || ("status " + r.status)).split("\r\n")[0].slice(0, 300);
      return;
    }
  }
  M.cancel = function () { if (login.state === "waiting" || login.state === "working") login.cancelled = true; login = { state: "none" }; return Promise.resolve(M.view()); };
  M.use = function (id) {
    if (!byId(id)) return Promise.reject(userErr("No such account.", "noaccount"));
    state.active = id; save();
    return Promise.resolve(M.view());
  };
  M.logout = function (id) {
    var a = byId(id);
    if (!a) return Promise.reject(userErr("No such account.", "noaccount"));
    state.accounts = state.accounts.filter(function (x) { return x !== a; });
    if (state.active === a.id) state.active = state.accounts.length ? state.accounts[0].id : null;
    delete standIns[a.id];
    save();
    return Promise.resolve(M.view());
  };
  M.verify = async function (id) {                                                  // is the account usable right now? (renews the tokens when they are old)
    var a = byId(id || state.active);
    if (!a) throw userErr("No such account.", "noaccount");
    var prof = await fetchProfile(await M.token(a));
    if (prof.id === a.id && prof.name !== a.name) { a.name = prof.name; save(); }
    return M.view();
  };

  /* ---------- the game's two Mojang calls ---------- */
  function unknownSession() { return { status: 401, text: JSON.stringify({ error: "UNKNOWN_SESSION", errorMessage: "Sign in again in OneClient." }) }; }
  function failure(e) { return { status: e.code === "signin" ? 401 : 502, text: JSON.stringify({ error: e.code || "error", message: e.message }) }; }
  M.profile = async function (session) {
    var a = accountFor(session);
    if (!a) return unknownSession();
    try {
      var r = await web(EP.mcProfile, { headers: { Authorization: "Bearer " + await M.token(a), Accept: "application/json" } });
      return { status: r.status, text: r.text };
    } catch (e) { return failure(e); }
  };
  M.join = async function (b) {
    var a = accountFor(b && b.accessToken);
    if (!a) return unknownSession();
    if (undash(b.selectedProfile) !== a.id || !/^-?[0-9a-f]{1,40}$/.test(String(b.serverId))) return { status: 403, text: JSON.stringify({ error: "ForbiddenOperationException", errorMessage: "Wrong profile." }) };
    try {
      var r = await web(EP.mcJoin, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ accessToken: await M.token(a), selectedProfile: a.id, serverId: String(b.serverId) }) });
      return { status: r.status, text: r.status === 204 ? "" : r.text };
    } catch (e) { return failure(e); }
  };
  /* the same for code that is inside this page and knows the account (the login gate) */
  M.joinServer = async function (acct, serverHash, opts) {                           // opts.via(host, port): the stream to reach Mojang through (the gate uses the game's own tunnel, so both leave from the same address)
    var r = await web(EP.mcJoin, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ accessToken: await M.token(acct), selectedProfile: acct.id, serverId: serverHash }), via: opts && opts.via });
    return r;
  };
  M.byId = byId;
})();
