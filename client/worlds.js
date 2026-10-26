/* OneClient worlds: the saved worlds of the game, and the buttons of its Singleplayer screens, for the Singleplayer page of the menus (menu.js).
 *
 * The worlds are read from the game's own filesystem (IndexedDB): worlds/<folder>/level.dat holds the name, the game mode, when it was last played.
 * Everything that changes something goes through the game's real screens, pressed with OC.native, exactly as a player would; this file only
 * knows where the buttons are and in which order to press them. Positions are GUI units (what the game lays out in), relative to the
 * middle of the screen, the top or the bottom, so they hold at every window size and GUI scale.
 *
 *   OC.worlds.load()           -> Promise { list: [ { dir, name, last, mode, hardcore, cheats, difficulty, version, newer, icon } ], ok }
 *   OC.worlds.open()           from the title screen: press Singleplayer, wait for the game's world list (or its "what would you like to do" box)
 *   OC.worlds.back()           leave the world screens back to the title screen
 *   OC.worlds.play(i)          select the i-th world of the game's list and press Play Selected World
 *   OC.worlds.create(opts)     press Create New World, fill the game's screen from opts and press Create (the game starts loading the world)
 *   OC.worlds.remove(i)        select the i-th world, press Delete and confirm
 *   OC.worlds.edit(i)          select the i-th world and open the game's Edit World screen (left for the player to use)
 * The order of the game's list is the order of load().list (last played first, then by folder name), which is what the row numbers mean.
 * ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient, N = OC && OC.native;
  if (!OC || !N || !window.indexedDB) return;

  var W = OC.worlds = {};
  var FS_DB = "_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_8_8_worlds", NB = OC.nbt, CURRENT_ID = 4903;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function waitScreen(test, ms) {
    return new Promise(function (resolve) {
      var t0 = performance.now();
      (function tick() { if (test(OC.screen)) return resolve(true); if (performance.now() - t0 > ms) return resolve(false); setTimeout(tick, 100); })();
    });
  }
  var isWorlds = function (s) { return s === "worlds" || s === "worldmenu"; };

  /* ---------- the saved worlds ---------- */
  function openFs() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(FS_DB);
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function fsGet(db, path) {
    return new Promise(function (resolve) {
      var q = db.transaction("filesystem", "readonly").objectStore("filesystem").get([path]);
      q.onsuccess = function () { resolve(q.result || null); };
      q.onerror = function () { resolve(null); };
    });
  }
  function fsKeys(db, prefix) {                                   // the first path segment after the prefix, once each
    return new Promise(function (resolve) {
      var q = db.transaction("filesystem", "readonly").objectStore("filesystem").getAllKeys(IDBKeyRange.bound([prefix], [prefix + String.fromCharCode(0xffff)]));
      q.onsuccess = function () {
        var seen = {}, out = [];
        (q.result || []).forEach(function (k) { var rest = String(k[0]).slice(prefix.length), d = rest.split("/")[0]; if (d && !seen[d]) { seen[d] = 1; out.push(d); } });
        resolve(out);
      };
      q.onerror = function () { resolve([]); };
    });
  }
  function gunzip(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function tagVal(c, k) { var t = c && NB.get(c, k); return t ? t.v : undefined; }

  function readWorld(db, dir) {
    return fsGet(db, "worlds/" + dir + "/level.dat").then(function (rec) {
      if (!rec) return null;
      return gunzip(new Uint8Array(rec.data)).then(function (raw) {
        var root = NB.read(raw).tag, d = NB.get(root, "Data");
        if (!d) return null;
        var ds = NB.get(d, "difficulty_settings"), ver = NB.get(d, "Version"), gt = Number(tagVal(d, "GameType")) || 0;
        var hard = ds ? !!Number(tagVal(ds, "hardcore")) : !!Number(tagVal(d, "hardcore"));
        var w = {
          dir: dir, name: String(tagVal(d, "LevelName") || dir), last: Number(tagVal(d, "LastPlayed") || 0),
          mode: hard ? "hardcore" : gt === 1 ? "creative" : gt === 2 ? "adventure" : gt === 3 ? "spectator" : "survival",
          hardcore: hard, cheats: !!Number(tagVal(d, "allowCommands")), difficulty: ds ? String(tagVal(ds, "difficulty") || "") : "",
          version: ver ? String(tagVal(ver, "Name") || "") : "", newer: ver ? Number(tagVal(ver, "Id") || 0) > CURRENT_ID : false, icon: null
        };
        return fsGet(db, "worlds/" + dir + "/icon.png").then(function (ic) {
          if (ic && ic.data && ic.data.byteLength > 8) w.icon = URL.createObjectURL(new Blob([ic.data], { type: "image/png" }));
          return w;
        });
      });
    }).catch(function () { return null; });
  }

  W.load = function () {
    var db;
    return openFs().then(function (d) {
      db = d;
      return fsGet(db, "worlds_list.txt").then(function (rec) {
        var names = rec ? new TextDecoder().decode(new Uint8Array(rec.data)).split("\n").map(function (s) { return s.replace(/\r$/, ""); }).filter(Boolean) : [];
        return names.length ? names : fsKeys(db, "worlds/");
      });
    }).then(function (dirs) {
      return Promise.all(dirs.map(function (d) { return readWorld(db, d); }));
    }).then(function (all) {
      db.close();
      var list = all.filter(Boolean);
      list.sort(function (a, b) { return b.last - a.last || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0); });       // the game's own order
      return { list: list, ok: true };
    }).catch(function (e) { try { db.close(); } catch (x) { /* never opened */ } return { list: [], ok: false, error: String(e && e.message || e) }; });
  };

  /* ---------- where the game's buttons are (GUI units) ---------- */
  function gui() { var g = N.gui(); return { cx: g.w / 2, h: g.h, dy: (g.h - 384) / 6 }; }     // dy: the Create World tabs keep their content at 1/6 of the free height (measured at 384 and 450 GUI units high)
  var P = {
    row: function (i) { var g = gui(); return [g.cx - 40, 69 + 36 * i]; },                 // a world's row; x is clear of the icon (a click on the icon plays the world)
    play: function () { var g = gui(); return [g.cx - 79, g.h - 42]; },
    create: function () { var g = gui(); return [g.cx + 79, g.h - 42]; },
    edit: function () { var g = gui(); return [g.cx - 119, g.h - 18]; },
    del: function () { var g = gui(); return [g.cx - 41, g.h - 18]; },
    confirmYes: function () { var g = gui(); return [g.cx - 77, g.h / 2 + 25]; },        // the Delete button of "Are you sure you want to delete this world?"
    dialogCreate: function () { var g = gui(); return [g.cx, g.h / 4 + 34]; },           // "Create New World" in the "what would you like to do" box
    // the Create New World screen
    tabGame: function () { var g = gui(); return [g.cx - 124, 14]; },
    tabWorld: function () { var g = gui(); return [g.cx, 14]; },
    name: function () { var g = gui(); return [g.cx + 90, 82 + g.dy]; },
    mode: function () { var g = gui(); return [g.cx, 110 + g.dy]; },
    diff: function () { var g = gui(); return [g.cx, 138 + g.dy]; },
    cheats: function () { var g = gui(); return [g.cx, 165 + g.dy]; },
    wtype: function () { var g = gui(); return [g.cx - 80, 68 + g.dy]; },
    seed: function () { var g = gui(); return [g.cx, 110 + g.dy]; },
    structs: function () { var g = gui(); return [g.cx + 132, 141 + g.dy]; },
    bonus: function () { var g = gui(); return [g.cx + 132, 165 + g.dy]; },
    go: function () { var g = gui(); return [g.cx - 79, g.h - 16]; },
    cancel: function () { var g = gui(); return [g.cx + 79, g.h - 16]; }           // Cancel on the Create New World screen (Escape there crashes the game)
  };
  function click(p, times) {
    var chain = Promise.resolve(), n = times == null ? 1 : times;
    for (var i = 0; i < n; i++) chain = chain.then(function () { return N.click(p[0], p[1]); }).then(function () { return N.frames(2); });
    return chain;
  }
  function key(name) {
    var codes = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
    return N.key(name, name, codes[name]);
  }

  /* ---------- driving the game ---------- */
  W.open = function () {
    if (isWorlds(OC.screen)) return Promise.resolve(OC.screen);
    if (OC.screen !== "title") return Promise.resolve(null);
    return N.click.apply(null, [].concat(OC.menu.pos("title.singleplayer"))).then(function () {
      return waitScreen(isWorlds, 90000);                        // the game starts its integrated server first: a few seconds, longer on a slow machine
    }).then(function (ok) { return ok ? OC.screen : null; });
  };

  W.back = function () {
    var tries = 0;
    function step() {
      if (OC.screen === "title") return Promise.resolve(true);
      if (tries++ > 6) return Promise.resolve(false);
      var act = OC.screen === "createworld" ? click(P.cancel()) : key("Escape");                 // Escape on the Create New World screen crashes the game: its Cancel button is pressed instead
      return act.then(function () { return waitScreen(function (s) { return s === "title"; }, 1800); }).then(function (ok) { return ok ? true : step(); });
    }
    return step();
  };

  W.select = function (i) {
    if (OC.screen !== "worlds") return Promise.resolve(false);
    var chain = click(P.row(0));
    if (i > 0) {                                                  // the arrow keys also scroll the list: this works for every row, visible or not
      chain = chain.then(function () {
        var c = Promise.resolve();
        for (var k = 0; k < i; k++) c = c.then(function () { return key("ArrowDown"); });
        return c;
      });
    }
    return chain.then(function () { return N.frames(3); }).then(function () { return true; });
  };

  W.play = function (i) {
    return W.select(i).then(function (ok) { return ok ? click(P.play()).then(function () { return true; }) : false; });
  };

  W.edit = function (i) {
    return W.select(i).then(function (ok) { return ok ? click(P.edit()).then(function () { return true; }) : false; });
  };

  W.remove = function (i) {
    return W.select(i).then(function (ok) {
      if (!ok) return false;
      return click(P.del()).then(function () { return N.frames(8); }).then(function () { return click(P.confirmYes()); }).then(function () {
        return waitScreen(function (s) { return s === "worlds" || s === "worldmenu"; }, 12000);
      }).then(function (back) { return back ? N.frames(4).then(function () { return true; }) : false; });
    });
  };

  /* the Create New World screen: defaults are Survival, Normal, no cheats, Default world type, structures on, no bonus chest.
   * o = { name, mode: survival|creative|hardcore, difficulty: peaceful|easy|normal|hard, cheats, type: default|superflat|large|amplified, seed, structures, bonus } */
  var MODES = ["survival", "hardcore", "creative"], DIFFS = ["normal", "hard", "peaceful", "easy"], TYPES = ["default", "superflat", "large", "amplified"];
  function idx(list, v, def) { var i = list.indexOf(v); return i < 0 ? def : i; }
  function fill(o) {
    var mode = o.mode || "survival", chain = Promise.resolve();
    function step(fn) { chain = chain.then(fn); }
    step(function () { return click(P.tabGame()); });
    step(function () { return click(P.name()); });
    step(function () { return N.backspace(48); });
    step(function () { return N.type(String(o.name || "New World").slice(0, 64)); });
    if (mode !== "hardcore") step(function () { return click(P.diff(), idx(DIFFS, o.difficulty || "normal", 0)); });      // the difficulty first: hardcore locks it, and leaving hardcore gives it back
    step(function () { return click(P.mode(), idx(MODES, mode, 0)); });
    if (mode !== "hardcore" && !!o.cheats !== (mode === "creative")) step(function () { return click(P.cheats()); });       // creative switches cheats on by itself
    step(function () { return click(P.tabWorld()); });
    step(function () { return click(P.wtype(), idx(TYPES, o.type || "default", 0)); });
    if (o.seed) { step(function () { return click(P.seed()); }); step(function () { return N.type(String(o.seed).slice(0, 40)); }); }
    if (o.structures === false) step(function () { return click(P.structs()); });
    if (o.bonus) step(function () { return click(P.bonus()); });
    return chain;
  }

  W.create = function (o) {
    o = o || {};
    var s = OC.screen, chain = Promise.resolve();
    if (s === "worlds") chain = click(P.create()).then(function () { return waitScreen(function (x) { return x === "worldmenu"; }, 12000); });
    else if (s !== "worldmenu") return Promise.resolve(false);
    return chain.then(function (ok) {
      if (ok === false) return false;
      return N.frames(4).then(function () { return key("Tab"); }).then(function () { return key("Enter"); }).then(function () {      // the first button of the box is Create New World
        return waitScreen(function (x) { return x === "createworld"; }, 4000);
      }).then(function (up) {
        if (up) return true;
        return click(P.dialogCreate()).then(function () { return waitScreen(function (x) { return x === "createworld"; }, 8000); });
      });
    }).then(function (up) {
      if (!up) return false;
      return N.frames(4).then(function () { return fill(o); }).then(function () { return click(P.go()); }).then(function () { return true; });
    });
  };

  /* the game's "what would you like to do" box (create / import an EPK or vanilla world / join a LAN world), for the player to use */
  W.more = function () {
    if (OC.screen === "worldmenu") return Promise.resolve(true);
    if (OC.screen !== "worlds") return Promise.resolve(false);
    return click(P.create()).then(function () { return waitScreen(function (x) { return x === "worldmenu"; }, 8000); });
  };

  W.positions = P;      // for tests and for the menu code that waits on these screens
})();
