/* ==OneClientMod==
 * @id oc-tps
 * @name TPS
 * @version 1.0
 * @author OneClient
 * @description How fast the server is ticking. 20 is perfect; lower means the server is lagging.
 * @category HUD
 * @icon gauge
 * @order 19
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "TPS" },
  { k: "quality", type: "toggle", label: "Colour by quality", note: "Green at 19 or more, yellow at 15, red below", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 5 });

function update() {
  var st = api.player.state;
  if (!api.game.inWorld || !api.net.active || !st || st.tps === undefined) { hud.visible(false); return; }
  hud.visible(true);
  var t = st.tps, c = api.settings.get("quality") ? (t >= 19 ? "#7dffb2" : t >= 15 ? "#ffe27a" : "#ff7a7a") : "";
  hud.set([["TPS", fmt.fixed(Math.min(20, t), 1), c]]);
}
api.every(500, update);
update();
