/* ==OneClientMod==
 * @id oc-shulker
 * @name Shulker Tooltip
 * @version 1.0
 * @author OneClient
 * @description Point at a shulker box in your inventory, your hotbar or a chest and see what is inside it, laid out like its slots.
 * @category Utility
 * @icon cube
 * @order 62
 * @needs net
 * ==/OneClientMod== */
var kit = api.kit, fmt = kit.fmt;

api.settings.define([
  { type: "section", label: "Shulker Tooltip" },
  { type: "info", label: "Point at a shulker box that is not empty while your inventory or a chest is open: its contents show instead of the game's text list. It reads the box from what the server sends, so it works in singleplayer and on servers whose connection can be read." },
  { k: "scale", type: "range", label: "Size", min: 70, max: 200, step: 10, unit: "%", def: 100 },
  { k: "tint", type: "toggle", label: "Colour of the box", note: "The frame and the slots take the colour of the shulker box", def: true },
  { k: "counts", type: "toggle", label: "Item counts", def: true },
  { k: "wear", type: "toggle", label: "Durability bars", note: "A bar under tools and armor that are worn", def: true },
  { k: "glint", type: "toggle", label: "Shimmer on enchanted items", def: true },
  { k: "carry", type: "toggle", label: "Also while you carry an item", note: "The game shows no tooltip then; this lets you look inside a box you are about to fill", def: false }
]);
if (api.schemaOnly) return;

var inv = api.inventory, N = window.OneClient && OneClient.native, OCg = window.OneClient;
var DYES = { white: "#f9fffe", orange: "#f9801d", magenta: "#c74ebd", light_blue: "#3ab3da", yellow: "#fed83d", lime: "#80c71f", pink: "#f38baa", gray: "#474f52", light_gray: "#9d9d97", cyan: "#169c9c", purple: "#8932b8", blue: "#3c44aa", brown: "#835432", green: "#5e7c16", red: "#b02e26", black: "#1d1d21" };
var PLAIN = "#9a6f9a";                                          // the shulker box nobody dyed

/* ---------- the tooltip ---------- */
var layer = api.dom.layer();
api.dom.style(
  ".ocst{position:fixed;left:0;top:0;display:none;box-sizing:border-box;padding:var(--p);color:#fff;font:700 var(--f)/1.15 var(--oc-font,'Segoe UI',system-ui,sans-serif);background:#150b21 linear-gradient(180deg,#1d1030,#110a1c);border:var(--b) solid var(--c,#5b3a8f);border-radius:var(--r);box-shadow:0 0 0 var(--b) rgba(0,0,0,.55),0 10px 30px rgba(0,0,0,.45);will-change:transform}" +
  ".ocst-h{height:var(--hh);line-height:var(--hh);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 var(--b) 0 rgba(0,0,0,.6)}" +
  ".ocst-h i{font-style:normal;color:var(--c,#b58cff)}" +
  ".ocst-g{display:grid;grid-template-columns:repeat(9,var(--s));grid-auto-rows:var(--s)}" +
  ".ocst-s{position:relative;box-sizing:border-box;margin:0;background:var(--sb,rgba(255,255,255,.07));border:var(--b) solid rgba(0,0,0,.4);border-top-color:rgba(0,0,0,.55);border-left-color:rgba(0,0,0,.55);border-bottom-color:rgba(255,255,255,.1);border-right-color:rgba(255,255,255,.1)}" +
  ".ocst-i{position:absolute;left:var(--i);top:var(--i);width:var(--ii);height:var(--ii);image-rendering:pixelated;pointer-events:none}" +
  ".ocst-p{position:absolute;left:var(--i);top:var(--i);width:var(--ii);height:var(--ii);display:flex;align-items:center;justify-content:center;border-radius:2px;background:rgba(255,255,255,.14);font-size:var(--f);color:rgba(255,255,255,.8)}" +
  ".ocst-n{position:absolute;right:calc(var(--b)*1.5);bottom:calc(var(--b)*.5);font-size:var(--f);text-shadow:var(--b) var(--b) 0 #383838;letter-spacing:0}" +
  ".ocst-w{position:absolute;left:calc(var(--s)*.14);right:calc(var(--s)*.14);bottom:calc(var(--s)*.1);height:calc(var(--b)*1.6);background:#000}.ocst-w i{display:block;height:100%}" +
  ".ocst-e{position:absolute;inset:var(--i);background:linear-gradient(120deg,transparent 30%,rgba(190,120,255,.55) 50%,transparent 70%);background-size:300% 100%;mix-blend-mode:screen;pointer-events:none;animation:ocstg 2.4s linear infinite;-webkit-mask:var(--m);mask:var(--m)}" +
  "@keyframes ocstg{from{background-position:150% 0}to{background-position:-50% 0}}" +
  ".ocst-f{height:var(--fh);line-height:var(--fh);margin-top:var(--b);color:rgba(255,255,255,.55);font-size:calc(var(--f)*.92);white-space:nowrap}");
var root = document.createElement("div");
root.className = "ocst";
layer.appendChild(root);
var shown = null, built = null;                                 // the stack that is on show, and the one the DOM was built for

function dyeOf(name) { var m = /^([a-z_]+)_shulker_box$/.exec(name); return m && DYES[m[1]] ? DYES[m[1]] : PLAIN; }
function hexMix(hex, k) { var n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return "rgba(" + r + "," + g + "," + b + "," + k + ")"; }

/* what picture a stack gets: the game's item texture, a cube for blocks (build.js draws one for every block item), else a plain tile */
function iconOf(st) {
  var ic = kit.icons();
  return (ic.items && ic.items[st.name]) || (ic.blocks && ic.blocks[st.name]) || null;
}

function build(stack, u) {
  var color = dyeOf(stack.name), s = api.settings, tint = s.get("tint") !== false;
  root.textContent = "";
  root.style.setProperty("--c", tint ? color : "#5b3a8f");
  root.style.setProperty("--sb", tint ? hexMix(color, 0.2) : "rgba(255,255,255,.07)");
  var head = document.createElement("div"), grid = document.createElement("div"), foot = document.createElement("div"), i, n = 0, items = 0;
  head.className = "ocst-h"; grid.className = "ocst-g"; foot.className = "ocst-f";
  head.textContent = stack.title || fmt.name("block", stack.name);
  for (i = 0; i < 27; i++) {
    var st = stack.contents[i], cell = document.createElement("div");
    cell.className = "ocst-s";
    if (st) {
      n++; items += st.count;
      var src = iconOf(st);
      if (src) { var img = document.createElement("img"); img.className = "ocst-i"; img.src = src; img.alt = ""; img.draggable = false; cell.appendChild(img); }
      else { var ph = document.createElement("b"); ph.className = "ocst-p"; ph.textContent = fmt.name("item", st.name).charAt(0); cell.appendChild(ph); }
      if (s.get("glint") !== false && ((st.enchants && st.enchants.length) || (st.stored && st.stored.length))) {
        var gl = document.createElement("i"); gl.className = "ocst-e";
        if (src) gl.style.setProperty("--m", "url(" + src + ") center/contain no-repeat");        // the shimmer only where the picture is
        cell.appendChild(gl);
      }
      if (s.get("counts") !== false && st.count > 1) { var ct = document.createElement("span"); ct.className = "ocst-n"; ct.textContent = String(st.count); cell.appendChild(ct); }
      if (s.get("wear") !== false && st.maxDamage > 0 && st.damage > 0) {
        var left = Math.max(0, Math.min(1, 1 - st.damage / st.maxDamage)), bar = document.createElement("div"), fill = document.createElement("i");
        bar.className = "ocst-w"; fill.style.width = (left * 100).toFixed(0) + "%"; fill.style.background = "hsl(" + Math.round(left * 120) + ",100%,50%)";
        bar.appendChild(fill); cell.appendChild(bar);
      }
    }
    grid.appendChild(cell);
  }
  foot.textContent = n + (n === 1 ? " stack" : " stacks") + ", " + items + (items === 1 ? " item" : " items");
  root.appendChild(head); root.appendChild(grid); root.appendChild(foot);
}

/* sizes follow the game's GUI scale: u = pixels of the page per GUI unit; a slot is 18 of them, like in the game */
function place(u, gui, gx, gy, stack) {
  var k = u * (api.settings.get("scale") / 100), P = 4, SZ = 18, W = 9 * SZ + 2 * P + 2, HH = 14, FH = 9, H = 1 + P + HH + 3 * SZ + 2 + FH + P + 1;
  var st = root.style;
  st.setProperty("--p", P * k + "px"); st.setProperty("--b", Math.max(1, k * 0.5) + "px"); st.setProperty("--r", 2 * k + "px");
  st.setProperty("--f", 8 * k + "px"); st.setProperty("--hh", HH * k + "px"); st.setProperty("--fh", FH * k + "px"); st.setProperty("--s", SZ * k + "px");
  st.setProperty("--i", 1 * k + "px"); st.setProperty("--ii", 16 * k + "px");
  st.width = W * k + "px"; st.height = H * k + "px";
  /* where the game puts its own text tooltip (12 right of the pointer, 12 above it, turned to the left near the right edge); ours covers it */
  var est = 0, names = [fmt.name("block", stack.name)], i;
  for (i = 0; i < stack.contents.length; i++) if (stack.contents[i] && names.length < 7) names.push(fmt.name("item", stack.contents[i].name) + " x" + stack.contents[i].count);
  for (i = 0; i < names.length; i++) est = Math.max(est, names[i].length * 5.4);
  var left, top = gy - 12 - 5, w = W * (k / u), h = H * (k / u);
  if (gx + 12 + est + 8 > gui.w) left = gx - 8 - w; else left = Math.min(gx + 7, gui.w - w);
  if (left < 0) left = 0;
  if (top + h > gui.h) top = gui.h - h;
  if (top < 0) top = 0;
  var rect = N.canvas.getBoundingClientRect();
  st.transform = "translate(" + (rect.left + left * u).toFixed(1) + "px," + (rect.top + top * u).toFixed(1) + "px)";
}

/* ---------- where things are on the screen ---------- */
function slotsOf(win) { return win ? win.slots : null; }
function cell(x, y, st) { return { x: x, y: y, st: st }; }

/* the layout of the open screen: where it starts, and the slots that hold something we could show */
function layout(gui, win, scr) {
  var cells = [], i, r, c, W = 176, H = 166, x0, y0, sl;
  if (win) {
    sl = win.slots; var size = win.size || sl.length;
    if (size < 36) return null;
    var cc = size - 36, generic = cc >= 18 && cc <= 54 && cc % 9 === 0, mainY, hotY;
    if (generic) {
      H = 114 + 18 * (cc / 9); mainY = H - 83; hotY = H - 25;
      for (i = 0; i < cc; i++) cells.push(cell(8 + 18 * (i % 9), 18 + 18 * Math.floor(i / 9), sl[i]));
    } else { mainY = 84; hotY = 142; }                              // the 166 high screens (crafting table, furnace, anvil ...): your inventory sits in the same place
    for (i = 0; i < 27; i++) cells.push(cell(8 + 18 * (i % 9), mainY + 18 * Math.floor(i / 9), sl[cc + i]));
    for (i = 0; i < 9; i++) cells.push(cell(8 + 18 * i, hotY, sl[cc + 27 + i]));
  } else if (scr === "inv") {
    if (OCg.player && OCg.player.gameMode === 1) {                  // the creative screen: its hotbar row is your hotbar
      W = 195; H = 136;
      for (i = 0; i < 9; i++) cells.push(cell(9 + 18 * i, 112, inv.slot(36 + i)));
    } else {
      for (i = 0; i < 27; i++) cells.push(cell(8 + 18 * (i % 9), 84 + 18 * Math.floor(i / 9), inv.slot(9 + i)));
      for (i = 0; i < 9; i++) cells.push(cell(8 + 18 * i, 142, inv.slot(36 + i)));
      cells.push(cell(77, 62, inv.slot(45)));
      for (r = 0; r < 2; r++) for (c = 0; c < 2; c++) cells.push(cell(98 + 18 * c, 18 + 18 * r, inv.slot(1 + r * 2 + c)));
    }
  } else return null;
  x0 = Math.floor((gui.w - W) / 2); y0 = Math.floor((gui.h - H) / 2);
  if (!win && scr === "inv" && inv.recipeOpen && gui.w >= 379 && !(OCg.player && OCg.player.gameMode === 1)) x0 = 177 + Math.floor((gui.w - W - 200) / 2);      // the open recipe book pushes the screen to the right
  return { x: x0, y: y0, cells: cells };
}

/* ---------- which screen is open ----------
 * A chest and the like are windows the server opens: inv.window(). Your own inventory screen is not (the game opens it by itself), so it is
 * recognised the way a player would: you pressed the inventory key while playing and the mouse came free. It ends when the mouse is captured again. */
var scr = null, pending = 0, invCode = "KeyE";
function codeOfKey(k) {                                         // "key.keyboard.e" -> "KeyE"
  var m = /^key\.keyboard\.(.+)$/.exec(k || ""), n = m && m[1];
  if (!n) return null;
  if (/^[a-z]$/.test(n)) return "Key" + n.toUpperCase();
  if (/^[0-9]$/.test(n)) return "Digit" + n;
  if (/^f[0-9]{1,2}$/.test(n)) return n.toUpperCase();
  return n === "space" ? "Space" : null;
}
function readKeys() { var o = (N && N.opts) || {}; invCode = codeOfKey(o["key_key.inventory"]) || "KeyE"; }
api.every(1500, readKeys); readKeys();
api.events.on("key", function (k) {
  if (k.repeat) return;
  if (k.code === invCode) { if (k.playing) pending = performance.now(); else if (scr === "inv") scr = null; }   // pressed in the game: it is about to open; pressed again: it closes
  else if (k.code === "Escape" && scr === "inv") scr = null;
});

var mx = 0, my = 0, has = false;
function onMove(e) { mx = e.clientX; my = e.clientY; has = true; refresh(); }
function onLeave() { has = false; refresh(); }
window.addEventListener("mousemove", onMove, true);
document.addEventListener("mouseleave", onLeave);
api.onDisable(function () { window.removeEventListener("mousemove", onMove, true); document.removeEventListener("mouseleave", onLeave); });

function refresh() {
  var locked = OCg.inGame && OCg.inGame(), now = performance.now(), win = inv.window(), want = null;
  if (pending && now - pending > 2500) pending = 0;                                             // the key did not open anything
  if (locked) scr = null;                                                                       // (the pointer is let go a moment after the key: do not forget the key yet)
  else if (scr === null && pending && api.game.inWorld) { scr = "inv"; pending = 0; }
  if (has && N && N.canvas && !locked && (win || scr) && api.game.inWorld && (api.settings.get("carry") === true || !inv.carried)) {
    var gui = N.gui(), g = N.fromClient(mx, my), lay = layout(gui, win, scr);
    if (lay) {
      for (var i = 0; i < lay.cells.length; i++) {
        var c = lay.cells[i];
        if (g[0] >= lay.x + c.x - 1 && g[0] < lay.x + c.x + 17 && g[1] >= lay.y + c.y - 1 && g[1] < lay.y + c.y + 17) {
          var st = c.st;
          if (st && /_?shulker_box$/.test(st.name) && st.contents && !st.unknown) {
            var any = false, j;
            for (j = 0; j < st.contents.length; j++) if (st.contents[j]) { any = true; break; }
            if (any) want = st;
          }
          break;
        }
      }
    }
    if (want) {
      var u = N.canvas.getBoundingClientRect().width * N.scale() / N.canvas.width;
      if (built !== want) { build(want, u); built = want; }
      place(u, gui, g[0], g[1], want);
    }
  }
  if (want) { if (!shown) root.style.display = "block"; shown = want; }
  else if (shown) { root.style.display = "none"; shown = null; built = null; }
}
api.onDisable(inv.onChange(refresh));
api.every(120, refresh);
api.onDisable(function () { if (root.parentNode) root.parentNode.removeChild(root); });
