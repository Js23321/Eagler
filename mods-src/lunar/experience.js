/* ==OneClientMod==
 * @id oc-xp
 * @name Experience
 * @version 1.0
 * @author OneClient
 * @description Your experience level, how far you are to the next one, and your total points.
 * @category HUD
 * @icon star
 * @order 23
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Experience" },
  { k: "progress", type: "toggle", label: "Show progress", note: "How far you are to the next level", def: true },
  { k: "total", type: "toggle", label: "Show total points", note: "Every point you have collected", def: false }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "br", row: 2 });

function update() {
  var st = api.player.state;
  if (!api.game.inWorld || !api.net.active || !st) { hud.visible(false); return; }
  hud.visible(true);
  var s = api.settings, lines = [["Level", String(st.level)]];
  if (s.get("progress")) lines.push(["Next", fmt.fixed(st.xpProgress * 100, 0) + "%"]);
  if (s.get("total")) lines.push(["Points", String(st.xpTotal)]);
  hud.set(lines, { row: true });
}
api.every(250, update);
update();
