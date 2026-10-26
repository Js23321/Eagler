/* ==OneClientMod==
 * @id oc-cooldowns
 * @name Cooldowns
 * @version 1.0
 * @author OneClient
 * @description Lists the items you cannot use for a moment (ender pearls, chorus fruit, shields ...) with the time that is left.
 * @category HUD
 * @icon hourglass
 * @order 31
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Cooldowns" },
  { k: "icons", type: "toggle", label: "Show item pictures", def: true },
  { k: "decimals", type: "range", label: "Decimals on the time", min: 0, max: 2, step: 1, def: 1 },
  { k: "idle", type: "choice", label: "When nothing is cooling down", opts: [["hide", "Hide it"], ["show", "Show a dash"]], def: "hide" }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tl", row: 0 });
var cds = {};                                                      // item group ("minecraft:ender_pearl") -> { end: ms, total: ticks }
var IDS = api.net.ids.cb;

/* the game tells us when a cooldown starts (the group of items and how many ticks) and when it ends early (0 ticks) */
api.net.onPacket("in", IDS.cooldown, function (r) {
  var group = r.string(), ticks = r.varint();
  if (ticks <= 0) delete cds[group]; else cds[group] = { end: performance.now() + ticks * 50, total: ticks };
});
api.net.onPacket("in", IDS.login, function () { cds = {}; });       // a new world or server starts with no cooldowns

function update() {
  var now = performance.now(), s = api.settings, d = s.get("decimals"), icons = kit.icons().items || {}, lines = [];
  if (!api.game.inWorld || !api.net.active) { hud.set([["Cooldowns", "-"]]); hud.visible(false); return; }
  Object.keys(cds).forEach(function (g) {
    var left = cds[g].end - now;
    if (left <= 0) { delete cds[g]; return; }
    var id = g.replace(/^minecraft:/, "");
    lines.push({ v: fmt.name("item", id), a: fmt.fixed(left / 1000, d) + "s", icon: s.get("icons") ? icons[id] : "", left: left });
  });
  lines.sort(function (a, b) { return b.left - a.left; });
  hud.visible(lines.length > 0 || s.get("idle") === "show");
  hud.set(lines.length ? lines : [["Cooldowns", "-"]]);
}
api.every(100, update);
update();
