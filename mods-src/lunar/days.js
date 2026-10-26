/* ==OneClientMod==
 * @id oc-days
 * @name Day Counter
 * @version 1.0
 * @author OneClient
 * @description Counts the days the world has been running, like the game's own day count.
 * @category HUD
 * @icon calendar
 * @order 13
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Day Counter" },
  { k: "first", type: "choice", label: "The first day is", note: "Day 0 is what the /time query day command says", opts: [["1", "Day 1"], ["0", "Day 0"]], def: "1" },
  { k: "time", type: "toggle", label: "Show time of day", note: "Morning, day, evening or night next to the count", def: false }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 1 });

function phase(t) {                                           // ticks since dawn
  return t < 6000 ? "Morning" : t < 12000 ? "Afternoon" : t < 13000 ? "Dusk" : t < 23000 ? "Night" : "Dawn";
}
function update() {
  var st = api.player.state, dt = api.net.active && st && st.dayTime ? st.dayTime() : null;
  if (!dt || !dt.known || !api.game.inWorld) { hud.visible(false); return; }
  hud.visible(true);
  var lines = [["Day", String(dt.day + (api.settings.get("first") === "1" ? 1 : 0))]];
  if (api.settings.get("time")) lines.push(["", phase(dt.ticks)]);
  hud.set(lines, { row: true });
}
api.every(500, update);
update();
