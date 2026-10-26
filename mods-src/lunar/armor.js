/* ==OneClientMod==
 * @id oc-armor
 * @name Armor Status
 * @version 1.0
 * @author OneClient
 * @description Shows the armor you wear (and the item in your hand) with how much durability is left.
 * @category HUD
 * @icon shield
 * @order 29
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Armor Status" },
  { k: "dir", type: "choice", label: "Layout", opts: [["row", "Row"], ["col", "Column"]], def: "row" },
  { k: "mode", type: "choice", label: "Durability", opts: [["left", "Points left"], ["pct", "Percent"], ["frac", "Left / total"], ["none", "Only the bar"]], def: "left" },
  { k: "bar", type: "toggle", label: "Durability bar", note: "A small bar under each item that goes from green to red", def: true },
  { k: "held", type: "toggle", label: "Item in your hand", note: "Also shows what you hold, with its durability or how many you carry", def: true },
  { k: "off", type: "toggle", label: "Item in your other hand", def: false },
  { k: "empty", type: "toggle", label: "Show empty armor slots", note: "A faded slot where nothing is worn", def: false },
  { k: "warn", type: "toggle", label: "Flash when almost broken", note: "The item blinks under 10% durability", def: true }
] }));
if (api.schemaOnly) return;

var inv = api.inventory;
var box = document.createElement("div");
box.className = "oc-armor";
kit.look(box);
var w = kit.widget({ id: "main", anchor: "bc", row: 2 }, box);
var rows = {};                                                   // slot key -> { el, img, bar, fill, txt }

function rowFor(key) {
  var r = rows[key];
  if (r) return r;
  var el = document.createElement("div"), img = document.createElement("img"), ph = document.createElement("b"), bar = document.createElement("div"), fill = document.createElement("i"), txt = document.createElement("span");
  el.className = "oa-s"; img.className = "oa-i"; ph.className = "oa-p"; bar.className = "oa-b"; txt.className = "oa-t";
  bar.appendChild(fill);
  el.appendChild(img); el.appendChild(ph); el.appendChild(bar); el.appendChild(txt);
  r = rows[key] = { el: el, img: img, ph: ph, bar: bar, fill: fill, txt: txt, name: null, state: "" };
  return r;
}

function describe(st, mode, stack) {
  if (!stack.maxDamage) return stack.count > 1 ? "x" + stack.count : "";
  var left = Math.max(0, stack.maxDamage - stack.damage), pct = Math.round(left / stack.maxDamage * 100);
  if (mode === "pct") return pct + "%";
  if (mode === "frac") return left + "/" + stack.maxDamage;
  if (mode === "none") return "";
  return String(left);
}

function paint(r, stack, s, fadedEmpty) {
  var icons = kit.icons().items || {};
  if (!stack) {
    r.img.style.display = "none"; r.ph.style.display = "none"; r.bar.style.display = "none"; r.txt.textContent = "";
    r.el.classList.toggle("faded", !!fadedEmpty);
    return;
  }
  r.el.classList.remove("faded");
  var src = icons[stack.name];
  if (src) { if (r.name !== stack.name) { r.img.src = src; r.name = stack.name; } r.img.style.display = ""; r.ph.style.display = "none"; }
  else { r.img.style.display = "none"; r.ph.style.display = ""; r.ph.textContent = fmt.name("item", stack.name).charAt(0); }
  r.img.title = fmt.name("item", stack.name) + (stack.enchants.length ? " (enchanted)" : "");
  r.img.classList.toggle("ench", stack.enchants.length > 0);
  var wear = stack.maxDamage ? Math.max(0, Math.min(1, 1 - stack.damage / stack.maxDamage)) : 1;
  if (stack.maxDamage && s.get("bar")) {
    r.bar.style.display = "";
    r.fill.style.width = Math.round(wear * 100) + "%";
    r.fill.style.background = "hsl(" + Math.round(wear * 120) + ",85%,55%)";
  } else r.bar.style.display = "none";
  var t = describe(s, s.get("mode"), stack);
  if (r.txt.textContent !== t) r.txt.textContent = t;
  r.el.classList.toggle("blink", !!(s.get("warn") && stack.maxDamage && wear < 0.1));
}

function update() {
  var s = api.settings;
  if (!api.game.inWorld || !api.net.active || !inv || !inv.ready) { w.visible(false); return; }
  var keys = [], stacks = {};
  var armor = inv.armor();
  ["head", "chest", "legs", "feet"].forEach(function (k, i) { stacks[k] = armor[i]; keys.push(k); });
  if (s.get("held")) { stacks.hand = inv.mainHand(); keys.push("hand"); }
  if (s.get("off")) { stacks.off = inv.offHand(); keys.push("off"); }
  box.setAttribute("data-dir", s.get("dir"));
  var shown = 0;
  keys.forEach(function (k) {
    var r = rowFor(k), st = stacks[k], isArmor = k !== "hand" && k !== "off";
    var visible = !!st || (isArmor && s.get("empty"));
    if (r.el.parentNode !== box) box.appendChild(r.el);
    r.el.style.display = visible ? "" : "none";
    if (visible) { paint(r, st, s, isArmor); shown++; }
  });
  Object.keys(rows).forEach(function (k) { if (keys.indexOf(k) < 0 && rows[k].el.parentNode) rows[k].el.parentNode.removeChild(rows[k].el); });
  w.visible(shown > 0);
}
api.every(300, update);
inv.onChange(update);
update();
