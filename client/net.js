/* OneClient network layer: the game's own protocol traffic, seen from the browser.
 *
 * Singleplayer runs the game's server in a Web Worker. Game and server talk the real Minecraft protocol (26.2 is protocol 776) as
 *   postMessage({ ch: "~!SVDATA", dat: ArrayBuffer })   in both directions;
 * a message holds frames [u32 little-endian length][VarInt packet id + fields]. Nothing is compressed or encrypted.
 * This file only LISTENS (it never changes or drops a packet): it follows the connection through handshake, login, configuration and
 * play, and hands packets to listeners. It can also send serverbound packets the way the client does (the server cannot tell).
 *
 * OC.net.on("in" | "out", id, fn)        play-state packets: fn(reader) with the reader just after the packet id
 * OC.net.onConfig("in" | "out", id, fn)  the same for the configuration state (registries, tags)
 * OC.net.onState(fn)                     fn(state, prev) when the connection state changes: "none" "login" "config" "play"
 * OC.net.send(id, bytes)                 a serverbound play packet; OC.net.command("time set day") runs a command as the player
 * OC.net.Reader                          the packet reader (varint, varlong, string, i32, i64, f32, f64, bytes ...)
 * Packet ids below are those of protocol 776. Another protocol version switches the layer off (OC.net.supported = false). */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC || typeof Worker !== "function") return;

  var PROTOCOL = 776;
  var CH = "~!SVDATA";
  var dec = new TextDecoder("utf-8");

  /* ---------- the packet reader ---------- */
  function Reader(u8, pos, end) {
    this.b = u8; this.p = pos || 0; this.end = end === undefined ? u8.length : end;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }
  var RP = Reader.prototype;
  RP.left = function () { return this.end - this.p; };
  RP.u8 = function () { return this.b[this.p++]; };
  RP.i8 = function () { return (this.b[this.p++] << 24) >> 24; };
  RP.bool = function () { return this.b[this.p++] !== 0; };
  RP.u16 = function () { var v = this.dv.getUint16(this.p); this.p += 2; return v; };
  RP.i16 = function () { var v = this.dv.getInt16(this.p); this.p += 2; return v; };
  RP.i32 = function () { var v = this.dv.getInt32(this.p); this.p += 4; return v; };
  RP.f32 = function () { var v = this.dv.getFloat32(this.p); this.p += 4; return v; };
  RP.f64 = function () { var v = this.dv.getFloat64(this.p); this.p += 8; return v; };
  RP.i64 = function () { var v = this.dv.getBigInt64(this.p); this.p += 8; return v; };         // BigInt
  RP.varint = function () {
    var v = 0, s = 0, c;
    do { if (this.p >= this.end || s > 28) throw new RangeError("bad VarInt"); c = this.b[this.p++]; v |= (c & 127) << s; s += 7; } while (c & 128);
    return v;
  };
  RP.varlong = function () {                                                                        // as a Number (exact below 2^53)
    var v = 0, m = 1, c, n = 0;
    do { if (this.p >= this.end || n++ > 9) throw new RangeError("bad VarLong"); c = this.b[this.p++]; v += (c & 127) * m; m *= 128; } while (c & 128);
    return v;
  };
  RP.bytes = function (n) { if (n < 0 || this.p + n > this.end) throw new RangeError("packet is shorter than it says"); var r = this.b.subarray(this.p, this.p + n); this.p += n; return r; };
  RP.skip = function (n) { if (n < 0 || this.p + n > this.end) throw new RangeError("packet is shorter than it says"); this.p += n; };
  RP.string = function () { var n = this.varint(); return dec.decode(this.bytes(n)); };
  RP.uuid = function () { var b = this.bytes(16), s = ""; for (var i = 0; i < 16; i++) { s += (b[i] < 16 ? "0" : "") + b[i].toString(16); if (i === 3 || i === 5 || i === 7 || i === 9) s += "-"; } return s; };
  RP.nbt = function () { return readNbt(this); };                                                  // network NBT (the root compound has no name); strings only for text values
  function readNbt(r) { var t = r.u8(); return t === 0 ? null : nbtPayload(r, t); }
  function nbtPayload(r, t) {
    var n, i, o, a;
    switch (t) {
      case 1: return r.i8();
      case 2: return r.i16();
      case 3: return r.i32();
      case 4: return Number(r.i64());
      case 5: return r.f32();
      case 6: return r.f64();
      case 7: n = r.i32(); r.skip(n); return null;
      case 8: n = r.u16(); return dec.decode(r.bytes(n));
      case 9: { var et = r.u8(); n = r.i32(); a = []; for (i = 0; i < n; i++) a.push(nbtPayload(r, et)); return a; }
      case 10: { o = {}; for (;;) { var tt = r.u8(); if (tt === 0) break; var nm = nbtPayload(r, 8); o[nm] = nbtPayload(r, tt); } return o; }
      case 11: n = r.i32(); r.skip(n * 4); return null;
      case 12: n = r.i32(); r.skip(n * 8); return null;
      default: throw new Error("bad NBT tag " + t);
    }
  }

  /* ---------- state and listeners ---------- */
  var net = OC.net = {
    supported: true, protocol: 0, state: "none", Reader: Reader, PROTOCOL: PROTOCOL, active: false, transport: "", server: null,     // transport: "singleplayer" (the game's own server) | "server"; server: { host, port, transport } of the last login handshake
    IDS: {
      cb: { containerSetContent: 18, containerClose: 17, openScreen: 59, recipeBookSettings: 76, cooldown: 22, setEntityData: 99, respawn: 82, playerCombatKill: 68, addEntity: 1, blockUpdate: 8, chunkBatchFinished: 11, chunkBatchStart: 12, commandSuggestions: 15, commands: 16, containerSetSlot: 20, damageEvent: 25, disguisedChat: 33, entityEvent: 34, entityPositionSync: 35, forgetChunk: 37, gameEvent: 38, chunkWithLight: 45, login: 49, moveEntityPos: 53, moveEntityPosRot: 54, moveEntityRot: 56, playerAbilities: 64, playerInfoUpdate: 70, playerPosition: 72, removeEntities: 77, removeMobEffect: 78, rotateHead: 83, sectionBlocksUpdate: 84, setExperience: 103, setHealth: 104, setHeldSlot: 105, setTime: 113, systemChat: 121, updateMobEffect: 132 },
      sb: { containerClose: 19, containerClick: 18, recipeBookSettings: 46, setCarriedItem: 53, useItem: 67, attack: 1, chat: 9, chatCommand: 7, chatCommandSigned: 8, commandSuggestion: 15, tickEnd: 13, movePlayerPos: 30, movePlayerPosRot: 31, movePlayerRot: 32, movePlayerStatus: 33, swing: 63 }
    }
  };
  var play = { "in": {}, "out": {} }, config = { "in": {}, "out": {} }, login = { "in": {}, "out": {} }, stateSubs = [];

  function addTo(table, dir, id, fn) {
    var list = table[dir][id] || (table[dir][id] = []);
    var rec = { fn: fn, fails: 0 };
    list.push(rec);
    return function () { var i = list.indexOf(rec); if (i >= 0) list.splice(i, 1); };
  }
  net.on = function (dir, id, fn) { return addTo(play, dir, id, fn); };
  net.onConfig = function (dir, id, fn) { return addTo(config, dir, id, fn); };
  net.onLogin = function (dir, id, fn) { return addTo(login, dir, id, fn); };
  net.onState = function (fn) { stateSubs.push(fn); return function () { var i = stateSubs.indexOf(fn); if (i >= 0) stateSubs.splice(i, 1); }; };

  function setState(s) {
    if (net.state === s) return;
    var prev = net.state; net.state = s; net.active = s === "play";
    stateSubs.slice().forEach(function (fn) { try { fn(s, prev); } catch (e) { warn("state listener", e); } });
  }
  function warn(what, e) { try { console.warn("[OneClient net] " + what + ": " + (e && e.message || e)); } catch (x) {} }

  function dispatch(table, dir, id, u8, start, end) {
    var list = table[dir][id];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      try { rec.fn(new Reader(u8, start, end)); }
      catch (e) { if (++rec.fails === 5) { warn("listener for packet " + dir + " " + id + " failed five times, removed", e); list.splice(i--, 1); } else warn("listener for packet " + dir + " " + id, e); }
    }
  }

  /* a handshake is the first serverbound packet of a connection: id 0, protocol, address, port, intent (2 login, 3 transfer) */
  function looksLikeHandshake(r, len) {
    try {
      var proto = r.varint(), host = r.string(), port = r.u16(), intent = r.varint();
      return r.p === r.end && proto > 700 && proto < 1000 && host.length < 256 && (intent === 1 || intent === 2 || intent === 3) ? { proto: proto, intent: intent, host: host, port: port } : null;
    } catch (e) { return null; }
  }

  function onFrame(dir, u8, start, end, ctx) {
    var r = new Reader(u8, start, end), id = r.varint();
    var s = net.state;
    if (dir === "out" && id === 0 && end - start >= 8) {                                  // a new connection starts here
      var hs = looksLikeHandshake(new Reader(u8, r.p, end), end - start);
      if (hs) {
        net.protocol = hs.proto; net.supported = hs.proto === PROTOCOL; if (hs.intent !== 1) net.encrypted = false;
        if (hs.intent !== 1) net.server = { host: String(hs.host).toLowerCase(), port: hs.port, transport: ctx ? "server" : "singleplayer" };      // who the player is joining (the server profiles use it)
        setState("none"); setState(hs.intent === 1 ? "status" : "login"); return;
      }
    }
    if (!net.supported) return;
    if (s === "login") {
      if (ctx && dir === "in") {
        if (id === 1) ctx.encrypted();                                                      // the server wants the connection encrypted: from here on it cannot be read
        else if (id === 3) { try { ctx.compression(new Reader(u8, r.p, end).varint()); } catch (e) { /* ignore */ } }     // set_compression: the threshold
      }
      dispatch(login, dir, id, u8, r.p, end);
      if (dir === "out" && id === 3) setState("config");                                    // login acknowledged
      return;
    }
    if (s === "config") {
      dispatch(config, dir, id, u8, r.p, end);
      if (dir === "out" && id === 3) setState("play");                                      // finish configuration acknowledged
      return;
    }
    if (s === "play") dispatch(play, dir, id, u8, r.p, end);
  }

  /* messages: [u32 LE length][packet] ... */
  function onMessage(dir, buf) {
    var u8 = new Uint8Array(buf), p = 0, n = u8.length;
    net.transport = "singleplayer";
    while (p + 4 <= n) {
      var len = (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0;
      p += 4;
      if (len === 0 || p + len > n) return;                                                 // not our framing: leave it alone
      try { onFrame(dir, u8, p, p + len); } catch (e) { warn("frame", e); }
      p += len;
    }
  }

  /* ---------- hooking the worker that carries the traffic ---------- */
  var origPost = Worker.prototype.postMessage, tapped = new WeakSet(), server = null;
  Worker.prototype.postMessage = function (msg, transfer) {
    try {
      if (!tapped.has(this)) {
        tapped.add(this);
        EventTarget.prototype.addEventListener.call(this, "message", function (e) {
          var d = e.data;
          if (d && d.ch === CH && d.dat instanceof ArrayBuffer) { server = e.target; onMessage("in", d.dat); }
        });
      }
      if (msg && msg.ch === CH && msg.dat instanceof ArrayBuffer) { server = this; lastSv = performance.now(); onMessage("out", msg.dat); }
      else if (msg && msg.ch === "~!IPC" && msg.dat && msg.dat.byteLength === 1) net.leftAt = performance.now();
    } catch (e) { warn("tap", e); }
    return origPost.apply(this, arguments);
  };

  /* ---------- is the game talking to a server right now? ----------
   * Without reading a single packet: while a world is open the game sends something every tick (20 times a second), to its own server worker
   * (singleplayer) or over the WebSocket of the server it joined. When that stops, the game has left the world. */
  var lastSv = 0, wsOpen = new Set();
  net.connected = function (ms) {
    var t = performance.now();
    if (t - lastSv < ms) return true;
    var any = false;
    wsOpen.forEach(function (ws) { if (ws.readyState === 1 && t - (ws.__ocLast || 0) < ms) any = true; });
    return any;
  };
  /* leaving a world is visible too: singleplayer sends the world worker a one-byte message on its control channel, a server connection is closed */
  net.leftAt = 0;
  net.canWatch = function () { return (net.state === "play" && net.transport === "singleplayer") || net.connected(400); };

  /* ---------- servers: the WebSocket the game opens ----------
   * A server connection (relay, EaglerX, Wisp) carries the same Minecraft protocol over a WebSocket. What passes is read the way the worker's
   * messages are, with the three differences a real connection has:
   *   framing      the bytes of a TCP-like stream: [VarInt length][packet] (a message may hold several packets, or part of one);
   *                or one bare packet per message (EaglerX style); or the same stream inside Wisp DATA frames. Found out from the handshake.
   *   compression  after the server's set_compression packet every packet is [VarInt length][VarInt data length][packet, deflated when data length > 0]
   *   encryption   an online-mode server asks the client to encrypt the connection: the keys never leave the game, so from there on the
   *                traffic cannot be read (OC.net.encrypted = true, no packets are delivered, mods that need packets show nothing)
   * Everything here only LISTENS, except net.send, which writes serverbound packets in the framing the connection uses. */
  var wsLog = net.wsLog = [], RealWS = window.WebSocket, conns = new WeakMap(), activeConn = null, EMPTY = new Uint8Array(0);
  net.encrypted = false;
  /* The login gate (client/gate.js) sits inside this tap: for a Java-account server it answers the encryption request itself, so the connection the
   * game and this layer see is plain. It gets every Wisp frame the game sends (outgoing(data): the frame to really send, or null to hold it back) and
   * every frame the server sends, before anything else reads it (incoming(event): it may swap event.data, or mark the event dropped). */
  var gateHook = null, gates = new WeakMap();
  net.setGate = function (g) { gateHook = g; };
  function sendRaw(ws, data) {                                                              // a frame to the server: through the gate (it may encrypt or hold it), then the real send
    var gs = gates.get(ws);
    if (gs) { try { data = gs.outgoing(data); } catch (e) { warn("gate", e); } if (data === null) return; }
    return wsSend.call(ws, data);
  }
  function toU8(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;                                                                            // text and Blob messages carry no packets
  }
  function isWispConnect(u8) {                                                              // CONNECT: type 1, stream id (u32), stream type (1 TCP / 2 UDP), port (u16), host name
    if (u8.length < 9 || u8[0] !== 1 || (u8[5] !== 1 && u8[5] !== 2)) return false;
    for (var i = 8; i < u8.length; i++) if (u8[i] < 33 || u8[i] > 126) return false;
    return true;
  }
  function detectMode(u8) {                                                                 // is this the handshake the client opens a Minecraft connection with? "a" (length first), "b" (a bare packet) or ""
    var r, id;
    try {
      r = new Reader(u8, 0, u8.length);
      var len = r.varint();
      if (len > 0 && len <= u8.length - r.p) {
        var end = r.p + len;
        id = r.varint();
        if (id === 0 && looksLikeHandshake(new Reader(u8, r.p, end), len)) return "a";
      }
    } catch (e) { /* not that */ }
    try {
      r = new Reader(u8, 0, u8.length);
      if (r.varint() === 0 && looksLikeHandshake(new Reader(u8, r.p, u8.length), u8.length)) return "b";
    } catch (e) { /* not that either */ }
    return "";
  }
  function concat(a, b) { if (!a.length) return b; var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  function inflate(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }

  function connOf(ws) {
    var c = conns.get(ws);
    if (!c) { c = { ws: ws, mode: "", wisp: false, wispId: [0, 0, 0, 0], comp: -1, dead: false, buf: { "in": EMPTY, out: EMPTY }, chain: Promise.resolve(), queued: false }; conns.set(ws, c); }
    return c;
  }
  function wsData(ws, dir, data) {
    var u8 = toU8(data);
    if (!u8 || !u8.length) return;
    var c = connOf(ws);
    if (c.dead) return;
    if (!c.mode && !c.wisp) {
      if (dir !== "out") return;                                                            // a connection starts with what the client sends
      if (isWispConnect(u8)) { c.wisp = true; c.mode = "a"; c.wispId = [u8[1], u8[2], u8[3], u8[4]]; return; }
      var m = detectMode(u8);
      if (!m) return;                                                                       // something else first (a custom handshake): keep waiting for the Minecraft handshake
      c.mode = m;
    }
    if (c.wisp) {
      if (u8[0] !== 2 || u8.length <= 5) return;                                            // only DATA frames carry the stream
      u8 = u8.subarray(5);
    }
    if (c.mode === "a") feed(c, dir, u8); else body(c, dir, u8);
  }
  function feed(c, dir, u8) {                                                               // a TCP-like stream: cut it into [length][packet]
    var buf = concat(c.buf[dir], u8), p = 0;
    while (p < buf.length) {
      var len = 0, shift = 0, q = p, ok = false;
      while (q < buf.length && shift <= 28) { var b = buf[q++]; len |= (b & 127) << shift; shift += 7; if (!(b & 128)) { ok = true; break; } }
      if (!ok || q + len > buf.length) break;                                               // not all of it yet
      if (len > 0) body(c, dir, buf.subarray(q, q + len));
      p = q + len;
    }
    c.buf[dir] = p >= buf.length ? EMPTY : buf.slice(p);
  }
  function body(c, dir, frame) {
    if (c.comp < 0 && !c.queued) { packet(c, dir, frame); return; }
    c.queued = true;                                                                        // once compression is on, everything goes through one queue so the order of the two directions is kept
    var comp = c.comp;
    c.chain = c.chain.then(function () {
      if (comp < 0 || c.comp < 0) return packet(c, dir, frame);
      var r = new Reader(frame, 0, frame.length), dl = r.varint(), rest = frame.subarray(r.p);
      if (dl === 0) return packet(c, dir, rest);
      return inflate(rest).then(function (u8) { packet(c, dir, u8); });
    }).catch(function (e) { warn("compressed packet", e); });
  }
  function packet(c, dir, u8) {
    if (c.dead || !u8.length) return;
    try {
      onFrame(dir, u8, 0, u8.length, {
        compression: function (t) { c.comp = t; },
        encrypted: function () { c.dead = true; net.encrypted = true; setState("none"); net.active = false; }
      });
    } catch (e) { warn("frame", e); }
    if (!c.dead && (net.state === "login" || net.state === "config" || net.state === "play")) { activeConn = c; net.transport = "server"; }      // a server list ping (status) never takes over
  }
  function wsGone(ws) {
    var c = conns.get(ws);
    if (c && activeConn === c) { activeConn = null; setState("none"); net.transport = ""; }
  }

  if (typeof RealWS === "function") {
    var wsSend = RealWS.prototype.send;
    RealWS.prototype.send = function (data) {
      if (this.__ocQuiet) return wsSend.apply(this, arguments);                             // OneClient's own status queries are nobody's traffic
      this.__ocLast = performance.now();
      try { wsData(this, "out", data); } catch (e) { warn("websocket", e); }
      try { rwOut(this, data); } catch (e) { warn("websocket", e); }
      try { if (net.debugWs) record(this, "out", data); } catch (e) {}
      if (gates.has(this)) return sendRaw(this, data);                                      // the tap above read the plain frame; the gate may encrypt what really goes out
      return wsSend.apply(this, arguments);
    };
    var wsClose = RealWS.prototype.close;
    RealWS.prototype.close = function () { if (wsOpen.has(this) && this.readyState === 1 && performance.now() - (this.__ocLast || 0) < 2000) net.leftAt = performance.now(); return wsClose.apply(this, arguments); };
    var wsAdd = RealWS.prototype.addEventListener;
    window.WebSocket = new Proxy(RealWS, { construct: function (target, args) {
      var ws = Reflect.construct(target, args);
      try {
        ws.__ocUrl = String(args[0]); wsOpen.add(ws); net.wsUrl = ws.__ocUrl;
        var gs = gateHook ? gateHook.attach(ws, ws.__ocUrl, { send: function (d) { return wsSend.call(ws, d); }, deliver: function (u8) { rwDeliver(ws, u8); } }) : null;
        if (gs) { gates.set(ws, gs); wsAdd.call(ws, "message", function (e) { try { gs.incoming(e); } catch (x) { warn("gate", x); } }); }       // first in line: everything after it sees what the gate made of the frame
        wsAdd.call(ws, "message", function (e) { if (e.__ocGateDrop) return; try { wsData(ws, "in", e.data); } catch (x) { warn("websocket", x); } if (net.debugWs) record(ws, "in", e.data); });
        wsAdd.call(ws, "open", function () { if (net.debugWs) wsLog.push({ ev: "open", url: ws.__ocUrl, t: Date.now() }); });
        wsAdd.call(ws, "close", function (e) { if (net.wsUrl === ws.__ocUrl) net.wsUrl = ""; if (performance.now() - (ws.__ocLast || 0) < 2000) net.leftAt = performance.now(); wsOpen.delete(ws); wsGone(ws); if (net.debugWs) wsLog.push({ ev: "close", url: ws.__ocUrl, code: e.code, t: Date.now() }); });
        wsAdd.call(ws, "error", function () { wsOpen.delete(ws); wsGone(ws); });
      } catch (e) {}
      return ws;
    } });
    function record(ws, dir, data) {
      var n = data && (data.byteLength !== undefined ? data.byteLength : data.size !== undefined ? data.size : String(data).length);
      var rec = { dir: dir, url: ws.__ocUrl, len: n, t: Date.now() };
      if (data instanceof ArrayBuffer) rec.b = new Uint8Array(data.slice(0, 64)); else if (ArrayBuffer.isView(data)) rec.b = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + Math.min(64, data.byteLength))); else if (typeof data === "string") rec.s = data.slice(0, 200);
      wsLog.push(rec); if (wsLog.length > 300) wsLog.shift();
    }
    /* serverbound packets on a server connection, in the framing the game itself uses on it */
    net._serverSend = function (frames) {
      var c = activeConn;
      if (!c || c.dead || c.ws.readyState !== 1 || !net.active) return false;
      for (var f = 0; f < frames.length; f++) {
        var bodyBytes = frames[f];
        if (c.comp >= 0) { if (bodyBytes.length >= c.comp) return false; bodyBytes = [0].concat(bodyBytes); }       // data length 0: not compressed (ours are small)
        var out = c.mode === "a" ? vi(bodyBytes.length, []).concat(bodyBytes) : bodyBytes;
        var u8 = new Uint8Array(out);
        if (c.wisp) { var w = new Uint8Array(5 + u8.length); w[0] = 2; w.set(c.wispId, 1); w.set(u8, 5); u8 = w; }
        sendRaw(c.ws, u8.buffer);
      }
      return true;
    };
  }

  /* ---------- changing what the game receives ----------
   * The game listens to its server worker with addEventListener("message"). A listener we put in front of it can pass the game a changed
   * copy of a message: OC.net.rewrite(id, fn) calls fn(reader) for every clientbound play packet with that id, before the game sees it;
   * fn returns undefined (leave it), false (drop it) or the new fields of the packet (an array / Uint8Array: everything after the id).
   * OC.net.inject(id, fields) hands the game a packet it never got from the server. Listeners of OC.net.on() still see the original traffic. */
  var rewriters = {}, gameCall = new WeakMap(), wrapMap = new WeakMap();
  net.rewrite = function (id, fn) {
    (rewriters[id] = rewriters[id] || []).push(fn);
    return function () { var l = rewriters[id], i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); };
  };
  function anyRewriters() { for (var k in rewriters) if (rewriters[k].length) return true; return false; }
  function frameOf(id, fields) { var b = vi(id, []); for (var i = 0; i < fields.length; i++) b.push(fields[i]); return b; }
  /* the rewriters of one packet id run over its fields: false = drop it, a Uint8Array = the new fields, null = nobody changed anything */
  function applyRewriters(id, fields) {
    var list = rewriters[id], body = null;
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var res;
      try { res = list[i](new Reader(fields, 0, fields.length)); } catch (e) { warn("rewriter for packet " + id, e); continue; }
      if (res === false) return false;
      if (res && res.length !== undefined) { fields = res instanceof Uint8Array ? res : new Uint8Array(res); body = fields; }
    }
    return body;
  }
  function joinFrames(frames) {
    var total = 0, i, p = 0;
    frames.forEach(function (f) { total += 4 + f.length; });
    var out = new Uint8Array(total);
    frames.forEach(function (f) { var n = f.length; out[p++] = n & 255; out[p++] = (n >> 8) & 255; out[p++] = (n >> 16) & 255; out[p++] = (n >> 24) & 255; for (i = 0; i < n; i++) out[p++] = f[i]; });
    return out.buffer;
  }
  /* the frames of a message with the rewriters applied: the new buffer, null when nothing changed, or an empty buffer when everything was dropped */
  function rewriteMessage(buf) {
    var u8 = new Uint8Array(buf), p = 0, n = u8.length, frames = [], changed = false;
    while (p + 4 <= n) {
      var len = (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0;
      if (len === 0 || p + 4 + len > n) return null;
      var start = p + 4, end = start + len, r = new Reader(u8, start, end), id = r.varint();
      var body = applyRewriters(id, u8.subarray(r.p, end));
      if (body === false) changed = true;
      else if (body) { frames.push(frameOf(id, body)); changed = true; }
      else frames.push(u8.subarray(start, end));
      p = end;
    }
    return changed ? joinFrames(frames) : null;
  }
  function fakeEvent(e, data) { try { return new MessageEvent("message", { data: data, origin: e.origin || "", lastEventId: e.lastEventId || "", ports: e.ports ? Array.prototype.slice.call(e.ports) : [] }); } catch (x) { return { data: data, target: e.target, type: "message" }; } }
  var tapAdd = EventTarget.prototype.addEventListener, tapRemove = EventTarget.prototype.removeEventListener;
  Worker.prototype.addEventListener = function (type, fn, opts) {
    if (type === "message" && fn && (typeof fn === "function" || typeof fn.handleEvent === "function")) {
      var self = this, call = typeof fn === "function" ? fn : function (e) { return fn.handleEvent(e); };
      var wrapped = function (e) {
        var out = e, d = e && e.data;
        if (d && d.ch === CH && d.dat instanceof ArrayBuffer && net.state === "play" && anyRewriters()) {
          try {
            var nb = rewriteMessage(d.dat);
            if (nb) { if (nb.byteLength === 0) return; out = fakeEvent(e, { ch: CH, dat: nb }); }
          } catch (x) { warn("rewrite", x); }
        }
        return call.call(this, out);
      };
      wrapMap.set(fn, wrapped);
      (gameCall.get(self) || (gameCall.set(self, []), gameCall.get(self))).push({ call: call, ctx: self });      // the game adds several listeners (files, packets ...): a packet goes to all of them, each takes what is its own
      return tapAdd.call(this, type, wrapped, opts);
    }
    return tapAdd.apply(this, arguments);
  };
  Worker.prototype.removeEventListener = function (type, fn, opts) {
    if (type === "message" && wrapMap.has(fn)) fn = wrapMap.get(fn);
    return tapRemove.call(this, type, fn, opts);
  };
  net.inject = function (id, fields) {
    if (net.transport === "server") return injectServer(id, fields);
    var g = server && gameCall.get(server);
    if (!g || !g.length || !net.active) return false;
    var ev = fakeEvent({}, { ch: CH, dat: joinFrames([frameOf(id, fields || [])]) }), ok = false;
    g.forEach(function (l) { try { l.call.call(l.ctx, ev); ok = true; } catch (e) { warn("inject", e); } });
    return ok;
  };
  net.worker = function () { return server; };

  /* ---------- the same on a SERVER connection ----------
   * What the server sends arrives as WebSocket messages. A listener put in front of the game's own (the same trick as for the worker) runs
   * the rewriters over the packets in each message and hands the game the changed bytes. Two things make it more careful than the worker:
   *   framing  a stream can cut a packet between two messages, so the stream is followed packet by packet; while a rewriter is active only
   *            complete packets go on (the rest waits for its other half), and when none is active everything goes on untouched and only the
   *            bookkeeping continues ("sent" = how much of the unfinished packet the game already has), so a mod can start at any moment;
   *   state    ids mean different things in login / configuration / play, so rewriting waits for the play state, which is known from the
   *            client's own acknowledgements (they are sent in the clear and in order).
   * Compressed packets (and an encrypted connection) are never touched: a changed packet goes out uncompressed (data length 0), which the
   * game accepts at any size. */
  var wsGame = new WeakMap(), wsWrap = new WeakMap(), wsEvt = new WeakMap();
  function newRw() { return { stage: "", buf: EMPTY, sent: 0, broken: false, queue: [] }; }
  function wsStage(c, body) {                                                               // one packet the CLIENT sent: where in the connection are we?
    var rw = c.rw || (c.rw = newRw()), r = new Reader(body, 0, body.length);
    if (c.comp >= 0 && r.varint() !== 0) return;
    var id = r.varint();
    if (id === 0 && r.left() >= 6 && looksLikeHandshake(new Reader(body, r.p, body.length), body.length)) { var hs = looksLikeHandshake(new Reader(body, r.p, body.length), body.length); rw.stage = hs.intent === 1 ? "status" : "login"; return; }
    if (rw.stage === "login" && id === 3) rw.stage = "config";                                // login acknowledged
    else if (rw.stage === "config" && id === 3) rw.stage = "play";                          // finish configuration acknowledged
  }
  function rwOut(ws, data) {
    var u8 = toU8(data), c = conns.get(ws);
    if (!u8 || !u8.length || !c || c.dead || !c.mode) return;
    if (c.wisp) { if (u8[0] !== 2 || u8.length <= 5) return; u8 = u8.subarray(5); }
    if (c.mode !== "a") { wsStage(c, u8); return; }
    for (var p = 0; p < u8.length;) {
      var len = 0, shift = 0, q = p, ok = false;
      while (q < u8.length && shift <= 28) { var b = u8[q++]; len |= (b & 127) << shift; shift += 7; if (!(b & 128)) { ok = true; break; } }
      if (!ok || q + len > u8.length) return;
      if (len > 0) wsStage(c, u8.subarray(q, q + len));
      p = q + len;
    }
  }
  function rwBody(c, body) {                                                                // one clientbound packet (after its length): null = leave, false = drop, else the new body
    var r = new Reader(body, 0, body.length), comp = c.comp >= 0;
    if (comp && r.varint() !== 0) return null;
    var id = r.varint(), res = applyRewriters(id, body.subarray(r.p));
    if (!res) return res;
    var nb = frameOf(id, res);
    return new Uint8Array(comp ? [0].concat(nb) : nb);
  }
  /* a message of a TCP-like stream through the tracker; returns the bytes to hand the game instead of the message, or null to hand it the message itself */
  function rwStream(c, rw, u8, active) {
    var stream = rw.buf.length ? concat(rw.buf, u8) : u8, p = 0, parts = [], changed = false, size = 0;
    while (p < stream.length) {
      var len = 0, shift = 0, q = p, ok = false;
      while (q < stream.length && shift <= 28) { var b = stream[q++]; len |= (b & 127) << shift; shift += 7; if (!(b & 128)) { ok = true; break; } }
      if (!ok) { if (shift > 28) rw.broken = true; break; }                                 // the length itself is not complete yet (or this is not a stream of packets)
      if (len < 0 || len > 16777216) { rw.broken = true; break; }
      if (q + len > stream.length) break;                                                   // the packet is not complete yet
      if (active) {
        var piece = stream.subarray(p, q + len);
        if (p === 0 && rw.sent > 0) piece = piece.subarray(rw.sent);                        // the game has the start of this one already: finish it as it is
        else if (len > 0) {
          var nb = rwBody(c, stream.subarray(q, q + len));
          if (nb === false) { piece = null; changed = true; }
          else if (nb) { var h = vi(nb.length, []); piece = new Uint8Array(h.length + nb.length); piece.set(h); piece.set(nb, h.length); changed = true; }
        }
        if (piece) { parts.push(piece); size += piece.length; }
      }
      p = q + len;
    }
    if (rw.broken) { var rest = stream.subarray(rw.sent), kept = stream !== u8; rw.buf = EMPTY; rw.sent = 0; return kept ? rest : null; }
    var tail = stream.subarray(p);
    if (!active) {                                                                          // nothing to change: the game gets what it was still owed (bytes held back while a rewriter was on) and this message
      var owed = stream !== u8 && rw.sent < rw.buf.length ? stream.subarray(rw.sent) : null;
      rw.buf = tail.length ? tail.slice() : EMPTY; rw.sent = rw.buf.length;
      return owed;
    }
    rw.buf = tail.length ? tail.slice() : EMPTY;
    if (p > 0) rw.sent = 0;                                                                 // whatever follows the last complete packet has not been handed over
    if (!changed && stream === u8 && p === u8.length) return null;
    var out = new Uint8Array(size), at = 0;
    parts.forEach(function (pc) { out.set(pc, at); at += pc.length; });
    return out;
  }
  /* what the game should get for one incoming message event: { drop, data } (cached, several game listeners may ask) */
  function rwEvent(ws, e) {
    var hit = wsEvt.get(e);
    if (hit) return hit;
    var res = { drop: false, data: null };
    wsEvt.set(e, res);
    var c = conns.get(ws), rw = null;
    try {
      var data = e.data;
      if (ws.__ocQuiet || !c || c.dead || net.encrypted || !c.mode || !(data instanceof ArrayBuffer)) return res;
      rw = c.rw || (c.rw = newRw());
      if (rw.broken) return res;
      var u8 = new Uint8Array(data), active = rw.stage === "play" && anyRewriters() && c.comp !== 0, out = null;
      if (c.wisp) {
        if (u8.length > 5 && u8[0] === 2 && u8[1] === c.wispId[0] && u8[2] === c.wispId[1] && u8[3] === c.wispId[2] && u8[4] === c.wispId[3]) {
          var inner = rwStream(c, rw, u8.subarray(5), active);
          if (inner) { out = new Uint8Array(5 + inner.length); out.set(u8.subarray(0, 5)); out.set(inner, 5); if (!inner.length) out = new Uint8Array(0); }
        }
      } else if (c.mode === "a") out = rwStream(c, rw, u8, active);
      else if (active) { var nb = rwBody(c, u8); if (nb === false) out = new Uint8Array(0); else if (nb) out = nb; }
      if (out) { if (!out.length) res.drop = true; else res.data = out.byteOffset === 0 && out.buffer.byteLength === out.length ? out.buffer : out.slice().buffer; }
    } catch (x) {
      warn("rewrite", x);
      if (rw) {                                                                             // lost: from here the connection runs untouched; what was held back goes out with this message
        var held = rw.buf.subarray(rw.sent);
        rw.broken = true; rw.buf = EMPTY; rw.sent = 0;
        if (held.length && e.data instanceof ArrayBuffer) res.data = concat(held, new Uint8Array(e.data)).buffer;
      }
    }
    return res;
  }
  function wsFrameOf(c, id, fields) {                                                       // a clientbound packet in the framing this connection uses
    var body = frameOf(id, fields);
    if (c.comp >= 0) body = [0].concat(body);
    var u8 = new Uint8Array(c.mode === "a" ? vi(body.length, []).concat(body) : body);
    if (c.wisp) { var w = new Uint8Array(5 + u8.length); w[0] = 2; w.set(c.wispId, 1); w.set(u8, 5); u8 = w; }
    return u8;
  }
  function rwDeliver(ws, u8) {
    var g = wsGame.get(ws);
    if (!g) return;
    var buf = u8.buffer, ev;
    try { ev = new MessageEvent("message", { data: buf }); Object.defineProperty(ev, "target", { value: ws, configurable: true }); } catch (e) { ev = { type: "message", data: buf, target: ws }; }
    g.slice().forEach(function (l) { try { l.call.call(ws, ev); } catch (e) { warn("inject", e); } });
  }
  function rwFlush(c) {                                                                     // packets waiting to be handed to the game go out when no half packet is in the game's hands
    var rw = c.rw;
    while (rw && rw.queue.length && rw.sent === 0) rwDeliver(c.ws, rw.queue.shift());
  }
  function serverRewritable(c) { return !!(c && !c.dead && !net.encrypted && c.mode && c.rw && c.rw.stage === "play" && !c.rw.broken && c.comp !== 0); }
  function injectServer(id, fields) {
    var c = activeConn;
    if (!serverRewritable(c) || !wsGame.get(c.ws)) return false;
    c.rw.queue.push(wsFrameOf(c, id, fields || []));
    rwFlush(c);
    return true;
  }
  if (typeof RealWS === "function") {
    var wsRemove = RealWS.prototype.removeEventListener;
    function wrapMessage(ws, call) {
      return function (e) {
        if (e.__ocGateDrop) return;                                                          // the gate kept this frame from the game (it answers the encryption request itself)
        var r = rwEvent(ws, e);
        if (!r.drop) {
          if (r.data) { try { Object.defineProperty(e, "data", { value: r.data, configurable: true }); } catch (x) { /* the game gets the original */ } }
          call.call(this, e);
        }
        var c = conns.get(ws);
        if (c && c.rw && c.rw.queue.length) { try { rwFlush(c); } catch (x) { warn("inject", x); } }
      };
    }
    function listen(ws, call) { var l = { call: call }; (wsGame.get(ws) || (wsGame.set(ws, []), wsGame.get(ws))).push(l); return l; }
    function unlisten(ws, l) { var g = wsGame.get(ws), i = g ? g.indexOf(l) : -1; if (i >= 0) g.splice(i, 1); }
    RealWS.prototype.addEventListener = function (type, fn, opts) {
      if (type === "message" && !this.__ocQuiet && fn && (typeof fn === "function" || typeof fn.handleEvent === "function")) {
        var ws = this, call = typeof fn === "function" ? fn : function (e) { return fn.handleEvent(e); }, wrapped = wrapMessage(ws, call), l = listen(ws, call);
        (wsWrap.get(ws) || (wsWrap.set(ws, new WeakMap()), wsWrap.get(ws))).set(fn, { wrapped: wrapped, l: l });
        return wsAdd.call(this, type, wrapped, opts);
      }
      return wsAdd.apply(this, arguments);
    };
    RealWS.prototype.removeEventListener = function (type, fn, opts) {
      var m = type === "message" && wsWrap.get(this), rec = m && m.get(fn);
      if (rec) { unlisten(this, rec.l); m.delete(fn); fn = rec.wrapped; }
      return wsRemove.call(this, type, fn, opts);
    };
    var omDesc = Object.getOwnPropertyDescriptor(RealWS.prototype, "onmessage");
    if (omDesc && omDesc.set) Object.defineProperty(RealWS.prototype, "onmessage", {
      configurable: true, enumerable: omDesc.enumerable,
      get: function () { return this.__ocQuiet ? omDesc.get.call(this) : (this.__ocOnMsg || null); },
      set: function (fn) {
        if (this.__ocQuiet) { omDesc.set.call(this, fn); return; }
        if (this.__ocOnMsgW) { wsRemove.call(this, "message", this.__ocOnMsgW.wrapped); unlisten(this, this.__ocOnMsgW.l); this.__ocOnMsgW = null; }
        this.__ocOnMsg = fn;
        if (typeof fn === "function") { var ws = this, w = wrapMessage(ws, function (e) { return fn.call(ws, e); }); this.__ocOnMsgW = { wrapped: w, l: listen(ws, function (e) { return fn.call(ws, e); }) }; wsAdd.call(this, "message", w); }
      }
    });
    /* a connection that is OneClient's own (a server list query): not game traffic, never read or changed */
    net.openQuiet = function (url) { var ws = new RealWS(url); ws.__ocQuiet = true; return ws; };
  }
  /* rewrite / inject work on the singleplayer worker, and on a server connection that is not encrypted (and not compressing every packet) */
  Object.defineProperty(net, "canRewrite", { get: function () { return net.transport === "singleplayer" || (net.transport === "server" && serverRewritable(activeConn)); } });

  /* writing packet fields */
  net.Writer = function () { this.a = []; };
  var W = net.Writer.prototype;
  W.u8 = function (v) { this.a.push(v & 255); return this; };
  W.bool = function (v) { this.a.push(v ? 1 : 0); return this; };
  W.i16 = function (v) { this.a.push((v >> 8) & 255, v & 255); return this; };
  W.i32 = function (v) { this.a.push((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255); return this; };
  W.i64 = function (v) { var hi = Math.floor(v / 4294967296), lo = v >>> 0; this.a.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255); return this; };
  W.f32 = function (v) { var b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v); this.a.push(b[0], b[1], b[2], b[3]); return this; };
  W.f64 = function (v) { var b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); for (var i = 0; i < 8; i++) this.a.push(b[i]); return this; };
  W.varint = function (v) { vi(v >>> 0, this.a); return this; };
  W.varlong = function (v) { while (v >= 128) { this.a.push((v % 128) | 128); v = Math.floor(v / 128); } this.a.push(v); return this; };
  W.bytes = function (u8) { for (var i = 0; i < u8.length; i++) this.a.push(u8[i]); return this; };
  W.string = function (s) { net.encodeString(s, this.a); return this; };
  W.toU8 = function () { return new Uint8Array(this.a); };

  /* ---------- sending ---------- */
  function vi(n, out) { do { var b = n & 127; n >>>= 7; out.push(n ? b | 128 : b); } while (n); return out; }
  net.encodeString = function (s, out) { var b = new TextEncoder().encode(s); vi(b.length, out); for (var i = 0; i < b.length; i++) out.push(b[i]); return out; };
  net.send = function (id, bytes) {                                                         // bytes: array / Uint8Array of the fields after the id
    if (net.transport === "server") {
      var sb = vi(id, []);
      for (var k = 0; k < bytes.length; k++) sb.push(bytes[k]);
      return !!net._serverSend && net._serverSend([sb]);
    }
    if (!server || !net.active) return false;
    var body = vi(id, []);
    for (var i = 0; i < bytes.length; i++) body.push(bytes[i]);
    var n = body.length, buf = new Uint8Array(4 + n);
    buf[0] = n & 255; buf[1] = (n >> 8) & 255; buf[2] = (n >> 16) & 255; buf[3] = (n >> 24) & 255; buf.set(body, 4);
    origPost.call(server, { ch: CH, dat: buf.buffer }, [buf.buffer]);
    return true;
  };
  /* several packets in one message (a big batch of commands costs the server one wake-up, not hundreds) */
  net.sendMany = function (list) {                                                          // list: [[id, bytes], ...]
    if (net.transport === "server") {
      return !!net._serverSend && net._serverSend(list.map(function (it) { var b = vi(it[0], []); for (var i = 0; i < it[1].length; i++) b.push(it[1][i]); return b; }));
    }
    if (!server || !net.active || !list.length) return false;
    var parts = [], total = 0;
    list.forEach(function (it) { var body = vi(it[0], []); for (var i = 0; i < it[1].length; i++) body.push(it[1][i]); parts.push(body); total += 4 + body.length; });
    var buf = new Uint8Array(total), p = 0;
    parts.forEach(function (b) { var n = b.length; buf[p++] = n & 255; buf[p++] = (n >> 8) & 255; buf[p++] = (n >> 16) & 255; buf[p++] = (n >> 24) & 255; buf.set(b, p); p += n; });
    origPost.call(server, { ch: CH, dat: buf.buffer }, [buf.buffer]);
    return true;
  };
  /* a plain chat message, unsigned (message, timestamp, salt, no signature, last seen messages: offset, 20 acknowledged bits, checksum) */
  net.chat = function (text) {
    var out = net.encodeString(String(text).slice(0, 256), []), t = Date.now(), i;
    for (i = 7; i >= 0; i--) out.push(Math.floor(t / Math.pow(2, 8 * i)) & 255);            // timestamp, big endian
    for (i = 0; i < 8; i++) out.push(0);                                                    // salt
    out.push(0, 0, 0, 0, 0, 0);                                                             // no signature, offset 0, 3 bytes of acknowledged bits, checksum 0
    return net.send(net.IDS.sb.chat, out);
  };
  net.command = function (text) { return net.send(net.IDS.sb.chatCommand, net.encodeString(String(text).replace(/^\//, ""), [])); };
  net.commands = function (texts) { return net.sendMany(texts.map(function (t) { return [net.IDS.sb.chatCommand, net.encodeString(String(t).replace(/^\//, ""), [])]; })); };
})();
