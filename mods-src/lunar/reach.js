/* ==OneClientMod==
 * @id oc-reach
 * @name Reach Display
 * @version 1.0
 * @author OneClient
 * @description Shows how far away the last thing you hit was, in blocks.
 * @category HUD
 * @icon ruler
 * @order 25
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Reach Display" },
  { k: "decimals", type: "range", label: "Decimals", min: 0, max: 3, step: 1, def: 2 },
  { k: "hold", type: "range", label: "Keep showing for", note: "After the last hit", min: 1, max: 15, step: 1, unit: "s", def: 4 },
  { k: "idle", type: "choice", label: "When nothing was hit lately", opts: [["show", "Show a dash"], ["hide", "Hide it"]], def: "show" }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 7 });
var lastHit = 0, reach = null;

api.player.onEvent(function (type) {
  if (type !== "swing") return;
  var st = api.player.state;
  if (st && st.reach !== null && st.reach !== undefined) { reach = st.reach; lastHit = performance.now(); }
});

function update() {
  var s = api.settings, fresh = reach !== null && performance.now() - lastHit < s.get("hold") * 1000;
  if (!api.game.inWorld) { hud.visible(false); return; }
  hud.visible(fresh || s.get("idle") === "show");
  hud.set([["Reach", fresh ? fmt.fixed(reach, s.get("decimals")) + " blocks" : "-"]]);
}
api.every(100, update);
update();
