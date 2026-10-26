/* ==OneClientMod==
 * @id oc-saturation
 * @name Saturation
 * @version 1.0
 * @author OneClient
 * @description Shows your hidden saturation, the buffer that keeps your food bar from dropping.
 * @category HUD
 * @icon apple
 * @order 21
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Saturation" },
  { k: "food", type: "toggle", label: "Also show the food level", note: "The visible food bar, out of 20", def: true },
  { k: "decimals", type: "range", label: "Decimals", min: 0, max: 2, step: 1, def: 1 }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "br", row: 0 });

function update() {
  var st = api.player.state;
  if (!api.game.inWorld || !api.net.active || !st) { hud.visible(false); return; }
  hud.visible(true);
  var d = api.settings.get("decimals"), lines = [["Saturation", fmt.fixed(st.saturation, d)]];
  if (api.settings.get("food")) lines.unshift(["Food", fmt.int(st.food)]);
  hud.set(lines, { row: true });
}
api.every(200, update);
update();
