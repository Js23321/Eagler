#!/usr/bin/env node
"use strict";
/*
 * OneClient Bridge - a small program that runs on YOUR computer so OneClient can use a real Java (Microsoft) account.
 *
 * Why it exists: a web page cannot call Minecraft's account servers (they send no CORS headers) and cannot open TCP connections.
 * The bridge does those two things for the page, on your own connection:
 *
 *   1. Sign-in      Microsoft's device-code sign-in, the Xbox / Minecraft token chain and the token refresh run here. The tokens
 *                   stay in a file in your own profile folder; OneClient only ever gets an opaque stand-in string for the account.
 *   2. Session join The game proves your account to a server by calling Mojang's session server. OneClient sends that call (and the
 *                   profile check before it) here; the bridge swaps the stand-in for the real token and forwards it.
 *   3. Connections  A Wisp server (WebSocket <-> TCP), so the game reaches a Minecraft server from your own internet connection.
 *
 * Safety: it listens on 127.0.0.1 only; every request needs the pairing code printed when it starts; only the two Mojang calls
 * above are forwarded; connections to private / loopback addresses are refused (so a web page cannot use it to poke at your own
 * network) unless you start it with --allow-private. No dependencies: Node.js 18 or newer.
 *
 *   node oneclient-bridge.js [--port 8742] [--client-id <azure app id>] [--allow-private] [--data-dir <folder>] [--new-pairing]
 */

const http = require("http"), net = require("net"), dns = require("dns"), crypto = require("crypto"), fs = require("fs"), os = require("os"), path = require("path");

if (typeof fetch !== "function") {
  console.error("OneClient Bridge needs Node.js 18 or newer (this is " + process.version + "). Get the current LTS from https://nodejs.org");
  process.exit(1);
}

const VERSION = "1.0.0";
const args = process.argv.slice(2);
const has = (n) => args.indexOf("--" + n) >= 0;
const val = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && i + 1 < args.length && args[i + 1].slice(0, 2) !== "--" ? args[i + 1] : d; };

if (has("help") || has("h") || has("?")) {
  console.log([
    "OneClient Bridge " + VERSION,
    "",
    "  node oneclient-bridge.js [options]",
    "",
    "  --port <n>           port to listen on (default 8742)",
    "  --client-id <id>     the Application (client) ID of your Azure app, used for the Microsoft sign-in",
    "  --allow-private      let the game connect to private / loopback addresses (a server on your own network)",
    "  --data-dir <folder>  where the sign-in file is kept (default: your local app data folder)",
    "  --new-pairing        make a new pairing code (OneClient has to be paired again)",
    "  --pass-encryption    let the game itself encrypt the connection to online-mode servers (OneClient's packet mods are blind there)"
  ].join("\n"));
  process.exit(0);
}

const PORT = parseInt(val("port", process.env.ONECLIENT_BRIDGE_PORT || "8742"), 10);
const ALLOW_PRIVATE = has("allow-private") || process.env.ONECLIENT_BRIDGE_ALLOW_PRIVATE === "1";
const PASS_ENCRYPTION = has("pass-encryption");                      // leave the encryption handshake to the game (then OneClient cannot read the packets of online-mode servers)
if (!(PORT >= 1 && PORT <= 65535)) { console.error("Bad --port."); process.exit(1); }

/* The web services the sign-in talks to. The environment variable is only for tests (a stand-in for Microsoft and Mojang). */
const EP = Object.assign({
  deviceCode: "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode",
  token: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  xbl: "https://user.auth.xboxlive.com/user/authenticate",
  xsts: "https://xsts.auth.xboxlive.com/xsts/authorize",
  mcLogin: "https://api.minecraftservices.com/authentication/login_with_xbox",
  mcProfile: "https://api.minecraftservices.com/minecraft/profile",
  mcJoin: "https://sessionserver.mojang.com/session/minecraft/join"
}, (() => { try { return JSON.parse(process.env.ONECLIENT_BRIDGE_ENDPOINTS || "{}"); } catch (e) { return {}; } })());
const SCOPE = "XboxLive.signin offline_access";
const BUFFER = 128;                       // Wisp: packets the game may send on a stream before it waits for a CONTINUE
const MAX_STREAMS = 32;                   // per connection of the game
const MAX_SOCKETS = 96;                   // in all
const MAX_FRAME = 8 * 1024 * 1024;

/* ---------- the state file ---------- */
function defaultDir() {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "OneClient Bridge");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "OneClient Bridge");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "oneclient-bridge");
}
const DIR = val("data-dir", process.env.ONECLIENT_BRIDGE_DIR || defaultDir());
const FILE = path.join(DIR, "state.json");
const PAIR_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newPair() {
  let s = "";
  const r = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) { s += PAIR_CHARS[r[i] % PAIR_CHARS.length]; if (i % 4 === 3 && i < 11) s += "-"; }
  return s;
}
function loadState() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { /* first run */ }
  if (!s || typeof s !== "object") s = {};
  if (has("new-pairing") || typeof s.pair !== "string" || !/^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/.test(s.pair)) s.pair = newPair();
  if (typeof s.secret !== "string" || s.secret.length < 32) s.secret = crypto.randomBytes(32).toString("hex");
  s.accounts = (Array.isArray(s.accounts) ? s.accounts : []).filter((a) => a && typeof a.id === "string" && typeof a.refresh === "string" && typeof a.clientId === "string");
  if (typeof s.clientId !== "string") s.clientId = "";
  if (!s.accounts.some((a) => a.id === s.active)) s.active = s.accounts.length ? s.accounts[0].id : null;
  return s;
}
let state = loadState();
if (val("client-id", process.env.ONECLIENT_BRIDGE_CLIENT_ID)) state.clientId = String(val("client-id", process.env.ONECLIENT_BRIDGE_CLIENT_ID)).trim();
function saveState() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (e) { log("could not save " + FILE + ": " + e.message); }
}
saveState();

function log(m) {
  const d = new Date(), p = (n) => (n < 10 ? "0" : "") + n;
  console.log(p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "  " + m);
}

/* ---------- small helpers ---------- */
const BOOT = crypto.randomBytes(6).toString("hex");                    // changes with every start: OneClient knows when the bridge was restarted
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function userErr(message, code) { const e = new Error(message); e.user = true; e.code = code || "error"; return e; }
function httpErr(status, message, code) { const e = new Error(message); e.status = status; e.code = code || "error"; return e; }
function sendJson(res, status, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": b.length });
  res.end(b);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > (limit || 65536)) { reject(httpErr(413, "Request too large.")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { const j = JSON.parse(b.toString("utf8")); return j && typeof j === "object" ? j : {}; } catch (e) { throw httpErr(400, "Bad JSON.", "json"); }
}
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const undash = (s) => String(s || "").replace(/-/g, "").toLowerCase();

/* ---------- Microsoft / Xbox / Minecraft sign-in ---------- */
async function web(url, init) {
  let r;
  try { r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000), redirect: "error" }, init)); }
  catch (e) { throw userErr("Could not reach " + new URL(url).host + " (" + (e && (e.cause && e.cause.code || e.message) || "network error") + "). Check your internet connection.", "network"); }
  let json = null, text = "";
  try { text = await r.text(); json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { ok: r.ok, status: r.status, json: json || {}, text: text };
}
const postForm = (url, fields) => web(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(fields).toString() });
const postJson = (url, obj) => web(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" }, body: JSON.stringify(obj) });

const XERR = {
  2148916227: "This Xbox account is banned.",
  2148916233: "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com (or start the Minecraft launcher) to create it, then try again.",
  2148916235: "Xbox Live is not available in your country or region.",
  2148916236: "This account needs adult verification on the Xbox site before it can sign in.",
  2148916237: "This account needs adult verification on the Xbox site before it can sign in.",
  2148916238: "This is a child account. An adult has to add it to a Microsoft family before it can sign in."
};

/* Xbox Live -> XSTS -> Minecraft services: the Microsoft access token in, a Minecraft access token out */
async function mojangChain(msAccess) {
  const x = await postJson(EP.xbl, { Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=" + msAccess }, RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" });
  const xc = x.json && x.json.DisplayClaims && x.json.DisplayClaims.xui && x.json.DisplayClaims.xui[0];
  if (!x.ok || !x.json.Token || !xc || !xc.uhs) throw userErr("Xbox Live did not accept the sign-in (" + x.status + ").", "xbox");
  const s = await postJson(EP.xsts, { Properties: { SandboxId: "RETAIL", UserTokens: [x.json.Token] }, RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT" });
  if (!s.ok) throw userErr(XERR[s.json && s.json.XErr] || "Xbox Live refused the Minecraft sign-in (" + s.status + (s.json && s.json.XErr ? ", code " + s.json.XErr : "") + ").", "xsts");
  const sc = s.json.DisplayClaims && s.json.DisplayClaims.xui && s.json.DisplayClaims.xui[0];
  const m = await postJson(EP.mcLogin, { identityToken: "XBL3.0 x=" + ((sc && sc.uhs) || xc.uhs) + ";" + s.json.Token });
  if (m.status === 403) throw userErr("Mojang has not approved this app's client ID for Minecraft yet (the form is https://aka.ms/mce-reviewappid). Until it is approved Minecraft's servers answer 403" + (m.json && typeof m.json.errorMessage === "string" ? ": " + m.json.errorMessage.slice(0, 160) : ".") , "unapproved");
  if (m.status === 429) throw userErr("Mojang is limiting sign-ins right now. Wait a few minutes and try again.", "ratelimit");
  if (!m.ok || typeof m.json.access_token !== "string") throw userErr("Minecraft services did not accept the sign-in (" + m.status + ").", "minecraft");
  return { token: m.json.access_token, exp: Date.now() + (m.json.expires_in > 0 ? m.json.expires_in : 86400) * 1000 };
}
async function fetchProfile(token) {
  const r = await web(EP.mcProfile, { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (r.status === 404) throw userErr("This Microsoft account does not own Minecraft: Java Edition (it has no Minecraft profile).", "noprofile");
  if (!r.ok) throw userErr("Minecraft services did not return the profile (" + r.status + ").", "profile");
  const id = undash(r.json.id);
  if (!/^[0-9a-f]{32}$/.test(id) || typeof r.json.name !== "string" || !/^[A-Za-z0-9_]{1,16}$/.test(r.json.name)) throw userErr("Minecraft services returned a profile OneClient cannot use.", "profile");
  return { id: id, name: r.json.name };
}

const tokens = new Map();                 // account id -> { token, exp }   (Minecraft access tokens, memory only)
const refreshing = new Map();             // account id -> promise
function accountById(id) { return state.accounts.find((a) => a.id === id) || null; }
function mcToken(acct) {
  const c = tokens.get(acct.id);
  if (c && c.exp - Date.now() > 120000) return Promise.resolve(c.token);
  if (refreshing.has(acct.id)) return refreshing.get(acct.id);
  const p = (async () => {
    const r = await postForm(EP.token, { grant_type: "refresh_token", client_id: acct.clientId, refresh_token: acct.refresh, scope: SCOPE });
    if (!r.ok || typeof r.json.access_token !== "string") {
      const gone = r.json && (r.json.error === "invalid_grant" || r.json.error === "interaction_required");
      throw userErr(gone ? "The Microsoft sign-in of " + acct.name + " has expired. Sign in again." : "Microsoft did not renew the sign-in (" + r.status + (r.json && r.json.error ? ", " + r.json.error : "") + ").", gone ? "signin" : "refresh");
    }
    if (typeof r.json.refresh_token === "string" && r.json.refresh_token !== acct.refresh) { acct.refresh = r.json.refresh_token; saveState(); }
    const mc = await mojangChain(r.json.access_token);
    tokens.set(acct.id, mc);
    return mc.token;
  })().finally(() => refreshing.delete(acct.id));
  refreshing.set(acct.id, p);
  return p;
}
/* the stand-in OneClient holds for an account: stable, useless without the pairing code */
function standIn(acct) { return "ocs_" + crypto.createHmac("sha256", state.secret).update("account:" + acct.id).digest("base64url").slice(0, 40); }
/* the secret part of the connection address (ws://127.0.0.1:port/wisp/<key>/): it only opens connections, it cannot touch the accounts */
function tunnelKey() { return crypto.createHmac("sha256", state.secret).update("tunnel").digest("base64url").slice(0, 22); }
function accountFor(session) {
  const s = Buffer.from(String(session || ""));
  for (const a of state.accounts) { const p = Buffer.from(standIn(a)); if (p.length === s.length && crypto.timingSafeEqual(p, s)) return a; }
  return null;
}

/* the device-code sign-in in progress (one at a time) */
let login = { state: "none" };
function loginView() {
  const l = login;
  if (l.state === "none") return { state: "none" };
  return { state: l.state, userCode: l.userCode, verificationUri: l.verificationUri, expiresIn: l.expiresAt ? Math.max(0, Math.round((l.expiresAt - Date.now()) / 1000)) : 0, message: l.message || "", account: l.account || null };
}
async function startLogin(clientId) {
  clientId = String(clientId || state.clientId || "").trim();
  if (!GUID.test(clientId)) throw userErr("Enter the Application (client) ID of your Azure app first: 36 letters and digits with dashes, like 11111111-2222-3333-4444-555555555555.", "clientid");
  if (login.state === "waiting" || login.state === "working") login.cancelled = true;
  const r = await postForm(EP.deviceCode, { client_id: clientId, scope: SCOPE });
  if (!r.ok || typeof r.json.device_code !== "string" || typeof r.json.user_code !== "string") {
    const d = (r.json && (r.json.error_description || r.json.error)) || ("status " + r.status);
    throw userErr("Microsoft did not start the sign-in: " + String(d).split("\r\n")[0].slice(0, 300), "devicecode");
  }
  if (clientId !== state.clientId) { state.clientId = clientId; saveState(); }
  const l = login = { state: "waiting", clientId: clientId, deviceCode: r.json.device_code, userCode: r.json.user_code, verificationUri: r.json.verification_uri || "https://www.microsoft.com/link", interval: Math.max(2, r.json.interval | 0 || 5), expiresAt: Date.now() + (r.json.expires_in > 0 ? r.json.expires_in : 900) * 1000, message: "" };
  pollLogin(l);
  return loginView();
}
async function pollLogin(l) {
  const dead = () => login !== l || l.cancelled;
  while (!dead() && l.state === "waiting") {
    await sleep(l.interval * 1000);
    if (dead()) return;
    if (Date.now() > l.expiresAt) { l.state = "error"; l.message = "The code expired. Start the sign-in again."; return; }
    let r;
    try { r = await postForm(EP.token, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: l.clientId, device_code: l.deviceCode }); }
    catch (e) { continue; }                                           // a hiccup: try again at the next tick
    if (dead()) return;
    if (r.ok && typeof r.json.access_token === "string") {
      l.state = "working"; l.message = "Signing in to Xbox and Minecraft...";
      try {
        const mc = await mojangChain(r.json.access_token), prof = await fetchProfile(mc.token);
        let a = accountById(prof.id);
        if (!a) { a = { id: prof.id, name: prof.name, clientId: l.clientId, refresh: "" }; state.accounts.push(a); }
        a.name = prof.name; a.clientId = l.clientId; a.refresh = r.json.refresh_token || a.refresh;
        state.active = a.id;
        tokens.set(a.id, mc);
        saveState();
        if (dead()) return;
        l.state = "done"; l.account = { id: a.id, name: a.name };
        log("signed in: " + a.name);
      } catch (e) {
        if (dead()) return;
        l.state = "error"; l.message = e.user ? e.message : "Sign-in failed: " + e.message;
        log("sign-in failed: " + l.message);
      }
      return;
    }
    const err = r.json && r.json.error;
    if (err === "authorization_pending") continue;
    if (err === "slow_down") { l.interval += 5; continue; }
    l.state = "error";
    l.message = ({ authorization_declined: "The sign-in was declined.", expired_token: "The code expired. Start the sign-in again.", bad_verification_code: "Microsoft did not recognise the code." })[err] || String((r.json && (r.json.error_description || r.json.error)) || ("status " + r.status)).split("\r\n")[0].slice(0, 300);
    return;
  }
}

/* ---------- web server (JSON for OneClient) ---------- */
const failLog = [];
function checkPair(given) {
  const now = Date.now();
  while (failLog.length && now - failLog[0] > 60000) failLog.shift();
  if (failLog.length >= 12) throw httpErr(429, "Too many wrong pairing codes. Wait a minute.", "throttled");
  const a = Buffer.from(String(given || "").replace(/\s+/g, "").toUpperCase()), b = Buffer.from(state.pair);
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) { failLog.push(now); throw httpErr(401, "Wrong or missing pairing code.", "pairing"); }
}
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, x-oc-session");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Cache-Control", "no-store");
}
const HOST_OK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;           // a web page of another site cannot reach us through a name pointing here
function accountView() {
  return {
    version: VERSION, boot: BOOT, clientId: state.clientId, active: state.active, allowPrivate: ALLOW_PRIVATE, tunnel: tunnelKey(), readable: !PASS_ENCRYPTION,
    accounts: state.accounts.map((a) => ({ id: a.id, name: a.name, session: standIn(a) })),
    login: loginView()
  };
}
async function route(req, res) {
  cors(req, res);
  if (!HOST_OK.test(req.headers.host || "")) throw httpErr(421, "Wrong host name.");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const p = new URL(req.url, "http://localhost").pathname;
  if (p === "/") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("OneClient Bridge " + VERSION + " is running.\nThis window has to stay open while you play. Pair OneClient with the code shown in it.\n"); }
  if (p === "/status" && req.method === "GET") return sendJson(res, 200, { bridge: "oneclient", version: VERSION, needsPairing: true });
  checkPair((String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i) || [])[1]);
  if (p === "/account" && req.method === "GET") return sendJson(res, 200, accountView());
  if (req.method !== "POST" && p.indexOf("/mojang/") !== 0) throw httpErr(404, "Not found.");
  if (p === "/account/client") {
    const b = await readJson(req), id = String(b.clientId || "").trim();
    if (id && !GUID.test(id)) throw httpErr(400, "That is not a client ID (36 characters with dashes).", "clientid");
    state.clientId = id; saveState();
    return sendJson(res, 200, accountView());
  }
  if (p === "/account/login") { const b = await readJson(req); await startLogin(b.clientId); return sendJson(res, 200, accountView()); }
  if (p === "/account/cancel") { if (login.state === "waiting" || login.state === "working") login.cancelled = true; login = { state: "none" }; return sendJson(res, 200, accountView()); }
  if (p === "/account/use") {
    const b = await readJson(req);
    if (!accountById(b.id)) throw httpErr(404, "No such account.");
    state.active = b.id; saveState();
    return sendJson(res, 200, accountView());
  }
  if (p === "/account/logout") {
    const b = await readJson(req), a = accountById(b.id);
    if (!a) throw httpErr(404, "No such account.");
    state.accounts = state.accounts.filter((x) => x !== a); tokens.delete(a.id);
    if (state.active === a.id) state.active = state.accounts.length ? state.accounts[0].id : null;
    saveState();
    log("signed out: " + a.name);
    return sendJson(res, 200, accountView());
  }
  if (p === "/account/verify") {                                     // is the account usable right now? (renews the tokens when they are old)
    const b = await readJson(req), a = accountById(b.id || state.active);
    if (!a) throw httpErr(404, "No such account.");
    const prof = await fetchProfile(await mcToken(a));
    if (prof.id === a.id && prof.name !== a.name) { a.name = prof.name; saveState(); }
    return sendJson(res, 200, accountView());
  }
  if (p === "/mojang/profile") {                                     // what the game asks Mojang before it logs in: whose account is this
    const a = accountFor(req.headers["x-oc-session"]);
    if (!a) return sendJson(res, 401, { error: "UNKNOWN_SESSION", errorMessage: "Sign in again in OneClient." });
    const r = await web(EP.mcProfile, { headers: { Authorization: "Bearer " + (await mcToken(a)), Accept: "application/json" } });
    res.writeHead(r.status, { "Content-Type": "application/json" });
    return res.end(r.text);
  }
  if (p === "/mojang/join") {                                        // "I am about to join the server with this hash": Mojang's session server
    const b = await readJson(req), a = accountFor(b.accessToken);
    if (!a) return sendJson(res, 401, { error: "UNKNOWN_SESSION", errorMessage: "Sign in again in OneClient." });
    if (undash(b.selectedProfile) !== a.id || !/^-?[0-9a-f]{1,40}$/.test(String(b.serverId))) return sendJson(res, 403, { error: "ForbiddenOperationException", errorMessage: "Wrong profile." });
    const r = await web(EP.mcJoin, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ accessToken: await mcToken(a), selectedProfile: a.id, serverId: String(b.serverId) }) });
    res.writeHead(r.status, { "Content-Type": "application/json" });
    return res.end(r.status === 204 ? undefined : r.text);
  }
  throw httpErr(404, "Not found.");
}
const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (res.headersSent) { try { res.end(); } catch (x) { /* gone */ } return; }
    const status = e.status || (e.user ? (e.code === "signin" ? 401 : e.code === "clientid" ? 400 : 502) : 500);
    if (!e.status && !e.user) log("error: " + (e && e.stack || e));
    sendJson(res, status, { error: e.code || "error", message: e.user || e.status ? e.message : "Internal error." });
  });
});
server.requestTimeout = 60000;

/* ---------- connections: a Wisp server (WebSocket <-> TCP) ---------- */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
class WsConn {
  constructor(socket, head) {
    this.socket = socket; this.buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.frag = null; this.fragLen = 0; this.closed = false;
    this.onmessage = null; this.onclose = null; this.ondrain = null;
    socket.setNoDelay(true);
    socket.on("data", (d) => { this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d; this.parse(); });
    socket.on("drain", () => { if (this.ondrain) this.ondrain(); });
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }
  start() { if (this.buf.length) this.parse(); }                      // bytes that came with the upgrade, once the handlers are set
  parse() {
    for (;;) {
      const b = this.buf;
      if (this.closed || b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 15, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 127, p = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); p = 4; }
      else if (len === 127) { if (b.length < 10) return; if (b.readUInt32BE(2) !== 0) return this.fail(1009); len = b.readUInt32BE(6); p = 10; }
      if (len > MAX_FRAME) return this.fail(1009);
      if (!masked) return this.fail(1002);
      if (b.length < p + 4 + len) return;
      const mask = b.subarray(p, p + 4); p += 4;
      const data = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) data[i] = b[p + i] ^ mask[i & 3];
      this.buf = b.subarray(p + len);
      this.frame(fin, op, data);
    }
  }
  frame(fin, op, data) {
    if (op >= 8) {
      if (op === 8) this.close(1000);
      else if (op === 9) this.raw(10, data);
      return;
    }
    if (op === 0) {
      if (!this.frag) return this.fail(1002);
      this.frag.push(data); this.fragLen += data.length;
      if (this.fragLen > MAX_FRAME) return this.fail(1009);
      if (fin) { const m = Buffer.concat(this.frag); this.frag = null; this.fragLen = 0; this.deliver(m); }
      return;
    }
    if (op === 1 || op === 2) {
      if (this.frag) return this.fail(1002);
      if (fin) this.deliver(data); else { this.frag = [data]; this.fragLen = data.length; }
      return;
    }
    this.fail(1002);
  }
  deliver(m) {
    try { if (this.onmessage) this.onmessage(m); }
    catch (e) { log("tunnel error: " + (e && e.message || e)); this.fail(1011); }
  }
  raw(op, data) {
    if (this.closed && op !== 8) return true;
    const n = data.length;
    let h;
    if (n < 126) { h = Buffer.allocUnsafe(2); h[1] = n; }
    else if (n < 65536) { h = Buffer.allocUnsafe(4); h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.allocUnsafe(10); h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(n, 6); }
    h[0] = 0x80 | op;
    this.socket.cork();
    this.socket.write(h);
    const ok = this.socket.write(data);
    this.socket.uncork();
    return ok;
  }
  send(data) { return this.raw(2, data); }
  close(code) { if (this.closed) return; const b = Buffer.alloc(2); b.writeUInt16BE(code || 1000, 0); this.raw(8, b); this.closed = true; this.socket.end(); this.finish(); }
  fail(code) { this.close(code); this.socket.destroy(); }
  finish() { if (this.finished) return; this.finished = true; this.closed = true; if (this.onclose) this.onclose(); }
}

/* where a Minecraft server may be: public addresses only, unless --allow-private */
function v6bytes(a) {                                                 // the 16 bytes of an IPv6 address (zone id and a dotted IPv4 tail handled), or null
  a = String(a).split("%")[0].toLowerCase();
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (m) { const o = m[2].split(".").map(Number); a = m[1] + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16); }
  const parts = a.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [], tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const groups = parts.length === 2 ? head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), tail) : head;
  if (groups.length !== 8) return null;
  const b = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) { const g = parseInt(groups[i], 16); if (!(g >= 0 && g <= 0xffff)) return null; b.writeUInt16BE(g, i * 2); }
  return b;
}
function isPrivateAddress(a) {
  if (net.isIPv6(a)) {
    const b = v6bytes(a);
    if (!b) return true;
    const zero = (from, to) => { for (let i = from; i < to; i++) if (b[i]) return false; return true; };
    const v4 = (i) => [b[i], b[i + 1], b[i + 2], b[i + 3]].join(".");
    if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isPrivateAddress(v4(12));          // ::ffff:a.b.c.d, however it is written
    if (zero(0, 12)) return true;                                                                  // ::, ::1 and the old IPv4-compatible form
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return isPrivateAddress(v4(12));     // 64:ff9b::/96 (NAT64)
    if (b[0] === 0x20 && b[1] === 0x02) return isPrivateAddress(v4(2));                           // 6to4
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true;            // Teredo
    return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) || b[0] === 0xff || (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8);
  }
  const o = a.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return true;
  return o[0] === 0 || o[0] === 10 || o[0] === 127 || (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || (o[0] === 169 && o[1] === 254) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 192 && o[1] === 0 && o[2] === 0) || o[0] >= 224;
}
const reasonErr = (reason, message) => { const e = new Error(message); e.wisp = reason; return e; };
async function resolveTargets(host, port) {
  if (!net.isIP(host) && port === 25565) {                              // a Minecraft client looks for an SRV record when the port is the default one
    try {
      const recs = await Promise.race([dns.promises.resolveSrv("_minecraft._tcp." + host), sleep(2500).then(() => [])]);
      if (recs && recs.length) { recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight); host = recs[0].name; port = recs[0].port; }
    } catch (e) { /* no record: the host itself */ }
  }
  let addrs;
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await dns.promises.lookup(host, { all: true, verbatim: true })).map((x) => x.address); }
    catch (e) { throw reasonErr(0x42, "cannot resolve " + host); }
  }
  if (!addrs.length) throw reasonErr(0x42, "no address for " + host);
  if (!ALLOW_PRIVATE && addrs.some(isPrivateAddress)) throw reasonErr(0x48, "private address refused: " + host);
  addrs.sort((a, b) => (net.isIPv4(a) ? 0 : 1) - (net.isIPv4(b) ? 0 : 1));
  return addrs.slice(0, 3).map((a) => ({ address: a, port: port }));
}
async function openTcp(host, port) {
  const targets = await resolveTargets(host, port);
  let last = reasonErr(0x42, "unreachable");
  for (const t of targets) {
    try {
      return await new Promise((resolve, reject) => {
        const s = net.connect({ host: t.address, port: t.port });
        const timer = setTimeout(() => { s.destroy(); reject(reasonErr(0x43, "timed out")); }, 9000);
        s.once("connect", () => { clearTimeout(timer); s.removeAllListeners("error"); resolve(s); });
        s.once("error", (e) => { clearTimeout(timer); reject(reasonErr(e.code === "ECONNREFUSED" ? 0x44 : e.code === "ETIMEDOUT" ? 0x43 : 0x42, e.code || e.message)); });
      });
    } catch (e) { last = e; if (e.wisp === 0x44) break; }
  }
  throw last;
}

/* ---------- a Minecraft login passing through: the bridge signs the player in with the real server ----------
 * The game talks to the bridge as if it were a server that needs no account (no encryption, no Mojang calls from the page) and the
 * bridge does what a Minecraft client does with the real server: the encryption handshake, Mojang's session join with the account's
 * token, then an encrypted pipe. So OneClient, which reads the plain stream the game sees, keeps working on online-mode servers, and the
 * real token never leaves this program. A server list ping, a server that needs no account and anything not understood pass through
 * untouched (and with --pass-encryption the game does the handshake itself, through the session-join call above). */
function rdVar(b, p) {                                                // [value, next position], or null while the bytes are incomplete
  let r = 0;
  for (let i = 0; i < 5; i++) {
    if (p + i >= b.length) return null;
    const c = b[p + i];
    r |= (c & 127) << (7 * i);
    if (!(c & 128)) return [r >>> 0, p + i + 1];
  }
  throw new Error("bad VarInt");
}
function wVar(n) { const o = []; do { let c = n & 127; n >>>= 7; if (n) c |= 128; o.push(c); } while (n); return Buffer.from(o); }
function mcStr(s) { const b = Buffer.from(s, "utf8"); return Buffer.concat([wVar(b.length), b]); }
function mcFrame(id, payload) { const b = Buffer.concat([wVar(id), payload]); return Buffer.concat([wVar(b.length), b]); }
function readPacket(b, p, max) {                                      // { id, body, end }, or null while the bytes are incomplete
  const l = rdVar(b, p);
  if (!l) return null;
  if (l[0] < 1 || l[0] > max) throw new Error("bad packet length");
  if (b.length < l[1] + l[0]) return null;
  const id = rdVar(b, l[1]);
  if (!id || id[1] > l[1] + l[0]) throw new Error("bad packet");
  return { id: id[0], body: b.subarray(id[1], l[1] + l[0]), end: l[1] + l[0] };
}
function rdBytes(b, p) {                                              // [length-prefixed bytes, next position]
  const l = rdVar(b, p);
  if (!l || b.length < l[1] + l[0]) throw new Error("short packet");
  return [b.subarray(l[1], l[1] + l[0]), l[1] + l[0]];
}
function serverHash(serverId, secret, pub) {                          // Minecraft's SHA-1: the digest read as a signed number, in hex
  const h = crypto.createHash("sha1").update(serverId, "latin1").update(secret).update(pub).digest();
  const neg = (h[0] & 0x80) !== 0;
  if (neg) { let c = 1; for (let i = h.length - 1; i >= 0; i--) { const v = (~h[i] & 0xff) + c; h[i] = v & 0xff; c = v >> 8; } }
  return (neg ? "-" : "") + (h.toString("hex").replace(/^0+/, "") || "0");
}

class LoginGate {
  constructor(sock, toGame, end, pass) {
    this.sock = sock; this.toGame = toGame; this.end = end;           // toGame(bytes): to the game; end(): close the stream
    this.state = pass ? "pipe" : "sniff";                             // sniff -> await -> joining -> pipe  (or dead)
    this.gbuf = Buffer.alloc(0); this.ubuf = Buffer.alloc(0); this.held = [];
    this.enc = null; this.dec = null; this.acct = null;
  }
  up(b) { this.sock.write(this.enc ? this.enc.update(b) : b); }
  /* bytes from the game; ack() once they are dealt with (the Wisp credit for the game) */
  fromGame(d, ack) {
    if (this.state === "pipe") { this.sock.write(this.enc ? this.enc.update(d) : d, ack); return; }
    if (this.state === "sniff") { this.gbuf = Buffer.concat([this.gbuf, d]); try { this.sniff(); } catch (e) { this.pass(); } }
    else if (this.state !== "dead") this.held.push(Buffer.from(d));      // the server has not answered yet: the game waits for it, keep what comes
    ack();
  }
  pass() {                                                            // not something to take over: everything goes through as it is
    if (this.state !== "sniff") return;
    this.state = "pipe";
    const b = this.gbuf; this.gbuf = null;
    if (b.length) this.up(b);
  }
  sniff() {
    const b = this.gbuf;
    if (b.length > 4096) return this.pass();
    const p1 = readPacket(b, 0, 4096);
    if (!p1) return;
    if (p1.id !== 0) return this.pass();
    const proto = rdVar(p1.body, 0), host = rdBytes(p1.body, proto[1]), next = rdVar(p1.body, host[1] + 2);       // Handshake: protocol, host, u16 port, next state
    if (!(next[0] === 2 || next[0] === 3) || proto[0] < 764) return this.pass();                                  // a status ping (1), or a login of an old version
    const p2 = readPacket(b, p1.end, 4096);
    if (!p2) return;                                                   // Login Start follows: name, uuid
    if (p2.id !== 0) return this.pass();
    const nl = rdVar(p2.body, 0);
    if (nl[0] > 64 || p2.body.length < nl[1] + nl[0] + 16) return this.pass();
    const uuid = p2.body.subarray(nl[1] + nl[0], nl[1] + nl[0] + 16).toString("hex");
    const acct = accountById(uuid) || accountById(state.active);
    if (!acct) { this.state = "dead"; return this.refuse("Sign in to a Java account in OneClient first (Multiplayer > Java account)."); }
    this.acct = acct;
    this.state = "await";
    const rest = b.subarray(p2.end);
    if (rest.length) this.held.push(Buffer.from(rest));
    this.gbuf = null;
    log("login as " + acct.name + " on " + host[0].toString("utf8").slice(0, 80));
    this.sock.write(Buffer.concat([b.subarray(0, p1.end), mcFrame(0, Buffer.concat([mcStr(acct.name), Buffer.from(acct.id, "hex")]))]));    // the same handshake, then Login Start of the real account
  }
  /* bytes from the server */
  fromUp(d) {
    if (this.state === "pipe" || this.state === "sniff") { this.toGame(this.dec ? this.dec.update(d) : d); return; }
    if (this.state === "dead") return;
    this.ubuf = Buffer.concat([this.ubuf, d]);
    if (this.state === "joining") return;
    let p;
    try { p = readPacket(this.ubuf, 0, 16384); } catch (e) { return this.release(); }
    if (!p) { if (this.ubuf.length > 16384) this.release(); return; }
    if (p.id !== 1) return this.release();                             // no Encryption Request: a server that needs no account, or a refusal: the game hears it as it is
    this.state = "joining";
    this.encrypt(p.body).catch((e) => {
      log("login failed: " + (e.message || e));
      this.refuse(e.user ? e.message : "The bridge could not sign in to the server (" + (e.message || e) + ").");
    });
  }
  release() {
    this.state = "pipe";
    const u = this.ubuf; this.ubuf = null;
    if (u.length) this.toGame(u);
    for (const h of this.held) this.up(h);
    this.held = [];
  }
  async encrypt(b) {                                                   // Encryption Request: server id, public key, verify token, should-authenticate
    const sid = rdBytes(b, 0), pub = rdBytes(b, sid[1]), tok = rdBytes(b, pub[1]);
    const authenticate = tok[1] < b.length ? b[tok[1]] !== 0 : true;
    const key = crypto.createPublicKey({ key: pub[0], format: "der", type: "spki" }), secret = crypto.randomBytes(16);
    const rsa = (x) => crypto.publicEncrypt({ key: key, padding: crypto.constants.RSA_PKCS1_PADDING }, x);
    if (authenticate) {
      const token = await mcToken(this.acct);
      const r = await web(EP.mcJoin, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ accessToken: token, selectedProfile: this.acct.id, serverId: serverHash(sid[0].toString("latin1"), secret, pub[0]) }) });
      if (r.status !== 204) {
        tokens.delete(this.acct.id);
        throw userErr("Mojang's session server refused the login for " + this.acct.name + " (" + r.status + (r.json && r.json.errorMessage ? ": " + r.json.errorMessage : "") + "). Sign in again in OneClient if this keeps happening.", "join");
      }
    }
    if (this.state === "dead") return;
    const es = rsa(secret), et = rsa(tok[0]);
    this.sock.write(mcFrame(1, Buffer.concat([wVar(es.length), es, wVar(et.length), et])));                    // Encryption Response
    this.enc = crypto.createCipheriv("aes-128-cfb8", secret, secret);                                            // from here the server's side is encrypted
    this.dec = crypto.createDecipheriv("aes-128-cfb8", secret, secret);
    this.state = "pipe"; this.ubuf = null;
    for (const h of this.held) this.up(h);
    this.held = [];
    log("signed in to the server as " + this.acct.name);
  }
  refuse(message) {                                                    // the game shows this on its Disconnected screen (a login-state Disconnect: JSON text)
    this.state = "dead";
    this.toGame(mcFrame(0, mcStr(JSON.stringify({ text: message }))));
    setTimeout(() => this.end(), 250);
  }
}

let totalSockets = 0;
function wispSession(ws, label) {
  const streams = new Map(), paused = new Set();
  const pkt = (type, id, payload) => { const b = Buffer.allocUnsafe(5 + payload.length); b[0] = type; b.writeUInt32LE(id >>> 0, 1); payload.copy(b, 5); return b; };
  const cont = (id, n) => { const p = Buffer.allocUnsafe(4); p.writeUInt32LE(n, 0); ws.send(pkt(3, id, p)); };
  const shut = (id, reason) => ws.send(pkt(4, id, Buffer.from([reason])));
  const drop = (id) => {
    const st = streams.get(id);
    if (!st) return;
    streams.delete(id); paused.delete(st);
    if (st.counted) { st.counted = false; totalSockets--; }
    if (st.sock) st.sock.destroy();
  };
  ws.ondrain = () => { for (const st of paused) st.sock.resume(); paused.clear(); };
  ws.onclose = () => { for (const id of Array.from(streams.keys())) drop(id); };
  cont(0, BUFFER);                                                    // the greeting: how many packets a stream may send before it waits
  function write(st, id, d) {                                         // the game's bytes for the server
    st.outstanding++;
    st.gate.fromGame(d, () => {
      st.outstanding--; st.freed++;
      if (streams.get(id) === st && st.freed >= BUFFER / 4) { st.freed = 0; cont(id, Math.max(1, BUFFER - st.outstanding)); }
    });
  }
  ws.onmessage = (m) => {
    if (m.length < 5) return;
    const type = m[0], id = m.readUInt32LE(1), body = m.subarray(5);
    if (type === 1) {                                                 // CONNECT: stream type (1 TCP), port, host
      if (id === 0 || streams.has(id) || body.length < 4) return shut(id, 0x41);
      if (body[0] !== 1) return shut(id, 0x41);
      const port = body.readUInt16LE(1), host = body.toString("utf8", 3).trim();
      if (!host || host.length > 253 || /[\s/\\@]/.test(host) || port < 1) return shut(id, 0x41);
      if (streams.size >= MAX_STREAMS || totalSockets >= MAX_SOCKETS) return shut(id, 0x49);
      const st = { sock: null, gate: null, outstanding: 0, freed: 0, pending: [], counted: true };
      streams.set(id, st);
      totalSockets++;
      log("connect " + host + ":" + port);
      openTcp(host, port).then((sock) => {
        if (streams.get(id) !== st) { sock.destroy(); return; }
        st.sock = sock;
        sock.setNoDelay(true); sock.setKeepAlive(true, 30000);
        const toGame = (d) => { for (let o = 0; o < d.length; o += 65536) { if (!ws.send(pkt(2, id, d.subarray(o, o + 65536)))) { sock.pause(); paused.add(st); } } };
        st.gate = new LoginGate(sock, toGame, () => { if (streams.get(id) === st) { shut(id, 0x02); drop(id); } }, PASS_ENCRYPTION);
        sock.on("data", (d) => { try { st.gate.fromUp(d); } catch (e) { log("error: " + e.message); shut(id, 0x03); drop(id); } });
        sock.on("end", () => { if (streams.get(id) === st) { shut(id, 0x02); drop(id); } });
        sock.on("error", () => { if (streams.get(id) === st) { shut(id, 0x03); drop(id); } });
        sock.on("close", () => { if (streams.get(id) === st) { shut(id, 0x02); drop(id); } });
        for (const d of st.pending) write(st, id, d);
        st.pending = null;
      }, (e) => {
        if (streams.get(id) !== st) return;
        log("connect failed: " + host + ":" + port + " (" + (e.message || e) + ")");
        shut(id, e.wisp || 0x42);
        drop(id);
      });
      return;
    }
    if (type === 2) {                                                 // DATA
      const st = streams.get(id);
      if (!st) return;
      if (!st.sock) { st.pending.push(Buffer.from(body)); return; }
      write(st, id, body);
      return;
    }
    if (type === 4) { drop(id); return; }                             // CLOSE
  };
}
function checkTunnel(given) {
  const now = Date.now();
  while (failLog.length && now - failLog[0] > 60000) failLog.shift();
  if (failLog.length >= 12) throw httpErr(429, "Too many wrong keys.", "throttled");
  const a = Buffer.from(String(given || "")), b = Buffer.from(tunnelKey());
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) { failLog.push(now); throw httpErr(401, "Wrong or missing key.", "pairing"); }
}
server.on("upgrade", (req, socket, head) => {
  const reject = (status, text) => { try { socket.end("HTTP/1.1 " + status + " " + text + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); } catch (e) { /* gone */ } };
  try {
    if (!HOST_OK.test(req.headers.host || "")) return reject(421, "Misdirected Request");
    const m = /^\/wisp\/([A-Za-z0-9_-]+)\/?$/.exec(new URL(req.url, "http://localhost").pathname);
    if (!m) return reject(404, "Not Found");
    try { checkTunnel(m[1]); } catch (e) { return reject(e.status || 401, "Unauthorized"); }
    const key = req.headers["sec-websocket-key"];
    if (!key || String(req.headers.upgrade).toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13") return reject(400, "Bad Request");
    const offered = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + crypto.createHash("sha1").update(key + WS_GUID).digest("base64") + "\r\n" +
      (offered.length ? "Sec-WebSocket-Protocol: " + offered[0] + "\r\n" : "") + "\r\n");
    const conn = new WsConn(socket, head);
    wispSession(conn, req.headers.origin || "");
    conn.start();
  } catch (e) { reject(500, "Internal Server Error"); }
});

/* ---------- start ---------- */
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error("\nPort " + PORT + " is already in use. Is OneClient Bridge already running in another window? (Or start this one with --port <another number>.)");
  else console.error("\n" + e.message);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  const line = "-".repeat(64);
  console.log([
    "", line,
    "  OneClient Bridge " + VERSION,
    line,
    "  Address       127.0.0.1:" + PORT,
    "  Pairing code  " + state.pair + "      (type it into OneClient once: Multiplayer > Java account)",
    "  Accounts      " + (state.accounts.length ? state.accounts.map((a) => a.name + (a.id === state.active ? " (in use)" : "")).join(", ") : "none yet - sign in from OneClient"),
    "  Client ID     " + (state.clientId || "not set yet (OneClient asks for it when you sign in)"),
    "  Private IPs   " + (ALLOW_PRIVATE ? "allowed" : "refused (start with --allow-private to join a server on your own network)"),
    "  Data          " + FILE,
    line,
    "  Keep this window open while you play. Press Ctrl+C to stop.",
    ""
  ].join("\n"));
});
process.on("SIGINT", () => { console.log("\nBridge stopped."); process.exit(0); });
process.on("uncaughtException", (e) => { log("error: " + (e && e.stack || e)); });
process.on("unhandledRejection", (e) => { log("error: " + (e && e.stack || e)); });
