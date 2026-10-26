/* ==OneClientMod==
 * @id oc-playtime
 * @name Playtime
 * @version 1.0
 * @author OneClient
 * @description How long you have been playing: this visit to a world, or all the time you ever spent in OneClient worlds.
 * @category HUD
 * @icon hourglass
 * @order 14
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Playtime" },
  { k: "scope", type: "choice", label: "Count", opts: [["world", "This visit"], ["total", "All time"]], def: "world" },
  { k: "paused", type: "toggle", label: "Keep counting in menus", note: "Off: the clock stops while no world is on screen", def: false }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 2 });
var visit = 0, total = api.storage.get("total", 0), last = performance.now(), saved = 0;

api.events.on("enter-world", function () { visit = 0; });
function update() {
  var now = performance.now(), dt = now - last;
  last = now;
  if (dt > 5000) dt = 0;                                       // the tab was asleep
  if (api.game.inWorld || api.settings.get("paused")) { visit += dt; total += dt; }
  if (now - saved > 15000) { saved = now; api.storage.set("total", total); }
  var ms = api.settings.get("scope") === "world" ? visit : total;
  hud.visible(api.game.inWorld || api.settings.get("paused"));
  hud.set([["Playtime", fmt.clock(ms / 1000)]]);
}
api.onDisable(function () { api.storage.set("total", total); });
api.every(250, update);
update();
