/* OneClient entity tracker: the entities the game knows about (mobs, other players, items, projectiles ...), from the packets that spawn,
 * move and remove them. Read only. Positions are the feet of the entity (what the game sends), sizes are the vanilla hitbox of that type.
 *
 * OC.entities.get(id) -> { id, uuid, type, name, x, y, z, yaw, pitch, w, h, since } | undefined
 * OC.entities.list() -> array        OC.entities.count()        OC.entities.onChange(fn): fn("add" | "remove" | "reset", entity)
 * OC.entities.typeName(typeId)       OC.entities.size(name) -> [width, height] */
(function () {
  "use strict";
  var OC = window.OneClient, net = OC && OC.net;
  if (!net) return;
  var CB = net.IDS.cb;
  var E = OC.entities = {};
  var byId = new Map(), subs = [], TYPES = [];
  try { var el = document.getElementById("oc-registries"); if (el && el.textContent) TYPES = JSON.parse(el.textContent).entities || []; } catch (e) { /* no table: types show as numbers */ }

  /* vanilla hitbox sizes [width, height] by entity type (anything not listed is 0.6 x 1.8) */
  var DIMS = {
    player: [0.6, 1.8], mannequin: [0.6, 1.8], zombie: [0.6, 1.95], zombie_villager: [0.6, 1.95], husk: [0.6, 1.95], drowned: [0.6, 1.95], zombified_piglin: [0.6, 1.95], piglin: [0.6, 1.95], piglin_brute: [0.6, 1.95],
    skeleton: [0.6, 1.99], stray: [0.6, 1.99], bogged: [0.6, 1.99], wither_skeleton: [0.7, 2.4], creeper: [0.6, 1.7], spider: [1.4, 0.9], cave_spider: [0.7, 0.5], enderman: [0.6, 2.9],
    endermite: [0.4, 0.3], silverfish: [0.4, 0.3], slime: [1.04, 1.04], magma_cube: [1.04, 1.04], ghast: [4, 4], happy_ghast: [4, 4], blaze: [0.6, 1.8], witch: [0.6, 1.95], villager: [0.6, 1.95],
    wandering_trader: [0.6, 1.95], pillager: [0.6, 1.95], vindicator: [0.6, 1.95], evoker: [0.6, 1.95], illusioner: [0.6, 1.95], ravager: [1.95, 2.2], vex: [0.4, 0.8], iron_golem: [1.4, 2.7], snow_golem: [0.7, 1.9],
    copper_golem: [0.49, 0.98], pig: [0.9, 0.9], cow: [0.9, 1.4], mooshroom: [0.9, 1.4], sheep: [0.9, 1.3], chicken: [0.4, 0.7], horse: [1.4, 1.6], donkey: [1.4, 1.5], mule: [1.4, 1.6], skeleton_horse: [1.4, 1.6],
    zombie_horse: [1.4, 1.6], llama: [0.9, 1.87], trader_llama: [0.9, 1.87], camel: [1.7, 2.375], sniffer: [1.9, 1.75], wolf: [0.6, 0.85], cat: [0.6, 0.7], ocelot: [0.6, 0.7], fox: [0.6, 0.7], rabbit: [0.4, 0.5],
    bat: [0.5, 0.9], parrot: [0.5, 0.9], squid: [0.8, 0.8], glow_squid: [0.8, 0.8], dolphin: [0.9, 0.6], turtle: [1.2, 0.4], panda: [1.3, 1.25], polar_bear: [1.4, 1.4], bee: [0.7, 0.6], axolotl: [0.75, 0.42],
    frog: [0.5, 0.5], tadpole: [0.4, 0.3], goat: [0.9, 1.3], armadillo: [0.7, 0.65], strider: [0.9, 1.7], hoglin: [1.4, 1.4], zoglin: [1.4, 1.4], phantom: [0.9, 0.5], guardian: [0.85, 0.85],
    elder_guardian: [2, 2], shulker: [1, 1], warden: [0.9, 2.9], allay: [0.35, 0.6], ender_dragon: [16, 8], wither: [0.9, 3.5], breeze: [0.6, 1.77], creaking: [0.9, 2.7], giant: [3.6, 12], nautilus: [0.9, 0.9],
    cod: [0.5, 0.3], salmon: [0.7, 0.4], pufferfish: [0.7, 0.7], tropical_fish: [0.5, 0.4], item: [0.25, 0.25], experience_orb: [0.5, 0.5], arrow: [0.5, 0.5], spectral_arrow: [0.5, 0.5], trident: [0.5, 0.5],
    armor_stand: [0.5, 1.975], tnt: [0.98, 0.98], falling_block: [0.98, 0.98], end_crystal: [2, 2], fireball: [1, 1], small_fireball: [0.3125, 0.3125], dragon_fireball: [1, 1], wither_skull: [0.3125, 0.3125],
    snowball: [0.25, 0.25], egg: [0.25, 0.25], ender_pearl: [0.25, 0.25], eye_of_ender: [0.25, 0.25], experience_bottle: [0.25, 0.25], splash_potion: [0.25, 0.25], lingering_potion: [0.25, 0.25],
    firework_rocket: [0.25, 0.25], fishing_bobber: [0.25, 0.25], wind_charge: [0.3125, 0.3125], llama_spit: [0.25, 0.25], shulker_bullet: [0.3125, 0.3125], item_frame: [0.75, 0.75], glow_item_frame: [0.75, 0.75],
    painting: [0.5, 0.5], evoker_fangs: [0.5, 0.8], minecart: [0.98, 0.7], chest_minecart: [0.98, 0.7], furnace_minecart: [0.98, 0.7], hopper_minecart: [0.98, 0.7], tnt_minecart: [0.98, 0.7],
    spawner_minecart: [0.98, 0.7], command_block_minecart: [0.98, 0.7], marker: [0, 0], lightning_bolt: [0, 0], area_effect_cloud: [0, 0], interaction: [0, 0]
  };
  function sizeOf(name) {
    var d = DIMS[name];
    if (d) return d;
    if (/_boat$|_raft$/.test(name)) return [1.375, 0.5625];
    if (/_chest_boat$|_chest_raft$/.test(name)) return [1.375, 0.5625];
    if (/_display$|^text_display$/.test(name)) return [0, 0];
    return [0.6, 1.8];
  }
  E.size = sizeOf;
  E.typeName = function (id) { return TYPES[id] || "entity_" + id; };
  E.get = function (id) { return byId.get(id); };
  E.list = function () { var out = []; byId.forEach(function (e) { out.push(e); }); return out; };
  E.count = function () { return byId.size; };
  E.onChange = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };
  function emit(type, e) { for (var i = 0; i < subs.length; i++) { try { subs[i](type, e); } catch (x) { try { console.warn("[OneClient entities] " + x.message); } catch (y) {} } } }

  function reset() { byId.clear(); emit("reset"); }
  net.on("in", CB.login, reset);
  net.onState(function (s) { if (s === "none") reset(); });
  if (OC.world && OC.world.onChange) OC.world.onChange(function (ev) { if (ev.type === "reset" && ev.why === "dimension") reset(); });       // another dimension (a portal): the game drops every entity of the old one

  net.on("in", CB.addEntity, function (r) {
    var id = r.varint(), uuid = r.uuid(), type = r.varint(), x = r.f64(), y = r.f64(), z = r.f64();
    var name = E.typeName(type), d = sizeOf(name), e = { id: id, uuid: uuid, type: type, name: name, x: x, y: y, z: z, yaw: 0, pitch: 0, w: d[0], h: d[1], since: performance.now() };
    byId.set(id, e);
    emit("add", e);
  });
  net.on("in", CB.removeEntities, function (r) {
    var n = r.varint();
    for (var i = 0; i < n; i++) { var id = r.varint(), e = byId.get(id); if (e) { byId.delete(id); emit("remove", e); } }
  });
  net.on("in", CB.moveEntityPos, function (r) {
    var e = byId.get(r.varint()); if (!e) return;
    e.x += r.i16() / 4096; e.y += r.i16() / 4096; e.z += r.i16() / 4096;
  });
  net.on("in", CB.moveEntityPosRot, function (r) {
    var e = byId.get(r.varint()); if (!e) return;
    e.x += r.i16() / 4096; e.y += r.i16() / 4096; e.z += r.i16() / 4096; e.yaw = r.u8() * 360 / 256; e.pitch = r.u8() * 360 / 256;
  });
  net.on("in", CB.moveEntityRot, function (r) {
    var e = byId.get(r.varint()); if (!e) return;
    e.yaw = r.u8() * 360 / 256; e.pitch = r.u8() * 360 / 256;
  });
  net.on("in", CB.entityPositionSync, function (r) {                 // an absolute position: id, x y z, motion x y z, yaw, pitch, on ground
    var e = byId.get(r.varint()); if (!e) return;
    e.x = r.f64(); e.y = r.f64(); e.z = r.f64(); r.f64(); r.f64(); r.f64(); e.yaw = r.f32(); e.pitch = r.f32();
  });
})();
