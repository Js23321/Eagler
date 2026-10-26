/* ==OneClientMod==
 * @id oc-coordinates
 * @name Coordinates
 * @version 1.0
 * @author OneClient
 * @description Shows where you are: your X, Y and Z, and optionally the matching spot in the other dimension.
 * @category HUD
 * @icon pin
 * @order 10
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Coordinates" },
  { k: "decimals", type: "range", label: "Decimals", note: "Digits after the point", min: 0, max: 3, step: 1, def: 1 },
  { k: "layout", type: "choice", label: "Layout", opts: [["col", "One per line"], ["row", "One line"]], def: "col" },
  { k: "other", type: "toggle", label: "Other dimension", note: "Also show the same spot in the Nether (from the Overworld) or the Overworld (from the Nether)", def: false },
  { k: "block", type: "toggle", label: "Round down to the block", note: "Show the block you stand in, like the game's F3 screen does for blocks", def: false }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tl", row: 4 });

/* the player's feet: from the position the game reports to the server; the camera (minus the eye height) when that is not available */
function feet() {
  var st = api.player.state, p = st && st.pos;
  if (p && api.net.active && performance.now() - p.at < 4000) return p;
  var c = api.game.cam;
  return c ? { x: c.x, y: c.y - 1.62, z: c.z } : null;
}

function update() {
  var p = feet();
  if (!p || !api.game.inWorld) { hud.visible(false); return; }
  hud.visible(true);
  var d = api.settings.get("decimals"), block = api.settings.get("block");
  function f(v) { return block ? String(Math.floor(v)) : fmt.fixed(v, d); }
  var lines = [["X", f(p.x)], ["Y", f(p.y)], ["Z", f(p.z)]];
  if (api.settings.get("other")) {
    var dim = api.world.dim || "";
    if (dim.indexOf("the_nether") >= 0) lines.push(["Overworld", f(p.x * 8) + " / " + f(p.z * 8)]);
    else if (dim.indexOf("overworld") >= 0 || !dim) lines.push(["Nether", f(p.x / 8) + " / " + f(p.z / 8)]);
  }
  hud.set(lines, { row: api.settings.get("layout") === "row" });
}
api.every(100, update);
update();
