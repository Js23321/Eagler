/* Litematica port for OneClient: shared state and small helpers. All files of this mod are joined into one script (see build.js), so
 * the names below are visible to every part. */
var LM = {
  schem: null,                 // the loaded schematic (see Formats)
  fileName: "",
  placement: { x: 0, y: 0, z: 0, rot: 0, mirrorX: false, mirrorZ: false },
  fatalMsg: null,
  hidden: {},                  // names of the regions of the loaded schematic that are switched off
  views: []                    // panel refresh callbacks
};
LM.materials = function () { return LM.schem ? Formats.materialsOf(LM.schem, LM.hidden) : { list: [], total: 0 }; };
LM.set = function (k) { return api.settings.get(k); };
LM.changed = function () { LM.views.slice().forEach(function (fn) { try { fn(); } catch (e) { api.error(e && e.message || e); } }); };
LM.onChange = function (fn) { LM.views.push(fn); return function () { var i = LM.views.indexOf(fn); if (i >= 0) LM.views.splice(i, 1); }; };
LM.fatal = function (m) { LM.fatalMsg = m; api.error(m); LM.changed(); };
LM.fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); };
LM.name = function (id) {                                  // "minecraft:oak_stairs" -> "Oak Stairs"
  return String(id).replace(/^minecraft:/, "").replace(/_/g, " ").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
};
