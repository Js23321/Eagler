/* ==OneClientMod==
 * @id hello-hud
 * @name Hello HUD
 * @version 1.0
 * @author OneClient
 * @description Example mod: a draggable on-screen note, a hotkey, and every kind of setting row.
 * ==/OneClientMod== */

// Everything below runs with `api` in scope. Whatever you register through it (widgets, keys, events, hooks)
// is removed again when the mod is switched off.

api.settings.define([
  { key: "section1", type: "section", label: "Appearance" },
  { key: "text", type: "text", label: "Message", note: "Shown in the on-screen note", default: "Hello from a mod!", placeholder: "Type something" },
  { key: "uppercase", type: "toggle", label: "UPPERCASE", note: "Shout it", default: false },
  { key: "size", type: "range", label: "Counter step", note: "How much the counter grows per press", min: 1, max: 10, step: 1, unit: "", default: 1 },
  { key: "mood", type: "choice", label: "Mood", options: [["calm", "Calm"], ["happy", "Happy"], ["wow", "Wow"]], default: "happy" },
  { key: "color", type: "color", label: "Colour", default: "#7dffb2" },
  { key: "section2", type: "section", label: "Actions" },
  { key: "reset", type: "button", label: "Reset the counter", text: "Reset", onClick: function () { count = 0; draw(); api.ui.toast("Counter reset"); } },
  { key: "about", type: "info", label: "Press the hotkey while playing to count up. The note is a normal HUD widget: open the Right Shift overlay to drag it around." }
]);

var count = 0;
var note = api.hud.text({ id: "note", text: "", x: 12, y: 220 });
var moods = { calm: "~", happy: ":)", wow: "!!" };

function draw() {
  var s = api.settings.get("text");
  if (api.settings.get("uppercase")) s = s.toUpperCase();
  note.set(s + " " + moods[api.settings.get("mood")] + "  [" + count + "]");
  if (note.el) note.el.style.color = api.settings.get("color");
}

api.keys.register({
  id: "count", label: "Count up", def: "KeyH",
  onDown: function () { count += api.settings.get("size"); draw(); }
});
api.settings.onChange(draw);
draw();
api.log("hello-hud started");
