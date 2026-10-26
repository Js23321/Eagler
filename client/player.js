/* OneClient player state, read from the game's own packets (see net.js): health, food, saturation, experience, the world clock, weather,
 * potion effects, game mode, ping, TPS, and combat (combo / reach). Read only.
 *
 * OC.player.health / food / saturation / level / xpProgress / xpTotal / gameMode (0 survival .. 3 spectator) / rain / thunder (0..1)
 * OC.player.entityId / uuid / name         OC.player.latency (ms, -1 unknown)       OC.player.tps
 * OC.player.dayTime() -> { day, ticks }    OC.player.effects() -> [{ id, name, amplifier, left (seconds, -1 endless), ambient }]
 * OC.player.combo { count, at }            OC.player.reach (blocks, of your last hit, null)
 * OC.player.onEvent(fn): fn(type, data) for "health" "xp" "time" "effect" "weather" "hit" "hurt" "reset" */
(function () {
  "use strict";
  var OC = window.OneClient, net = OC && OC.net;
  if (!net) return;
  var CB = net.IDS.cb, SB = net.IDS.sb;
  var P = OC.player = {
    entityId: -1, uuid: "", name: "", health: 20, food: 20, saturation: 5, level: 0, xpProgress: 0, xpTotal: 0, gameMode: -1,
    rain: 0, thunder: 0, raining: false, latency: -1, tps: 20, gameTime: 0, combo: { count: 0, at: 0, last: 0 }, reach: null, hits: 0
  };
  var subs = [], effects = {}, clock = { total: 0, rate: 1, gameTime: 0, at: 0, have: false }, lastTime = { gameTime: 0, at: 0 }, EFFECTS = [];
  function emit(type, data) { for (var i = 0; i < subs.length; i++) { try { subs[i](type, data); } catch (e) { warn(e); } } }
  function warn(e) { try { console.warn("[OneClient player] " + (e && e.message || e)); } catch (x) {} }
  P.onEvent = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };

  /* registries read from the game: potion effect names by id */
  try {
    var el = document.getElementById("oc-registries");
    if (el && el.textContent) EFFECTS = JSON.parse(el.textContent).effects || [];
  } catch (e) { warn(e); }
  P.effectName = function (id) { return EFFECTS[id] || "effect_" + id; };

  function reset() {
    P.health = 20; P.food = 20; P.saturation = 5; P.level = 0; P.xpProgress = 0; P.xpTotal = 0; P.rain = 0; P.thunder = 0; P.raining = false;
    effects = {}; clock.have = false; P.combo.count = 0; P.reach = null; P.latency = -1;
    emit("reset");
  }

  /* who we are: the login packets */
  net.onLogin("in", 2, function (r) { P.uuid = r.uuid(); P.name = r.string(); });
  net.on("in", CB.login, function (r) { P.entityId = r.i32(); reset(); });
  net.onState(function (s) { if (s === "none") { P.entityId = -1; reset(); } });

  net.on("in", CB.setHealth, function (r) {
    var hp = r.f32(), food = r.varint(), sat = r.f32();
    if (hp < P.health) emit("hurt", { amount: P.health - hp });
    P.health = hp; P.food = food; P.saturation = sat;
    emit("health");
  });
  net.on("in", CB.setExperience, function (r) { P.xpProgress = r.f32(); P.level = r.varint(); P.xpTotal = r.varint(); emit("xp"); });
  net.on("in", CB.playerAbilities, function () { /* the flags say nothing about the game mode */ });

  /* the world clock: a long (game ticks) and a map of clocks (id, total ticks, partial tick, rate); clock 0 is the overworld's day */
  net.on("in", CB.setTime, function (r) {
    var game = Number(r.i64()), n = r.varint(), now = performance.now();
    for (var i = 0; i < n; i++) {
      var id = r.varint(), total = r.varlong(), part = r.f32(), rate = r.f32();
      if (id === 0) { clock.total = total + part; clock.rate = rate; clock.gameTime = game; clock.at = now; clock.have = true; }      // the server only sends the clock when it changes: from then on it advances with the game time
    }
    if (lastTime.at && game > lastTime.gameTime) {                          // TPS: game ticks per real second between two packets
      var dt = (now - lastTime.at) / 1000;
      if (dt > 0.4) { var v = Math.min(20, (game - lastTime.gameTime) / dt); P.tps = P.tps * 0.6 + v * 0.4; }
    }
    lastTime.gameTime = game; lastTime.at = now; P.gameTime = game;
    emit("time");
  });
  /* the day clock as the server has it right now (total ticks, ticks per tick) and the game time: what to put back after a mod changed what the game shows */
  function clockTicks() { return clock.total + clock.rate * ((P.gameTime - clock.gameTime) + Math.min(20, (performance.now() - lastTime.at) / 50)); }
  P.clockNow = function () {
    if (!clock.have) return null;
    return { total: Math.floor(clockTicks()), rate: clock.rate, gameTime: P.gameTime };
  };
  P.dayTime = function () {
    if (!clock.have) return { day: 0, ticks: 0, known: false };
    var t = Math.floor(clockTicks());
    return { day: Math.floor(t / 24000), ticks: ((t % 24000) + 24000) % 24000, known: true };
  };

  /* weather and game mode come as "game events" (an event id and a float) */
  net.on("in", CB.gameEvent, function (r) {
    var ev = r.u8(), v = r.f32();
    if (ev === 1) { P.raining = true; P.rain = 0; emit("weather"); }          // rain starts (its strength then climbs through event 7)
    else if (ev === 2) { P.raining = false; P.rain = 0; emit("weather"); }    // rain stops
    else if (ev === 3) { P.gameMode = Math.round(v); emit("mode"); }
    else if (ev === 7) { P.rain = v; if (v > 0) P.raining = true; emit("weather"); }
    else if (ev === 8) { P.thunder = v; emit("weather"); }
  });

  /* potion effects: [entity id, effect, amplifier, duration (ticks), flags] / [entity id, effect] */
  net.on("in", CB.updateMobEffect, function (r) {
    var ent = r.varint(), id = r.varint(), amp = r.varint(), dur = r.varint(), flags = r.u8();
    if (ent !== P.entityId) return;
    effects[id] = { id: id, amplifier: amp, endAt: dur < 0 ? -1 : performance.now() + dur * 50, ambient: !!(flags & 1), icon: !!(flags & 4) };
    emit("effect");
  });
  net.on("in", CB.removeMobEffect, function (r) { var ent = r.varint(), id = r.varint(); if (ent === P.entityId && effects[id]) { delete effects[id]; emit("effect"); } });
  P.effects = function () {
    var now = performance.now(), out = [];
    Object.keys(effects).forEach(function (k) {
      var e = effects[k];
      if (e.endAt >= 0 && e.endAt < now - 500) { delete effects[k]; return; }
      out.push({ id: e.id, name: P.effectName(e.id), amplifier: e.amplifier, left: e.endAt < 0 ? -1 : Math.max(0, (e.endAt - now) / 1000), ambient: e.ambient });
    });
    return out.sort(function (a, b) { return a.id - b.id; });
  };

  /* ping: the latency the server reports for us in the player list */
  net.on("in", CB.playerInfoUpdate, function (r) {
    var actions = r.u8(), n = r.varint();
    for (var i = 0; i < n; i++) {
      var id = r.uuid(), mine = id === P.uuid;
      if (actions & 1) { r.string(); var pc = r.varint(); for (var k = 0; k < pc; k++) { r.string(); r.string(); if (r.bool()) r.string(); } }
      if (actions & 2) { if (r.bool()) { r.uuid(); r.skip(8); var kl = r.varint(); r.skip(kl); var sl = r.varint(); r.skip(sl); } }
      if (actions & 4) { var gm = r.varint(); if (mine) { P.gameMode = gm; emit("mode"); } }
      if (actions & 8) r.bool();
      if (actions & 16) { var ms = r.varint(); if (mine) { P.latency = ms; emit("ping"); } }
      if (actions & 32) { if (r.bool()) r.nbt(); }                           // display name
      if (actions & 64) r.varint();                                          // list order
      if (actions & 128) r.bool();                                           // hat shown
    }
  });

  /* where we are (feet): the client reports its position to the server every tick it moves (serverbound 30 position, 31 position + rotation,
   * 32 rotation, 33 on-ground flags) and the server moves us with player_position (72: teleport id, position, motion, rotation, relative flags) */
  P.pos = null;                                                              // { x, y, z, yaw, pitch, onGround, at } once known
  function setPos(x, y, z, yaw, pitch, ground) {
    var p = P.pos || (P.pos = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, onGround: true, at: 0 });
    if (x !== null) { p.x = x; p.y = y; p.z = z; }
    if (yaw !== null) { p.yaw = yaw; p.pitch = pitch; }
    if (ground !== null) p.onGround = ground;
    p.at = performance.now();
  }
  net.on("out", SB.movePlayerPos, function (r) { var x = r.f64(), y = r.f64(), z = r.f64(); setPos(x, y, z, null, null, !!(r.u8() & 1)); });
  net.on("out", SB.movePlayerPosRot, function (r) { var x = r.f64(), y = r.f64(), z = r.f64(), yaw = r.f32(), pitch = r.f32(); setPos(x, y, z, yaw, pitch, !!(r.u8() & 1)); });
  net.on("out", SB.movePlayerRot, function (r) { var yaw = r.f32(), pitch = r.f32(); setPos(null, 0, 0, yaw, pitch, !!(r.u8() & 1)); });
  net.on("in", CB.playerPosition, function (r) {
    r.varint();
    var x = r.f64(), y = r.f64(), z = r.f64(); r.f64(); r.f64(); r.f64();
    var yaw = r.f32(), pitch = r.f32(), rel = r.i32(), p = P.pos || { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    setPos((rel & 1) ? p.x + x : x, (rel & 2) ? p.y + y : y, (rel & 4) ? p.z + z : z, (rel & 8) ? p.yaw + yaw : yaw, (rel & 16) ? p.pitch + pitch : pitch, null);
  });
  net.on("in", CB.login, function () { P.pos = null; });

  /* death: the server tells us we died (our entity id, the message): remember where, for mods that mark the spot */
  P.death = null;
  net.on("in", CB.playerCombatKill, function (r) {
    if (r.varint() !== P.entityId) return;
    var p = P.pos || (OC.sense && OC.sense.cam && { x: OC.sense.cam.x, y: OC.sense.cam.y - 1.62, z: OC.sense.cam.z });
    if (!p) return;
    P.death = { x: p.x, y: p.y, z: p.z, dim: OC.world ? OC.world.dim : "", at: Date.now() };
    emit("death", P.death);
  });

  /* combat: our attacks go out as serverbound packet 1 (the entity id), a hit shows up as a damage event (victim, cause) */
  net.on("out", SB.attack, function (r) {
    var target = r.varint(), ents = OC.entities, e = ents && ents.get(target), cam = OC.sense && OC.sense.cam;
    P.hits++;
    if (e && cam && e.w) {                                                  // distance from your eyes to the nearest point of the target's box
      var dx = Math.max(Math.abs(cam.x - e.x) - e.w / 2, 0), dz = Math.max(Math.abs(cam.z - e.z) - e.w / 2, 0), dy = cam.y < e.y ? e.y - cam.y : (cam.y > e.y + e.h ? cam.y - e.y - e.h : 0);
      P.reach = Math.hypot(dx, dy, dz);
    }
    P.lastTarget = target;
    emit("swing", { target: target });
  });
  net.on("in", CB.damageEvent, function (r) {
    var victim = r.varint(); r.varint(); var cause = r.varint() - 1;
    var now = performance.now();
    if (victim === P.entityId) { P.combo.count = 0; emit("hurt", { amount: 0 }); }
    else if (cause === P.entityId) { P.combo.count++; P.combo.at = now; P.combo.last = victim; emit("hit", { target: victim, combo: P.combo.count, reach: P.reach }); }
  });
})();
