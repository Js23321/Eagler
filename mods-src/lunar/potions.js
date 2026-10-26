/* ==OneClientMod==
 * @id oc-potions
 * @name Potion Effects
 * @version 1.0
 * @author OneClient
 * @description Lists the potion effects on you with their level and how long they last.
 * @category HUD
 * @icon flask
 * @order 26
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define(kit.settings({ label: false, rows: [
  { type: "section", label: "Potion Effects" },
  { k: "icons", type: "toggle", label: "Show icons", note: "The game's own effect pictures", def: true },
  { k: "timer", type: "toggle", label: "Show time left", def: true },
  { k: "level", type: "toggle", label: "Show level", note: "Speed II, Strength III ...", def: true },
  { k: "bad", type: "toggle", label: "Colour harmful effects", note: "Slowness, poison and the like in red", def: true },
  { k: "ambient", type: "toggle", label: "Include beacon effects", note: "Effects that come from a beacon or conduit", def: true }
] }));
if (api.schemaOnly) return;

var hud = kit.hud({ anchor: "tr", row: 8 });
var BAD = { slowness: 1, mining_fatigue: 1, instant_damage: 1, nausea: 1, blindness: 1, hunger: 1, weakness: 1, poison: 1, wither: 1, levitation: 1, unluck: 1, bad_omen: 1, darkness: 1, raid_omen: 1, trial_omen: 1, infested: 1, oozing: 1, weaving: 1, wind_charged: 1 };
var NAME = { instant_damage: "Instant Damage", instant_health: "Instant Health", jump_boost: "Jump Boost", dolphins_grace: "Dolphin's Grace", hero_of_the_village: "Hero of the Village", breath_of_the_nautilus: "Breath of the Nautilus" };

function update() {
  var st = api.player.state, s = api.settings;
  if (!api.game.inWorld || !api.net.active || !st) { hud.visible(false); return; }
  var icons = kit.icons().effects || {}, list = st.effects(), lines = [];
  list.forEach(function (e) {
    if (e.ambient && !s.get("ambient")) return;
    var nm = NAME[e.name] || fmt.name("effect", e.name), tx = nm + (s.get("level") ? " " + fmt.roman(e.amplifier + 1) : "");
    var left = s.get("timer") ? (e.left < 0 ? "inf" : fmt.clock(e.left)) : "";
    lines.push({ v: tx, a: left, c: s.get("bad") && BAD[e.name] ? "#ff9a9a" : "", icon: s.get("icons") ? icons[e.name] : "" });
  });
  hud.visible(lines.length > 0);
  hud.set(lines);
}
api.every(250, update);
update();
