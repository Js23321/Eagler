/* ==OneClientMod==
 * @id oc-packs
 * @name Pack Display
 * @version 1.0
 * @author OneClient
 * @description Shows which resource packs are switched on, the top one first.
 * @category HUD
 * @icon pack
 * @order 28
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Pack Display" },
  { k: "vanilla", type: "toggle", label: "Include the game's own assets", note: "The built-in pack that is always at the bottom", def: false },
  { k: "max", type: "range", label: "Most packs shown", min: 1, max: 12, step: 1, unit: "", def: 5 },
  { k: "title", type: "toggle", label: "Show a heading", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "bl", row: 3 });
var names = null, reading = false;

function bytes64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
/* the game keeps its settings in localStorage as gzip + base64 of options.txt; the line resourcePacks:["vanilla","file/..."] lists the packs, bottom first */
function read() {
  if (reading || typeof DecompressionStream !== "function") return;
  var raw = null;
  try { raw = localStorage.getItem("_eaglercraftX.g"); } catch (e) {}
  if (!raw) { names = []; return; }
  reading = true;
  new Response(new Blob([bytes64(raw)]).stream().pipeThrough(new DecompressionStream("gzip"))).text().then(function (txt) {
    var m = /^resourcePacks:(.*)$/m.exec(txt), list = [];
    try { list = JSON.parse(m ? m[1] : "[]"); } catch (e) {}
    names = list.map(function (n) { return String(n).replace(/^file\//, ""); }).filter(function (n) { return n !== "OneClient"; });     // an older build's marker pack: not a pack any more
    reading = false;
  }, function () { reading = false; });
}

function update() {
  var s = api.settings;
  if (names === null) { read(); return; }
  var list = names.filter(function (n) { return n !== "vanilla" || s.get("vanilla"); }).reverse().slice(0, s.get("max"));
  var lines = [];
  if (s.get("title")) lines.push(["", "Resource packs", "#9cd0ff"]);
  if (!list.length) lines.push(["", "None"]);
  list.forEach(function (n) { lines.push(["", n === "vanilla" ? "Default" : n]); });
  hud.set(lines);
}
api.every(400, update);
api.every(4000, read);                                              // the list changes when you pick packs in the game's options
api.events.on("screen", read);
read(); update();
