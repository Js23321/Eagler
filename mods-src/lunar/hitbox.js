/* ==OneClientMod==
 * @id oc-hitbox
 * @name Hitbox
 * @version 1.0
 * @author OneClient
 * @description Shows the hitboxes of mobs, players and items, exactly as the game itself draws them (the F3+B view), in the colour you pick.
 * @category World
 * @icon hitbox
 * @order 42
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;
var live = false, shown = false;                                // shown: the game's hitbox view is on because of this mod

/* the game's own toggle: hold F3, press B */
function toggleGame() {
  function key(type, k, code, kc) { var e = new KeyboardEvent(type, { key: k, code: code, keyCode: kc, which: kc, bubbles: true, cancelable: true }); e.__oc = true; window.dispatchEvent(e); }
  key("keydown", "F3", "F3", 114);
  setTimeout(function () { key("keydown", "b", "KeyB", 66); }, 50);
  setTimeout(function () { key("keyup", "b", "KeyB", 66); }, 100);
  setTimeout(function () { key("keyup", "F3", "F3", 114); }, 150);
}
/* the key combination only reaches the game while you are really playing: in the world, mouse captured, no screen and no OneClient menu open */
function canPress() { return api.game.inWorld && api.game.playing && OneClient.screen === null; }
function sync() {
  if (!live || !canPress()) return;
  if (!shown) { toggleGame(); shown = true; }
}

api.settings.define([
  { type: "section", label: "Hitbox" },
  { type: "info", label: "The boxes are drawn by the game itself, so they are exact: the same size and place as the game's F3+B view. Switching this mod on turns that view on, switching it off turns it off again." },
  { k: "color", type: "color", label: "Box colour", note: "The white boxes. The red eye line and the blue look direction stay as the game draws them", def: "#ffffff" },
  { k: "opacity", type: "range", label: "Opacity", min: 20, max: 100, step: 5, unit: "%", def: 100 },
  { type: "button", label: "Out of step with the game?", note: "If you pressed F3+B yourself, press this to flip the view again", text: "Press F3+B", onClick: function () { if (live && canPress()) toggleGame(); else api.ui.toast("Switch the mod on and stand in a world first."); } }
]);
if (api.schemaOnly) return;
live = true;

function apply() {
  var rgb = kit.rgb(api.settings.get("color"));
  api.gl.fx.set("oc_hitbox", [rgb[0], rgb[1], rgb[2], api.settings.get("opacity") / 100]);
}
apply();
api.settings.onChange(apply);

api.events.on("frame", sync);                                     // waits until you are playing in a world
sync();
api.onDisable(function () {
  if (shown && canPress()) toggleGame();
  else if (shown) api.ui.toast("Press F3+B in the world to hide the hitboxes.");
  shown = false;
});
