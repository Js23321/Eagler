/* ==OneClientMod==
 * @id oc-ping
 * @name Ping
 * @version 1.0
 * @author OneClient
 * @description Your connection delay to the server, in milliseconds.
 * @category HUD
 * @icon signal
 * @order 18
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Ping" },
  { k: "quality", type: "toggle", label: "Colour by quality", note: "Green is good, yellow is slow, red is bad", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 4 });

function update() {
  var st = api.player.state, ms = api.net.active && st ? st.latency : -1;
  if (!api.game.inWorld) { hud.visible(false); return; }
  hud.visible(true);
  if (ms < 0) { hud.set([["Ping", "-"]]); return; }
  var c = api.settings.get("quality") ? (ms < 80 ? "#7dffb2" : ms < 180 ? "#ffe27a" : "#ff7a7a") : "";
  hud.set([["Ping", ms + " ms", c]]);
}
api.every(500, update);
update();
