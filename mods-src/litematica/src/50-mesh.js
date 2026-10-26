/* Turning a loaded schematic into drawable sections: unify the palettes of all regions, bake the models, build the atlas, then hand the
 * volumes to the mesher worker. Sections arrive one by one; the renderer uploads them to the GPU on the next frame. */
var Mesher = (function () {
  var worker = null, workerUrl = null, jobId = 0, job = null;
  var state = { building: false, progress: 0, total: 0, quads: 0, sections: 0, error: null, bounds: null, version: 0, list: [], pendingFree: [], unknown: [] };

  function startWorker() {
    if (worker) return Promise.resolve(worker);
    return api.assets.text("worker.js").then(function (src) {
      workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
      worker.onmessage = onMessage;
      worker.onerror = function (e) { fail("The mesher stopped: " + (e && e.message || "unknown error")); };
      return worker;
    });
  }
  function stopWorker() {
    if (worker) { worker.terminate(); worker = null; }
    if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
  }
  function fail(msg) { state.building = false; state.error = msg; job = null; api.warn(msg); LM.changed(); }

  function onMessage(e) {
    var m = e.data;
    if (!job || m.id !== job.id) return;                      // a job we gave up on
    if (m.type === "section") {
      state.list.push({ cx: m.cx, cy: m.cy, cz: m.cz, quads: m.quads, verts: m.verts, gl: null });
      state.quads += m.quads; state.sections++;
      if (!(state.sections % 8)) LM.changed();
    } else if (m.type === "progress") {
      state.progress = m.total ? m.done / m.total : 0; LM.changed();
    } else if (m.type === "done") {
      state.bounds = m.bounds; state.building = false; state.progress = 1; state.version++;
      var j = job; job = null;
      j.resolve(m);
      LM.changed();
    } else if (m.type === "error") fail(m.message);
  }

  function clearSections() {
    state.list.forEach(function (s) { if (s.gl) state.pendingFree.push(s.gl); });
    state.list = []; state.quads = 0; state.sections = 0; state.bounds = null;
  }

  /* pack baked models for the worker: 27 floats per quad */
  function packModel(b, group) {
    var n = b.quads.length, f = new Float32Array(n * 27), i, j;
    for (i = 0; i < n; i++) {
      var q = b.quads[i], o = i * 27;
      f[o] = q.c; f[o + 1] = q.tex; f[o + 2] = q.shadeOn; f[o + 3] = q.tintRgb[0]; f[o + 4] = q.tintRgb[1]; f[o + 5] = q.tintRgb[2]; f[o + 6] = q.a;
      for (j = 0; j < 20; j++) f[o + 7 + j] = q.v[j];
    }
    return { n: n, quads: f, opaque: b.opaque, cullSame: b.cullSame, group: group };
  }

  /* build(schem, placement) -> Promise (resolves when every section is meshed) */
  function build(schem, pl) {
    jobId++;
    dropJob();                                                  // an older build is still running: stop it, its answers are not wanted any more
    clearSections();
    state.error = null; state.progress = 0; state.unknown = [];
    var shown = schem.regions.filter(function (r) { return !LM.hidden[r.name]; });      // regions the player switched off are left out
    if (!shown.length) { state.building = false; state.version++; return Promise.resolve(); }
    state.building = true;
    var id = jobId, global = [{ name: "minecraft:air", props: {} }], keyIndex = { "minecraft:air": 0 }, groupOf = {}, groups = [0];
    var remaps = shown.map(function (r) {
      var map = new Uint16Array(r.palette.length);
      r.palette.forEach(function (st, i) {
        if (Formats.isAir(st.name)) { map[i] = 0; return; }
        var k = Formats.stateKey(st);
        if (keyIndex[k] === undefined) {
          keyIndex[k] = global.length; global.push(st);
          if (groupOf[st.name] === undefined) groupOf[st.name] = Object.keys(groupOf).length + 1;
          groups.push(groupOf[st.name]);
        }
        map[i] = keyIndex[k];
      });
      return map;
    });
    if (global.length > 65535) { fail("This schematic uses more than 65,000 different block states."); return Promise.reject(new Error("too many states")); }
    Models.options.unknown = LM.set("showUnknown") !== false;
    return Models.prepare(global.slice(1)).then(function (baked) {
      if (id !== jobId) return null;
      var models = [null].concat(baked.map(function (b, i) { return b.empty ? null : packModel(b, groups[i + 1]); }));
      var seenName = {};
      global.forEach(function (st, i) { if (i && !seenName[st.name] && Models.isUnknown(st.name)) { seenName[st.name] = 1; state.unknown.push(st.name); } });
      var atlas = Assets.atlas;
      return startWorker().then(function (w) {
        if (id !== jobId) return null;
        return new Promise(function (resolve) {
          job = { id: id, resolve: resolve };
          var regions = shown.map(function (r, ri) {
            var map = remaps[ri], src = r.data, out = new Uint16Array(src.length), i;
            for (i = 0; i < src.length; i++) out[i] = map[src[i]];
            return { min: r.min, dim: r.dim, data: out };
          });
          state.total = regions.reduce(function (a, r) { return a + r.data.length; }, 0);
          w.postMessage({ type: "mesh", id: id, regions: regions, models: models, rot: pl.rot, mirrorX: pl.mirrorX, mirrorZ: pl.mirrorZ, rects: atlas.rects.slice() },
            regions.map(function (r) { return r.data.buffer; }));
        });
      });
    }).catch(function (e) { if (id === jobId) fail("Could not build this schematic: " + (e && e.message || e)); throw e; });
  }

  function dropJob() { if (job) { var j = job; job = null; stopWorker(); j.resolve(null); } }
  function cancel() { jobId++; dropJob(); state.building = false; stopWorker(); clearSections(); state.unknown = []; }

  return { state: state, build: build, cancel: cancel, dispose: function () { cancel(); } };
})();
