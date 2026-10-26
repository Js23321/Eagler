/* ==OneClientMod==
 * @id oc-direction
 * @name Direction HUD
 * @version 1.0
 * @author OneClient
 * @description A compass strip (or a line of text) that shows which way you are facing.
 * @category HUD
 * @icon compass
 * @order 11
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Direction" },
  { k: "style", type: "choice", label: "Style", opts: [["bar", "Compass strip"], ["text", "Text"]], def: "bar" },
  { k: "degrees", type: "toggle", label: "Show degrees", note: "The heading in degrees (0 is north, 90 east)", def: true },
  { k: "axis", type: "toggle", label: "Show axis", note: "Text style: which axis you are facing, like +Z", def: true },
  { k: "ticks", type: "toggle", label: "Marks every 15 degrees", note: "Compass strip: small marks between the letters", def: true }
] }));
if (api.schemaOnly) return;

var NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
var LONG = ["North", "North east", "East", "South east", "South", "South west", "West", "North west"];
var AXIS = ["-Z", "+X -Z", "+X", "+X +Z", "+Z", "-X +Z", "-X", "-X -Z"];
var PX = 3.2;                                                   // pixels per degree on the strip

/* heading: 0 = north, 90 = east (the game's yaw is 0 = south, 90 = west) */
function heading() {
  var c = api.game.cam;
  return c ? (((c.yaw + 180) % 360) + 360) % 360 : null;
}

/* the compass strip: one element per 15 degrees, moved every update */
function makeBar() {
  var bar = document.createElement("div"), marks = [], center = document.createElement("b"), deg = document.createElement("em");
  bar.className = "oc-compass";
  for (var h = 0; h < 360; h += 15) {
    var el = document.createElement("i"), main = h % 90 === 0, mid = h % 45 === 0;
    el.className = main ? (h === 0 ? "n" : "") : mid ? "m" : "t";
    el.textContent = main || mid ? NAMES[h / 45] : "";
    bar.appendChild(el);
    marks.push({ el: el, h: h, mid: mid || main, hide: null, shown: null });
  }
  bar.appendChild(center); bar.appendChild(deg);
  kit.look(bar);
  return { bar: bar, marks: marks, deg: deg };
}

var cur = null;                                                 // { style, w, bar? }
function build(style) {
  if (cur) cur.w.remove();
  if (style === "bar") { var b = makeBar(); cur = { style: style, bar: b, w: kit.widget({ id: "bar", anchor: "tc", row: 0 }, b.bar) }; }
  else cur = { style: style, w: kit.hud({ id: "text", anchor: "tc", row: 0 }) };
}

function update() {
  var hd = heading(), s = api.settings, style = s.get("style");
  if (!cur || cur.style !== style) build(style);
  if (hd === null || !api.game.inWorld) { cur.w.visible(false); return; }
  cur.w.visible(true);
  if (style === "bar") {
    var b = cur.bar, ticks = s.get("ticks"), W = b.bar.clientWidth || 280;
    for (var i = 0; i < b.marks.length; i++) {
      var m = b.marks[i], dlt = ((m.h - hd + 540) % 360) - 180;
      if (Math.abs(dlt) * PX > W / 2 + 30) { if (m.hide !== true) { m.el.style.visibility = "hidden"; m.hide = true; } continue; }
      if (m.hide !== false) { m.el.style.visibility = ""; m.hide = false; }
      m.el.style.left = (W / 2 + dlt * PX).toFixed(1) + "px";
      var show = m.mid || ticks;
      if (m.shown !== show) { m.shown = show; m.el.style.display = show ? "" : "none"; }
    }
    var dg = s.get("degrees");
    b.deg.style.display = dg ? "" : "none";
    if (dg) b.deg.textContent = (Math.round(hd) % 360) + " deg";
  } else {
    var idx = Math.round(hd / 45) % 8, parts = [["", LONG[idx]]];
    if (s.get("axis")) parts.push(["", "(" + AXIS[idx] + ")"]);
    if (s.get("degrees")) parts.push(["", (Math.round(hd) % 360) + " deg"]);
    cur.w.set(parts, { row: true });
  }
}
api.every(50, update);
update();
