/* ==OneClientMod==
 * @id oc-clock
 * @name Clock
 * @version 1.0
 * @author OneClient
 * @description The time: your real clock, the game's clock, or both.
 * @category HUD
 * @icon clock
 * @order 12
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Clock" },
  { k: "source", type: "choice", label: "Show", opts: [["real", "Real time"], ["game", "Game time"], ["both", "Both"]], def: "real" },
  { k: "h24", type: "toggle", label: "24-hour clock", note: "Off: 3:07 PM style", def: false },
  { k: "seconds", type: "toggle", label: "Show seconds", note: "Real time only", def: false }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 0 });

function two(n) { return fmt.pad2(n); }
function stamp(h, m, sec, h24, seconds) {
  var t;
  if (h24) t = two(h) + ":" + two(m);
  else t = (h % 12 === 0 ? 12 : h % 12) + ":" + two(m);
  if (seconds && sec !== null) t += ":" + two(sec);
  if (!h24) t += h < 12 ? " AM" : " PM";
  return t;
}

function update() {
  var s = api.settings, src = s.get("source"), h24 = s.get("h24"), lines = [];
  if (src !== "game") { var d = new Date(); lines.push(["Time", stamp(d.getHours(), d.getMinutes(), d.getSeconds(), h24, s.get("seconds"))]); }
  if (src !== "real") {
    var st = api.player.state, dt = api.net.active && st && st.dayTime ? st.dayTime() : null;
    if (dt && dt.known) {
      var hours = (dt.ticks / 1000 + 6) % 24, h = Math.floor(hours), m = Math.floor((hours - h) * 60);       // tick 0 is dawn: 6:00
      lines.push([src === "both" ? "Game" : "Time", stamp(h, m, null, h24, false)]);
    } else lines.push([src === "both" ? "Game" : "Time", "-"]);
  }
  hud.visible(src === "real" || api.game.inWorld);
  hud.set(lines);
}
api.every(250, update);
update();
