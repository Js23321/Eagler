/* ==OneClientMod==
 * @id oc-sneak
 * @name Toggle Sneak
 * @version 1.0
 * @author OneClient
 * @description Press the sneak key once to start sneaking and again to stop, instead of holding it down.
 * @category Utility
 * @icon sneak
 * @order 60
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;
var sneaking = false;

function press(type) {                                          // a key event for the game, marked as ours so OneClient itself ignores it
  var code = api.settings.get("gameKey") || "ShiftLeft", isShift = /^Shift/.test(code);
  var target = document.pointerLockElement || api.game.canvas() || document.body;
  var ev = new KeyboardEvent(type, { key: isShift ? "Shift" : code, code: code, keyCode: isShift ? 16 : 0, which: isShift ? 16 : 0, shiftKey: isShift && type === "keydown", bubbles: true, cancelable: true });
  ev.__oc = true;
  target.dispatchEvent(ev);
}

api.keys.register({
  id: "toggle", label: "Toggle key", def: "ShiftLeft", consume: true,
  onDown: function () { if (!live) return; sneaking = !sneaking; press(sneaking ? "keydown" : "keyup"); refresh(); }
});
var live = false;

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Toggle Sneak" },
  { k: "gameKey", type: "key", label: "The game's sneak key", note: "Must be the key set for Sneak in the game's Controls (Left Shift by default)", def: "ShiftLeft" },
  { k: "tag", type: "toggle", label: "Show a tag while sneaking", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ id: "tag", anchor: "cc", row: 3 });
live = true;

function refresh() {
  hud.visible(sneaking && api.settings.get("tag"));
  hud.set([["", "Sneaking (toggled)"]]);
}
refresh();
api.settings.onChange(function () { refresh(); });

/* a screen (inventory, chat ...) makes the game let go of every key: press it again when you are back in the world */
var wasPlaying = false;
api.events.on("frame", function () {
  var now = !!api.game.playing;
  if (now && !wasPlaying && sneaking) press("keydown");
  wasPlaying = now;
});
api.onDisable(function () { if (sneaking) { sneaking = false; press("keyup"); } });
