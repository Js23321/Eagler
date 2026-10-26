/* OneClient TLS: a small TLS 1.3 client for the page, so it can talk to Microsoft's and Mojang's servers through a plain TCP tunnel (Wisp).
 *
 * Why: a web page cannot call those servers (they send no CORS headers) and cannot open TCP connections. A tunnel gives it the
 * TCP; the TLS is done here, in the page, end to end with the real server, so the tunnel's operator sees only encrypted bytes.
 * The page's own crypto (WebCrypto) does the maths; this file is the protocol and the certificate check.
 *
 * What it supports (enough for login.microsoftonline.com, *.auth.xboxlive.com, api.minecraftservices.com, sessionserver.mojang.com):
 *   TLS 1.3 only, TLS_AES_128_GCM_SHA256 / TLS_AES_256_GCM_SHA384, key exchange secp256r1, server signatures rsa_pss_rsae_*, ecdsa_secp256r1/384.
 *   Plus, only when the caller passes { tls12: true } (login.live.com cannot do 1.3): TLS 1.2 with ECDHE (secp256r1 / secp384r1) and AES-GCM, extended master secret required.
 * What it checks: the whole certificate chain up to a PINNED root (DigiCert Global Root G2 and Microsoft's own roots, below; nothing else
 * is trusted), signatures, validity dates, CA flags, the host name, the server's CertificateVerify and Finished.
 *
 * OC.tls.connect(transport, host)   -> Promise of a connection: { write(u8), onData(fn), onClose(fn), close() }
 *     transport: { send(u8), close(), onmessage: fn(u8), onclose: fn() }   (set by connect)
 * OC.tls.verifyChain(ders, host, now, roots)   resolves when the chain is good, rejects with the reason
 * ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC) return;
  var T = OC.tls = {}, subtle = window.crypto && window.crypto.subtle;
  T.available = !!subtle;
  if (!subtle) return;

  /* ---------- bytes ---------- */
  function cat() {
    var n = 0, i, o, p = 0;
    for (i = 0; i < arguments.length; i++) n += arguments[i].length;
    o = new Uint8Array(n);
    for (i = 0; i < arguments.length; i++) { o.set(arguments[i], p); p += arguments[i].length; }
    return o;
  }
  function be(n, len) { var o = new Uint8Array(len); for (var i = len - 1; i >= 0; i--) { o[i] = n % 256; n = Math.floor(n / 256); } return o; }
  function eq(a, b) { if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
  function ascii(s) { var o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255; return o; }
  function b64(s) { var bin = atob(s), o = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
  function zeros(n) { return new Uint8Array(n); }
  function rnd(n) { var o = new Uint8Array(n); window.crypto.getRandomValues(o); return o; }
  var EMPTY = new Uint8Array(0);

  /* ---------- DER and X.509 ---------- */
  function tlv(b, p) {
    if (p + 2 > b.length) throw new Error("bad certificate (DER)");
    var tag = b[p], l = b[p + 1], q = p + 2, i;
    if (l & 128) {
      var n = l & 127;
      if (n < 1 || n > 4 || q + n > b.length) throw new Error("bad certificate (DER length)");
      l = 0;
      for (i = 0; i < n; i++) l = l * 256 + b[q++];
    }
    if (q + l > b.length) throw new Error("bad certificate (DER size)");
    return { tag: tag, s: q, e: q + l, h: p };
  }
  function kids(b, node) { var out = [], p = node.s; while (p < node.e) { var t = tlv(b, p); out.push(t); p = t.e; } return out; }
  function oidOf(b, t) {
    if (t.tag !== 6 || t.e <= t.s) throw new Error("bad certificate (OID)");
    var p = t.s, first = b[p++], parts = [Math.floor(first / 40), first % 40], v = 0;
    while (p < t.e) { var c = b[p++]; v = v * 128 + (c & 127); if (!(c & 128)) { parts.push(v); v = 0; } }
    return parts.join(".");
  }
  function timeOf(b, t) {
    var s = String.fromCharCode.apply(null, b.subarray(t.s, t.e)), m;
    if (t.tag === 0x17) {
      m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s);
      if (m) return Date.UTC(+m[1] >= 50 ? 1900 + +m[1] : 2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    } else if (t.tag === 0x18) {
      m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    }
    throw new Error("bad certificate (time)");
  }
  function parseCert(der) {
    var cert = tlv(der, 0);
    if (cert.tag !== 0x30 || cert.e !== der.length) throw new Error("bad certificate");
    var top = kids(der, cert);
    if (top.length !== 3 || top[0].tag !== 0x30 || top[1].tag !== 0x30 || top[2].tag !== 0x03) throw new Error("bad certificate (layout)");
    var tbs = top[0], f = kids(der, tbs), i = 0;
    if (f[i].tag === 0xa0) i++;                                                  // version
    i += 2;                                                                      // serial, signature algorithm
    var issuer = f[i++], validity = f[i++], subject = f[i++], spki = f[i++], vt = kids(der, validity);
    var c = {
      der: der, tbs: der.subarray(tbs.h, tbs.e), issuer: der.subarray(issuer.h, issuer.e), subject: der.subarray(subject.h, subject.e), spki: der.subarray(spki.h, spki.e),
      notBefore: timeOf(der, vt[0]), notAfter: timeOf(der, vt[1]), dns: [], ca: false, usage: null, eku: null
    };
    c.sigAlg = oidOf(der, kids(der, top[1])[0]);
    c.sig = der.subarray(top[2].s + 1, top[2].e);                                // the first byte of a BIT STRING counts unused bits
    for (; i < f.length; i++) {
      if (f[i].tag !== 0xa3) continue;
      kids(der, kids(der, f[i])[0]).forEach(function (x) {
        var k = kids(der, x), id = oidOf(der, k[0]), val = k[k.length - 1];
        if (val.tag !== 0x04) return;
        var inner = der.subarray(val.s, val.e), root = tlv(inner, 0);
        if (id === "2.5.29.17") {                                                // subjectAltName: dNSName is context tag 2
          kids(inner, root).forEach(function (g) { if (g.tag === 0x82) c.dns.push(String.fromCharCode.apply(null, inner.subarray(g.s, g.e)).toLowerCase()); });
        } else if (id === "2.5.29.19") {                                         // basicConstraints: cA
          var bc = kids(inner, root);
          c.ca = bc.length > 0 && bc[0].tag === 0x01 && inner[bc[0].s] !== 0;
        } else if (id === "2.5.29.15") {                                         // keyUsage: keyCertSign is bit 5
          c.usage = root.tag === 0x03 && root.e - root.s > 1 ? inner[root.s + 1] : 0;
        } else if (id === "2.5.29.37") {                                         // extended key usage
          c.eku = kids(inner, root).map(function (o) { return oidOf(inner, o); });
        }
      });
    }
    return c;
  }
  function nameMatches(names, host) {
    host = String(host).toLowerCase();
    return names.some(function (n) {
      if (n === host) return true;
      if (n.indexOf("*.") !== 0 || n.indexOf("*", 1) >= 0) return false;
      var dot = host.indexOf(".");
      return dot > 0 && host.slice(dot) === n.slice(1);                          // the wildcard stands for exactly one label
    });
  }

  /* signatures with WebCrypto */
  var CERT_SIG = {
    "1.2.840.113549.1.1.11": { k: "rsa", hash: "SHA-256" }, "1.2.840.113549.1.1.12": { k: "rsa", hash: "SHA-384" }, "1.2.840.113549.1.1.13": { k: "rsa", hash: "SHA-512" },
    "1.2.840.10045.4.3.2": { k: "ec", hash: "SHA-256" }, "1.2.840.10045.4.3.3": { k: "ec", hash: "SHA-384" }, "1.2.840.10045.4.3.4": { k: "ec", hash: "SHA-512" }
  };
  function keyKind(spki) {
    var k = kids(spki, tlv(spki, 0)), alg = kids(spki, k[0]), id = oidOf(spki, alg[0]);
    if (id === "1.2.840.113549.1.1.1") return { kind: "rsa" };
    if (id === "1.2.840.10045.2.1" && alg[1]) {
      var curve = oidOf(spki, alg[1]);
      if (curve === "1.2.840.10045.3.1.7") return { kind: "ec", curve: "P-256", size: 32 };
      if (curve === "1.3.132.0.34") return { kind: "ec", curve: "P-384", size: 48 };
    }
    throw new Error("unsupported public key in a certificate");
  }
  function ecRaw(der, size) {                                                    // DER SEQUENCE { INTEGER r, INTEGER s } -> r || s
    var k = kids(der, tlv(der, 0)), out = new Uint8Array(size * 2);
    if (k.length !== 2) throw new Error("bad signature");
    for (var i = 0; i < 2; i++) {
      var v = der.subarray(k[i].s, k[i].e);
      while (v.length > 0 && v[0] === 0) v = v.subarray(1);
      if (v.length > size) throw new Error("bad signature");
      out.set(v, i * size + (size - v.length));
    }
    return out;
  }
  async function certSigOk(cert, issuerSpki) {
    var a = CERT_SIG[cert.sigAlg], kk = keyKind(issuerSpki);
    if (!a || a.k !== kk.kind) return false;
    try {
      if (kk.kind === "rsa") {
        var rk = await subtle.importKey("spki", issuerSpki, { name: "RSASSA-PKCS1-v1_5", hash: a.hash }, false, ["verify"]);
        return await subtle.verify("RSASSA-PKCS1-v1_5", rk, cert.sig, cert.tbs);
      }
      var ek = await subtle.importKey("spki", issuerSpki, { name: "ECDSA", namedCurve: kk.curve }, false, ["verify"]);
      return await subtle.verify({ name: "ECDSA", hash: a.hash }, ek, ecRaw(cert.sig, kk.size), cert.tbs);
    } catch (e) { return false; }
  }

  /* the roots this client trusts: nothing else (a tunnel operator cannot get a certificate from any of them for these hosts) */
  T.roots = [];
  T.addRoot = function (der) { var c = parseCert(der); T.roots.push({ subject: c.subject, spki: c.spki, der: der, notBefore: c.notBefore, notAfter: c.notAfter }); return c; };
  var ROOTS = [
    ["DigiCert Global Root G2", "cb3ccbb76031e5e0138f8dd39a23f9de47ffc35e43c1144cea27d46a5ab1cb5f",
      "MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBhMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGln" +
      "aUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBHMjAeFw0x" +
      "MzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVTMRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsT" +
      "EHd3dy5kaWdpY2VydC5jb20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A" +
      "MIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULec" +
      "YxpsMNzaHxmx1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQq2EGnI/yuum06ZIya7XzV+hd" +
      "G82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5WztCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9" +
      "g+UQvIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB" +
      "/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY1Yl9" +
      "PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/J" +
      "sw1HKj2ZL7tcu7XUIOGZX1NGFdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ918rGOmaFvE7FB" +
      "cf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTepLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyN" +
      "xF1WW6LZZm6zNTflMrY="],
    ["Microsoft ECC Root Certificate Authority 2017", "358df39d764af9e1b766e9c972df352ee15cfac227af6ad1d70e8e4a6edcba02",
      "MIICWTCCAd+gAwIBAgIQZvI9r4fei7FK6gxXMQHC7DAKBggqhkjOPQQDAzBlMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9z" +
      "b2Z0IENvcnBvcmF0aW9uMTYwNAYDVQQDEy1NaWNyb3NvZnQgRUNDIFJvb3QgQ2VydGlmaWNhdGUgQXV0aG9yaXR5IDIwMTcwHhcN" +
      "MTkxMjE4MjMwNjQ1WhcNNDIwNzE4MjMxNjA0WjBlMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u" +
      "MTYwNAYDVQQDEy1NaWNyb3NvZnQgRUNDIFJvb3QgQ2VydGlmaWNhdGUgQXV0aG9yaXR5IDIwMTcwdjAQBgcqhkjOPQIBBgUrgQQA" +
      "IgNiAATUvD0CQnVBEyPNgASGAlEvaqiBYgtlzPbKnR5vSmZRogPZnZH6thaxjG7efM3beaYvzrvOcS/lpaso7GMEZpn4+vKTEAXh" +
      "gShC48Zo9OYbhGBKia/teQ87zvH2RPUBeMCjVDBSMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBTI" +
      "y5lycFIM+Oa+sgRXKSrPQhDtNTAQBgkrBgEEAYI3FQEEAwIBADAKBggqhkjOPQQDAwNoADBlAjBY8k3qDPlfXu5gKcs68tvWMoQZ" +
      "P3zVL8KxzJOuULsJMsbG7X7JNpQS5GiFBqIb0C8CMQCZ6Ra0DvpWSNSkMBaReNtUjGUBiudQZsIxtzm6uBoiB078a1QWIP8rtedM" +
      "DE2mT3M="],
    ["Microsoft RSA Root Certificate Authority 2017", "c741f70f4b2a8d88bf2e71c14122ef53ef10eba0cfa5e64cfa20f418853073e0",
      "MIIFqDCCA5CgAwIBAgIQHtOXCV/YtLNHcB6qvn9FszANBgkqhkiG9w0BAQwFADBlMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWlj" +
      "cm9zb2Z0IENvcnBvcmF0aW9uMTYwNAYDVQQDEy1NaWNyb3NvZnQgUlNBIFJvb3QgQ2VydGlmaWNhdGUgQXV0aG9yaXR5IDIwMTcw" +
      "HhcNMTkxMjE4MjI1MTIyWhcNNDIwNzE4MjMwMDIzWjBlMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0" +
      "aW9uMTYwNAYDVQQDEy1NaWNyb3NvZnQgUlNBIFJvb3QgQ2VydGlmaWNhdGUgQXV0aG9yaXR5IDIwMTcwggIiMA0GCSqGSIb3DQEB" +
      "AQUAA4ICDwAwggIKAoICAQDKW76UM4wplZEWCpW9R2LBifOZNt9GkMml7Xhqb0eRaPgnZ1AzHaGm++DlQ6OEAlcBXZxIQIJTELy/" +
      "xztokLaCLeX0ZdDMbRnMlfl7rEqUrQ7eS0MdhweSE5CAg2Q1OQT85elss7YfUJQ4ZVBcF0a5toW1HLUX6NZFndiyJrDKxHBKrmCk" +
      "3bPZ7Pw71VdyvD/IybLeS2v4I2wDwAW9lcfNcztmgGTjGqwu+UcF8ga2m3P1eDNbx6H7JyqhtJqRjJHTOoI+dkC0zVJhUXAoP8XF" +
      "WvLJjEm7FFtNyP9nTUwSlq31/niol4fX/V4ggNyhSyL71Imtus5Hl0dVe49FyGcohJUcaDDv70ngNXtk55iwlNpNhTs+VcQor1fz" +
      "nhPbRiefHqJeRIOkpcrVE7NLP8TjwuaGYaRSMLl6IE9vDzhTyzMMEyuP1pq9KsgtsRx9S1HKR9FIJ3Jdh+vVReZIZZ2vUpC6W6IY" +
      "ZVcSn2i51BVrlMRpIpj0M+Dt+VGOQVDJNE92kKz8OMHY4Xu54+OU4UZpyw4KUGsTuqwPN1q3ErWQgR5WrlcihtnJ0tHXUeOrO8ZV" +
      "/R4O03QK0dqq6mm4lyiPSMQH+FJDOvTKVTUssKZqwJz58oHhEmrARdlns87/I6KJClTUFLkqqNfs+avNJVgyeY+QW5g5xAgGwax/" +
      "Dj0ApQIDAQABo1QwUjAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUCctZf4aycI8awznjwNnpv7tN" +
      "siMwEAYJKwYBBAGCNxUBBAMCAQAwDQYJKoZIhvcNAQEMBQADggIBAKyvPl3CEZaJjqPnktaXFbgToqZCLgLNFgVZJ8og6Lq46Brs" +
      "TaiXVq5lQ7GPAJtSzVXNUzltYkyLDVt8LkS/gxCP81OCgMNPOsduET/m4xaRhPtthH80dK2Jp86519efhGSSvpWhrQlTM93uCupK" +
      "UY5vVau6tZRGrox/2KJQJWVggEbbMwSubLWYdFQl3JPk+ONVFT24bcMKpBLBaYVu32TxU5nhSnUgnZUP5NbcA/FZGOhHibJXWpS2" +
      "qdgXKxdJ5XbLwVaZOjex/2kskZGT4d9Mozd2TaGf+G0eHdP67Pv0RR0Tbc/3WeUiJ3IrhvNXuzDtJE3cfVa7o7P4NHmJweDyAmH3" +
      "pvwPuxwXC65B2Xy9J6P9LjrRk5Sxcx0ki69bIImtt2dmefU6xqaWM/5TkshGsRGRxpl/j8nWZjEgQRCHLQzWwa80mMpkg/sTV9HB" +
      "8Dx6jKXB/ZUhoHHBk2dxEuqPiAppGWSZI1b7rCoucL5mxAyE7+WL85MB+GqQk2dLsmijtWKP6T+MejteD+eMuMZ87zf9dOLITzNy" +
      "4ZQ5bb0Sr74MTnB8G2+NszKTc0QWbej09+CVgI+WXTik9KveCjCHk9hNAHFiRSdLOkKEW39lt2c0Ui2cFmuqqNh7o0JMcccMyj6D" +
      "5KbvtwEwXlGjefVwaaZBRA+GsCyRxj3qrg+E"]
  ];
  ROOTS.forEach(function (r) {                                                   // each root is checked against the fingerprint written next to it
    var der = b64(r[2]);
    T.addRoot(der);
    subtle.digest("SHA-256", der).then(function (h) {
      var hex = "", a = new Uint8Array(h);
      for (var i = 0; i < a.length; i++) hex += (a[i] < 16 ? "0" : "") + a[i].toString(16);
      if (hex !== r[1]) { T.roots = T.roots.filter(function (x) { return x.der !== der; }); try { console.warn("[OneClient tls] root '" + r[0] + "' does not match its fingerprint and was dropped"); } catch (e) { /* no console */ } }
    });
  });

  async function verifyChain(ders, host, now, roots) {
    roots = roots || T.roots;
    now = now === undefined ? Date.now() : now;
    if (!ders.length) throw new Error("the server sent no certificate");
    var certs = ders.map(parseCert), leaf = certs[0];
    if (!nameMatches(leaf.dns, host)) throw new Error("the certificate is not for " + host);
    if (leaf.eku && leaf.eku.indexOf("1.3.6.1.5.5.7.3.1") < 0 && leaf.eku.indexOf("2.5.29.37.0") < 0) throw new Error("the certificate may not be used for web servers");
    var cur = leaf, pool = certs.slice(1), depth = 0, i, r;
    function timeCheck(c) {
      if (now < c.notBefore) throw new Error("a certificate is not valid yet (is this device's clock right?)");
      if (now > c.notAfter) throw new Error("a certificate has expired (is this device's clock right?)");
    }
    for (;;) {
      timeCheck(cur);
      for (i = 0; i < roots.length; i++) {                                       // the server sent the root itself
        if (eq(roots[i].der, cur.der)) return;
      }
      for (i = 0; i < roots.length; i++) {                                       // a pinned root signed this one
        r = roots[i];
        if (eq(r.subject, cur.issuer) && now >= r.notBefore && now <= r.notAfter && await certSigOk(cur, r.spki)) return;
      }
      var next = null;
      for (i = 0; i < pool.length; i++) {
        var c = pool[i];
        if (eq(c.subject, cur.issuer) && c.ca && (c.usage === null || (c.usage & 0x04)) && await certSigOk(cur, c.spki)) { next = c; pool.splice(i, 1); break; }
      }
      if (!next) throw new Error("the certificate does not lead to a trusted authority");
      if (++depth > 5) throw new Error("the certificate chain is too long");
      cur = next;
    }
  }
  T.verifyChain = verifyChain;
  T.parseCert = parseCert;

  /* ---------- crypto helpers (HKDF from HMAC, as TLS 1.3 wants it) ---------- */
  async function hmac(hash, key, data) {
    var k = await subtle.importKey("raw", key, { name: "HMAC", hash: hash }, false, ["sign"]);
    return new Uint8Array(await subtle.sign("HMAC", k, data));
  }
  async function digest(hash, data) { return new Uint8Array(await subtle.digest(hash, data)); }
  async function expandLabel(hash, secret, label, context, len) {                // HKDF-Expand-Label; every length used here fits one HMAC block
    var full = ascii("tls13 " + label), info = cat(be(len, 2), new Uint8Array([full.length]), full, new Uint8Array([context.length]), context);
    return (await hmac(hash, secret, cat(info, new Uint8Array([1])))).subarray(0, len);
  }
  async function trafficKeys(hash, secret, keyLen) {
    var key = await expandLabel(hash, secret, "key", EMPTY, keyLen), iv = await expandLabel(hash, secret, "iv", EMPTY, 12);
    return { secret: secret, key: await subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]), iv: iv, seq: 0 };
  }
  function nonce(iv, seq) {
    var n = iv.slice();
    for (var i = 0; i < 8; i++) n[11 - i] ^= Math.floor(seq / Math.pow(256, i)) & 255;
    return n;
  }
  var HRR = new Uint8Array([0xcf, 0x21, 0xad, 0x74, 0xe5, 0x9a, 0x61, 0x11, 0xbe, 0x1d, 0x8c, 0x02, 0x1e, 0x65, 0xb8, 0x91, 0xc2, 0xa2, 0x11, 0x16, 0x7a, 0xbb, 0x8c, 0x5e, 0x07, 0x9e, 0x09, 0xe2, 0xc8, 0xa8, 0x33, 0x9c]);

  /* ---------- the connection ---------- */
  function Conn(tr, host, opts) {
    this.tr = tr; this.host = host; this.opts = opts || {};
    this.buf = EMPTY; this.hs = EMPTY; this.msgs = [];
    this.state = "hello"; this.closed = false;
    this.rk = null; this.wk = null;
    this.onData = null; this.onClose = null;
    this.q = Promise.resolve(); this.wq = Promise.resolve();
  }
  var P = Conn.prototype;

  P.start = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      self.done = { resolve: resolve, reject: reject, over: false };
      self.tr.onmessage = function (u8) { self.input(u8); };
      self.tr.onclose = function () {                                             // the end of the bytes: after every record that already arrived has been handled
        self.q = self.q.then(function () { return self.pump(); }).then(function () { self.fail(new Error("the connection closed")); }).catch(function (e) { self.fail(e); });
      };
      self.hello().catch(function (e) { self.fail(e); });
    });
  };
  P.fail = function (e) {
    if (this.closed) return;
    this.closed = true;
    try { this.tr.close(); } catch (x) { /* already closed */ }
    if (this.done && !this.done.over) { this.done.over = true; this.done.reject(e); }
    if (this.onClose) { try { this.onClose(e); } catch (x) { /* listener's problem */ } }
  };
  P.input = function (u8) {
    var self = this;
    if (this.closed) return;
    this.buf = cat(this.buf, u8);
    this.q = this.q.then(function () { return self.pump(); }).catch(function (e) { self.fail(e); });
  };

  P.hello = async function () {
    var kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    this.kp = kp;
    var pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey)), host = ascii(this.host);
    this.sid = rnd(32);
    var ext = cat(
      be(0x0000, 2), be(host.length + 5, 2), be(host.length + 3, 2), new Uint8Array([0]), be(host.length, 2), host,            // server_name
      be(0x000a, 2), be(4, 2), be(2, 2), be(0x0017, 2),                                                                       // supported_groups: secp256r1
      be(0x000d, 2), be(16, 2), be(14, 2), be(0x0804, 2), be(0x0805, 2), be(0x0806, 2), be(0x0401, 2), be(0x0501, 2), be(0x0403, 2), be(0x0503, 2),   // signature_algorithms
      be(0x002b, 2), be(3, 2), new Uint8Array([2]), be(0x0304, 2),                                                            // supported_versions: TLS 1.3
      be(0x0033, 2), be(pub.length + 6, 2), be(pub.length + 4, 2), be(0x0017, 2), be(pub.length, 2), pub,                      // key_share
      be(0x0010, 2), be(11, 2), be(9, 2), new Uint8Array([8]), ascii("http/1.1")                                              // ALPN
    );
    var body = cat(be(0x0303, 2), rnd(32), new Uint8Array([32]), this.sid, be(4, 2), be(0x1301, 2), be(0x1302, 2), new Uint8Array([1, 0]), be(ext.length, 2), ext);
    var msg = cat(new Uint8Array([1]), be(body.length, 3), body);
    this.msgs.push(msg);
    this.tr.send(cat(new Uint8Array([22, 3, 1]), be(msg.length, 2), msg));
  };

  P.pump = async function () {
    for (;;) {
      if (this.closed || this.buf.length < 5) return;
      var len = (this.buf[3] << 8) | this.buf[4];
      if (len > 16384 + 256) throw new Error("bad TLS record size");
      if (this.buf.length < 5 + len) return;
      var type = this.buf[0], hdr = this.buf.slice(0, 5), body = this.buf.slice(5, 5 + len);
      this.buf = this.buf.slice(5 + len);
      await this.record(type, hdr, body);
    }
  };
  P.record = async function (type, hdr, body) {
    if (type === 20) return;                                                      // change_cipher_spec: only for middleboxes, ignored
    if (type === 23 && this.rk) {
      var k = this.rk, plain;
      try { plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce(k.iv, k.seq), additionalData: hdr, tagLength: 128 }, k.key, body)); }
      catch (e) { var ce = new Error("the data from the server was altered on the way (bad record)"); ce.cert = true; throw ce; }
      k.seq++;
      var n = plain.length;
      while (n > 0 && plain[n - 1] === 0) n--;                                    // padding
      if (n === 0) throw new Error("bad TLS record");
      return this.content(plain[n - 1], plain.subarray(0, n - 1));
    }
    if (type === 22 && this.state === "hello") return this.content(22, body);
    if (type === 21 && !this.rk) return this.alert(body);
    throw new Error("unexpected TLS record");
  };
  P.alert = function (b) {
    if (b.length >= 2 && b[1] === 0) { var e = new Error("the server closed the connection"); e.clean = true; this.fail(e); return; }       // close_notify
    throw new Error("the server sent a TLS alert (" + (b[1] === undefined ? "?" : b[1]) + ")");
  };
  P.content = async function (type, data) {
    if (type === 22) {
      this.hs = cat(this.hs, data);
      for (;;) {
        if (this.hs.length < 4) return;
        var l = (this.hs[1] << 16) | (this.hs[2] << 8) | this.hs[3];
        if (this.hs.length < 4 + l) return;
        var msg = this.hs.slice(0, 4 + l);
        this.hs = this.hs.slice(4 + l);
        await this.message(msg[0], msg.subarray(4), msg);
      }
    }
    if (type === 23) {
      if (this.state !== "app") throw new Error("data before the handshake was over");
      if (data.length && this.onData) this.onData(data);
      return;
    }
    if (type === 21) return this.alert(data);
    throw new Error("unexpected TLS content");
  };

  P.message = async function (t, body, raw) {
    var s = this.state;
    if (s === "hello") {
      if (t !== 2) throw new Error("unexpected handshake message");
      return this.serverHello(body, raw);
    }
    if (s === "app") {
      if (t === 4) return;                                                        // NewSessionTicket: not used
      if (t === 24) return this.keyUpdate(body);
      throw new Error("unexpected handshake message");
    }
    if (s === "ee" && t === 8) { this.msgs.push(raw); this.state = "cert"; return; }
    if (s === "cert" && t === 11) { this.msgs.push(raw); this.state = "cv"; return this.certificate(body); }
    if (s === "cv" && t === 15) { var th = await digest(this.hash, cat.apply(null, this.msgs)); this.msgs.push(raw); this.state = "fin"; return this.certVerify(body, th); }
    if (s === "fin" && t === 20) return this.finished(body, raw);
    throw new Error("unexpected handshake message (" + t + ")");
  };

  P.serverHello = async function (body, raw) {
    var p = 0, ver = (body[p++] << 8) | body[p++], random = body.subarray(p, p + 32), sidLen, suite, extEnd, ks = null, sv = 0, et, el, ed;
    p += 32; sidLen = body[p++];
    var sid = body.subarray(p, p + sidLen); p += sidLen;
    suite = (body[p++] << 8) | body[p++]; p++;                                    // cipher suite, compression method
    extEnd = p + 2 + ((body[p] << 8) | body[p + 1]); p += 2;
    if (extEnd > body.length) throw new Error("bad ServerHello");
    while (p + 4 <= extEnd) {
      et = (body[p] << 8) | body[p + 1]; el = (body[p + 2] << 8) | body[p + 3]; p += 4;
      ed = body.subarray(p, p + el); p += el;
      if (et === 0x002b) sv = (ed[0] << 8) | ed[1];
      else if (et === 0x0033 && ed.length >= 4) ks = { group: (ed[0] << 8) | ed[1], key: ed.subarray(4, 4 + ((ed[2] << 8) | ed[3])) };
    }
    if (ver !== 0x0303 || sv !== 0x0304) throw new Error("the server does not speak TLS 1.3");
    if (eq(random, HRR)) throw new Error("the server wants another key exchange (not supported)");
    if (!eq(sid, this.sid)) throw new Error("bad ServerHello");
    if (suite !== 0x1301 && suite !== 0x1302) throw new Error("the server chose a cipher suite that is not supported");
    if (!ks || ks.group !== 0x0017 || ks.key.length !== 65) throw new Error("bad key share from the server");
    var hash = suite === 0x1301 ? "SHA-256" : "SHA-384", hl = suite === 0x1301 ? 32 : 48, keyLen = suite === 0x1301 ? 16 : 32;
    this.hash = hash; this.hl = hl; this.keyLen = keyLen;
    this.msgs.push(raw);
    var peer = await subtle.importKey("raw", ks.key, { name: "ECDH", namedCurve: "P-256" }, false, []);
    var shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: peer }, this.kp.privateKey, 256));
    var early = await hmac(hash, zeros(hl), zeros(hl)), emptyHash = await digest(hash, EMPTY);
    var derived = await expandLabel(hash, early, "derived", emptyHash, hl);
    var hsSecret = await hmac(hash, derived, shared);
    var th = await digest(hash, cat.apply(null, this.msgs));
    this.cHs = await expandLabel(hash, hsSecret, "c hs traffic", th, hl);
    var sHs = await expandLabel(hash, hsSecret, "s hs traffic", th, hl);
    this.sHs = sHs;
    this.rk = await trafficKeys(hash, sHs, keyLen);
    this.wk = await trafficKeys(hash, this.cHs, keyLen);
    var derived2 = await expandLabel(hash, hsSecret, "derived", emptyHash, hl);
    this.master = await hmac(hash, derived2, zeros(hl));
    this.state = "ee";
  };

  P.certificate = async function (body) {
    var p = 1 + body[0], total = (body[p] << 16) | (body[p + 1] << 8) | body[p + 2], ders = [];
    p += 3;
    if (p + total !== body.length) throw new Error("bad Certificate message");
    while (p < body.length) {
      var l = (body[p] << 16) | (body[p + 1] << 8) | body[p + 2];
      p += 3;
      ders.push(body.slice(p, p + l)); p += l;
      p += 2 + ((body[p] << 8) | body[p + 1]);                                    // that entry's extensions
    }
    try { await verifyChain(ders, this.opts.verifyHost || this.host, this.opts.now, this.opts.roots); }
    catch (e) { e.cert = true; throw e; }                                          // a certificate problem is a warning, never retried on another path
    this.leaf = parseCert(ders[0]);
  };

  P.certVerify = async function (body, th) {
    var alg = (body[0] << 8) | body[1], sl = (body[2] << 8) | body[3], sig = body.subarray(4, 4 + sl);
    if (sig.length !== sl) throw new Error("bad CertificateVerify");
    var data = cat(new Uint8Array(64).fill(32), ascii("TLS 1.3, server CertificateVerify"), new Uint8Array([0]), th), ok = false, spki = this.leaf.spki, kk = keyKind(spki);
    if ((alg === 0x0804 || alg === 0x0805 || alg === 0x0806) && kk.kind === "rsa") {
      var h = alg === 0x0804 ? "SHA-256" : alg === 0x0805 ? "SHA-384" : "SHA-512", salt = alg === 0x0804 ? 32 : alg === 0x0805 ? 48 : 64;
      var rk = await subtle.importKey("spki", spki, { name: "RSA-PSS", hash: h }, false, ["verify"]);
      ok = await subtle.verify({ name: "RSA-PSS", saltLength: salt }, rk, sig, data);
    } else if ((alg === 0x0403 && kk.curve === "P-256") || (alg === 0x0503 && kk.curve === "P-384")) {
      var ek = await subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: kk.curve }, false, ["verify"]);
      ok = await subtle.verify({ name: "ECDSA", hash: alg === 0x0403 ? "SHA-256" : "SHA-384" }, ek, ecRaw(sig, kk.size), data);
    } else { var ea = new Error("the server signed with an algorithm that is not supported"); ea.cert = true; throw ea; }
    if (!ok) { var eb = new Error("the server's signature is wrong"); eb.cert = true; throw eb; }
  };

  P.finished = async function (body, raw) {
    var hash = this.hash, hl = this.hl;
    var th = await digest(hash, cat.apply(null, this.msgs));                      // everything up to CertificateVerify
    var expect = await hmac(hash, await expandLabel(hash, this.sHs, "finished", EMPTY, hl), th);
    if (!eq(expect, body)) { var ef = new Error("the server's Finished message is wrong"); ef.cert = true; throw ef; }
    this.msgs.push(raw);
    var thf = await digest(hash, cat.apply(null, this.msgs));
    var mine = await hmac(hash, await expandLabel(hash, this.cHs, "finished", EMPTY, hl), thf);
    var cAp = await expandLabel(hash, this.master, "c ap traffic", thf, hl), sAp = await expandLabel(hash, this.master, "s ap traffic", thf, hl);
    var fin = cat(new Uint8Array([20]), be(hl, 3), mine);
    await this.seal(22, fin);                                                     // still under the handshake keys
    this.wk = await trafficKeys(hash, cAp, this.keyLen);
    this.rk = await trafficKeys(hash, sAp, this.keyLen);
    this.state = "app";
    this.msgs = null;
    if (!this.done.over) { this.done.over = true; this.done.resolve(this); }
  };

  P.keyUpdate = async function (body) {
    this.rk = await trafficKeys(this.hash, await expandLabel(this.hash, this.rk.secret, "traffic upd", EMPTY, this.hl), this.keyLen);
    if (body[0] === 1) {                                                          // the server asked us to update as well
      var self = this;
      this.wq = this.wq.then(async function () {
        await self.seal(22, new Uint8Array([24, 0, 0, 1, 0]));
        self.wk = await trafficKeys(self.hash, await expandLabel(self.hash, self.wk.secret, "traffic upd", EMPTY, self.hl), self.keyLen);
      }).catch(function (e) { self.fail(e); });
    }
  };

  P.seal = async function (type, plain) {
    var k = this.wk, inner = cat(plain, new Uint8Array([type])), hdr = cat(new Uint8Array([23, 3, 3]), be(inner.length + 16, 2));
    var ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce(k.iv, k.seq), additionalData: hdr, tagLength: 128 }, k.key, inner));
    k.seq++;
    this.tr.send(cat(hdr, ct));
  };
  P.write = function (data) {
    var self = this;
    if (this.state !== "app" || this.closed) return;
    this.wq = this.wq.then(async function () {
      for (var o = 0; o < data.length && !self.closed; o += 16384) await self.seal(23, data.subarray(o, Math.min(data.length, o + 16384)));
    }).catch(function (e) { self.fail(e); });
  };
  P.close = function () {
    var self = this;
    if (this.closed) return;
    this.wq = this.wq.then(async function () {
      if (self.state === "app" && !self.closed) { try { await self.seal(21, new Uint8Array([1, 0])); } catch (e) { /* closing anyway */ } }
      self.closed = true;
      try { self.tr.close(); } catch (e) { /* already closed */ }
    });
  };

  /* ---------- TLS 1.2, only when the caller asks (opts.tls12): for hosts that cannot do 1.3, such as login.live.com ----------
   * ECDHE (secp256r1 / secp384r1) with AES-GCM only. The server's certificate chain, the signature over its key exchange, both Finished messages
   * and every record are checked as strictly as in the 1.3 path, and the extended master secret is required. Nothing of this is offered to a host
   * unless the caller passes { tls12: true }; every other host stays TLS 1.3 only. */
  var S12 = { 0xc02f: { hash: "SHA-256", keyLen: 16, auth: "rsa" }, 0xc030: { hash: "SHA-384", keyLen: 32, auth: "rsa" },
    0xc02b: { hash: "SHA-256", keyLen: 16, auth: "ec" }, 0xc02c: { hash: "SHA-384", keyLen: 32, auth: "ec" } };
  async function prf12(hash, secret, label, seed, len) {                         // TLS 1.2 PRF: P_hash(secret, label + seed)
    var ls = cat(ascii(label), seed), a = ls, out = EMPTY;
    while (out.length < len) { a = await hmac(hash, secret, a); out = cat(out, await hmac(hash, secret, cat(a, ls))); }
    return out.subarray(0, len);
  }
  function Conn12(tr, host, opts) { Conn.call(this, tr, host, opts); }
  Conn12.prototype = Object.create(Conn.prototype);
  var Q = Conn12.prototype;
  function certErr(msg) { var e = new Error(msg); e.cert = true; return e; }

  Q.hello = async function () {
    var host = ascii(this.host), sb = EMPTY;
    this.cr = rnd(32);
    [0xc030, 0xc02f, 0xc02c, 0xc02b].forEach(function (s) { sb = cat(sb, be(s, 2)); });
    var ext = cat(
      be(0x0000, 2), be(host.length + 5, 2), be(host.length + 3, 2), new Uint8Array([0]), be(host.length, 2), host,            // server_name
      be(0x000a, 2), be(6, 2), be(4, 2), be(0x0017, 2), be(0x0018, 2),                                                        // supported_groups: secp256r1, secp384r1
      be(0x000b, 2), be(2, 2), new Uint8Array([1, 0]),                                                                        // ec_point_formats: uncompressed
      be(0x000d, 2), be(14, 2), be(12, 2), be(0x0804, 2), be(0x0805, 2), be(0x0401, 2), be(0x0501, 2), be(0x0403, 2), be(0x0503, 2),   // signature_algorithms
      be(0x0017, 2), be(0, 2),                                                                                                // extended_master_secret
      be(0xff01, 2), be(1, 2), new Uint8Array([0])                                                                            // renegotiation_info
    );
    var body = cat(be(0x0303, 2), this.cr, new Uint8Array([0]), be(sb.length, 2), sb, new Uint8Array([1, 0]), be(ext.length, 2), ext);
    var msg = cat(new Uint8Array([1]), be(body.length, 3), body);
    this.msgs.push(msg);
    this.tr.send(cat(new Uint8Array([22, 3, 1]), be(msg.length, 2), msg));
  };

  Q.record = async function (type, hdr, body) {
    if (type === 20) {                                                            // the server's change_cipher_spec: its records are encrypted from here on
      if (this.state !== "sccs" || body.length !== 1 || body[0] !== 1) throw new Error("unexpected TLS record");
      this.rk = this.rkNext; this.state = "sfin";
      return;
    }
    if (this.rk && (type === 21 || type === 22 || type === 23)) {                 // 8 explicit nonce bytes, then the ciphertext and its 16 tag bytes
      var k = this.rk;
      if (body.length < 8 + 16) throw new Error("bad TLS record");
      var ct = body.subarray(8), aad = cat(be(k.seq, 8), new Uint8Array([type, 3, 3]), be(ct.length - 16, 2)), plain;
      try { plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: cat(k.iv, body.subarray(0, 8)), additionalData: aad, tagLength: 128 }, k.key, ct)); }
      catch (e) { throw certErr("the data from the server was altered on the way (bad record)"); }
      k.seq++;
      return this.content(type, plain);
    }
    if (type === 22 && !this.rk) return this.content(22, body);
    if (type === 21 && !this.rk) return this.alert(body);
    throw new Error("unexpected TLS record");
  };

  Q.message = async function (t, body, raw) {
    var s = this.state;
    if (s === "hello" && t === 2) return this.serverHello(body, raw);
    if (s === "cert" && t === 11) { this.msgs.push(raw); this.state = "ske"; return this.certificate(body); }
    if (s === "ske" && t === 12) { this.msgs.push(raw); this.state = "shd"; return this.keyExchange(body); }
    if (s === "shd" && t === 14) { if (body.length) throw new Error("bad ServerHelloDone"); this.msgs.push(raw); return this.helloDone(); }
    if (s === "sccs" && t === 4) { this.msgs.push(raw); return; }                 // NewSessionTicket (part of what Finished covers; never asked for)
    if (s === "sfin" && t === 20) return this.finished12(body);
    if (s === "app" && t === 0) return;                                           // HelloRequest: a renegotiation is not accepted, it is ignored
    throw new Error("unexpected handshake message (" + t + ")");
  };

  Q.serverHello = async function (body, raw) {
    var p = 0, ver = (body[p++] << 8) | body[p++], random = body.subarray(p, p + 32), suite, comp, ems = false, et, el, ed, extEnd;
    p += 32; p += 1 + body[p];                                                    // random, session id
    suite = (body[p++] << 8) | body[p++]; comp = body[p++];
    if (ver !== 0x0303) throw new Error("the server does not speak TLS 1.2");
    if (!S12[suite]) throw new Error("the server chose a cipher suite that is not supported");
    if (comp !== 0 || p > body.length) throw new Error("bad ServerHello");
    if (p + 2 <= body.length) {
      extEnd = p + 2 + ((body[p] << 8) | body[p + 1]); p += 2;
      if (extEnd > body.length) throw new Error("bad ServerHello");
      while (p + 4 <= extEnd) {
        et = (body[p] << 8) | body[p + 1]; el = (body[p + 2] << 8) | body[p + 3]; p += 4;
        ed = body.subarray(p, p + el); p += el;
        if (et === 0x0017) ems = true;
        else if (et === 0xff01 && !(ed.length === 1 && ed[0] === 0)) throw new Error("bad renegotiation info from the server");
      }
    }
    if (!ems) throw new Error("the server does not support the extended master secret");
    this.sr = random.slice(); this.suite = S12[suite];
    this.msgs.push(raw); this.state = "cert";
  };

  Q.certificate = async function (body) {
    var p = 3, total = (body[0] << 16) | (body[1] << 8) | body[2], ders = [];
    if (body.length < 3 || 3 + total !== body.length) throw new Error("bad Certificate message");
    while (p < body.length) {
      var l = (body[p] << 16) | (body[p + 1] << 8) | body[p + 2];
      p += 3;
      if (p + l > body.length) throw new Error("bad Certificate message");
      ders.push(body.slice(p, p + l)); p += l;
    }
    try { await verifyChain(ders, this.opts.verifyHost || this.host, this.opts.now, this.opts.roots); }
    catch (e) { e.cert = true; throw e; }
    this.leaf = parseCert(ders[0]);
  };

  Q.keyExchange = async function (body) {                                         // ServerKeyExchange: an ECDHE key, signed with the certificate's key
    if (body.length < 4 || body[0] !== 3) throw new Error("the server chose a key exchange that is not supported");
    var cid = (body[1] << 8) | body[2], plen = body[3], curve = cid === 0x0017 ? { name: "P-256", len: 65, bits: 256 } : cid === 0x0018 ? { name: "P-384", len: 97, bits: 384 } : null;
    if (!curve || plen !== curve.len || body.length < 4 + plen + 4) throw new Error("the server chose a curve that is not supported");
    var p = 4 + plen, alg = (body[p] << 8) | body[p + 1], sl = (body[p + 2] << 8) | body[p + 3], sig = body.subarray(p + 4, p + 4 + sl);
    if (sig.length !== sl || p + 4 + sl !== body.length) throw new Error("bad ServerKeyExchange");
    var data = cat(this.cr, this.sr, body.subarray(0, p)), spki = this.leaf.spki, kk = keyKind(spki), ok = false;
    if (kk.kind !== this.suite.auth) throw certErr("the server's key does not fit the cipher suite it chose");
    if ((alg === 0x0401 || alg === 0x0501) && kk.kind === "rsa") {
      var rk = await subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: alg === 0x0401 ? "SHA-256" : "SHA-384" }, false, ["verify"]);
      ok = await subtle.verify("RSASSA-PKCS1-v1_5", rk, sig, data);
    } else if ((alg === 0x0804 || alg === 0x0805) && kk.kind === "rsa") {
      var pk = await subtle.importKey("spki", spki, { name: "RSA-PSS", hash: alg === 0x0804 ? "SHA-256" : "SHA-384" }, false, ["verify"]);
      ok = await subtle.verify({ name: "RSA-PSS", saltLength: alg === 0x0804 ? 32 : 48 }, pk, sig, data);
    } else if ((alg === 0x0403 || alg === 0x0503) && kk.kind === "ec") {              // in TLS 1.2 the hash is not tied to the curve (a P-384 key may sign with SHA-256)
      var ek = await subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: kk.curve }, false, ["verify"]);
      ok = await subtle.verify({ name: "ECDSA", hash: alg === 0x0403 ? "SHA-256" : "SHA-384" }, ek, ecRaw(sig, kk.size), data);
    } else throw certErr("the server signed with an algorithm that is not supported");
    if (!ok) throw certErr("the server's signature is wrong");
    this.ske ={ curve: curve, point: body.slice(4, 4 + plen) };
  };

  Q.helloDone = async function () {                                               // our half: key exchange, change_cipher_spec, Finished
    var c = this.ske.curve, hash = this.suite.hash, kl = this.suite.keyLen;
    var kp = await subtle.generateKey({ name: "ECDH", namedCurve: c.name }, true, ["deriveBits"]);
    var peer = await subtle.importKey("raw", this.ske.point, { name: "ECDH", namedCurve: c.name }, false, []);
    var pms = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: peer }, kp.privateKey, c.bits));
    var pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
    var cke = cat(new Uint8Array([16]), be(pub.length + 1, 3), new Uint8Array([pub.length]), pub);
    this.msgs.push(cke);
    var master = await prf12(hash, pms, "extended master secret", await digest(hash, cat.apply(null, this.msgs)), 48);
    var kb = await prf12(hash, master, "key expansion", cat(this.sr, this.cr), 2 * kl + 8);
    this.wk = { key: await subtle.importKey("raw", kb.slice(0, kl), { name: "AES-GCM" }, false, ["encrypt"]), iv: kb.slice(2 * kl, 2 * kl + 4), seq: 0 };
    this.rkNext = { key: await subtle.importKey("raw", kb.slice(kl, 2 * kl), { name: "AES-GCM" }, false, ["decrypt"]), iv: kb.slice(2 * kl + 4, 2 * kl + 8), seq: 0 };
    this.master = master;
    this.tr.send(cat(new Uint8Array([22, 3, 3]), be(cke.length, 2), cke));
    this.tr.send(new Uint8Array([20, 3, 3, 0, 1, 1]));
    var fin = cat(new Uint8Array([20]), be(12, 3), await prf12(hash, master, "client finished", await digest(hash, cat.apply(null, this.msgs)), 12));
    this.msgs.push(fin);
    this.state = "sccs";
    await this.seal(22, fin);
  };

  Q.finished12 = async function (body) {
    var hash = this.suite.hash, expect = await prf12(hash, this.master, "server finished", await digest(hash, cat.apply(null, this.msgs)), 12);
    if (!eq(expect, body)) throw certErr("the server's Finished message is wrong");
    this.state = "app"; this.msgs = null;
    if (!this.done.over) { this.done.over = true; this.done.resolve(this); }
  };

  Q.seal = async function (type, plain) {
    var k = this.wk, seqb = be(k.seq, 8), aad = cat(seqb, new Uint8Array([type, 3, 3]), be(plain.length, 2));
    var ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: cat(k.iv, seqb), additionalData: aad, tagLength: 128 }, k.key, plain));
    k.seq++;
    this.tr.send(cat(new Uint8Array([type, 3, 3]), be(8 + ct.length, 2), seqb, ct));
  };

  /* connect(transport, host [, { roots, now, verifyHost, tls12 }]): the handshake over a byte transport; resolves with the open connection */
  T.connect = function (tr, host, opts) {
    var c = opts && opts.tls12 ? new Conn12(tr, host, opts) : new Conn(tr, host, opts);
    return c.start();
  };
  T.Conn = Conn;
  T.Conn12 = Conn12;
})();
