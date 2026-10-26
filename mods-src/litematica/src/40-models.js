/* Block states -> geometry, the way the game bakes block models: blockstate JSON picks model(s) (variants / multipart), models
 * inherit from parents, elements become quads with the game's face winding, uv rotation, element rotation and blockstate
 * x / y rotation. Output per state: { quads, opaque, cullSame, fluid, empty } with
 *   quad = { c: cull direction | -1, tex, tint: tint index | -1, shade, a: alpha, v: [x,y,z,u,v] x4 } (positions 0..1, uv 0..1 inside the texture)
 * Directions: 0 down, 1 up, 2 north (-z), 3 south (+z), 4 west (-x), 5 east (+x). */
var Models = (function () {
  var DIRS = ["down", "up", "north", "south", "west", "east"];
  var DIR_V = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  var SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
  var resolved = {};                                          // model id -> { elements, textures, entity }
  var options = { unknown: true };                            // draw blocks the game does not know as magenta cubes (otherwise leave them out)
  var FLUID = { "minecraft:water": 1, "minecraft:lava": 1 };
  var SKIP = { "minecraft:air": 1, "minecraft:cave_air": 1, "minecraft:void_air": 1, "minecraft:structure_void": 1, "minecraft:light": 1, "minecraft:barrier": 1, "minecraft:bubble_column": 1, "minecraft:moving_piston": 1, "minecraft:jigsaw": 0 };

  function strip(s) { return String(s).replace(/^minecraft:/, ""); }

  /* ---------- reading the blockstate ---------- */
  function matchKey(key, props) {
    if (key === "") return 0;
    var pairs = key.split(","), n = 0;
    for (var i = 0; i < pairs.length; i++) {
      var e = pairs[i].indexOf("="), k = pairs[i].slice(0, e), v = pairs[i].slice(e + 1);
      if (props[k] !== undefined && String(props[k]) !== v) return -1;
      if (props[k] !== undefined) n++;
    }
    return n;
  }
  function whenMatches(w, props) {
    if (w.OR) return w.OR.some(function (c) { return whenMatches(c, props); });
    if (w.AND) return w.AND.every(function (c) { return whenMatches(c, props); });
    return Object.keys(w).every(function (k) { return String(w[k]).split("|").indexOf(String(props[k])) >= 0; });
  }
  function first(x) { return Array.isArray(x) ? x[0] : x; }
  function refsOf(def, props) {                               // [{ model, x, y, uvlock }]
    if (!def) return [];
    if (def.variants) {
      var best = null, bestN = -1;
      Object.keys(def.variants).forEach(function (k) { var n = matchKey(k, props); if (n > bestN) { bestN = n; best = k; } });
      return best === null ? [] : [first(def.variants[best])];
    }
    if (def.multipart) {
      var out = [];
      def.multipart.forEach(function (part) { if (!part.when || whenMatches(part.when, props)) out.push(first(part.apply)); });
      return out;
    }
    return [];
  }

  /* ---------- models ---------- */
  function resolve(id) {
    id = strip(id);
    if (resolved[id]) return resolved[id];
    var m = Assets.modelSync(id), out = { elements: null, textures: {}, entity: false, missing: !m };
    resolved[id] = out;
    if (!m) return out;
    if (m.parent) {
      var pid = strip(m.parent);
      if (pid === "builtin/entity") out.entity = true;
      else if (pid.indexOf("builtin/") !== 0) { var p = resolve(pid); out.elements = p.elements; out.entity = p.entity; Object.keys(p.textures).forEach(function (k) { out.textures[k] = p.textures[k]; }); }
    }
    if (m.elements) out.elements = m.elements;
    if (m.textures) Object.keys(m.textures).forEach(function (k) { out.textures[k] = m.textures[k]; });
    return out;
  }
  function texName(model, ref) {                               // a slot is "#other", "block/stone", or in 26.x { sprite: "block/stone", force_translucent: true }
    var guard = 0;
    while (guard++ < 10) {
      if (ref && typeof ref === "object") ref = ref.sprite || null;
      if (typeof ref === "string" && ref.charAt(0) === "#") ref = model.textures[ref.slice(1)]; else break;
    }
    if (ref && typeof ref === "object") ref = ref.sprite || null;
    return typeof ref === "string" && ref.charAt(0) !== "#" ? ref : null;
  }
  /* every model a set of states needs (parents included), fetched before any baking */
  function loadModels(ids) {
    var seen = {}, queue = ids.map(strip);
    function step() {
      var todo = queue.filter(function (i) { return !seen[i]; });
      if (!todo.length) return Promise.resolve();
      todo.forEach(function (i) { seen[i] = true; });
      queue = [];
      return Promise.all(todo.map(function (i) { return Assets.model(i); })).then(function (list) {
        list.forEach(function (m) { if (m && m.parent && strip(m.parent).indexOf("builtin/") !== 0) queue.push(strip(m.parent)); });
        return step();
      });
    }
    return step();
  }

  /* ---------- geometry ---------- */
  function faceVerts(d, x1, y1, z1, x2, y2, z2) {
    switch (d) {
      case 0: return [[x1, y1, z2], [x1, y1, z1], [x2, y1, z1], [x2, y1, z2]];
      case 1: return [[x1, y2, z1], [x1, y2, z2], [x2, y2, z2], [x2, y2, z1]];
      case 2: return [[x2, y2, z1], [x2, y1, z1], [x1, y1, z1], [x1, y2, z1]];
      case 3: return [[x1, y2, z2], [x1, y1, z2], [x2, y1, z2], [x2, y2, z2]];
      case 4: return [[x1, y2, z1], [x1, y1, z1], [x1, y1, z2], [x1, y2, z2]];
      default: return [[x2, y2, z2], [x2, y1, z2], [x2, y1, z1], [x2, y2, z1]];
    }
  }
  function defaultUV(d, x1, y1, z1, x2, y2, z2) {
    switch (d) {
      case 0: return [x1, 16 - z2, x2, 16 - z1];
      case 1: return [x1, z1, x2, z2];
      case 2: return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
      case 3: return [x1, 16 - y2, x2, 16 - y1];
      case 4: return [z1, 16 - y2, z2, 16 - y1];
      default: return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
    }
  }
  function rot(axis, c, s, p) {                               // right-handed rotation of a point about an axis through the origin
    var x = p[0], y = p[1], z = p[2];
    if (axis === "x") return [x, y * c - z * s, y * s + z * c];
    if (axis === "y") return [x * c + z * s, y, -x * s + z * c];
    return [x * c - y * s, x * s + y * c, z];
  }
  function elementRotate(v, r) {
    var o = r.origin || [8, 8, 8], a = (r.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = r.rescale ? 1 / Math.max(Math.abs(c), 1e-6) : 1;
    var p = rot(r.axis, c, s, [v[0] - o[0], v[1] - o[1], v[2] - o[2]]);
    if (r.rescale) { if (r.axis === "x") { p[1] *= k; p[2] *= k; } else if (r.axis === "y") { p[0] *= k; p[2] *= k; } else { p[0] *= k; p[1] *= k; } }
    return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  }
  function blockRotate(v, rx, ry) {                           // the blockstate's x then y, clockwise degrees, around the block centre
    if (!rx && !ry) return v;
    var p = [v[0] - 8, v[1] - 8, v[2] - 8], a, c, s;
    if (rx) { a = -rx * Math.PI / 180; c = Math.cos(a); s = Math.sin(a); p = rot("x", c, s, p); }
    if (ry) { a = -ry * Math.PI / 180; c = Math.cos(a); s = Math.sin(a); p = rot("y", c, s, p); }
    return [p[0] + 8, p[1] + 8, p[2] + 8];
  }
  function nearestDir(n) {                                    // index of the axis direction closest to the vector
    var ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (ay >= ax && ay >= az) return n[1] < 0 ? 0 : 1;
    if (az >= ax) return n[2] < 0 ? 2 : 3;
    return n[0] < 0 ? 4 : 5;
  }
  function rotDir(d, rx, ry) {
    if (!rx && !ry) return d;
    var v = DIR_V[d], p = [v[0], v[1], v[2]], a, c, s;
    if (rx) { a = -rx * Math.PI / 180; c = Math.cos(a); s = Math.sin(a); p = rot("x", c, s, p); }
    if (ry) { a = -ry * Math.PI / 180; c = Math.cos(a); s = Math.sin(a); p = rot("y", c, s, p); }
    return nearestDir(p);
  }

  function bakeElements(model, ref, quads, fullCubeOut) {
    var rx = ref.x || 0, ry = ref.y || 0, els = model.elements || [];
    els.forEach(function (el) {
      var f = el.from, t = el.to, x1 = f[0], y1 = f[1], z1 = f[2], x2 = t[0], y2 = t[1], z2 = t[2];
      if (!el.rotation && x1 === 0 && y1 === 0 && z1 === 0 && x2 === 16 && y2 === 16 && z2 === 16 && Object.keys(el.faces || {}).length === 6) fullCubeOut.full = true;
      Object.keys(el.faces || {}).forEach(function (name) {
        var d = DIRS.indexOf(name), face = el.faces[name];
        if (d < 0) return;
        var verts = faceVerts(d, x1, y1, z1, x2, y2, z2), uv = face.uv || defaultUV(d, x1, y1, z1, x2, y2, z2), turn = ((face.rotation || 0) / 90) | 0;
        var tn = texName(model, face.texture), tex = Assets.texId(tn || "block/missing"), out = [];
        for (var i = 0; i < 4; i++) {
          var sh = (i + turn) % 4, u = uv[sh === 0 || sh === 1 ? 0 : 2], vv = uv[sh === 0 || sh === 3 ? 1 : 3];
          var p = verts[i];
          if (el.rotation) p = elementRotate(p, el.rotation);
          p = blockRotate(p, rx, ry);
          out.push(p[0] / 16, p[1] / 16, p[2] / 16, u / 16, vv / 16);
        }
        var ax = out[5] - out[0], ay = out[6] - out[1], az = out[7] - out[2], bx = out[10] - out[0], by = out[11] - out[1], bz = out[12] - out[2];
        var normal = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];     // winding is counter-clockwise seen from outside
        var nd = nearestDir(normal);
        if (ref.uvlock && (rx || ry)) {                      // uvlock: the texture stays put in the world while the model turns: take uv from where each corner ended up
          for (var u = 0; u < 4; u++) {
            var px = out[u * 5] * 16, py = out[u * 5 + 1] * 16, pz = out[u * 5 + 2] * 16, lu, lv;
            if (nd === 0) { lu = px; lv = 16 - pz; } else if (nd === 1) { lu = px; lv = pz; } else if (nd === 2) { lu = 16 - px; lv = 16 - py; }
            else if (nd === 3) { lu = px; lv = 16 - py; } else if (nd === 4) { lu = pz; lv = 16 - py; } else { lu = 16 - pz; lv = 16 - py; }
            out[u * 5 + 3] = lu / 16; out[u * 5 + 4] = lv / 16;
          }
        }
        var cull = face.cullface ? rotDir(DIRS.indexOf(face.cullface), rx, ry) : -1;
        quads.push({ c: cull, tex: tex, tint: face.tintindex === undefined ? -1 : face.tintindex, shadeOn: el.shade === false ? 0 : 1, a: 1, v: out });
      });
    });
  }

  /* ---------- special blocks that have no model ---------- */
  function boxQuads(x1, y1, z1, x2, y2, z2, tex, o) {         // a box in 0..16 units
    var quads = [], model = { textures: { t: tex }, elements: [{ from: [x1, y1, z1], to: [x2, y2, z2], faces: {} }] };
    DIRS.forEach(function (n, d) {
      var cull = d === 0 && y1 === 0 ? 0 : d === 1 && y2 === 16 ? 1 : d === 2 && z1 === 0 ? 2 : d === 3 && z2 === 16 ? 3 : d === 4 && x1 === 0 ? 4 : d === 5 && x2 === 16 ? 5 : null;
      model.elements[0].faces[n] = Object.assign({ texture: "#t" }, cull === null ? {} : { cullface: n }, o && o.tint !== undefined ? { tintindex: o.tint } : {});
    });
    bakeElements(model, { x: 0, y: 0 }, quads, {});
    if (o && o.a !== undefined) quads.forEach(function (q) { q.a = o.a; });
    return quads;
  }
  var ENTITYISH = /(chest$|_bed$|sign$|banner$|_head$|_skull$|^skull$|shulker_box$|^conduit$|^bell$|^decorated_pot$|^dragon_head$|^player_head$)/;
  var WOOD = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)/;
  var COLOR = /^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_/;
  function entityShape(name, props) {                         // approximate stand-ins for blocks the game draws with entity models
    var n = strip(name), q;
    var color = COLOR.exec(n), wood = WOOD.exec(n);
    if (/chest$/.test(n)) return boxQuads(1, 0, 1, 15, 14, 15, n === "ender_chest" ? "block/obsidian" : /copper/.test(n) ? "block/copper_block" : "block/oak_planks");
    if (/_bed$/.test(n)) return boxQuads(0, 3, 0, 16, 9, 16, "block/" + (color ? color[1] : "red") + "_wool");
    if (/shulker_box$/.test(n)) return boxQuads(0, 0, 0, 16, 16, 16, "block/" + (color ? color[1] + "_concrete" : "purple_concrete"));
    if (/_wall_sign$/.test(n) || /_wall_hanging_sign$/.test(n)) {
      var f = props.facing || "north", plank = "block/" + (wood ? wood[1] : "oak") + "_planks";
      var q2 = boxQuads(0, 4.5, 14, 16, 12.5, 16, plank);
      return rotY(q2, { north: 0, east: 90, south: 180, west: 270 }[f] || 0);
    }
    if (/_sign$/.test(n) || /hanging_sign$/.test(n)) { var pl = "block/" + (wood ? wood[1] : "oak") + "_planks"; return boxQuads(0, 8, 7, 16, 16, 9, pl).concat(boxQuads(7, 0, 7, 9, 8, 9, pl)); }
    if (/_banner$/.test(n)) return boxQuads(7, 0, 7, 9, 24 > 16 ? 16 : 24, 9, "block/oak_planks").concat(boxQuads(0, 4, 7.5, 16, 16, 8.5, "block/" + (color ? color[1] : "white") + "_wool"));
    if (/_(head|skull)$/.test(n) || n === "player_head" || n === "dragon_head") return boxQuads(4, 0, 4, 12, 8, 12, "block/soul_sand");
    if (n === "conduit") return boxQuads(5, 5, 5, 11, 11, 11, "block/prismarine");
    if (n === "bell") return boxQuads(5, 6, 5, 11, 13, 11, "block/gold_block");
    if (n === "decorated_pot") return boxQuads(1, 0, 1, 15, 16, 15, "block/terracotta");
    return boxQuads(0, 0, 0, 16, 16, 16, "block/stone");
  }
  function rotY(quads, deg) {
    if (!deg) return quads;
    quads.forEach(function (q) {
      for (var i = 0; i < 4; i++) {
        var p = blockRotate([q.v[i * 5] * 16, q.v[i * 5 + 1] * 16, q.v[i * 5 + 2] * 16], 0, deg);
        q.v[i * 5] = p[0] / 16; q.v[i * 5 + 1] = p[1] / 16; q.v[i * 5 + 2] = p[2] / 16;
      }
      if (q.c >= 2) q.c = rotDir(q.c, 0, deg);
    });
    return quads;
  }
  function fluidQuads(name, props) {
    var lvl = parseInt(props.level || "0", 10) || 0, h = lvl === 0 ? 14.2 : lvl >= 8 ? 16 : Math.max(2, (8 - lvl) / 9 * 16 - 1.8);
    var lava = name === "minecraft:lava", tex = lava ? "block/lava_still" : "block/water_still";
    var qs = boxQuads(0, 0, 0, 16, h, 16, tex, { tint: lava ? undefined : 0, a: lava ? 1 : 0.78 });
    if (h < 16) qs.forEach(function (q) { if (q.c === 1) q.c = -1; });           // the lowered surface is never hidden by what is above
    return qs;
  }

  /* ---------- tint colours ---------- */
  var GRASS = /^(grass_block|short_grass|tall_grass|fern|large_fern|sugar_cane|potted_fern|bush|short_dry_grass)$/;
  var FOLIAGE = /^(oak_leaves|jungle_leaves|acacia_leaves|dark_oak_leaves|mangrove_leaves|vine)$/;
  function tintFor(name, props, index) {
    var n = strip(name), T = Assets.tintMaps;
    if (n === "water" || n === "bubble_column" || n === "water_cauldron") return [0.247, 0.463, 0.894];
    if (GRASS.test(n)) return T.grass || [0.569, 0.741, 0.349];
    if (FOLIAGE.test(n)) return T.foliage || [0.467, 0.671, 0.184];
    if (n === "birch_leaves") return [0.502, 0.655, 0.333];
    if (n === "spruce_leaves") return [0.38, 0.6, 0.38];
    if (n === "lily_pad") return [0.125, 0.5, 0.188];
    if (n === "redstone_wire") {
      var p = (parseInt(props.power || "0", 10) || 0) / 15;
      return [p * 0.6 + (p > 0 ? 0.4 : 0.3), Math.min(1, Math.max(0, p * p * 0.7 - 0.5)), Math.min(1, Math.max(0, p * p * 0.6 - 0.7))];
    }
    if (n === "melon_stem" || n === "pumpkin_stem") { var a = parseInt(props.age || "0", 10) || 0; return [a * 32 / 255, (255 - a * 8) / 255, a * 4 / 255]; }
    if (n === "attached_melon_stem" || n === "attached_pumpkin_stem") return [0.878, 0.78, 0.11];
    return null;
  }

  /* ---------- baking a state ---------- */
  function emptyBaked() { return { quads: [], opaque: false, cullSame: false, fluid: false, empty: true }; }

  function bake(state) {
    var name = state.name, props = state.props || {};
    if (SKIP[name]) return emptyBaked();
    var quads = [], fluid = !!FLUID[name], full = { full: false }, entity = false;
    if (fluid) quads = fluidQuads(name, props);
    else {
      var def = Assets.blockstateSync(name), refs = refsOf(def, props);
      refs.forEach(function (ref) {
        if (!ref || !ref.model) return;
        var m = resolve(ref.model);
        if (m.entity) { entity = true; return; }
        bakeElements(m, ref, quads, full);
      });
      if (!quads.length) {
        if (entity || ENTITYISH.test(strip(name))) quads = entityShape(name, props);          // chests, beds, signs ...: the game draws these with entity models
        else if (!def && options.unknown) quads = boxQuads(0, 0, 0, 16, 16, 16, "block/missing");      // a block this game version does not know (renamed, or from a mod): a magenta cube, not silence
      }
    }
    if (!quads.length) return emptyBaked();
    var tintCache = {};
    quads.forEach(function (q) {
      var t = q.tint >= 0 ? (tintCache[q.tint] || (tintCache[q.tint] = tintFor(name, props, q.tint))) : null;
      q.tintRgb = t || [1, 1, 1];
    });
    var allOpaque = true;
    quads.forEach(function (q) { var t = Assets.textureSync(q.tex); if (!t || !t.loaded || t.alpha !== 0 || q.a < 1) allOpaque = false; });
    var isFull = full.full && refsSingle(props, name);
    return { quads: quads, opaque: isFull && allOpaque && !fluid, cullSame: (isFull && !allOpaque) || fluid, fluid: fluid, empty: false };
  }
  function refsSingle(props, name) { var def = Assets.blockstateSync(name); return !!def && refsOf(def, props).length === 1; }

  /* a block with no blockstate in this game version (and no special handling): renamed since the schematic was made, or from a mod */
  function isUnknown(name) { return !SKIP[name] && !FLUID[name] && !ENTITYISH.test(strip(name)) && !Assets.blockstateSync(name); }

  /* every texture id a state uses (after bake) */
  function texturesOf(baked) { var s = {}; baked.quads.forEach(function (q) { s[q.tex] = 1; }); return Object.keys(s).map(Number); }

  /* ---------- loading everything a list of states needs, then baking them: Promise<[baked]> ---------- */
  function prepare(states) {
    var names = {}, i;
    states.forEach(function (s) { names[s.name] = 1; });
    return Assets.syncPacks().then(function () { return Assets.tints(); }).then(function () {
      return Promise.all(Object.keys(names).map(function (n) { return SKIP[n] || FLUID[n] ? null : Assets.blockstate(n); }));
    }).then(function () {
      var ids = [];
      states.forEach(function (s) { refsOf(Assets.blockstateSync(s.name), s.props || {}).forEach(function (r) { if (r && r.model) ids.push(r.model); }); });
      ids.push("minecraft:block/water");
      return loadModels(ids);
    }).then(function () {
      var first = states.map(bake), need = {};
      first.forEach(function (b) { texturesOf(b).forEach(function (t) { need[t] = 1; }); });
      need[Assets.texId("block/missing")] = 1; need[Assets.texId("block/stone")] = 1;
      return Assets.ensure(Object.keys(need).map(Number));
    }).then(function () {
      return states.map(bake);                                // second pass: texture transparency is known now
    });
  }

  return { prepare: prepare, bake: bake, refsOf: refsOf, resolve: resolve, isUnknown: isUnknown, options: options, DIRS: DIRS, DIR_V: DIR_V, rotDir: rotDir };
})();
