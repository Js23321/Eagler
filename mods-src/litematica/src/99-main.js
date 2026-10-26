/* Wiring: settings, hotkeys, file handling, placement, and the world-pass hook. */

api.settings.define([
  { key: "visible", type: "toggle", label: "Show schematic", note: "Hide or show the overlay without unloading it", default: true },
  { key: "opacity", type: "range", label: "Opacity", note: "How solid the ghost blocks look", min: 10, max: 100, step: 5, unit: "%", default: 70 },
  { key: "throughWalls", type: "toggle", label: "See through terrain", note: "Draw the schematic over blocks that are in front of it", default: false },
  { key: "outline", type: "toggle", label: "Outline box", note: "A frame around the whole schematic", default: true },
  { key: "showUnknown", type: "toggle", label: "Show unknown blocks", note: "Blocks this game version does not have (renamed, or from a mod) are drawn as magenta cubes", default: true },
  { key: "verify", type: "toggle", label: "Verifier", note: "Compare the schematic with the world the game has loaded and box what is missing or wrong", default: true },
  { key: "vMissing", type: "toggle", label: "Show missing blocks", note: "Blue boxes: the schematic has a block, the world has air", default: true, when: function (c) { return c.verify; } },
  { key: "vWrong", type: "toggle", label: "Show wrong blocks", note: "Red boxes: another block is there", default: true, when: function (c) { return c.verify; } },
  { key: "vState", type: "toggle", label: "Show wrong states", note: "Orange boxes: the right block with other properties (facing, half, ...)", default: true, when: function (c) { return c.verify; } },
  { key: "vExtra", type: "toggle", label: "Show extra blocks", note: "Pink boxes: a block where the schematic has air (lots of them when the schematic sits inside terrain)", default: false, when: function (c) { return c.verify; } },
  { key: "vStrict", type: "toggle", label: "Compare every property", note: "Off: stairs shape, fence connections, powered / lit, leaf distance, crop age ... are ignored because they follow from the surroundings", default: false, when: function (c) { return c.verify; } },
  { key: "distance", type: "range", label: "Draw distance", note: "Parts of the schematic further than this are not drawn", min: 32, max: 512, step: 16, unit: "m", default: 160 },
  { key: "layerMode", type: "choice", label: "Layers", note: "Show only part of the height, to build floor by floor", options: [["all", "All"], ["single", "One layer"], ["below", "This and below"], ["above", "This and above"]], default: "all" },
  { key: "layer", type: "range", label: "Layer", note: "0 is the lowest layer of the schematic", min: 0, max: 319, step: 1, unit: "", default: 0, when: function (c) { return c.layerMode !== "all"; } }
]);

LM.defaultPlacement = function () { return { x: 0, y: 0, z: 0, rot: 0, mirrorX: false, mirrorZ: false }; };
LM.savePlacement = function () { LM.unplaced = false; if (LM.fileName) api.storage.set("pl:" + LM.fileName, LM.placement); };

LM.rebuild = function () {
  if (!LM.schem) return Promise.resolve();
  return Mesher.build(LM.schem, LM.placement).then(function () { LM.changed(); }, function () { LM.changed(); });
};
LM.placeAtPlayer = function () {
  var c = api.game.cam;
  if (!c) { api.ui.toast("Join a world first", true); return; }
  LM.placement.x = Math.floor(c.x); LM.placement.y = Math.floor(c.y - 1.62 + 0.05); LM.placement.z = Math.floor(c.z);
  LM.savePlacement(); LM.changed();
};
LM.move = function (axis, d) { LM.placement[axis] += d; LM.savePlacement(); LM.changed(); };
LM.rotate = function (k) { LM.placement.rot = (LM.placement.rot + k + 4) % 4; LM.savePlacement(); LM.rebuild(); LM.changed(); };
LM.mirror = function (axis) { if (axis === "x") LM.placement.mirrorX = !LM.placement.mirrorX; else LM.placement.mirrorZ = !LM.placement.mirrorZ; LM.savePlacement(); LM.rebuild(); LM.changed(); };
LM.resetTurn = function () { LM.placement.rot = 0; LM.placement.mirrorX = LM.placement.mirrorZ = false; LM.savePlacement(); LM.rebuild(); LM.changed(); };
LM.unload = function () {
  Mesher.cancel(); LM.schem = null; LM.fileName = ""; LM.fatalMsg = null; LM.hidden = {};
  api.storage.remove("current");
  LM.changed();
};
/* switch regions of a multi-region schematic on or off (kept per file) */
LM.saveHidden = function () {
  var list = Object.keys(LM.hidden);
  if (list.length) api.storage.set("hr:" + LM.fileName, list); else api.storage.remove("hr:" + LM.fileName);
};
LM.toggleRegion = function (name) {
  if (!LM.schem) return;
  if (LM.hidden[name]) delete LM.hidden[name]; else LM.hidden[name] = true;
  LM.saveHidden(); LM.rebuild(); LM.changed();
};
LM.setAllRegions = function (on) {
  if (!LM.schem) return;
  LM.hidden = {};
  if (!on) LM.schem.regions.forEach(function (r) { LM.hidden[r.name] = true; });
  LM.saveHidden(); LM.rebuild(); LM.changed();
};

LM.loadBytes = function (name, bytes, opts) {
  opts = opts || {};
  return Formats.load(name, bytes).then(function (s) {
    LM.schem = s; LM.fileName = name; LM.fatalMsg = null;
    LM.hidden = {};
    var hr = api.storage.get("hr:" + name, []);
    (Array.isArray(hr) ? hr : []).forEach(function (n) { if (s.regions.some(function (r) { return r.name === n; })) LM.hidden[n] = true; });
    var saved = api.storage.get("pl:" + name, null);
    LM.placement = Object.assign(LM.defaultPlacement(), saved || {});
    LM.unplaced = !saved;                                         // never positioned: it goes to the player's feet (now, or on the first frame in a world)
    if (LM.unplaced && api.game.cam) LM.placeAtPlayer();
    if (opts.save) api.files.save("schem/" + name, bytes).then(function () { LM.refreshSaved(); }, function () { api.warn("could not keep a copy of " + name); });
    api.storage.set("current", name);
    LM.changed();
    if (!opts.quiet) api.ui.toast("Loaded " + (s.name || name) + ": " + LM.fmt(s.blocks) + " blocks");
    return LM.rebuild();
  }, function (e) {
    LM.fatalMsg = "Could not read " + name + ": " + (e && e.message || e);
    LM.changed();
    api.ui.toast(LM.fatalMsg, true);
    throw e;
  });
};
LM.openFile = function (file) {
  return file.arrayBuffer().then(function (b) { return LM.loadBytes(file.name, new Uint8Array(b), { save: true }); }).catch(function () {});
};

/* kept schematics */
LM.savedList = [];
LM.savedSig = function () { return LM.savedList.map(function (f) { return f.name + ":" + f.size; }).join("|") + "@" + LM.fileName; };
LM.refreshSaved = function () {
  api.files.list().then(function (l) {
    LM.savedList = l.filter(function (f) { return f.name.indexOf("schem/") === 0; }).map(function (f) { return { name: f.name.slice(6), size: f.size, at: f.at }; }).sort(function (a, b) { return b.at - a.at; });
    LM.changed();
  });
};
LM.useSaved = function (name) {
  api.files.load("schem/" + name).then(function (buf) {
    if (!buf) { api.ui.toast("That file is gone", true); LM.refreshSaved(); return; }
    LM.loadBytes(name, new Uint8Array(buf), { save: false }).catch(function () {});
  });
};
LM.deleteSaved = function (name) {
  api.files.remove("schem/" + name).then(function () {
    api.storage.remove("pl:" + name); api.storage.remove("hr:" + name);
    if (LM.fileName === name) LM.unload();
    LM.refreshSaved();
  });
};

/* hotkeys */
api.keys.register({ id: "toggle", label: "Show / hide the schematic", def: "KeyK", onDown: function () { api.settings.set("visible", !LM.set("visible")); api.ui.toast("Schematic " + (LM.set("visible") ? "shown" : "hidden")); } });
api.keys.register({ id: "layerUp", label: "Layer up", def: "", onDown: function () { var v = LM.set("layer"); api.settings.set("layer", Math.min(319, v + 1)); if (LM.set("layerMode") === "all") api.settings.set("layerMode", "single"); } });
api.keys.register({ id: "layerDown", label: "Layer down", def: "", onDown: function () { var v = LM.set("layer"); api.settings.set("layer", Math.max(0, v - 1)); if (LM.set("layerMode") === "all") api.settings.set("layerMode", "single"); } });
api.keys.register({ id: "toMe", label: "Move the schematic to me", def: "", onDown: function () { LM.placeAtPlayer(); } });
api.keys.register({ id: "rotate", label: "Rotate 90 degrees", def: "", onDown: function () { LM.rotate(1); } });

/* files: .litematic and friends dropped on, or picked with, the Load mods button */
api.onFile(["litematic", "schem", "schematic", "nbt"], function (f) { return LM.loadBytes(f.name, f.bytes, { save: true }); });

api.gl.onWorld(function (ctx) { Render.draw(ctx); });
api.ui.panel(function (box) { Panel.build(box); });
api.onDisable(function () { Mesher.dispose(); Render.release(); Assets.closeFs(); LM.views.length = 0; });

api.settings.onChange(function (k) { if (k === "showUnknown") LM.rebuild(); });

/* a schematic loaded outside a world is put at the player's feet on the first frame in a world */
api.events.on("world-frame", function () {
  if (!LM.unplaced || !LM.schem || !api.game.cam) return;
  LM.placeAtPlayer();
  api.ui.toast("Placed at your position. Move it from the Litematica page.");
});

/* resource packs are switched in Options: when the player is back in the world, rebuild if the set of packs changed */
api.events.on("screen", function (id) {
  if (id || !LM.schem) return;
  Assets.syncPacks().then(function (changed) { if (changed) LM.rebuild(); });
});

if (window.__ocDebug) window.__lm = { api: api, LM: LM, Mesher: Mesher, Render: Render, Assets: Assets, Models: Models, Formats: Formats, Verify: Verify, States: States };      // test hook, only when the page sets __ocDebug

/* come back to the schematic you were using */
(function () {
  var cur = api.storage.get("current", null);
  if (!cur) return;
  api.files.load("schem/" + cur).then(function (buf) {
    if (buf) LM.loadBytes(cur, new Uint8Array(buf), { save: false, quiet: true }).catch(function () {});
  });
})();
