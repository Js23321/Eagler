/* ==OneClientMod==
 * @id oc-speed
 * @name Speedometer
 * @version 1.0
 * @author OneClient
 * @description How fast you are moving.
 * @category HUD
 * @icon gauge
 * @order 20
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Speedometer" },
  { k: "unit", type: "choice", label: "Unit", opts: [["bps", "Blocks per second"], ["kmh", "km/h"], ["mph", "mph"]], def: "bps" },
  { k: "vertical", type: "toggle", label: "Count up and down too", note: "Off: only sideways movement counts", def: false },
  { k: "decimals", type: "range", label: "Decimals", min: 0, max: 2, step: 1, def: 1 }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "bl", row: 2 });
var last = null, lastT = 0, speed = 0, shown = "";

/* sample the camera every frame; smooth over a quarter of a second */
api.events.on("frame", function () {
  var c = api.game.cam, now = performance.now();
  if (!c || !api.game.inWorld) { last = null; return; }
  if (last) {
    var dt = (now - lastT) / 1000;
    if (dt > 0.004 && dt < 0.5) {
      var dx = c.x - last.x, dy = api.settings.get("vertical") ? c.y - last.y : 0, dz = c.z - last.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 12) speed += (d / dt - speed) * Math.min(1, dt / 0.25);        // a jump of many blocks is a teleport, not speed
    }
  }
  last = { x: c.x, y: c.y, z: c.z }; lastT = now;
});

function update() {
  var s = api.settings, u = s.get("unit"), v = speed < 0.02 ? 0 : speed, txt;
  if (!api.game.inWorld) { hud.visible(false); return; }
  hud.visible(true);
  if (u === "kmh") txt = fmt.fixed(v * 3.6, s.get("decimals")) + " km/h";
  else if (u === "mph") txt = fmt.fixed(v * 2.23694, s.get("decimals")) + " mph";
  else txt = fmt.fixed(v, s.get("decimals")) + " b/s";
  if (txt !== shown) { shown = txt; hud.set([["Speed", txt]]); }
}
api.every(100, update);
update();
