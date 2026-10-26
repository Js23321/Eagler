/* The game's block state table: state id <-> block name + properties.
 *
 * A state id is the block's first id plus a mixed-radix number over its properties (the slowest property first). This table was read from the
 * running game (every block's properties from the server's command suggestions, every state id from /setblock answers) and is checked to tile the
 * id space without gaps. It is embedded in the page as <script id="oc-blocks"> (client/blocks26.json: { protocol, game, total, blocks }).
 *
 * OC.blocks.info(id)        -> { name: "minecraft:oak_stairs", props: { facing: "north", ... }, block: n } or null
 * OC.blocks.idOf(name, props) -> state id (properties left out take the block's default values), -1 for an unknown block, -2 for an unknown property or value
 * OC.blocks.defaultId(name) -> id of the default state, -1 if there is no such block
 * OC.blocks.isAir(id), OC.blocks.has(name), OC.blocks.names()
 */
(function () {
  "use strict";
  var OC = window.OneClient;
  if (!OC) return;
  var B = OC.blocks = { ready: false, protocol: 0, game: "", total: 0, count: 0 };
  var table = [], mins = [], byName = {}, airIds = {}, cache = {};

  function load(data) {
    table = []; mins = []; byName = {}; airIds = {}; cache = {};
    var blocks = data.blocks || [];
    blocks.forEach(function (b, i) {
      var props = b[3] || [], strides = new Array(props.length), n = 1, k;
      for (k = props.length - 1; k >= 0; k--) { strides[k] = n; n *= props[k][1].length; }
      var rec = { name: "minecraft:" + b[0], min: b[1], def: b[2], count: n, props: props, strides: strides };
      var vi = {}; props.forEach(function (p, j) { var m = {}; p[1].forEach(function (v, x) { m[v] = x; }); vi[p[0]] = j; rec["_v" + j] = m; });
      rec.propIndex = vi;
      table.push(rec); mins.push(rec.min); byName[rec.name] = i;
      if (/^minecraft:(air|cave_air|void_air)$/.test(rec.name)) airIds[rec.min] = true;
    });
    B.protocol = data.protocol || 0; B.game = data.game || ""; B.total = data.total || 0; B.count = table.length; B.ready = table.length > 0;
  }
  B.load = load;

  function blockIndexOf(id) {                                         // binary search over the first ids
    var n = mins.length, lo = 0, hi = n - 1;
    if (!n || id < 0 || id >= table[hi].min + table[hi].count) return -1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (mins[mid] <= id) lo = mid; else hi = mid - 1; }
    return lo;
  }

  B.info = function (id) {
    var c = cache[id];
    if (c) return c;
    var bi = blockIndexOf(id);
    if (bi < 0) return null;
    var b = table[bi], off = id - b.min, props = {};
    for (var k = b.props.length - 1; k >= 0; k--) { var n = b.props[k][1].length; props[b.props[k][0]] = b.props[k][1][off % n]; off = Math.floor(off / n); }
    c = { name: b.name, props: props, block: bi };
    cache[id] = c;
    return c;
  };
  B.nameOf = function (id) { var bi = blockIndexOf(id); return bi < 0 ? "" : table[bi].name; };
  B.has = function (name) { return byName[/:/.test(name) ? name : "minecraft:" + name] !== undefined; };
  B.names = function () { return table.map(function (b) { return b.name; }); };
  B.isAir = function (id) { return !!airIds[id]; };
  B.propsOf = function (name) { var i = byName[/:/.test(name) ? name : "minecraft:" + name]; return i === undefined ? [] : table[i].props; };      // [[property, [values in id order]], ...] slowest first
  B.rangeOf = function (name) { var i = byName[/:/.test(name) ? name : "minecraft:" + name]; return i === undefined ? null : { min: table[i].min, count: table[i].count, strides: table[i].strides.slice() }; };
  B.defaultId = function (name) { var i = byName[/:/.test(name) ? name : "minecraft:" + name]; return i === undefined ? -1 : table[i].def; };
  B.idOf = function (name, props) {
    var i = byName[/:/.test(name) ? name : "minecraft:" + name];
    if (i === undefined) return -1;
    var b = table[i], off = b.def - b.min, id = b.min, bad = false, k;
    for (k = 0; k < b.props.length; k++) {                            // start from the default state, then apply what was asked
      var n = b.props[k][1].length, idx = Math.floor(off / b.strides[k]) % n, want = props && props[b.props[k][0]];
      if (want !== undefined) { var j = b["_v" + k][String(want)]; if (j === undefined) bad = true; else idx = j; }
      id += idx * b.strides[k];
    }
    if (props) for (var key in props) if (b.propIndex[key] === undefined) bad = true;
    return bad ? -2 : id;
  };
  /* like idOf, but a property or value this game version does not know is ignored instead of failing */
  B.idOfLoose = function (name, props) {
    var i = byName[/:/.test(name) ? name : "minecraft:" + name];
    if (i === undefined) return -1;
    var b = table[i], off = b.def - b.min, id = b.min;
    for (var k = 0; k < b.props.length; k++) {
      var n = b.props[k][1].length, idx = Math.floor(off / b.strides[k]) % n, want = props && props[b.props[k][0]];
      if (want !== undefined) { var j = b["_v" + k][String(want)]; if (j !== undefined) idx = j; }
      id += idx * b.strides[k];
    }
    return id;
  };

  /* the table ships inside the page */
  try {
    var el = document.getElementById("oc-blocks");
    if (el && el.textContent) load(JSON.parse(el.textContent));
  } catch (e) { try { console.warn("[OneClient] block table: " + e.message); } catch (x) {} }
})();
