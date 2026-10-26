/* ==OneClientMod==
 * @id oc-health
 * @name Health
 * @version 1.0
 * @author OneClient
 * @description Your health as a number, in hearts or in health points.
 * @category HUD
 * @icon heart
 * @order 22
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Health" },
  { k: "unit", type: "choice", label: "Unit", opts: [["hp", "Health points (20)"], ["hearts", "Hearts (10)"]], def: "hp" },
  { k: "decimals", type: "range", label: "Decimals", min: 0, max: 2, step: 1, def: 1 },
  { k: "warn", type: "toggle", label: "Colour when low", note: "Yellow under half, red under a quarter", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "br", row: 1 });

function update() {
  var st = api.player.state;
  if (!api.game.inWorld || !api.net.active || !st) { hud.visible(false); return; }
  hud.visible(true);
  var s = api.settings, hp = st.health, v = s.get("unit") === "hearts" ? hp / 2 : hp, c = "";
  if (s.get("warn")) c = hp <= 5 ? "#ff7a7a" : hp <= 10 ? "#ffe27a" : "";
  hud.set([["Health", fmt.fixed(v, s.get("decimals")), c]]);
}
api.every(150, update);
update();
