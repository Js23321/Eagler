/* OneClient server status: how many players a server has, how fast it answers and its picture, for the cards of the Multiplayer page.
 * OneClient asks the servers itself (the game only pings its list while its own server list screen is open, and OneClient hides that screen):
 *   relay servers    the Minecraft server list ping through the relay: handshake (intent 1), status request, then a ping
 *   Java-account servers   the same ping, through the tunnel of OneClient Bridge (client/account.js: OC.account.openStream)
 *   EaglerX servers  the Eagler query: the text "Accept: MOTD", answered with JSON and, when the server has one, its 64 x 64 picture
 * The sockets are the page's own (OC.net.openQuiet): the packet layer neither reads nor changes them, and nothing is sent that a
 * normal list ping would not send. Results are kept in localStorage so the page shows the last known picture and numbers at once.
 *
 * OC.status.get(entry)               { state: "pending" | "online" | "stale" | "offline" | "unknown", online, max, ping, motd, version, icon, sample, at }
 * OC.status.refresh(entries, force)  query those servers (4 at a time; a result is reused for 25 s unless forced)
 * OC.status.onChange(fn)             fn(key of the server) whenever a result arrives
 * "entry" is a server of the list: { ip, rel: { base, target } | null, wisp: { base, target } | null, mode }. ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient, net = OC && OC.net;
  if (!OC || !net || typeof net.openQuiet !== "function") return;

  var S = OC.status = {}, cache = {}, subs = [], queue = [], running = 0, saveTimer = 0;
  var MAX_PAR = 4, TTL = 25000, TIMEOUT = 7000, STORE = "oneclient.status.v1", EMPTY = new Uint8Array(0);

  function key(e) { return String(e && e.ip || "").trim().toLowerCase().replace(/\/+$/, ""); }
  S.key = key;
  S.onChange = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };
  function emit(k) { subs.slice().forEach(function (fn) { try { fn(k); } catch (e) { /* a listener's problem */ } }); }
  S.get = function (e) { return cache[key(e)] || null; };

  /* what was known last time (shown as "stale" until the first answer of this visit) */
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "{}");
    Object.keys(saved).forEach(function (k) {
      var r = saved[k];
      if (r && typeof r === "object") { r.state = r.state === "online" ? "stale" : r.state === "offline" ? "offline" : "unknown"; cache[k] = r; }
    });
  } catch (e) { /* no memory of earlier visits */ }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var out = {}, cut = Date.now() - 30 * 86400000;
      Object.keys(cache).forEach(function (k) { var r = cache[k]; if (r.at && r.at > cut && (r.state === "online" || r.state === "stale" || r.state === "offline")) out[k] = { state: r.state, online: r.online, max: r.max, ping: r.ping, motd: r.motd, version: r.version, icon: r.icon && r.icon.length < 40000 ? r.icon : "", at: r.at }; });
      try { localStorage.setItem(STORE, JSON.stringify(out)); } catch (e) { /* storage full or blocked */ }
    }, 600);
  }

  /* ---------- small helpers ---------- */
  var SECTION = new RegExp(String.fromCharCode(167) + ".", "g");                    // the colour codes of server texts
  function plain(c) {                                                              // a chat component or a string -> plain text
    if (c == null) return "";
    if (typeof c === "string") return c.replace(SECTION, "");
    if (Array.isArray(c)) return c.map(plain).join("");
    if (typeof c === "object") return plain(c.text || "") + plain(c.extra || []);
    return String(c);
  }
  function vi(n, out) { do { var b = n & 127; n >>>= 7; out.push(n ? b | 128 : b); } while (n); return out; }
  function utf8(s) { return Array.prototype.slice.call(new TextEncoder().encode(s)); }
  function frame(body) { return vi(body.length, []).concat(body); }
  function concat(a, b) { if (!a.length) return b; var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  function readVi(u8, p) { var v = 0, s = 0, b; do { if (p.i >= u8.length || s > 28) return null; b = u8[p.i++]; v |= (b & 127) << s; s += 7; } while (b & 128); return v; }
  function pngUrl(u8) {                                                            // the server's picture: a PNG as it is, or 64 x 64 raw RGBA (the Eagler query)
    try {
      if (u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) { var s = ""; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return "data:image/png;base64," + btoa(s); }
      if (u8.length === 16384) {
        var c = document.createElement("canvas"); c.width = c.height = 64;
        var x = c.getContext("2d"), d = x.createImageData(64, 64); d.data.set(u8); x.putImageData(d, 0, 0);
        return c.toDataURL("image/png");
      }
    } catch (e) { /* no picture */ }
    return "";
  }

  /* ---------- a Minecraft server through the relay ---------- */
  function mcQuery(e, done) {
    var host = (e.rel || e.wisp).target, port = 25565, m = /^(.*):(\d{1,5})$/.exec(host);
    if (m) { host = m[1].replace(/^\[|\]$/g, ""); port = parseInt(m[2], 10); }
    var ws, buf = EMPTY, t0 = 0, tPing = 0, rtt = 0, info = null, opened = false, over = false, timer;
    function end(res) { if (over) return; over = true; clearTimeout(timer); try { ws.close(); } catch (x) { /* already closed */ } done(res); }
    function result(ping) { var r = info; r.state = "online"; r.ping = Math.max(1, Math.round(ping || rtt)); return r; }
    function giveUp(why) { end(info ? result(0) : { state: opened ? "unknown" : "offline", error: why }); }
    try { ws = e.rel ? net.openQuiet(e.ip) : OC.account.openStream(e.wisp.target); } catch (x) { return done({ state: "offline", error: "bad address" }); }
    ws.binaryType = "arraybuffer";
    timer = setTimeout(function () { giveUp("timed out"); }, TIMEOUT);
    ws.onopen = function () {
      opened = true; t0 = performance.now();
      var hs = [0].concat(vi(776, []), vi(utf8(host).length, []), utf8(host), [(port >> 8) & 255, port & 255], vi(1, []));
      ws.send(new Uint8Array(frame(hs).concat(frame([0]))).buffer);                  // handshake (next state: status) and the status request
    };
    ws.onmessage = function (ev) {
      if (!(ev.data instanceof ArrayBuffer)) return;
      buf = concat(buf, new Uint8Array(ev.data));
      for (;;) {
        var p = { i: 0 }, len = readVi(buf, p);
        if (len === null || p.i + len > buf.length) return;                           // not all of it yet
        var body = buf.subarray(p.i, p.i + len), q = { i: 0 }, id = readVi(body, q);
        buf = buf.slice(p.i + len);
        if (id === 0 && !info) {                                                      // the status: a JSON string
          try {
            var n = readVi(body, q), o = JSON.parse(new TextDecoder().decode(body.subarray(q.i, q.i + n))), pl = o.players || {}, v = o.version || {};
            info = { online: pl.online | 0, max: pl.max | 0, motd: plain(o.description), version: String(v.name || ""), icon: typeof o.favicon === "string" && o.favicon.indexOf("data:image/") === 0 ? o.favicon : "", sample: (pl.sample || []).map(function (s) { return plain(s && s.name); }).slice(0, 12), at: Date.now() };
          } catch (x) { return end({ state: "unknown", error: "unreadable answer" }); }
          rtt = performance.now() - t0; tPing = performance.now();
          var pingBody = [1, 0, 0, 0, 0, 0, 0, 0, 0];
          ws.send(new Uint8Array(frame(pingBody)).buffer);                            // the ping: its echo is the latency
        } else if (id === 1 && info) { return end(result(performance.now() - tPing)); }
      }
    };
    ws.onerror = function () { giveUp("connection failed"); };
    ws.onclose = function () { giveUp("closed"); };
  }

  /* ---------- an EaglerX server: the Eagler query ---------- */
  function eaglerQuery(e, done) {
    var ws, t0 = 0, info = null, icon = "", wantIcon = false, opened = false, over = false, timer, iconTimer;
    function end(res) { if (over) return; over = true; clearTimeout(timer); clearTimeout(iconTimer); try { ws.close(); } catch (x) { /* already closed */ } done(res); }
    function finish() { if (!info) return end({ state: opened ? "unknown" : "offline", error: opened ? "no answer" : "connection failed" }); if (icon) info.icon = icon; info.state = "online"; end(info); }
    try { ws = net.openQuiet(e.ip); } catch (x) { return done({ state: "offline", error: "bad address" }); }
    ws.binaryType = "arraybuffer";
    timer = setTimeout(finish, TIMEOUT);
    ws.onopen = function () { opened = true; t0 = performance.now(); ws.send("Accept: MOTD"); };
    ws.onmessage = function (ev) {
      if (typeof ev.data === "string") {
        var j;
        try { j = JSON.parse(ev.data); } catch (x) { return; }
        var d = j && j.data;
        if (!d || typeof d !== "object") return;
        var lines = Array.isArray(d.motd) ? d.motd : d.motd ? [d.motd] : [];
        info = { online: d.online | 0, max: d.max | 0, motd: lines.map(plain).join("\n"), version: String(j.vers || ""), icon: "", sample: Array.isArray(d.players) ? d.players.map(plain).slice(0, 12) : [], ping: Math.max(1, Math.round(performance.now() - t0)), at: Date.now() };
        wantIcon = !!d.icon;
        if (icon || !wantIcon) finish(); else iconTimer = setTimeout(finish, 1500);        // the picture follows as a binary message
      } else if (ev.data instanceof ArrayBuffer) {
        icon = pngUrl(new Uint8Array(ev.data));
        if (info) finish();
      }
    };
    ws.onerror = function () { finish(); };
    ws.onclose = function () { finish(); };
  }

  /* ---------- the queue ---------- */
  function run(job) {
    var e = job.entry, k = key(e), rec = cache[k] || (cache[k] = { state: "pending", at: 0 });
    var kind = e.rel ? "mc" : e.wisp ? "wisp" : /^wss?:\/\//i.test(e.ip || "") ? "eagler" : "";
    if (kind === "wisp" && !(OC.account && OC.account.state().bridge === "ready" && OC.account.wispUrl())) {            // no bridge to ask through: nothing to say about it
      running--; rec.querying = false; rec.state = "unknown"; rec.error = "OneClient Bridge is not running"; rec.at = Date.now(); emit(k); pump(); return;
    }
    function done(res) {
      running--;
      rec.querying = false;
      if (res.state === "online") { ["online", "max", "ping", "motd", "version", "icon", "sample"].forEach(function (f) { rec[f] = res[f]; }); rec.state = "online"; }
      else { rec.state = res.state; rec.ping = 0; rec.error = res.error || ""; if (res.state === "offline") rec.online = 0; }
      rec.at = Date.now();
      save(); emit(k); pump();
    }
    if (!kind) { running--; rec.querying = false; rec.state = "unknown"; rec.at = Date.now(); emit(k); pump(); return; }
    try { (kind === "eagler" ? eaglerQuery : mcQuery)(e, done); } catch (x) { done({ state: "offline", error: String(x && x.message || x) }); }
  }
  function pump() { while (running < MAX_PAR && queue.length) { var job = queue.shift(); running++; run(job); } }

  S.refresh = function (entries, force) {
    (entries || []).forEach(function (e) {
      var k = key(e);
      if (!k) return;
      var rec = cache[k];
      if (rec && rec.querying) return;
      if (!force && rec && rec.at && rec.state !== "stale" && Date.now() - rec.at < TTL) return;
      if (!rec) rec = cache[k] = { state: "pending", at: 0 };
      rec.querying = true;
      queue.push({ entry: e });
    });
    pump();
  };
})();
