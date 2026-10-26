/* ==OneClientMod==
 * @id oc-server
 * @name Server Address
 * @version 1.0
 * @author OneClient
 * @description Shows which server you are playing on (or that you are in a singleplayer world).
 * @category HUD
 * @icon server
 * @order 16
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;

api.settings.define(kit.settings({ rows: [
  { type: "section", label: "Server Address" },
  { k: "name", type: "toggle", label: "Show the server's name", note: "The name you gave it in your server list, when you joined from there", def: false },
  { k: "single", type: "toggle", label: "Show in singleplayer", note: "Off: the widget hides when you play alone", def: true },
  { k: "hide", type: "toggle", label: "Hide the address", note: "Shows dots instead of the address (for streaming)", def: false }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "bl", row: 1 });

/* the host of the connection the game has open: the address you joined, or the target behind a relay */
function wsTarget(url) {
  if (!url) return "";
  try {
    var u = new URL(url), t = u.searchParams.get("target");
    return t || u.host;
  } catch (e) { return String(url).replace(/^wss?:\/\//, "").replace(/[\/?].*$/, ""); }
}

function update() {
  var s = api.settings;
  if (!api.game.inWorld) { hud.visible(false); return; }
  var ses = api.session(), single = api.net.transport === "singleplayer" && !ses.address, addr, name = "";
  if (single) {
    if (!s.get("single")) { hud.visible(false); return; }
    addr = "Singleplayer";
  } else {
    addr = ses.address || wsTarget(OneClient.net && OneClient.net.wsUrl) || "Server";
    name = ses.name && ses.name !== addr ? ses.name : "";
  }
  hud.visible(true);
  if (s.get("hide") && !single) addr = "........";
  var lines = [["Server", addr]];
  if (s.get("name") && name) lines.unshift(["Name", name]);
  hud.set(lines);
}
api.every(500, update);
update();
