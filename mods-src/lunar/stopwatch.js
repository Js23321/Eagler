/* ==OneClientMod==
 * @id oc-stopwatch
 * @name Stopwatch
 * @version 1.0
 * @author OneClient
 * @description A stopwatch you start, stop and reset with keys. Handy for timing runs, farms and builds.
 * @category HUD
 * @icon stopwatch
 * @order 15
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;
var live = false;                                              // false while this code only reads the settings

function toggle() {
  if (!live) { api.ui.toast("Switch the Stopwatch on first, then use these buttons."); return; }
  if (run) { elapsed += performance.now() - t0; run = false; } else { t0 = performance.now(); run = true; }
  update(); api.ui.refresh();
}
function reset() {
  if (!live) { api.ui.toast("Switch the Stopwatch on first, then use these buttons."); return; }
  elapsed = 0; run = false; laps.length = 0; update();
}
function lap() {
  if (!live) { api.ui.toast("Switch the Stopwatch on first, then use these buttons."); return; }
  if (run || elapsed) { laps.unshift(now()); if (laps.length > 5) laps.pop(); update(); }
}

api.keys.register({ id: "toggle", label: "Start / stop", def: "", onDown: toggle });
api.keys.register({ id: "lap", label: "Lap", def: "", onDown: lap });
api.keys.register({ id: "reset", label: "Reset", def: "", onDown: reset });

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Stopwatch" },
  { type: "info", label: "Pick keys below, or use the buttons here while this page is open. A lap is a split time: the watch keeps running." },
  { type: "button", label: "Start / stop", text: function () { return live && run ? "Stop" : "Start"; }, onClick: toggle },
  { type: "button", label: "Lap", text: "Lap", onClick: lap },
  { type: "button", label: "Reset", text: "Reset", onClick: reset },
  { k: "hundredths", type: "toggle", label: "Show hundredths", note: "1:02.37 instead of 1:02", def: true },
  { k: "laps", type: "toggle", label: "Show laps", note: "The last five lap times under the watch", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 3 });
var run = false, t0 = 0, elapsed = 0, laps = [];
live = true;

function now() { return (elapsed + (run ? performance.now() - t0 : 0)) / 1000; }
function update() {
  var s = api.settings, lines = [["Stopwatch", fmt.clock(now(), s.get("hundredths"))]];
  if (s.get("laps")) laps.forEach(function (t, i) { lines.push(["Lap " + (laps.length - i), fmt.clock(t, s.get("hundredths"))]); });
  hud.set(lines);
}
api.every(60, update);
update();
