/* ==OneClientMod==
 * @id oc-time
 * @name Time Changer
 * @version 1.0
 * @author OneClient
 * @description Sets the time of day you see, only on your screen: the server and other players keep the real time.
 * @category Visual
 * @icon moon
 * @order 56
 * @needs rewrite
 * ==/OneClientMod== */
api.settings.define([
  { type: "section", label: "Time of day" },
  { k: "hour", type: "range", label: "Time", note: "As on a clock: 6 is sunrise, 12 is noon, 18 is sunset and 0 is midnight", min: 0, max: 24, step: 0.5, unit: "h", def: 12 },
  { k: "preset", type: "choice", label: "Quick pick", opts: [["", "Custom"], ["6", "Sunrise"], ["12", "Noon"], ["18", "Sunset"], ["0", "Midnight"]], def: "" },
  { type: "info", label: "The time stands still at the hour you pick. Switch the mod off and the real time comes back at once. This changes what you see; it does not change the world's time." }
]);
if (api.schemaOnly) return;

var CLOCK_DAY = 0, SET_TIME = api.net.ids.cb.setTime;            // clock 0 is the overworld's day
var warned = false;
api.every(3000, function () {
  if (!api.net.active || api.net.canRewrite || warned) return;
  warned = true;
  api.ui.toast(api.net.encrypted ? "This server encrypts its connection, so Time Changer cannot change what you see here." : "Time Changer cannot change this connection.");
});

/* put the chosen time on the screen right now, without waiting for the server's next time packet */
function applyNow() {
  var st = api.player.state, c = st && st.clockNow ? st.clockNow() : null;
  if (!c) return;
  var want = ((api.settings.get("hour") - 6 + 24) % 24) * 1000;
  api.net.inject(SET_TIME, new api.net.Writer().i64(c.gameTime).varint(1).varint(CLOCK_DAY).varlong(Math.floor(c.total / 24000) * 24000 + Math.round(want)).f32(0).f32(0).toU8());
}
api.settings.onChange(function (k, v) {
  if (k === "preset" && v !== "") { api.settings.set("hour", parseFloat(v)); api.settings.set("preset", ""); }
  else if (k === "hour") applyNow();
});

/* set_time: the game time (long), then the clocks that changed: id, total ticks (varlong), partial tick (float), rate (float). The server only lists
 * the day clock when it changes, so ours is added to every packet; rate 0 makes the game's own clock stand still. */
api.net.rewrite(SET_TIME, function (r) {
  var game = r.bytes(8), n = r.varint(), entries = [], day = -1, i;
  for (i = 0; i < n; i++) {
    var id = r.varint(), total = r.varlong(), part = r.f32(), rate = r.f32();
    if (id === CLOCK_DAY) day = Math.floor(total / 24000);
    else entries.push({ id: id, total: total, part: part, rate: rate });
  }
  if (day < 0) { var st = api.player.state, dt = st && st.dayTime ? st.dayTime() : null; day = dt && dt.known ? dt.day : 0; }      // keep the real day number: the moon phase follows it
  var want = ((api.settings.get("hour") - 6 + 24) % 24) * 1000;
  entries.push({ id: CLOCK_DAY, total: day * 24000 + Math.round(want), part: 0, rate: 0 });
  var w = new api.net.Writer();
  w.bytes(game).varint(entries.length);
  entries.forEach(function (e) { w.varint(e.id).varlong(e.total).f32(e.part).f32(e.rate); });
  return w.toU8();
});

applyNow();

/* switched off: put the real clock back right away (the packet tap saw the server's own, unchanged) */
api.onDisable(function () {
  var st = api.player.state, c = st && st.clockNow ? st.clockNow() : null;
  if (!c) return;
  api.net.inject(SET_TIME, new api.net.Writer().i64(c.gameTime).varint(1).varint(CLOCK_DAY).varlong(c.total).f32(0).f32(c.rate).toU8());
});
