/* ==OneClientMod==
 * @id oc-combo
 * @name Combo Counter
 * @version 1.0
 * @author OneClient
 * @description Counts the hits you land in a row. It resets when you get hit or stop hitting for a moment.
 * @category HUD
 * @icon flame
 * @order 24
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Combo Counter" },
  { k: "timeout", type: "range", label: "Reset after", note: "No hit for this long ends the combo", min: 1, max: 10, step: 0.5, unit: "s", def: 3 },
  { k: "idle", type: "choice", label: "When there is no combo", opts: [["show", "Show 0"], ["hide", "Hide it"]], def: "show" }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 6 });

function update() {
  var st = api.player.state, s = api.settings;
  if (!api.game.inWorld || !st) { hud.visible(false); return; }
  var cb = st.combo, fresh = cb.count > 0 && performance.now() - cb.at < s.get("timeout") * 1000, n = fresh ? cb.count : 0;
  hud.visible(n > 0 || s.get("idle") === "show");
  hud.set([["Combo", String(n)]]);
}
api.every(100, update);
update();
