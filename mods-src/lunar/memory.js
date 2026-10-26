/* ==OneClientMod==
 * @id oc-memory
 * @name Memory Usage
 * @version 1.0
 * @author OneClient
 * @description How much memory the game uses.
 * @category HUD
 * @icon memory
 * @order 17
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Memory" },
  { k: "mode", type: "choice", label: "Show", opts: [["used", "Used"], ["both", "Used / limit"], ["pct", "Percent"]], def: "both" },
  { k: "warn", type: "toggle", label: "Colour when it runs low", note: "Turns yellow, then red, as the limit gets close", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "bl", row: 0 });
var mem = performance && performance.memory;

function update() {
  var s = api.settings;
  if (!mem) { hud.set([["RAM", "not available in this browser"]]); return; }
  var used = mem.usedJSHeapSize / 1048576, max = mem.jsHeapSizeLimit / 1048576, pct = used / max * 100, mode = s.get("mode"), v;
  if (mode === "pct") v = fmt.fixed(pct, 0) + "%";
  else if (mode === "used") v = fmt.fixed(used, 0) + " MB";
  else v = fmt.fixed(used, 0) + " / " + fmt.fixed(max, 0) + " MB";
  var c = s.get("warn") ? (pct > 85 ? "#ff7a7a" : pct > 65 ? "#ffe27a" : "") : "";
  hud.set([["RAM", v, c]]);
}
api.every(1000, update);
update();
