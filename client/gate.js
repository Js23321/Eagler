/* OneClient login gate (Java accounts, built-in sign-in): lets the mods read online-mode servers.
 *
 * An online-mode server asks the client to encrypt the connection (the Encryption Request) and to prove its account to Mojang. The game does that
 * itself with keys only it knows, so nothing could read the connection afterwards (OC.net.encrypted). For the account signed in with OneClient this
 * gate does that part instead: it keeps the Encryption Request from the game (so the game is never asked and never encrypts), answers it (RSA, the
 * session join with the real token through the same Wisp tunnel, a fresh AES key) and from then on decrypts what the server sends and encrypts what
 * the game sends, inside the Wisp frames of that one stream. The game and the packet layer (client/net.js) see a plain connection, exactly as with
 * OneClient Bridge. Everything else (a server list ping, a server that needs no account, anything this does not understand) passes through untouched.
 * When the gate fails AFTER it took the request over, that server is remembered for a day and the next join is left to the game (mods cannot read it
 * then); the switch on the Java account page (OC.gate.setEnabled) turns the whole thing off.
 *
 * OC.gate.enabled() / setEnabled(on)    OC.gate.state() { on, failed: [host:port], last }    OC.gate.onChange(fn)    OC.gate.log  (a few lines of what happened)
 * net.js calls attach(ws, url, api) for every WebSocket the game opens; the Conn it returns sees each frame the game sends (outgoing) and each
 * frame the server sends (incoming) before anything else does. ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC || !OC.net || typeof OC.net.setGate !== "function") return;
  var subtle = window.crypto && window.crypto.subtle;
  if (!subtle || typeof BigInt !== "function") return;
  var G = OC.gate = { version: 1, last: null, log: [] }, KEY = "oneclient.gate.v1", EMPTY = new Uint8Array(0), enc = new TextEncoder(), dec = new TextDecoder("utf-8");

  /* ---------- settings: on / off, and the servers where the gate failed ---------- */
  var cfg = { on: true, failed: {} }, subs = [], DAY = 86400000;
  try {
    var sv = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (sv && typeof sv === "object") { if (sv.on === false) cfg.on = false; if (sv.failed && typeof sv.failed === "object") cfg.failed = sv.failed; }
  } catch (e) { /* no storage: the defaults */ }
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } }
  function failedNow(key) { var t = cfg.failed[key]; return typeof t === "number" && Date.now() - t < DAY; }
  function emit() { subs.slice().forEach(function (fn) { try { fn(G.state()); } catch (e) { /* a listener's problem */ } }); }
  function note(m) { G.log.push(new Date().toISOString().slice(11, 23) + " " + m); if (G.log.length > 60) G.log.shift(); }
  G.onChange = function (fn) { subs.push(fn); };
  G.enabled = function () { return cfg.on; };
  G.setEnabled = function (on) { cfg.on = !!on; if (cfg.on) cfg.failed = {}; saveCfg(); emit(); };
  G.state = function () { return { on: cfg.on, failed: Object.keys(cfg.failed).filter(failedNow), last: G.last }; };

  /* ---------- bytes ---------- */
  function cat() {
    var n = 0, i, o, p = 0;
    for (i = 0; i < arguments.length; i++) n += arguments[i].length;
    o = new Uint8Array(n);
    for (i = 0; i < arguments.length; i++) { o.set(arguments[i], p); p += arguments[i].length; }
    return o;
  }
  function vint(n) { var o = []; do { var b = n & 127; n >>>= 7; o.push(n ? b | 128 : b); } while (n); return new Uint8Array(o); }
  function rdVar(b, p) {                                                           // [value, next position], or null while the bytes are incomplete
    var r = 0;
    for (var i = 0; i < 5; i++) {
      if (p + i >= b.length) return null;
      var c = b[p + i];
      r |= (c & 127) << (7 * i);
      if (!(c & 128)) return [r >>> 0, p + i + 1];
    }
    throw new Error("bad VarInt");
  }
  function mcStr(s) { var b = enc.encode(s); return cat(vint(b.length), b); }
  function mcFrame(id, payload) { var body = cat(vint(id), payload); return cat(vint(body.length), body); }
  function u32(b, p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
  function wisp(type, id, payload) { var o = new Uint8Array(5 + payload.length); o[0] = type; o[1] = id & 255; o[2] = (id >>> 8) & 255; o[3] = (id >>> 16) & 255; o[4] = (id >>> 24) & 255; o.set(payload, 5); return o; }
  function asU8(d) { if (d instanceof ArrayBuffer) return new Uint8Array(d); if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength); return null; }
  function userErr(m) { var e = new Error(m); e.user = true; return e; }

  /* ---------- AES-128 and CFB8: the stream cipher of Minecraft (WebCrypto has neither CFB8 nor a way to ask for one block per byte) ---------- */
  var SB = new Uint8Array(256), T0 = new Uint32Array(256), T1 = new Uint32Array(256), T2 = new Uint32Array(256), T3 = new Uint32Array(256);
  function rotl8(x, n) { return ((x << n) | (x >> (8 - n))) & 255; }
  (function () {
    var p = 1, q = 1, i;
    do {
      p = (p ^ ((p << 1) & 255) ^ (p & 128 ? 27 : 0)) & 255;                     // p = p * 3 in GF(2^8)
      q ^= (q << 1) & 255; q ^= (q << 2) & 255; q ^= (q << 4) & 255; if (q & 128) q ^= 9;      // q = q / 3
      SB[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 99) & 255;
    } while (p !== 1);
    SB[0] = 99;
    for (i = 0; i < 256; i++) {
      var s = SB[i], s2 = ((s << 1) ^ (s & 128 ? 27 : 0)) & 255, w = ((s2 << 24) | (s << 16) | (s << 8) | (s2 ^ s)) >>> 0;
      T0[i] = w; T1[i] = ((w >>> 8) | (w << 24)) >>> 0; T2[i] = ((w >>> 16) | (w << 16)) >>> 0; T3[i] = ((w >>> 24) | (w << 8)) >>> 0;
    }
  })();
  function expandKey(key) {                                                        // 16 bytes -> 44 round key words
    var rk = new Uint32Array(44), i, t, rcon = 1;
    for (i = 0; i < 4; i++) rk[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
    for (i = 4; i < 44; i++) {
      t = rk[i - 1];
      if (i % 4 === 0) {
        t = ((SB[(t >>> 16) & 255] << 24) | (SB[(t >>> 8) & 255] << 16) | (SB[t & 255] << 8) | SB[t >>> 24]) ^ (rcon << 24);
        rcon = ((rcon << 1) ^ (rcon & 128 ? 27 : 0)) & 255;
      }
      rk[i] = (rk[i - 4] ^ t) >>> 0;
    }
    return rk;
  }
  /* Cfb8(key, iv).crypt(bytes, decrypt) -> new bytes. One AES block is encrypted per byte (only its first byte is used), so the last round is cut short. */
  function Cfb8(key, iv) {
    if (key.length !== 16 || iv.length !== 16) throw new Error("AES-128 needs a 16 byte key and iv");
    this.rk = expandKey(key);
    this.s0 = ((iv[0] << 24) | (iv[1] << 16) | (iv[2] << 8) | iv[3]) | 0; this.s1 = ((iv[4] << 24) | (iv[5] << 16) | (iv[6] << 8) | iv[7]) | 0;
    this.s2 = ((iv[8] << 24) | (iv[9] << 16) | (iv[10] << 8) | iv[11]) | 0; this.s3 = ((iv[12] << 24) | (iv[13] << 16) | (iv[14] << 8) | iv[15]) | 0;
  }
  Cfb8.prototype.crypt = function (data, decrypt) {
    var n = data.length, out = new Uint8Array(n), rk = this.rk, s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3;
    for (var i = 0; i < n; i++) {
      var a0 = s0 ^ rk[0], a1 = s1 ^ rk[1], a2 = s2 ^ rk[2], a3 = s3 ^ rk[3], b0, b1, b2, b3, k = 4;
      for (var r = 1; r < 10; r++, k += 4) {
        b0 = T0[a0 >>> 24] ^ T1[(a1 >>> 16) & 255] ^ T2[(a2 >>> 8) & 255] ^ T3[a3 & 255] ^ rk[k];
        b1 = T0[a1 >>> 24] ^ T1[(a2 >>> 16) & 255] ^ T2[(a3 >>> 8) & 255] ^ T3[a0 & 255] ^ rk[k + 1];
        b2 = T0[a2 >>> 24] ^ T1[(a3 >>> 16) & 255] ^ T2[(a0 >>> 8) & 255] ^ T3[a1 & 255] ^ rk[k + 2];
        b3 = T0[a3 >>> 24] ^ T1[(a0 >>> 16) & 255] ^ T2[(a1 >>> 8) & 255] ^ T3[a2 & 255] ^ rk[k + 3];
        a0 = b0; a1 = b1; a2 = b2; a3 = b3;
      }
      var ks = SB[a0 >>> 24] ^ (rk[40] >>> 24), d = data[i], c;
      if (decrypt) { c = d; out[i] = d ^ ks; } else { c = d ^ ks; out[i] = c; }
      s0 = (s0 << 8) | (s1 >>> 24); s1 = (s1 << 8) | (s2 >>> 24); s2 = (s2 << 8) | (s3 >>> 24); s3 = (s3 << 8) | c;
    }
    this.s0 = s0; this.s1 = s1; this.s2 = s2; this.s3 = s3;
    return out;
  };

  /* ---------- RSA (PKCS#1 v1.5 encryption with the server's public key) with BigInt: WebCrypto only offers OAEP ---------- */
  function tlv(b, p) {
    if (p + 2 > b.length) throw new Error("bad public key");
    var tag = b[p], l = b[p + 1], q = p + 2;
    if (l & 128) { var n = l & 127; if (n < 1 || n > 3 || q + n > b.length) throw new Error("bad public key"); l = 0; for (var i = 0; i < n; i++) l = l * 256 + b[q++]; }
    if (q + l > b.length) throw new Error("bad public key");
    return { tag: tag, s: q, e: q + l };
  }
  function rsaKey(spki) {                                                          // SubjectPublicKeyInfo { AlgorithmIdentifier, BIT STRING { RSAPublicKey { n, e } } }
    var top = tlv(spki, 0), alg = tlv(spki, top.s), bits = tlv(spki, alg.e);
    if (top.tag !== 48 || alg.tag !== 48 || bits.tag !== 3) throw new Error("the server's key is not an RSA key");
    var rsa = tlv(spki, bits.s + 1), n = tlv(spki, rsa.s), e = tlv(spki, n.e);
    if (rsa.tag !== 48 || n.tag !== 2 || e.tag !== 2) throw new Error("the server's key is not an RSA key");
    var nb = spki.subarray(n.s, n.e);
    while (nb.length && nb[0] === 0) nb = nb.subarray(1);
    return { n: nb, e: spki.subarray(e.s, e.e) };
  }
  function bigOf(u8) { var h = ""; for (var i = 0; i < u8.length; i++) h += (u8[i] < 16 ? "0" : "") + u8[i].toString(16); return BigInt("0x" + (h || "0")); }
  function bytesOf(v, len) { var h = v.toString(16); while (h.length < len * 2) h = "0" + h; var o = new Uint8Array(len); for (var i = 0; i < len; i++) o[i] = parseInt(h.substr(h.length - 2 * (len - i), 2), 16); return o; }
  function modPow(b, e, m) { var r = BigInt(1), zero = BigInt(0), one = BigInt(1); b = b % m; while (e > zero) { if (e & one) r = (r * b) % m; e = e >> one; b = (b * b) % m; } return r; }
  function rsaEncrypt(spki, data) {
    var k = rsaKey(spki), kl = k.n.length;
    if (kl < 64 || kl > 1024 || data.length > kl - 11) throw new Error("the server's key does not fit");
    var ps = new Uint8Array(kl - 3 - data.length), one = new Uint8Array(1), i;
    window.crypto.getRandomValues(ps);
    for (i = 0; i < ps.length; i++) while (ps[i] === 0) { window.crypto.getRandomValues(one); ps[i] = one[0]; }          // the padding has no zero byte
    var m = bigOf(cat(new Uint8Array([0, 2]), ps, new Uint8Array([0]), data));
    return bytesOf(modPow(m, bigOf(k.e), bigOf(k.n)), kl);
  }
  async function serverHash(serverId, secret, pub) {                               // Minecraft's session hash: SHA-1 read as a signed number, in hex
    var h = new Uint8Array(await subtle.digest("SHA-1", cat(serverId, secret, pub))), neg = (h[0] & 128) !== 0, i, hex = "";
    if (neg) { var c = 1; for (i = h.length - 1; i >= 0; i--) { var v = (~h[i] & 255) + c; h[i] = v & 255; c = v >> 8; } }
    for (i = 0; i < h.length; i++) hex += (h[i] < 16 ? "0" : "") + h[i].toString(16);
    return (neg ? "-" : "") + (hex.replace(/^0+/, "") || "0");
  }
  function parseRequest(packet) {                                                  // the whole packet: [length][id 1][server id][public key][verify token][should authenticate]
    var l = rdVar(packet, 0), id = l && rdVar(packet, l[1]);
    if (!l || !id || id[0] !== 1) throw new Error("not an Encryption Request");
    var p = id[1], end = l[1] + l[0];
    function bytes() {
      var n = rdVar(packet, p);
      if (!n || n[0] > 4096 || n[1] + n[0] > end) throw new Error("short Encryption Request");
      p = n[1] + n[0];
      return packet.slice(n[1], p);
    }
    var serverId = bytes(), pub = bytes(), token = bytes();
    return { serverId: serverId, pub: pub, token: token, auth: p < end ? packet[p] !== 0 : true };
  }

  /* ---------- one stream (one Minecraft connection inside a Wisp WebSocket) ----------
   * idle    reading the game's handshake                   -> pass (a status ping, off, failed before) or login
   * login   waiting for the server's first packet          -> req (it is an Encryption Request) or pass
   * req     collecting the Encryption Request (the game never sees it)
   * joining Mojang's session join is under way (what the game sends now is held)
   * pipe    encrypted both ways (the game and net.js see the plain bytes)        dead / closed: nothing more happens */
  function Stream(conn, id, host, port) {
    this.conn = conn; this.id = id; this.host = host; this.port = port;
    this.state = "idle"; this.obuf = EMPTY; this.req = EMPTY; this.reqLen = 0; this.held = []; this.enc = null; this.dec = null; this.timer = 0; this.key = host + ":" + port;
  }
  var SP = Stream.prototype;
  SP.sniff = function (payload) {                                                  // the game's first packet: the handshake
    var b = this.obuf = cat(this.obuf, payload);
    if (b.length > 2048) { this.state = "pass"; return; }
    var l = rdVar(b, 0);
    if (!l) return;
    if (l[0] < 1 || l[0] > 1024) { this.state = "pass"; return; }
    if (b.length < l[1] + l[0]) return;                                            // not complete yet
    var end = l[1] + l[0], id = rdVar(b, l[1]), proto = id && id[0] === 0 ? rdVar(b, id[1]) : null, hl = proto && rdVar(b, proto[1]);
    this.obuf = EMPTY;
    if (!proto || !hl || hl[1] + hl[0] + 2 >= end) { this.state = "pass"; return; }
    var next = rdVar(b, hl[1] + hl[0] + 2), name = dec.decode(b.subarray(hl[1], hl[1] + hl[0])).toLowerCase(), port = (b[hl[1] + hl[0]] << 8) | b[hl[1] + hl[0] + 1];
    if (!next || !(next[0] === 2 || next[0] === 3) || proto[0] < 47) { this.state = "pass"; return; }          // a status ping (1) or something else: the game's own business
    this.key = name + ":" + port;
    if (!cfg.on || failedNow(this.key)) {
      this.state = "pass";
      note("not reading " + this.key + (cfg.on ? ": the gate failed there before, the game does the login itself" : " (the gate is off)"));
      G.last = { server: this.key, state: "passed", message: cfg.on ? "left to the game after an earlier failure" : "the gate is off", at: Date.now() };
      return;
    }
    this.state = "login";
  };
  SP.out = function (payload, data) {                                              // a frame the game sends: the frame to send really, or null to hold it
    if (this.state === "idle") { this.sniff(payload); return data; }
    if (this.state === "pipe") return wisp(2, this.id, this.enc.crypt(payload, false));
    if (this.state === "req" || this.state === "joining") { this.held.push(payload.slice()); return null; }
    return data;
  };
  SP.incoming = function (e, u8) {                                                 // a DATA frame from the server
    var payload = u8.subarray(5);
    switch (this.state) {
      case "login": {
        var l, id;
        try { l = rdVar(payload, 0); id = l && rdVar(payload, l[1]); } catch (x) { l = null; }
        if (!l || !id) { this.state = "pass"; note("the first packet of " + this.key + " could not be read: left to the game"); return; }
        if (id[0] !== 1) { this.state = "pass"; note(this.key + " asks for no encryption (packet " + id[0] + "): the game goes on alone"); G.last = { server: this.key, state: "passed", message: "the server needs no encryption", at: Date.now() }; return; }
        this.state = "req"; this.reqLen = l[1] + l[0]; this.req = EMPTY;
      }
      /* falls through: the first piece of the request is collected like the others */
      case "req":
        e.__ocGateDrop = true;
        this.req = cat(this.req, payload);
        if (this.req.length >= this.reqLen) this.begin();
        return;
      case "joining":                                                               // the server spoke before we answered (it gave up on us): the game hears it as it is
        this.state = "dead"; clearTimeout(this.timer); note("the server sent " + payload.length + " bytes while the login was being answered");
        return;
      case "pipe": {
        var plain = this.dec.crypt(payload, true), out = new Uint8Array(5 + plain.length);
        out.set(u8.subarray(0, 5)); out.set(plain, 5);
        try { Object.defineProperty(e, "data", { value: out.buffer, configurable: true }); } catch (x) { e.__ocGateDrop = true; this.fail(new Error("cannot change a frame")); }
        return;
      }
      default: return;
    }
  };
  SP.begin = async function () {                                                   // the whole Encryption Request is here
    var st = this, conn = this.conn;
    this.state = "joining";
    try {
      var r = parseRequest(this.req), acct = OC.msauth && OC.msauth.active && OC.msauth.active();
      if (r.auth && !acct) throw userErr("Sign in to a Java account first (Multiplayer > Java account).");
      var secret = new Uint8Array(16);
      window.crypto.getRandomValues(secret);
      this.timer = setTimeout(function () { if (st.state === "joining") st.fail(userErr("The login took too long: the server or Mojang did not answer. Try again.")); }, 30000);
      note("taking over the login to " + this.key + (acct ? " as " + acct.name : ""));
      if (r.auth) {
        var hash = await serverHash(r.serverId, secret, r.pub);
        var j = await OC.msauth.joinServer(acct, hash, { via: function (host, port) { return OC.wisp.connectVia(conn.url, host, port); } });       // from the same tunnel as the game's connection
        if (st.state !== "joining") return;
        if (j.status !== 204) throw userErr("Mojang's session server refused the login for " + acct.name + " (" + j.status + (j.json && j.json.errorMessage ? ": " + String(j.json.errorMessage).slice(0, 120) : "") + "). Sign in again in OneClient if this keeps happening.");
      }
      var es = rsaEncrypt(r.pub, secret), et = rsaEncrypt(r.pub, r.token);
      if (st.state !== "joining") return;
      this.enc = new Cfb8(secret, secret); this.dec = new Cfb8(secret, secret);
      conn.api.send(wisp(2, this.id, mcFrame(1, cat(vint(es.length), es, vint(et.length), et))));          // the answer goes out in the clear: the server turns encryption on after reading it
      this.state = "pipe"; clearTimeout(this.timer);
      var held = this.held; this.held = [];
      held.forEach(function (p) { conn.api.send(wisp(2, st.id, st.enc.crypt(p, false))); });
      note("signed in to " + this.key + ": the connection is readable");
      G.last = { server: this.key, state: "reading", message: "", at: Date.now() };
      emit();
    } catch (e) { this.fail(e); }
  };
  SP.fail = function (e) {
    if (this.state === "dead" || this.state === "closed") return;
    var mine = !!(e && e.user), text = e && e.message || String(e);
    this.state = "dead"; clearTimeout(this.timer);
    if (!mine) { cfg.failed[this.key] = Date.now(); saveCfg(); }
    G.last = { server: this.key, state: "failed", message: text, at: Date.now() };
    note("login to " + this.key + " failed: " + text);
    emit();
    var msg = mine ? text : "OneClient could not take over the login to this server (" + text + "). Press Try again: the next join is left to the game, so the mods that read the server stay off there.";
    var id = this.id, api = this.conn.api;
    try { api.deliver(wisp(2, id, mcFrame(0, mcStr(JSON.stringify({ text: msg }))))); } catch (x) { /* the game is gone */ }          // the game shows this on its Disconnected screen
    setTimeout(function () { try { api.send(wisp(4, id, new Uint8Array([2]))); } catch (x) { /* closed */ } }, 250);
  };

  /* ---------- one WebSocket (one Wisp session) ---------- */
  function Conn(ws, url, api) { this.ws = ws; this.url = url; this.api = api; this.streams = {}; }
  Conn.prototype.outgoing = function (data) {
    var u8 = asU8(data);
    if (!u8 || u8.length < 5) return data;
    var type = u8[0], id = u32(u8, 1), st;
    if (type === 1) {                                                              // CONNECT: stream type, port, host
      if (u8.length > 8 && u8[5] === 1) {
        var host = ""; for (var i = 8; i < u8.length; i++) host += String.fromCharCode(u8[i]);
        this.streams[id] = new Stream(this, id, host.toLowerCase(), u8[6] | (u8[7] << 8));
      }
      return data;
    }
    st = this.streams[id];
    if (!st) return data;
    if (type === 4) { st.state = "closed"; clearTimeout(st.timer); delete this.streams[id]; return data; }
    if (type !== 2 || u8.length === 5) return data;
    return st.out(u8.subarray(5), data);
  };
  Conn.prototype.incoming = function (e) {
    var d = e.data;
    if (!(d instanceof ArrayBuffer) || d.byteLength < 5) return;
    var u8 = new Uint8Array(d), type = u8[0], st = this.streams[u32(u8, 1)];
    if (!st) return;
    if (type === 4) { if (st.state !== "closed") { clearTimeout(st.timer); if (st.state === "joining" || st.state === "req") note("the server closed the connection during the login"); st.state = "closed"; } return; }
    if (type === 2 && u8.length > 5) st.incoming(e, u8);
  };

  OC.net.setGate({
    attach: function (ws, url, api) {                                              // a socket the game opened: is it a Java-account tunnel with the built-in sign-in?
      var A = OC.account;
      if (!cfg.on || !A || !OC.msauth || typeof A.provider !== "function" || A.provider() !== "browser" || typeof A.wispUrl !== "function" || url !== A.wispUrl()) return null;
      return new Conn(ws, url, api);
    }
  });
  G._test = { Cfb8: Cfb8, rsaEncrypt: rsaEncrypt, serverHash: serverHash, parseRequest: parseRequest, Conn: Conn, cfg: cfg };
})();
