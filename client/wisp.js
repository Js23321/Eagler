/* OneClient tunnel + HTTPS: how the page reaches Microsoft's and Mojang's servers without a helper program.
 *
 * Wisp is a tiny protocol that carries TCP streams over one WebSocket (public Wisp servers exist; the game's Java-account mode uses
 * them too). OC.wisp opens a stream to host:port; OC.tls (client/tls.js) then runs TLS 1.3 through that stream, end to end with the
 * real server, so the Wisp server's operator only sees encrypted bytes; OC.https puts a plain HTTP/1.1 request on top.
 *
 * OC.wisp.servers()            the Wisp servers tried in order (yours first, then the built-in ones)
 * OC.wisp.setCustom(url)       a Wisp server of your own (wss://...), tried first; "" forgets it
 * OC.wisp.open(url)            -> Promise of a session; session.connect(host, port) -> a stream { send, close, onmessage, onclose }
 * OC.wisp.connect(host, port)  -> Promise of a stream through the first Wisp server that works
 * OC.https.request(url, init)  -> Promise { status, headers, body, text(), json() }   init: { method, headers, body, signal, timeout }
 * OC.https.fetch(url, init)    the same as a Response
 * OC.https.test(url)           -> Promise of { ok, ms, error }: can this Wisp server carry an HTTPS request to Mojang?
 * ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC || !OC.tls || !OC.tls.available) return;
  var W = OC.wisp = {}, H = OC.https = {}, KEY = "oneclient.wisp.v1";
  var DEFAULTS = ["wss://wisp.mercurywork.shop/", "wss://anura.pro/"];
  var cfg = { custom: "", last: "" };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (saved && typeof saved === "object") {
      if (/^wss?:\/\/[^\s]+$/i.test(saved.custom || "")) cfg.custom = saved.custom;
      if (/^wss?:\/\/[^\s]+$/i.test(saved.last || "")) cfg.last = saved.last;
    }
  } catch (e) { /* no storage */ }
  function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } }

  W.defaults = DEFAULTS.slice();
  W.custom = function () { return cfg.custom; };
  W.setCustom = function (url) {
    url = String(url || "").trim();
    if (url && !/^wss?:\/\/[^\s]+$/i.test(url)) throw new Error("A Wisp server address looks like wss://wisp.example.com/");
    cfg.custom = url; saveCfg();
  };
  W.servers = function () {                                                       // the order to try: yours, the one that worked last, the built-in ones
    var out = [];
    [cfg.custom, cfg.last].concat(DEFAULTS).forEach(function (u) { if (u && out.indexOf(u) < 0) out.push(u); });
    return out;
  };

  var CLOSE = { 0x01: "closed for an unknown reason", 0x02: "closed", 0x03: "the connection failed", 0x41: "the Wisp server rejected the address", 0x42: "the Wisp server could not reach that host", 0x43: "the Wisp server timed out reaching that host", 0x44: "that host refused the connection", 0x47: "the connection timed out", 0x48: "the Wisp server blocks that destination", 0x49: "the Wisp server is busy (too many connections)", 0x50: "client error" };

  /* ---------- a Wisp session: one WebSocket, many streams ---------- */
  var sessions = {};
  function openSocket(url) {
    var ws = OC.net && OC.net.openQuiet ? OC.net.openQuiet(url) : new window.WebSocket(url);      // OneClient's own sockets are never read as game traffic
    ws.binaryType = "arraybuffer";
    return ws;
  }
  W.open = function (url) {
    var s = sessions[url];
    if (s && s.ready && s.ws.readyState === 1) return Promise.resolve(s);
    if (s && s.pending) return s.pending;
    var sess = { url: url, ws: null, ready: false, streams: {}, next: 1, credits: 128, idle: 0 };
    sessions[url] = sess;
    sess.pending = new Promise(function (resolve, reject) {
      var ws, timer, over = false;
      function fail(why) {
        if (over) return;
        over = true; clearTimeout(timer);
        if (sessions[url] === sess) delete sessions[url];
        try { ws.close(); } catch (e) { /* closed */ }
        reject(new Error(why));
      }
      try { ws = sess.ws = openSocket(url); } catch (e) { return fail("bad Wisp address"); }
      timer = setTimeout(function () { fail("the Wisp server did not answer"); }, 8000);
      ws.onmessage = function (ev) {
        if (!(ev.data instanceof ArrayBuffer)) return;
        var u = new Uint8Array(ev.data);
        if (u.length < 5) return;
        var type = u[0], id = (u[1] | (u[2] << 8) | (u[3] << 16) | (u[4] << 24)) >>> 0;
        if (type === 3 && id === 0 && !sess.ready) {                              // the greeting: how many packets a stream may send before it waits
          sess.credits = u.length >= 9 ? (u[5] | (u[6] << 8) | (u[7] << 16) | (u[8] << 24)) >>> 0 : 128;
          sess.ready = true; over = true; clearTimeout(timer);
          resolve(sess);
          return;
        }
        var st = sess.streams[id];
        if (!st) return;
        if (type === 2) { if (st.onmessage) st.onmessage(u.slice(5)); }
        else if (type === 3) { st.credits = u.length >= 9 ? (u[5] | (u[6] << 8) | (u[7] << 16) | (u[8] << 24)) >>> 0 : st.credits; st.flush(); }
        else if (type === 4) st.end(CLOSE[u[5]] || ("closed (" + u[5] + ")"), u[5] === 0x02);
      };
      ws.onerror = function () { fail("could not reach the Wisp server"); };
      ws.onclose = function () {
        if (!sess.ready) return fail("the Wisp server closed the connection");
        if (sessions[url] === sess) delete sessions[url];
        Object.keys(sess.streams).forEach(function (k) { sess.streams[k].end("the Wisp connection closed", false); });
      };
    });
    return sess.pending;
  };
  function frame(type, id, payload) {
    var b = new Uint8Array(5 + payload.length);
    b[0] = type; b[1] = id & 255; b[2] = (id >> 8) & 255; b[3] = (id >> 16) & 255; b[4] = (id >>> 24) & 255;
    b.set(payload, 5);
    return b;
  }
  /* a stream: the transport the TLS code wants (send, close, onmessage, onclose) */
  function connectStream(sess, host, port) {
    var id = sess.next++, st = { id: id, onmessage: null, onclose: null, credits: sess.credits, queue: [], over: false };
    sess.streams[id] = st;
    clearTimeout(sess.idle);
    var h = new TextEncoder().encode(host), c = new Uint8Array(3 + h.length);
    c[0] = 1; c[1] = port & 255; c[2] = (port >> 8) & 255; c.set(h, 3);
    sess.ws.send(frame(1, id, c));
    st.flush = function () {
      while (st.queue.length && st.credits > 0 && !st.over) {
        var d = st.queue.shift();
        st.credits--;
        try { sess.ws.send(frame(2, id, d)); } catch (e) { st.end("the Wisp connection closed", false); return; }
      }
    };
    st.send = function (u8) {
      for (var o = 0; o < u8.length; o += 16384) st.queue.push(u8.slice(o, Math.min(u8.length, o + 16384)));
      st.flush();
    };
    st.end = function (why, clean) {
      if (st.over) return;
      st.over = true;
      delete sess.streams[id];
      if (!Object.keys(sess.streams).length) sess.idle = setTimeout(function () { if (!Object.keys(sess.streams).length) { try { sess.ws.close(); } catch (e) { /* closed */ } } }, 20000);
      if (st.onclose) { var e = new Error(why); e.clean = !!clean; try { st.onclose(e); } catch (x) { /* listener's problem */ } }
    };
    st.close = function () {
      if (st.over) return;
      try { sess.ws.send(frame(4, id, new Uint8Array([0x02]))); } catch (e) { /* gone */ }
      st.end("closed", true);
    };
    return st;
  }
  W.connectVia = function (url, host, port) { return W.open(url).then(function (sess) { return connectStream(sess, host, port); }); };
  W.connect = async function (host, port) {                                       // through the first Wisp server that answers
    var list = W.servers(), last = null;
    for (var i = 0; i < list.length; i++) {
      try { var st = await W.connectVia(list[i], host, port); cfg.last = list[i]; saveCfg(); st.via = list[i]; return st; } catch (e) { last = e; }
    }
    throw last || new Error("no Wisp server is set up");
  };

  /* ---------- HTTPS: HTTP/1.1 over TLS over a Wisp stream ---------- */
  function utf8(s) { return new TextEncoder().encode(s); }
  function cat(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
  function indexOfCRLF2(b) { for (var i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i; return -1; }
  function headerList(h) {
    var o = [];
    if (!h) return o;
    if (typeof Headers === "function" && h instanceof Headers) { h.forEach(function (v, k) { o.push([k, v]); }); return o; }
    Object.keys(h).forEach(function (k) { o.push([k, h[k]]); });
    return o;
  }
  /* one request; resolves when the response is complete. init.via: a function (host, port) -> Promise of a stream, to use another path (tests) */
  function readResponse(c, u, init, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var over = false, timer, abort = null, head = null, buf = new Uint8Array(0), parts = [], got = 0, chunked = false, need = -1, cb = new Uint8Array(0), lastChunk = false;
      function finish(err, res) {
        if (over) return;
        over = true; clearTimeout(timer);
        if (init.signal && abort) init.signal.removeEventListener("abort", abort);
        try { c.close(); } catch (e) { /* closed */ }
        if (err) reject(err); else resolve(res);
      }
      function done() {
        var out = new Uint8Array(got), p = 0;
        parts.forEach(function (x) { out.set(x, p); p += x.length; });
        finish(null, { status: head.status, headers: head.headers, body: out, text: function () { return new TextDecoder().decode(out); }, json: function () { return JSON.parse(new TextDecoder().decode(out)); } });
      }
      function take(d) { parts.push(d); got += d.length; }
      function pumpBody() {                                                       // the body so far, by its framing
        if (chunked) {
          for (;;) {
            var i = -1, k;
            for (k = 0; k + 1 < cb.length; k++) if (cb[k] === 13 && cb[k + 1] === 10) { i = k; break; }
            if (i < 0) return;
            var size = parseInt(new TextDecoder().decode(cb.subarray(0, i)).split(";")[0], 16);
            if (isNaN(size)) return finish(new Error("bad HTTP chunk"));
            if (size === 0) { lastChunk = true; return done(); }
            if (cb.length < i + 2 + size + 2) return;
            take(cb.slice(i + 2, i + 2 + size));
            cb = cb.slice(i + 2 + size + 2);
          }
        }
        if (need >= 0 && got >= need) done();
      }
      timer = setTimeout(function () { finish(new Error("the request to " + u.hostname + " timed out")); }, timeoutMs);
      if (init.signal) {
        if (init.signal.aborted) return finish(new Error("aborted"));
        abort = function () { finish(new Error("aborted")); };
        init.signal.addEventListener("abort", abort);
      }
      c.onData = function (d) {
        if (over) return;
        if (!head) {
          buf = cat(buf, d);
          var e = indexOfCRLF2(buf);
          if (e < 0) { if (buf.length > 65536) finish(new Error("the HTTP answer is malformed")); return; }
          var text = new TextDecoder().decode(buf.subarray(0, e)).split("\r\n"), m = /^HTTP\/1\.[01] (\d{3})/.exec(text[0]);
          if (!m) return finish(new Error("the answer was not HTTP"));
          head = { status: +m[1], headers: {} };
          for (var i = 1; i < text.length; i++) {
            var ix = text[i].indexOf(":");
            if (ix > 0) { var k = text[i].slice(0, ix).trim().toLowerCase(), v = text[i].slice(ix + 1).trim(); head.headers[k] = head.headers[k] ? head.headers[k] + ", " + v : v; }
          }
          chunked = /chunked/i.test(head.headers["transfer-encoding"] || "");
          need = head.headers["content-length"] !== undefined ? parseInt(head.headers["content-length"], 10) : -1;
          if (head.status === 204 || head.status === 304 || (head.status >= 100 && head.status < 200) || /^HEAD$/i.test(init.method || "")) { need = 0; chunked = false; }
          var rest = buf.slice(e + 4);
          if (chunked) cb = rest; else if (rest.length) take(rest);
          return pumpBody();
        }
        if (chunked) cb = cat(cb, d); else take(d);
        pumpBody();
      };
      c.onClose = function (err) {
        if (over) return;
        if (head && !chunked && (need < 0 || got >= need)) return done();               // the server closed after its answer: that is the end of it
        finish(err && err.cert ? err : new Error(err && err.message ? err.message : "the connection closed before the answer was complete"));         // a damaged or forged record stays a "can not be trusted" error
      };
      var body = init.body === undefined || init.body === null ? new Uint8Array(0) : typeof init.body === "string" ? utf8(init.body) : init.body;
      var lines = [(init.method || "GET").toUpperCase() + " " + (u.pathname || "/") + u.search + " HTTP/1.1", "Host: " + u.host, "User-Agent: OneClient", "Accept: */*", "Accept-Encoding: identity", "Connection: close"];
      var hasBody = body.length > 0 || /^(POST|PUT|PATCH)$/i.test(init.method || "");
      headerList(init.headers).forEach(function (kv) {
        var k = kv[0].toLowerCase();
        if (k !== "host" && k !== "connection" && k !== "accept-encoding" && k !== "content-length") lines.push(kv[0] + ": " + kv[1]);
      });
      if (hasBody) lines.push("Content-Length: " + body.length);
      c.write(cat(utf8(lines.join("\r\n") + "\r\n\r\n"), body));
    });
  }
  H.request = async function (urlStr, init) {
    init = init || {};
    var u = new URL(urlStr);
    if (u.protocol !== "https:") throw new Error("only https:// addresses can be fetched");
    var port = +u.port || 443, host = u.hostname, t0 = Date.now(), total = init.timeout || 30000;
    var list = init.via ? [null] : W.servers(), conn = null, stream = null, last = null;
    for (var i = 0; i < list.length && !conn; i++) {
      if (init.signal && init.signal.aborted) throw new Error("aborted");
      try {
        stream = await (init.via ? init.via(host, port) : W.connectVia(list[i], host, port));
        conn = await OC.tls.connect(stream, host, init.tls);
        if (!init.via && W.custom() !== list[i] && cfg.last !== list[i]) { cfg.last = list[i]; saveCfg(); }
      } catch (e) {
        last = e;
        try { if (stream) stream.close(); } catch (x) { /* closed */ }
        stream = null;
        if (e && e.cert) throw e;                                                 // a certificate problem is a warning, not a reason to try another path
      }
    }
    if (!conn) throw last || new Error("no Wisp server is set up");
    return readResponse(conn, u, init, Math.max(3000, total - (Date.now() - t0)));
  };
  H.fetch = function (urlStr, init) {
    return H.request(urlStr, init).then(function (r) {
      var nullBody = r.status === 204 || r.status === 205 || r.status === 304;
      return new Response(nullBody ? null : r.body, { status: r.status, headers: r.headers });
    });
  };
  /* can this Wisp server carry an HTTPS request to Mojang? (the Java-account page's Test button) */
  H.test = function (wispUrl) {
    var t0 = Date.now();
    return H.request("https://sessionserver.mojang.com/", { timeout: 20000, via: function (host, port) { return W.connectVia(wispUrl, host, port); } }).then(function (r) {
      return { ok: r.status > 0, ms: Date.now() - t0, status: r.status };
    }, function (e) { return { ok: false, ms: Date.now() - t0, error: e && e.message || String(e) }; });
  };
})();
