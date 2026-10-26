/* ==OneClientMod==
 * @id oc-tnt
 * @name TNT Countdown
 * @version 1.0
 * @author OneClient
 * @description Floats the time left over every lit TNT, from green to red as it gets close to going off.
 * @category World
 * @icon bomb
 * @order 44
 * @needs camera
 * ==/OneClientMod== */
api.settings.define([
  { type: "section", label: "TNT Countdown" },
  { k: "unit", type: "choice", label: "Show the time as", opts: [["s", "Seconds (3.2)"], ["ticks", "Game ticks (64)"]], def: "s" },
  { k: "decimals", type: "range", label: "Decimals", min: 0, max: 2, step: 1, def: 1, when: function (c) { return c.unit !== "ticks"; } },
  { k: "colors", type: "toggle", label: "Colour by time left", note: "Green, then yellow, then red in the last second", def: true },
  { k: "minecarts", type: "toggle", label: "Include TNT minecarts", def: true },
  { k: "range", type: "range", label: "Hide TNT further than", note: "0 shows it at any distance", min: 0, max: 128, step: 4, unit: "blocks", def: 0 },
  { k: "most", type: "range", label: "Most labels at once", note: "The nearest ones win when a cannon fires", min: 5, max: 100, step: 5, def: 30 },
  { k: "size", type: "range", label: "Text size", min: 10, max: 28, step: 1, unit: "px", def: 15 }
]);
if (api.schemaOnly) return;

var IDS = api.net.ids.cb, EVENT_TNT_MINECART_LIT = 10, FUSE_INDEX = 8, SERIALIZER_INT = 1, SERIALIZER_BYTE = 0;
var fuses = {};                                                    // entity id -> { ticks: left when last heard, at: ms }

function lit(id, ticks) { fuses[id] = { ticks: ticks, at: performance.now() }; }
api.entities.list().forEach(function (e) { if (e.name === "tnt") lit(e.id, 80); });     // TNT that was already burning when the mod came on

/* a lit TNT starts at 80 ticks unless it was spawned with another fuse, and the server tells us the real value every tick */
api.entities.onChange(function (type, e) {
  if (type === "reset") { fuses = {}; return; }
  if (type === "remove") { delete fuses[e.id]; return; }
  if (e.name === "tnt") lit(e.id, 80);
});
api.net.onPacket("in", IDS.setEntityData, function (r) {
  var id = r.varint();
  if (!api.entities.get(id) || api.entities.get(id).name !== "tnt") return;
  for (;;) {
    var idx = r.u8();
    if (idx === 255) return;
    var kind = r.varint();
    if (kind === SERIALIZER_INT) { var v = r.varint(); if (idx === FUSE_INDEX) { lit(id, v); return; } }
    else if (kind === SERIALIZER_BYTE) r.skip(1);
    else return;                                                   // a value we do not know the size of: the fuse is not in this packet
  }
});
api.net.onPacket("in", IDS.entityEvent, function (r) {             // a TNT minecart that has been set alight (its fuse is not sent, it runs 80 ticks)
  var id = r.i32(), ev = r.i8(), e = api.entities.get(id);
  if (e && e.name === "tnt_minecart" && ev === EVENT_TNT_MINECART_LIT) lit(id, 80);
});

var layer = api.dom.layer(), els = {};
api.dom.style(".octnt-l{position:absolute;left:0;top:0;padding:2px 8px;border-radius:8px;background:rgba(12,14,20,.55);border:1px solid rgba(255,255,255,.2);font:700 15px/1.2 'Segoe UI',system-ui,sans-serif;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,.8);will-change:transform;display:none;color:#fff}");

function label(id) {
  var e = els[id];
  if (!e) {
    var el = document.createElement("div");
    el.className = "octnt-l"; layer.appendChild(el);
    e = els[id] = { el: el, text: null, color: null, shown: false };
  }
  return e;
}
function hide(e) { if (e.shown) { e.el.style.display = "none"; e.shown = false; } }
function hideAll() { Object.keys(els).forEach(function (k) { hide(els[k]); }); }

api.events.on("frame", function () {
  var cam = api.game.cam, s = api.settings;
  if (!cam || !api.game.inWorld) { hideAll(); return; }
  var now = performance.now(), range = s.get("range"), most = s.get("most"), size = s.get("size"), ticksMode = s.get("unit") === "ticks", dec = s.get("decimals"), colors = s.get("colors"), carts = s.get("minecarts");
  var list = [];
  Object.keys(fuses).forEach(function (k) {
    var id = +k, f = fuses[k], e = api.entities.get(id);
    if (!e) return;
    if (e.name === "tnt_minecart" && !carts) return;
    var dx = e.x - cam.x, dy = e.y - cam.y, dz = e.z - cam.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (range > 0 && dist > range) return;
    list.push({ id: id, e: e, dist: dist, left: Math.max(0, f.ticks - (now - f.at) / 50) });     // the tick count runs on between the server's updates
  });
  list.sort(function (a, b) { return a.dist - b.dist; });
  var seen = {};
  for (var i = 0; i < list.length && i < most; i++) {
    var it = list[i], el = label(it.id), p = api.game.project(it.e.x, it.e.y + it.e.h + 0.45, it.e.z);
    seen[it.id] = true;
    if (!p || !p.visible) { hide(el); continue; }
    var txt = ticksMode ? String(Math.ceil(it.left)) : (it.left / 20).toFixed(dec) + "s";
    if (el.text !== txt) { el.text = txt; el.el.textContent = txt; }
    var col = !colors ? "#ffffff" : it.left > 40 ? "#7dffb2" : it.left > 20 ? "#ffe27a" : "#ff6b6b";
    if (el.color !== col) { el.color = col; el.el.style.color = col; }
    el.el.style.fontSize = size + "px";
    el.el.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px) translate(-50%,-100%)";
    if (!el.shown) { el.el.style.display = "block"; el.shown = true; }
  }
  Object.keys(els).forEach(function (k) {
    if (seen[k]) return;
    if (!fuses[k]) { if (els[k].el.parentNode) els[k].el.parentNode.removeChild(els[k].el); delete els[k]; }   // that TNT is gone
    else hide(els[k]);
  });
});
