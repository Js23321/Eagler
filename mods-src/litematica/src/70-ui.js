/* The Litematica page inside the Mods menu: load schematics, saved list, placement, materials. The display options (opacity, layers ...)
 * are ordinary settings rows above this panel. */
var Panel = (function () {
  api.dom.style(
    ".lm-card{padding:14px 16px;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#fff;font:500 13px/1.45 var(--oc-font,system-ui)}" +
    ".lm-card h4{margin:0 0 4px;font:750 15px/1.2 var(--oc-font,system-ui)}" +
    ".lm-card small{color:rgba(255,255,255,.62);font-size:12px}" +
    ".lm-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}" +
    ".lm-grow{flex:1;min-width:0}" +
    ".lm-btn{appearance:none;height:34px;padding:0 13px;border:1px solid rgba(255,255,255,.26);border-radius:11px;background:rgba(255,255,255,.12);color:#fff;font:650 12.5px/1 var(--oc-font,system-ui);cursor:pointer;outline:none}" +
    ".lm-btn:hover{background:rgba(255,255,255,.22)}.lm-btn:active{transform:scale(.96)}" +
    ".lm-btn.pri{background:linear-gradient(180deg,rgba(156,208,255,.5),rgba(122,155,255,.4));border-color:rgba(255,255,255,.4)}" +
    ".lm-btn.dng:hover{background:rgba(255,90,90,.28)}" +
    ".lm-btn.on{background:rgba(125,255,178,.28);border-color:rgba(125,255,178,.6)}" +
    ".lm-btn:disabled{opacity:.4;cursor:default}" +
    ".lm-num{display:flex;align-items:center;gap:4px}.lm-num b{width:16px;color:rgba(255,255,255,.6);font-size:12px}" +
    ".lm-num input{width:78px;height:34px;padding:0 8px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(0,0,0,.28);color:#fff;font:650 13px/1 var(--oc-font,system-ui);text-align:center;outline:none}" +
    ".lm-num input:focus{border-color:#9cd0ff}" +
    ".lm-num button{width:26px;height:34px;padding:0;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:rgba(255,255,255,.1);color:#fff;font:700 13px/1 system-ui;cursor:pointer}" +
    ".lm-num button:hover{background:rgba(255,255,255,.22)}" +
    ".lm-list{display:flex;flex-direction:column;gap:6px;margin-top:10px;max-height:190px;overflow:auto}" +
    ".lm-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:12px;background:rgba(0,0,0,.2)}" +
    ".lm-item.cur{outline:1px solid rgba(125,255,178,.55)}" +
    ".lm-item span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".lm-mat{display:grid;grid-template-columns:1fr auto auto auto;gap:3px 14px;margin-top:8px;max-height:260px;overflow:auto;font-size:12.5px}" +
    ".lm-mat b{text-align:right;font-variant-numeric:tabular-nums}.lm-mat i{font-style:normal;color:rgba(255,255,255,.55);text-align:right}" +
    ".lm-dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:baseline}.lm-ver{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:13px}.lm-ver b{font-variant-numeric:tabular-nums}.lm-err{color:#ffb4a0;margin-top:8px}.lm-note{color:#ffd9a0;margin-top:8px;font-size:12px}" +
    ".lm-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.12);margin-top:8px;overflow:hidden}.lm-bar i{display:block;height:100%;background:#9cd0ff;transition:width .2s}"
  );

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function btn(label, cls, fn) { var b = el("button", "lm-btn " + (cls || ""), esc(label)); b.type = "button"; b.tabIndex = -1; b.addEventListener("mousedown", function (e) { e.preventDefault(); }); b.addEventListener("click", fn); return b; }

  function build(box) {
    box.textContent = "";
    var root = el("div"), st = Mesher.state;
    root.style.cssText = "display:flex;flex-direction:column;gap:10px";

    /* --- schematic --- */
    var cur = el("div", "lm-card"), curTitle = el("h4"), curSub = el("small"), curBar = el("div", "lm-bar", "<i></i>"), curErr = el("div", "lm-err"), curNote = el("div", "lm-note");
    cur.appendChild(curTitle); cur.appendChild(curSub); cur.appendChild(curBar); cur.appendChild(curErr); cur.appendChild(curNote);
    var r1 = el("div", "lm-row");
    r1.appendChild(btn("Load schematic file\u2026", "pri", function () {
      api.ui.pickFiles(".litematic,.schem,.schematic,.nbt", true).then(function (fs) { fs.forEach(function (f) { LM.openFile(f); }); });
    }));
    var unload = btn("Unload", "dng", function () { LM.unload(); });
    r1.appendChild(unload);
    cur.appendChild(r1);
    root.appendChild(cur);

    /* --- regions (only for schematics that have several) --- */
    var reg = el("div", "lm-card"), regList = el("div", "lm-list"), regSig = "";
    reg.appendChild(el("h4", null, "Regions"));
    reg.appendChild(el("small", null, "Switch parts of this schematic on or off. The material list follows."));
    var rr = el("div", "lm-row");
    rr.appendChild(btn("Show all", "", function () { LM.setAllRegions(true); }));
    rr.appendChild(btn("Hide all", "", function () { LM.setAllRegions(false); }));
    reg.appendChild(rr); reg.appendChild(regList);
    root.appendChild(reg);
    function paintRegions() {
      var s = LM.schem, many = !!s && s.regions.length > 1;
      reg.style.display = many ? "" : "none";
      var sig = many ? LM.fileName + "|" + Object.keys(LM.hidden).join(",") : "";
      if (sig === regSig) return;
      regSig = sig; regList.textContent = "";
      if (!many) return;
      s.regions.forEach(function (r) {
        var on = !LM.hidden[r.name], it = el("div", "lm-item" + (on ? " cur" : ""));
        it.appendChild(el("span", null, esc(r.name)));
        it.appendChild(el("small", null, r.dim[0] + " x " + r.dim[1] + " x " + r.dim[2] + "   " + LM.fmt(r.blocks) + " blocks"));
        it.appendChild(btn(on ? "Shown" : "Hidden", on ? "on" : "", function () { LM.toggleRegion(r.name); }));
        regList.appendChild(it);
      });
    }

    /* --- verifier --- */
    var ver = el("div", "lm-card"), verLine = el("div", "lm-ver"), verSub = el("small");
    ver.appendChild(el("h4", null, "Verifier")); ver.appendChild(verLine); verSub.style.display = "block"; verSub.style.marginTop = "8px"; ver.appendChild(verSub);
    root.appendChild(ver);
    function paintVerify() {
      var v = Verify.summary(), s = LM.schem;
      ver.style.display = s ? "" : "none";
      if (!s) return;
      if (!v.on) { verLine.textContent = ""; verSub.textContent = v.reason || ""; return; }
      var dot = function (c, n, label) { return '<span><i class="lm-dot" style="background:' + c + '"></i><b>' + LM.fmt(n) + "</b> " + label + "</span>"; };
      verLine.innerHTML = dot("#7dffb2", v.correct, "correct") + dot("#40a6ff", v.missing, "missing") + dot("#ff3838", v.wrong, "wrong block") + dot("#ffa01e", v.state, "wrong state") + (LM.set("vExtra") ? dot("#e63ce6", v.extra, "extra") : "");
      verSub.textContent = (v.pending ? "Checking " + LM.fmt(v.pending) + " more sections\u2026 " : "") + (v.unknown ? LM.fmt(v.unknown) + " blocks are not in this game version and are skipped. " : "") + "Only parts of the world the game has loaded can be checked.";
    }

    /* --- saved --- */
    var saved = el("div", "lm-card"), savedList = el("div", "lm-list");
    saved.appendChild(el("h4", null, "Saved schematics"));
    saved.appendChild(el("small", null, "Schematics you loaded are kept in this browser, so they come back next time."));
    saved.appendChild(savedList);
    root.appendChild(saved);

    /* --- placement --- */
    var pl = el("div", "lm-card");
    pl.appendChild(el("h4", null, "Placement"));
    pl.appendChild(el("small", null, "Where the schematic's origin corner is in the world. The overlay shows where the blocks go; it never changes the world."));
    var nums = el("div", "lm-row"), inputs = {};
    ["x", "y", "z"].forEach(function (k) {
      var w = el("div", "lm-num"), input = el("input");
      input.type = "number"; input.step = "1"; input.tabIndex = -1;
      input.addEventListener("change", function () { LM.move(k, Math.round(+input.value || 0) - LM.placement[k]); });
      input.addEventListener("keydown", function (e) { e.stopPropagation(); }, true);
      w.appendChild(el("b", null, k.toUpperCase()));
      [["-16", -16], ["-1", -1]].forEach(function (s) { var b = el("button", null, s[0]); b.type = "button"; b.tabIndex = -1; b.addEventListener("click", function () { LM.move(k, s[1]); }); w.appendChild(b); });
      w.appendChild(input);
      [["+1", 1], ["+16", 16]].forEach(function (s) { var b = el("button", null, s[0]); b.type = "button"; b.tabIndex = -1; b.addEventListener("click", function () { LM.move(k, s[1]); }); w.appendChild(b); });
      inputs[k] = input; nums.appendChild(w);
    });
    pl.appendChild(nums);
    var r2 = el("div", "lm-row"), bMirX, bMirZ, rotLabel = el("small");
    r2.appendChild(btn("Move to my position", "pri", function () { LM.placeAtPlayer(); }));
    r2.appendChild(btn("Rotate 90\u00b0", "", function () { LM.rotate(1); }));
    bMirX = btn("Mirror X", "", function () { LM.mirror("x"); }); r2.appendChild(bMirX);
    bMirZ = btn("Mirror Z", "", function () { LM.mirror("z"); }); r2.appendChild(bMirZ);
    r2.appendChild(btn("Reset turn", "", function () { LM.resetTurn(); }));
    pl.appendChild(r2);
    var extent = el("small"); extent.style.display = "block"; extent.style.marginTop = "10px";
    pl.appendChild(extent);
    root.appendChild(pl);

    /* --- selection: two corners, save as a schematic, paste --- */
    var selc = el("div", "lm-card"), selInfo = el("small"), selNames = {}, selIn = {};
    selc.appendChild(el("h4", null, "Selection"));
    selc.appendChild(el("small", null, "Mark an area of the world, then save it as a schematic (read from the blocks the game has loaded), or use it to see where a schematic sits."));
    [1, 2].forEach(function (n) {
      var row = el("div", "lm-row"), lab = el("small", null, "Corner " + n); lab.style.width = "62px";
      row.appendChild(lab);
      ["x", "y", "z"].forEach(function (k, ki) {
        var w = el("div", "lm-num"), input = el("input"); input.type = "number"; input.step = "1"; input.tabIndex = -1; input.style.width = "70px";
        input.addEventListener("keydown", function (e) { e.stopPropagation(); }, true);
        input.addEventListener("change", function () { var p = (n === 1 ? Sel.a : Sel.b) || [0, 0, 0]; p = p.slice(); p[ki] = Math.round(+input.value || 0); Sel.set(n, p); });
        w.appendChild(el("b", null, k.toUpperCase())); w.appendChild(input); selIn[n + k] = input; row.appendChild(w);
      });
      row.appendChild(btn("My feet", "", function () { var p = Sel.feet(); if (p) Sel.set(n, p); else api.ui.toast("Join a world first", true); }));
      row.appendChild(btn("Block I look at", "", function () { var p = Sel.aim(); if (p) Sel.set(n, p); else api.ui.toast("No block in view (is the chunk loaded?)", true); }));
      selc.appendChild(row);
    });
    selInfo.style.display = "block"; selInfo.style.marginTop = "10px"; selc.appendChild(selInfo);
    var rs = el("div", "lm-row"), nameIn = el("input"); nameIn.type = "text"; nameIn.placeholder = "Name for the schematic"; nameIn.tabIndex = -1; nameIn.className = "lm-grow";
    nameIn.style.cssText = "height:34px;padding:0 10px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(0,0,0,.28);color:#fff;font:600 13px system-ui;outline:none;min-width:120px";
    nameIn.addEventListener("keydown", function (e) { e.stopPropagation(); }, true);
    var saveBtn = btn("Save selection", "pri", function () {
      var nm = (nameIn.value || "").trim() || "selection-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      saveBtn.disabled = true;
      Sel.exportBytes(nm, "OneClient").then(function (r) {
        var file = nm.replace(/[\\/:*?"<>|]+/g, "_").replace(/(\.litematic)?$/, ".litematic");
        return api.files.save("schem/" + file, r.bytes).then(function () { LM.refreshSaved(); api.ui.toast("Saved " + file + ": " + LM.fmt(r.blocks) + " blocks, " + r.size.join(" x ")); });
      }).catch(function (e) { api.ui.toast(e && e.message || String(e), true); }).then(function () { saveBtn.disabled = false; });
    });
    rs.appendChild(nameIn); rs.appendChild(saveBtn);
    rs.appendChild(btn("Select the schematic", "", function () {
      var S = LM.schem, st = Mesher.state, pl = LM.placement; if (!S) return;
      var b = st.bounds || { min: S.min, max: [S.min[0] + S.size[0], S.min[1] + S.size[1], S.min[2] + S.size[2]] };
      Sel.set(1, [pl.x + b.min[0], pl.y + b.min[1], pl.z + b.min[2]]); Sel.set(2, [pl.x + b.max[0] - 1, pl.y + b.max[1] - 1, pl.z + b.max[2] - 1]);
    }));
    rs.appendChild(btn("Clear", "dng", function () { Sel.clear(); }));
    selc.appendChild(rs);
    root.appendChild(selc);
    function paintSelection() {
      var bx = Sel.box(), ok = api.world.available;
      selc.style.display = ok ? "" : "none";
      [1, 2].forEach(function (n) { var p = n === 1 ? Sel.a : Sel.b; ["x", "y", "z"].forEach(function (k, ki) { var i = selIn[n + k]; if (document.activeElement !== i) i.value = p ? p[ki] : ""; }); });
      selInfo.textContent = bx ? bx.size.join(" x ") + " blocks (" + LM.fmt(bx.size[0] * bx.size[1] * bx.size[2]) + ")" + (api.world.ready && Sel.missingChunks(bx).length ? "  \u00b7  " + Sel.missingChunks(bx).length + " chunks not loaded yet" : "") : "Set both corners.";
      saveBtn.disabled = !bx;
    }

    /* --- paste --- */
    var pc = el("div", "lm-card"), pcInfo = el("small"), pcBar = el("div", "lm-bar", "<i></i>"), pasteBtn, armed = 0;
    pc.appendChild(el("h4", null, "Paste into the world"));
    pc.appendChild(el("small", null, "Builds the schematic at its placement for you, with commands. Singleplayer worlds with cheats on only. It cannot be undone."));
    var pr = el("div", "lm-row");
    pasteBtn = btn("Paste schematic", "pri", function () {
      var run = Sel.pasteState();
      if (run) { Sel.cancelPaste(); return; }
      if (!armed || Date.now() - armed > 6000) { armed = Date.now(); pasteBtn.textContent = "Click again to paste"; setTimeout(function () { if (!Sel.pasteState()) pasteBtn.textContent = "Paste schematic"; }, 6200); return; }
      armed = 0; pasteBtn.textContent = "Stop pasting";
      Sel.startPaste(false).then(function (r) { api.ui.toast(r.cancelled ? "Paste stopped" : "Pasted " + LM.fmt(r.total) + " commands"); }, function (e) { api.ui.toast(e && e.message || String(e), true); }).then(function () { pasteBtn.textContent = "Paste schematic"; LM.changed(); });
    });
    pr.appendChild(pasteBtn); pc.appendChild(pr); pc.appendChild(pcInfo); pc.appendChild(pcBar);
    root.appendChild(pc);
    function paintPaste() {
      var ok = api.world.available && !!LM.schem;
      pc.style.display = ok ? "" : "none";
      var run = Sel.pasteState();
      pcBar.style.display = run ? "" : "none";
      if (run) { pcBar.firstChild.style.width = Math.max(3, Math.round(100 * run.done / run.total)) + "%"; pcInfo.textContent = LM.fmt(run.done) + " of " + LM.fmt(run.total) + " commands sent" + (run.skipped ? "  \u00b7  " + LM.fmt(run.skipped) + " blocks skipped (not in this game version)" : ""); pasteBtn.textContent = "Stop pasting"; }
      else pcInfo.textContent = api.net.transport === "singleplayer" ? "" : "Join a singleplayer world to paste.";
    }

    /* --- materials --- */
    var mat = el("div", "lm-card"), matBody = el("div"), matHead = el("h4"), matOpen = false;
    var rm = el("div", "lm-row");
    var toggle = btn("Show list", "", function () { matOpen = !matOpen; paintMaterials(); toggle.textContent = matOpen ? "Hide list" : "Show list"; });
    rm.appendChild(toggle);
    rm.appendChild(btn("Copy as text", "", function () {
      if (!LM.schem) return;
      var text = LM.materials().list.map(function (m) { return LM.name(m[0]) + "\t" + m[1]; }).join("\n");
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { api.ui.toast("Material list copied"); }, function () { api.ui.toast("Could not copy", true); });
    }));
    mat.appendChild(matHead); mat.appendChild(rm); mat.appendChild(matBody);
    root.appendChild(mat);
    function paintMaterials() {
      matBody.textContent = "";
      if (!matOpen || !LM.schem) return;
      var g = el("div", "lm-mat"), list = LM.materials().list, vs = Verify.summary(), miss = vs.on ? Verify.missingByName() : null;
      if (miss) { g.appendChild(el("span", null, "")); g.appendChild(el("i", null, "needed")); g.appendChild(el("i", null, "")); g.appendChild(el("i", null, "to place" + (vs.pending ? " (so far)" : ""))); }
      list.slice(0, 200).forEach(function (m) {
        var stacks = m[1] >= 64 ? Math.floor(m[1] / 64) + " x 64" + (m[1] % 64 ? " + " + (m[1] % 64) : "") : "";
        g.appendChild(el("span", null, esc(LM.name(m[0])))); g.appendChild(el("b", null, LM.fmt(m[1]))); g.appendChild(el("i", null, stacks));
        g.appendChild(el("b", null, miss ? (miss[m[0]] ? LM.fmt(miss[m[0]]) : "\u2013") : ""));
      });
      if (list.length > 200) g.appendChild(el("span", null, "\u2026 " + (list.length - 200) + " more"));
      matBody.appendChild(g);
    }

    box.appendChild(root);

    var savedSig = "";
    function refresh() {
      if (!root.isConnected) { off(); return; }
      var s = LM.schem, mt = LM.materials();
      curTitle.textContent = s ? (s.name || LM.fileName) : "No schematic loaded";
      var bits = [];
      if (s) {
        bits.push(s.size[0] + " x " + s.size[1] + " x " + s.size[2] + " blocks");
        bits.push(LM.fmt(mt.total) + " blocks placed");
        if (s.regions.length > 1) bits.push(s.regions.length + " regions");
        if (s.author) bits.push("by " + s.author);
        bits.push(s.kind === "litematic" ? "Litematica file" : s.kind === "sponge" ? "Sponge .schem" : s.kind === "legacy" ? "legacy .schematic" : "structure .nbt");
      } else bits.push("Load a .litematic, .schem, .schematic or .nbt file, or drop one on the Load mods button.");
      curSub.textContent = bits.join("  \u00b7  ");
      var info = s && st.building ? "Building the overlay\u2026 " + LM.fmt(st.quads) + " faces" : (s ? LM.fmt(st.quads) + " faces in " + LM.fmt(st.sections) + " sections" : "");
      curBar.style.display = s && st.building ? "" : "none";
      if (s && st.building) curBar.firstChild.style.width = Math.max(4, Math.round(st.progress * 100)) + "%";
      curErr.textContent = LM.fatalMsg || st.error || "";
      curErr.style.display = curErr.textContent ? "" : "none";
      var unk = s && !st.building ? st.unknown : [];
      curNote.textContent = unk.length ? "Not in this game version, so " + (LM.set("showUnknown") ? "drawn as magenta cubes: " : "left out: ") + unk.slice(0, 6).map(function (n) { return n.replace(/^minecraft:/, ""); }).join(", ") + (unk.length > 6 ? " and " + (unk.length - 6) + " more" : "") : "";
      curNote.style.display = curNote.textContent ? "" : "none";
      if (s && !st.building && !curErr.textContent) curSub.textContent += "  \u00b7  " + info;
      unload.disabled = !s;
      ["x", "y", "z"].forEach(function (k) { if (document.activeElement !== inputs[k]) inputs[k].value = LM.placement[k]; });
      bMirX.classList.toggle("on", LM.placement.mirrorX); bMirZ.classList.toggle("on", LM.placement.mirrorZ);
      var b = st.bounds || (s && { min: s.min, max: [s.min[0] + s.size[0], s.min[1] + s.size[1], s.min[2] + s.size[2]] });
      extent.textContent = b ? "Covers x " + (LM.placement.x + b.min[0]) + " to " + (LM.placement.x + b.max[0] - 1) + ",  y " + (LM.placement.y + b.min[1]) + " to " + (LM.placement.y + b.max[1] - 1) + ",  z " + (LM.placement.z + b.min[2]) + " to " + (LM.placement.z + b.max[2] - 1) + "   (turned " + LM.placement.rot * 90 + "\u00b0)" : "";
      matHead.textContent = s ? "Materials (" + LM.fmt(mt.list.length) + " kinds, " + LM.fmt(mt.total) + " blocks)" : "Materials";
      paintMaterials(); paintRegions(); paintVerify(); paintSelection(); paintPaste();
      var sig = LM.savedSig();
      if (sig !== savedSig) { savedSig = sig; paintSaved(); }
    }
    function paintSaved() {
      savedList.textContent = "";
      var list = LM.savedList || [];
      if (!list.length) { savedList.appendChild(el("small", null, "Nothing saved yet.")); return; }
      list.forEach(function (f) {
        var it = el("div", "lm-item" + (f.name === LM.fileName ? " cur" : ""));
        it.appendChild(el("span", null, esc(f.name)));
        it.appendChild(el("small", null, (f.size / 1024 >= 1024 ? (f.size / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(f.size / 1024)) + " KB")));
        it.appendChild(btn("Use", "", function () { LM.useSaved(f.name); }));
        it.appendChild(btn("Delete", "dng", function () { LM.deleteSaved(f.name); }));
        savedList.appendChild(it);
      });
    }
    var off = LM.onChange(refresh);
    LM.refreshSaved();
    refresh();
  }
  return { build: build };
})();
