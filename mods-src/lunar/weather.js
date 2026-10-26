/* ==OneClientMod==
 * @id oc-weather
 * @name Weather Changer
 * @version 1.0
 * @author OneClient
 * @description Chooses the weather you see: clear, rain or a thunderstorm, whatever the server says. Only on your screen.
 * @category Visual
 * @icon rain
 * @order 57
 * @needs rewrite
 * ==/OneClientMod== */
api.settings.define([
  { type: "section", label: "Weather" },
  { k: "mode", type: "choice", label: "Weather", opts: [["clear", "Clear"], ["rain", "Rain"], ["storm", "Thunderstorm"]], def: "clear" },
  { type: "info", label: "This changes what you see and hear; the weather on the server stays as it is. Switch the mod off and your screen goes back to the real weather." }
]);
if (api.schemaOnly) return;

var warned = false;
api.every(3000, function () {
  if (!api.net.active || api.net.canRewrite || warned) return;
  warned = true;
  api.ui.toast(api.net.encrypted ? "This server encrypts its connection, so Weather Changer cannot change what you see here." : "Weather Changer cannot change this connection.");
});
var EV = { START_RAINING: 1, STOP_RAINING: 2, RAIN_LEVEL: 7, THUNDER_LEVEL: 8 }, GAME_EVENT = api.net.ids.cb.gameEvent;

function want() {
  var m = api.settings.get("mode");
  return { rain: m === "clear" ? 0 : 1, thunder: m === "storm" ? 1 : 0 };
}
function send(ev, v) { api.net.inject(GAME_EVENT, new api.net.Writer().u8(ev).f32(v).toU8()); }
function apply(rain, thunder) {                                  // put the game's weather into this state right now
  send(rain > 0 ? EV.START_RAINING : EV.STOP_RAINING, 0);
  send(EV.RAIN_LEVEL, rain);
  send(EV.THUNDER_LEVEL, thunder);
}

/* from now on every weather message of the server is bent to the chosen weather */
api.net.rewrite(GAME_EVENT, function (r) {
  var ev = r.u8(), v = r.f32(), w = want();
  if (ev === EV.START_RAINING) return w.rain > 0 ? undefined : false;
  if (ev === EV.STOP_RAINING) return w.rain > 0 ? false : undefined;
  if (ev === EV.RAIN_LEVEL) return new api.net.Writer().u8(ev).f32(w.rain).toU8();
  if (ev === EV.THUNDER_LEVEL) return new api.net.Writer().u8(ev).f32(w.thunder).toU8();
});

function applyNow() { var w = want(); apply(w.rain, w.thunder); }
applyNow();
api.settings.onChange(function (k) { if (k === "mode") applyNow(); });
api.events.on("enter-world", function () { setTimeout(applyNow, 1500); });         // a new world starts with its own weather: set ours once it has loaded

/* switched off: back to what the server really has (the packet tap above saw every real weather message) */
api.onDisable(function () {
  var st = api.player.state;
  if (st) apply(st.raining ? Math.max(st.rain, 0.01) : 0, st.thunder || 0);
});
