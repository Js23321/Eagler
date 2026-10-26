/* ==OneClientMod==
 * @id oc-waypoints
 * @name Waypoints
 * @version 1.0
 * @author OneClient
 * @description Mark places in your worlds: a name and distance floats over each one, with a beam you can see from far away. Dying leaves a waypoint too.
 * @category World
 * @icon flag
 * @order 43
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;
var live = false, show = true;
var PALETTE = ["#ff7a7a", "#ffb86b", "#ffe27a", "#7dffb2", "#7af0ff", "#9cd0ff", "#c79bff", "#ff7ad9"];

function addHere() { if (live) addWaypoint({}); }
function toggleAll() { if (live) { show = !show; api.ui.toast("Waypoints " + (show ? "shown" : "hidden")); } }
api.keys.register({ id: "add", label: "Add a waypoint here", def: "", onDown: addHere });
api.keys.register({ id: "toggle", label: "Show / hide all waypoints", def: "", onDown: toggleAll });

api.settings.define([
  { type: "section", label: "Waypoints" },
  { type: "info", label: "Waypoints are kept for each world and each server separately. Add them with the key below, or in the list at the bottom of this page." },
  { k: "labels", type: "toggle", label: "Show names", note: "The name floats over the waypoint", def: true },
  { k: "distance", type: "toggle", label: "Show distance", def: true, when: function (c) { return !!c.labels; } },
  { k: "beams", type: "toggle", label: "Show beams", note: "A coloured pillar up from the waypoint", def: true },
  { k: "through", type: "toggle", label: "Beams through walls", def: false, when: function (c) { return !!c.beams; } },
  { k: "range", type: "range", label: "Hide waypoints further than", note: "0 shows them at any distance", min: 0, max: 5000, step: 50, unit: "blocks", def: 0 },
  { k: "size", type: "range", label: "Text size", min: 10, max: 22, step: 1, unit: "px", def: 13 },
  { k: "death", type: "toggle", label: "Mark where you die", note: "Leaves a red \"Death\" waypoint; the next death replaces it", def: true }
]);
if (api.schemaOnly) return;
live = true;

/* ---------- where we are, and the waypoints that belong there ---------- */
function wsTarget(url) {
  if (!url) return "";
  try { var u = new URL(url), t = u.searchParams.get("target"); return t || u.host; } catch (e) { return ""; }
}
function worldKey() {
  var ses = api.session();
  if (ses.address) return "srv:" + ses.address;
  var w = OneClient.world;
  if (api.net.transport === "singleplayer") return "sp:" + (w && w.seed ? w.seed : "unknown");
  return "srv:" + (wsTarget(OneClient.net && OneClient.net.wsUrl) || "unknown");
}
function loadAll() { return api.storage.get("wp", {}); }
function saveAll(all) { api.storage.set("wp", all); }
function listFor(key) { return loadAll()[key] || []; }
function dimNow() { return api.world.dim || ""; }
function feet() {
  var st = api.player.state, p = st && st.pos;
  if (p && api.net.active && performance.now() - p.at < 4000) return { x: p.x, y: p.y, z: p.z };
  var c = api.game.cam;
  return c ? { x: c.x, y: c.y - 1.62, z: c.z } : null;
}
var panelRender = null;
function changed() { if (panelRender) panelRender(); }

function addWaypoint(o) {
  var key = worldKey(), all = loadAll(), l = all[key] || (all[key] = []), p = feet();
  var x = o.x !== undefined ? o.x : p && p.x, y = o.y !== undefined ? o.y : p && p.y, z = o.z !== undefined ? o.z : p && p.z;
  if (x === undefined || y === undefined || z === undefined || !isFinite(x + y + z)) { api.ui.toast("Stand in a world first, or type the coordinates.", true); return null; }
  var wp = { id: o.id || "w" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: o.name || "Waypoint " + (l.length + 1), x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), dim: o.dim !== undefined ? o.dim : dimNow(), color: o.color || PALETTE[l.length % PALETTE.length], on: true };
  l.push(wp);
  saveAll(all); changed();
  api.ui.toast("Waypoint \"" + wp.name + "\" added");
  return wp;
}
function updateWaypoint(key, id, patch) {
  var all = loadAll(), l = all[key] || [];
  for (var i = 0; i < l.length; i++) if (l[i].id === id) { Object.keys(patch).forEach(function (k) { l[i][k] = patch[k]; }); break; }
  saveAll(all);
}
function removeWaypoint(key, id) {
  var all = loadAll(), l = all[key] || [];
  all[key] = l.filter(function (w) { return w.id !== id; });
  saveAll(all); changed();
}

/* dying leaves a waypoint (one per world: the last death) */
api.player.onEvent(function (type, d) {
  if (type !== "death" || !api.settings.get("death") || !d) return;
  var key = worldKey(), all = loadAll(), l = (all[key] || []).filter(function (w) { return w.id !== "death"; });
  l.push({ id: "death", name: "Death", x: Math.floor(d.x), y: Math.floor(d.y), z: Math.floor(d.z), dim: d.dim || "", color: "#ff5555", on: true });
  all[key] = l; saveAll(all); changed();
});

/* ---------- in the world: labels (DOM) and beams (GL) ---------- */
var layer = api.dom.layer(), els = {};
api.dom.style(".ocwp-l{position:absolute;left:0;top:0;transform:translate(-50%,-100%);padding:3px 8px;border-radius:8px;background:rgba(12,14,20,.55);border:1px solid rgba(255,255,255,.18);color:#fff;font:600 13px/1.2 'Segoe UI',system-ui,sans-serif;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,.8);will-change:transform;display:none}.ocwp-l i{font-style:normal;opacity:.7;margin-left:6px;font-weight:500}.ocwp-l:before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c,#fff);margin-right:6px;box-shadow:0 0 6px var(--c,#fff)}");
function labelFor(wp) {
  var e = els[wp.id];
  if (!e) {
    var el = document.createElement("div"), nm = document.createElement("span"), di = document.createElement("i");
    el.className = "ocwp-l"; el.appendChild(nm); el.appendChild(di); layer.appendChild(el);
    e = els[wp.id] = { el: el, nm: nm, di: di, name: null, dist: null, color: null, shown: false };
  }
  return e;
}
function hideAll() { Object.keys(els).forEach(function (k) { if (els[k].shown) { els[k].el.style.display = "none"; els[k].shown = false; } }); }

var batch = api.gl.batch(), beams = [];
function visibleWaypoints() {
  var dim = dimNow();
  return listFor(worldKey()).filter(function (w) { return w.on !== false && (!w.dim || !dim || w.dim === dim); });
}
var lastScan = 0, cache = [];
api.events.on("frame", function () {
  var cam = api.game.cam, s = api.settings;
  if (!cam || !api.game.inWorld || !show) { hideAll(); beams = []; return; }
  var now = performance.now();
  if (now - lastScan > 250) { lastScan = now; cache = visibleWaypoints(); }       // the list lives in storage: read it a few times a second
  var range = s.get("range"), labels = s.get("labels"), withDist = s.get("distance"), size = s.get("size"), seen = {}, bm = [];
  cache.forEach(function (w) {
    var dx = w.x + 0.5 - cam.x, dy = w.y + 0.5 - cam.y, dz = w.z + 0.5 - cam.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (range > 0 && dist > range) return;
    seen[w.id] = true;
    bm.push({ w: w, dist: dist });
    if (!labels) return;
    var e = labelFor(w), p = api.game.project(w.x + 0.5, w.y + 1.4, w.z + 0.5);
    if (!p || !p.visible) { if (e.shown) { e.el.style.display = "none"; e.shown = false; } return; }
    if (e.name !== w.name) { e.name = w.name; e.nm.textContent = w.name; }
    var ds = withDist ? Math.round(dist) + " m" : "";
    if (e.dist !== ds) { e.dist = ds; e.di.textContent = ds; e.di.style.display = ds ? "" : "none"; }
    if (e.color !== w.color) { e.color = w.color; e.el.style.setProperty("--c", w.color); }
    e.el.style.fontSize = size + "px";
    e.el.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px) translate(-50%,-100%)";
    if (!e.shown) { e.el.style.display = "block"; e.shown = true; }
  });
  beams = bm;
  Object.keys(els).forEach(function (id) { if (!seen[id] && els[id].shown) { els[id].el.style.display = "none"; els[id].shown = false; } });
});

api.gl.onWorld(function (ctx) {
  var s = api.settings;
  if (!show || !s.get("beams") || !beams.length) return;
  var top = (api.world.ready ? api.world.minY + api.world.height : 320) + 16;
  batch.begin(ctx);
  beams.forEach(function (b) {
    var w = b.w, c = kit.rgb(w.color), x = w.x, z = w.z, a = Math.min(0.5, 0.18 + b.dist / 400);
    batch.fillBox(x + 0.38, w.y, z + 0.38, x + 0.62, top, z + 0.62, [c[0], c[1], c[2], a * 0.8]);
    batch.box(x + 0.02, w.y + 0.02, z + 0.02, x + 0.98, w.y + 0.98, z + 0.98, [c[0], c[1], c[2], 0.9], 2);
  });
  batch.draw(ctx, { through: s.get("through") });
});

/* ---------- the list on the settings page ---------- */
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
api.dom.style(".ocwp{display:flex;flex-direction:column;gap:8px;font:500 13px/1.3 'Segoe UI',system-ui,sans-serif;color:#fff}.ocwp h4{margin:6px 2px 2px;font:700 11.5px/1 'Segoe UI',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.62)}.ocwp-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1)}.ocwp-row input[type=text]{height:32px;padding:0 10px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(0,0,0,.28);color:#fff;font:600 13px/1 'Segoe UI',system-ui,sans-serif;outline:none;min-width:0}.ocwp-row input.nm{flex:1}.ocwp-row input.n{width:68px;text-align:center}.ocwp-row button{height:32px;padding:0 12px;border:1px solid rgba(255,255,255,.26);border-radius:10px;background:rgba(255,255,255,.12);color:#fff;font:650 12.5px/1 'Segoe UI',system-ui,sans-serif;cursor:pointer;outline:none}.ocwp-row button:hover{background:rgba(255,255,255,.22)}.ocwp-dot{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.7);padding:0!important;flex:none}.ocwp-xyz{color:rgba(255,255,255,.6);font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}.ocwp-empty{padding:14px;border-radius:14px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.62)}");

api.ui.panel(function (host) {
  var box = el("div", "ocwp");
  host.appendChild(box);
  function render() {
    if (!box.isConnected) { panelRender = null; return; }
    var key = worldKey(), wps = listFor(key);
    box.textContent = "";
    var where = key.indexOf("srv:") === 0 ? "this server" : (api.game.inWorld ? "this world" : "the world you are in");
    box.appendChild(el("h4", null, "Waypoints in " + where));
    if (!wps.length) box.appendChild(el("div", "ocwp-empty", "None yet. Use the Add button below, or set a key above and press it in the world."));
    wps.forEach(function (w) {
      var row = el("div", "ocwp-row"), dot = el("button", "ocwp-dot"), nm = el("input", "nm"), xyz = el("span", "ocwp-xyz", w.x + " " + w.y + " " + w.z), vis = el("button", null, w.on === false ? "Hidden" : "Shown"), del = el("button", null, "Delete");
      dot.type = vis.type = del.type = "button"; dot.style.background = w.color; dot.title = "Change the colour";
      nm.type = "text"; nm.value = w.name; nm.spellcheck = false; nm.tabIndex = -1;
      nm.addEventListener("input", function () { updateWaypoint(key, w.id, { name: nm.value || "Waypoint" }); lastScan = 0; });
      dot.addEventListener("click", function () { var i = PALETTE.indexOf(w.color); updateWaypoint(key, w.id, { color: PALETTE[(i + 1) % PALETTE.length] }); lastScan = 0; render(); });
      vis.addEventListener("click", function () { updateWaypoint(key, w.id, { on: w.on === false }); lastScan = 0; render(); });
      del.addEventListener("click", function () { removeWaypoint(key, w.id); lastScan = 0; });
      row.appendChild(dot); row.appendChild(nm); row.appendChild(xyz); row.appendChild(vis); row.appendChild(del);
      box.appendChild(row);
    });
    box.appendChild(el("h4", null, "Add a waypoint"));
    var add = el("div", "ocwp-row"), name = el("input", "nm"), x = el("input", "n"), y = el("input", "n"), z = el("input", "n"), here = el("button", null, "Here"), go = el("button", null, "Add");
    [name, x, y, z].forEach(function (i) { i.type = "text"; i.spellcheck = false; i.tabIndex = -1; });
    name.placeholder = "Name"; x.placeholder = "X"; y.placeholder = "Y"; z.placeholder = "Z"; here.type = go.type = "button";
    here.title = "Fill in the coordinates of where you stand";
    here.addEventListener("click", function () { var p = feet(); if (!p) { api.ui.toast("Stand in a world first.", true); return; } x.value = Math.floor(p.x); y.value = Math.floor(p.y); z.value = Math.floor(p.z); });
    go.addEventListener("click", function () {
      var o = { name: name.value.trim() || undefined };
      if (x.value.trim() !== "" || y.value.trim() !== "" || z.value.trim() !== "") {
        var nx = parseFloat(x.value), ny = parseFloat(y.value), nz = parseFloat(z.value);
        if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) { api.ui.toast("Type all three coordinates, or leave them empty to use where you stand.", true); return; }
        o.x = nx; o.y = ny; o.z = nz;
      }
      if (addWaypoint(o)) { lastScan = 0; }
    });
    [name, x, y, z, here, go].forEach(function (n) { add.appendChild(n); });
    box.appendChild(add);
  }
  panelRender = render;
  render();
});
