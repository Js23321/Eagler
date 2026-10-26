/* ==OneClientMod==
 * @id oc-itemcount
 * @name Item Counter
 * @version 1.0
 * @author OneClient
 * @description Counts the items you pick: golden apples, arrows, ender pearls, totems ... across your whole inventory.
 * @category HUD
 * @icon items
 * @order 30
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;
var PRESETS = [["", "Nothing"], ["golden_apple", "Golden apple"], ["enchanted_golden_apple", "Enchanted golden apple"], ["arrow", "Arrow"], ["ender_pearl", "Ender pearl"],
  ["totem_of_undying", "Totem of Undying"], ["experience_bottle", "Bottle o' Enchanting"], ["firework_rocket", "Firework rocket"], ["cooked_beef", "Steak"], ["bread", "Bread"],
  ["snowball", "Snowball"], ["tnt", "TNT"], ["cobblestone", "Cobblestone"], ["obsidian", "Obsidian"], ["diamond", "Diamond"], ["iron_ingot", "Iron ingot"], ["gold_ingot", "Gold ingot"],
  ["emerald", "Emerald"], ["shield", "Shield"], ["water_bucket", "Water bucket"]];

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Items to count" },
  { type: "info", label: "Pick up to three things from the lists, or type any item's game name (like oak_log or minecraft:diamond_sword) in the box under each list." },
  { k: "p1", type: "choice", label: "First item", opts: PRESETS, def: "golden_apple" }, { k: "c1", type: "text", label: "or type its name", placeholder: "oak_log", def: "" },
  { k: "p2", type: "choice", label: "Second item", opts: PRESETS, def: "arrow" }, { k: "c2", type: "text", label: "or type its name", placeholder: "", def: "" },
  { k: "p3", type: "choice", label: "Third item", opts: PRESETS, def: "ender_pearl" }, { k: "c3", type: "text", label: "or type its name", placeholder: "", def: "" },
  { type: "section", label: "Display" },
  { k: "zero", type: "toggle", label: "Show items you do not have", note: "Off: an item disappears from the list when its count is 0", def: false },
  { k: "icons", type: "toggle", label: "Show icons", def: true }
] }));
if (api.schemaOnly) return;

var inv = api.inventory;
var hud = kit.hud({ anchor: "tc", row: 4 });

function nameOf(i) {
  var s = api.settings, typed = String(s.get("c" + i) || "").trim().toLowerCase().replace(/^minecraft:/, "").replace(/[^a-z0-9_]/g, "_");
  return typed || s.get("p" + i) || "";
}
function update() {
  var s = api.settings;
  if (!api.game.inWorld || !api.net.active || !inv || !inv.ready) { hud.visible(false); return; }
  var icons = kit.icons().items || {}, lines = [];
  for (var i = 1; i <= 3; i++) {
    var n = nameOf(i);
    if (!n) continue;
    var c = inv.count(n);
    if (c === 0 && !s.get("zero")) continue;
    lines.push({ l: s.get("icons") && icons[n] ? "" : fmt.name("item", n), v: String(c), icon: s.get("icons") ? icons[n] : "", c: c === 0 ? "#ff9a9a" : "" });
  }
  hud.visible(lines.length > 0);
  hud.set(lines);
}
api.every(300, update);
inv.onChange(update);
update();
