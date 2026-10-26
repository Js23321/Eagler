/* ==OneClientMod==
 * @id coords
 * @name Coordinates
 * @version 1.0
 * @author OneClient
 * @description Shows your exact position, the direction you face and the block you stand in.
 * ==/OneClientMod== */

// Reads the camera the game itself renders with (api.game.cam), so it needs no help from the game's code.

api.settings.define([
  { key: "decimals", type: "range", label: "Decimals", min: 0, max: 3, step: 1, unit: "", default: 1 },
  { key: "block", type: "toggle", label: "Show block position", default: true },
  { key: "facing", type: "toggle", label: "Show direction", default: true }
]);

var w = api.hud.text({ id: "xyz", text: "XYZ -", x: 12, y: 260 });
var DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];

api.events.on("frame", function (n, inWorld) {
  if (n % 6) return;                                      // ten times a second is plenty
  var c = api.game.cam;
  if (!inWorld || !c) { w.set("XYZ -"); return; }
  var d = api.settings.get("decimals"), p = function (v) { return v.toFixed(d); };
  var s = "XYZ " + p(c.x) + " / " + p(c.y) + " / " + p(c.z);
  if (api.settings.get("block")) s += "   Block " + Math.floor(c.x) + " " + Math.floor(c.y) + " " + Math.floor(c.z);
  if (api.settings.get("facing")) s += "   " + DIRS[Math.round((((c.yaw % 360) + 360) % 360) / 45) % 8] + " " + c.yaw.toFixed(0) + "/" + c.pitch.toFixed(0);
  w.set(s);
});

api.keys.register({
  id: "copy", label: "Copy position", def: "",
  onDown: function () {
    var c = api.game.cam;
    if (!c) return;
    var text = Math.floor(c.x) + " " + Math.floor(c.y) + " " + Math.floor(c.z);
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { api.ui.toast("Copied " + text); }, function () { api.ui.toast("Could not copy", true); });
  }
});
