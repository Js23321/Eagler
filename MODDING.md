# Mods for OneClient

OneClient 26.2 loads mods in three ways: the **40 built-in mods** (always there, switched on and off from the Mods menu), mods you
**upload** (press **Right Shift**, open **Mods**, press **Load mods** or drop files on the menu), and **ports** of real Minecraft mods
(Litematica). Uploaded mods are stored in your browser (IndexedDB), switch on and off from their cards, and have their own settings pages.

## What the Load mods button accepts

| File | What happens |
| --- | --- |
| `.js` | A one-file OneClient mod (see below). |
| `.ocmod` (or a `.zip` with `oneclient.mod.json`) | A OneClient mod package: manifest, code and any files the mod ships. |
| `.jar` | A **real Minecraft mod** (Fabric, Quilt, NeoForge, Forge). Read for its details. If OneClient has a port of that mod it is installed and switched on (Litematica). Library jars (malilib, Fabric API ...) are recognised and explained. Anything else is listed as "Can't run" with the reason. |
| `.litematic` `.schem` `.schematic` `.nbt` | Schematics, handed to the mod that handles them (the Litematica port; it is installed on the spot if needed). |

### Why real mod jars cannot run
A Minecraft mod is Java bytecode that calls into Minecraft's classes and rewrites them with mixins. This client is the game
**compiled ahead of time to WebAssembly**: there is no Java VM, no class loading, no way to rewrite a method at run time, and the
compiled binary does not even carry its function names. A jar needs the real Minecraft classes it was written against and a
VM to run them; neither exists here, and rebuilding the game with a mod compiled in needs the game's source, which is not in
the file. So the code inside a jar has nowhere to run.

What OneClient *can* do is work from everything the game does that a browser can see: the camera and projection it renders with, its
WebGL frame, its audio, input and storage, and **the real Minecraft protocol it speaks with its server** (singleplayer or a server).
Mods written for OneClient use that, and "ports" re-implement a popular mod's features on top of it. Litematica is the first port,
the built-in mods are the second kind.

## A one-file mod

```js
/* ==OneClientMod==
 * @id my-mod
 * @name My Mod
 * @version 1.0
 * @author You
 * @description What it does
 * ==/OneClientMod== */

api.settings.define([
  { key: "greeting", type: "text", label: "Message", default: "Hello" },
  { key: "big", type: "toggle", label: "Big", default: false }
]);
var w = api.hud.text({ id: "note", text: "", x: 12, y: 220 });          // a draggable on-screen note
function draw() { w.set(api.settings.get("greeting")); }
api.settings.onChange(draw); draw();
api.keys.register({ id: "hi", label: "Say hi", def: "KeyH", onDown: function () { api.ui.toast("Hi!"); } });
```

The code runs as a function body with `api` (and `OneClient`, `module`, `exports`) in scope. Whatever the mod registers through `api`
is removed again when the mod is switched off. Examples: `mods/examples/` (`hello-hud.js`, `coords.js`, `ghost-box.js`). Header fields:
`@id @name @version @author @description`, and for built-in mods `@category` (HUD, World, Visual, Utility), `@icon` (a name from the icons in
`client/mods.js`), `@order`, `@default on` and `@needs` (net, world, camera, rewrite: what the About box tells the player).

## A mod package (.ocmod)

A zip with `oneclient.mod.json` at its root:

```json
{ "id": "my-mod", "name": "My Mod", "version": "1.0.0", "author": "You", "description": "...", "icon": "icon.png", "main": "main.js", "api": 1 }
```

`main.js` is the entry point; everything else in the zip is available through `api.assets` (textures, JSON, a worker script ...).
The Litematica port is built this way from `mods-src/litematica/` (see `build.js`: `src/*.js` are joined into `main.js`,
`worker/*.js` into `worker.js`, and `epk` globs copy files out of the game's own asset pack).

## Built-in mods

`mods-src/lunar/*.js` are one-file mods that `build.js` embeds in the page (`<script type="text/oc-builtin">`). They are always listed,
can be switched off but not removed, keep only their on/off switch with the other switches, and their settings can be shown while they are
off: the loader runs the code once with **`api.schemaOnly` set** to read what the mod defines, so a built-in mod begins like this:

```js
var kit = api.kit;
api.settings.define(kit.settings({ rows: [ /* the mod's own rows */ ] }));      // + the standard appearance rows
if (api.schemaOnly) return;                                                     // everything below only runs when the mod is on
var hud = kit.hud({ anchor: "tl", row: 4 });
api.every(100, function () { hud.set([["X", "12.5"], ["Y", "64"]]); });
```

### The HUD kit (`api.kit`, `client/hudkit.js`)

| | |
| --- | --- |
| `kit.settings({ rows, label, color, widget })` | The mod's own rows followed by the standard **Appearance** rows: show label, text colour, background, background opacity, corner roundness, text shadow, size. `label: false` leaves out "show label". |
| `kit.hud({ id, anchor, row, rowStep, lines })` | A draggable text widget (same drag / snap / scroll-to-resize machinery as the FPS counter). `anchor` is `t c b` + `l c r` (`"tl"`, `"br"`, `"cc"` ...), `row` stacks widgets (40 px per row, or `rowStep`). Returns `{ set(lines, { row }), visible(bool), remove(), el }`. A line is `[label, value, colour, iconUrl, after]` or `{ l, v, c, icon, a }`; a plain string is one line. |
| `kit.widget({ id, anchor, row }, node)` | Any element as a draggable widget (the compass strip, the armor row). |
| `kit.look(node)` | Make your own element follow the standard appearance settings (`--hk-c`, `--hk-bg`, `--hk-r`, `data-nobg` ...). |
| `kit.fmt` | `fixed`, `int`, `pad2`, `clock(seconds, hundredths)`, `roman`, `title`, `name(kind, id)` (display names of blocks, items, entities, effects, enchantments from the game's language file). |
| `kit.icons()` | `{ effects, items, hud, blocks }`: the game's own pictures as data URLs; `items` are the flat item textures, `blocks` a drawn cube for every block item that has none (cobblestone, planks, stairs ...). |
| `kit.blockColors()` | `{ "stone": "7e7e7e", "grass_block": "939393r", "short_grass": "x" ... }`: one colour per block, averaged from the game's textures by the build (six hex digits and a kind letter: `r` grass tint, `f` foliage tint, `l` leaves, `g` glass, `w` water, `v` lava, `x` nothing to draw from above). |
| `kit.biomeColors()` | `{ "plains": ["91bd59", "77ab2f", "3f76e4"] ... }`: the grass, foliage and water tint of every biome, worked out like the game does. |
| `kit.rgb("#rrggbb")`, `kit.hue(0..1)` | Colours for shaders and GL. |

## The `api` object (version 1)

| | |
| --- | --- |
| `api.id`, `api.name`, `api.version`, `api.manifest`, `api.schemaOnly` | Who you are; `schemaOnly` is true while a built-in mod's settings are being read. |
| `api.log / info / warn / error(...)` | Console plus the log on the mod's page. |
| `api.onDisable(fn)` | Extra clean-up when the mod is switched off. |
| `api.every(ms, fn)`, `api.after(ms, fn)` | Timers that stop with the mod. |
| `api.settings.define([...])` | Rows of the settings page: `toggle`, `range` (`min max step unit`), `choice` (`options` / `opts: [[value, label], ...]`), `color`, `key`, `text`, `button` (`text`, `onClick`), `info`, `section`. Each row: `key` (or `k`), `label`, `note`, `default` (or `def`), optional `when(values)`, and optional `get()` / `set(v)` to keep the value somewhere else. |
| `api.settings.get(key) / set(key, v) / all() / onChange(fn(key, v)) / reset()` | Values persist. |
| `api.storage.get(k, default) / set / remove / keys` | Small JSON values (localStorage). |
| `api.files.save(name, bytes) / load / list / remove` | Bigger data (IndexedDB), returns promises. |
| `api.assets.list / has / bytes / text / json / url(path)` | Files inside your package. |
| `api.keys.register({ id, label, def, onDown, onUp, consume })` | A rebindable hotkey; only fires while you play (not in menus or chat). `consume` keeps the game from seeing the key (and its release, and its repeats). |
| `api.events.on(name, fn)` | `frame(n, inWorld)`, `world-frame(n)`, `enter-world`, `leave-world`, `key`, `keyup`, `mousedown`, `mouseup`, `screen`, `settings:<id>`. |
| `api.hud.text({ id, text, x, y })` | A draggable HUD chip: `{ set(text), el, remove() }`. (`api.kit` is the richer way.) |
| `api.ui.toast(msg, bad)`, `pickFiles(accept, multiple)`, `panel(fn(container))`, `openSettings()`, `refresh()` | `panel` puts your own controls on the mod's page. |
| `api.dom.layer(z)`, `api.dom.style(css)` | A click-through layer above the game (default level is just below OneClient's own overlay), a style sheet (both removed with the mod). |
| `api.onFile(["ext", ...], fn({ name, ext, bytes }))` | Be the handler for uploaded files of those types. |
| `api.session()` | `{ name, address, mode }` of the server you joined from the Servers page (empty strings otherwise). |
| `api.game.cam` | The camera the game renders with: `x y z` (exact world position), `yaw pitch fov aspect near far`, `view` and `proj` (column-major matrices), `fx fy fz` (look direction), `reverseZ`. `null` outside a world. |
| `api.game.inWorld / fps / screen / playing / canvas() / project(x, y, z)` | State and a world-to-screen projection (page pixels). `playing` is true while the mouse is really captured. `screen` is the name OneClient knows the game's current screen by, or `null`: `title`, `worlds`, `worldmenu`, `createworld`, `busy` (a world is loading), `options` and `o-video` / `o-sounds` / `o-controls` / `o-mouse` / `o-skin` / `o-chat` / `o-access`, `multiplayer`, `profile`, `pause`, `connect`, `terrain`, `disconnected`. |

### What the packets give you

`api.net.active` is true while a connection is in the play state and its packets are readable (`api.net.transport`: `"singleplayer"` or
`"server"`; `api.net.encrypted` is true for an online-mode server that cannot be read).

| | |
| --- | --- |
| `api.player.state` | Health, food, saturation, level / xpProgress / xpTotal, gameMode, rain / thunder / raining, latency, tps, `pos` (feet, from your own movement packets), `dayTime()`, `effects()`, `combo`, `reach`, `death`, `name`, `uuid`, `entityId`. `api.player.onEvent(fn(type, data))`: `health xp time effect weather mode ping swing hit hurt death reset`. |
| `api.entities` | `list() get(id) count() size(name) typeName(id) onChange(fn)`: every entity the server told the game about, with position, type name and hitbox size. |
| `api.inventory` | `slot(i) armor() mainHand() offHand() count(name) held onChange(fn) items()` and stacks `{ name, count, damage, maxDamage, enchants, color, unknown, title, contents, bundle }` (`contents`: what a shulker box holds, an array by slot with nulls; `bundle`: the stacks of a bundle; `title`: its custom name). `window()` is the chest, furnace or shulker box the server has open now, `{ id, type, title, slots }` (its slots, then your 36), else null; `carried` tells that the cursor holds an item; `recipeOpen` that the crafting recipe book is open. |
| `api.world` | `getBlock(x, y, z)` -> `{ id, name, props }`, `getState`, `isLoaded`, `section`, `palette(cx, sy, cz)` (the block states a section holds, without decoding it), `biomeAt(x, y, z)` ("minecraft:plains"), `biomeIndex`, `biomeName(i)`, `dim`, `minY`, `height`, `onChange`. The blocks and biomes of every chunk the server sent (block updates included). |
| `api.blocks` | The game's block state table: `info(id) nameOf idOf idOfLoose defaultId isAir has names propsOf rangeOf`. |
| `api.net.command(text)`, `commands([...])`, `chat(text)` | Send a command / chat message as the player (a chat message packet is unsigned: use it in singleplayer; on a server type the text in instead, see the Auto Text mod). |
| `api.net.onPacket(dir, id, fn(reader))` | Listen to packets ("in" or "out"); `api.net.ids` lists the ids of protocol 776 that OneClient knows. |
| `api.net.rewrite(id, fn(reader))`, `inject(id, fields)`, `Writer` | Change or drop a packet the game is about to receive (`fn` returns nothing, `false`, or the new fields), or hand the game one it never got. Works in singleplayer and on a server connection that is not encrypted (`api.net.canRewrite` tells; it is false on an online-mode server, and when the server compresses every packet). Only the packet in the play state and not deflated are touched: set_time, game_event and the like are tiny, so they never are. `Writer` builds fields (`u8 bool i16 i32 i64 f32 f64 varint varlong string bytes`, then `toU8()`). Time Changer and Weather Changer are written this way. |

### Graphics

| | |
| --- | --- |
| `api.gl.onWorld(fn(ctx))` | Draw into the game's own frame (below). `ctx = { gl, cam, width, height, frame, time, bindTexture(unit, tex), resetUnpack() }`. |
| `api.gl.batch()` | Lines (as ribbons, so they can be thicker than a pixel) and quads: `b.begin(ctx)`, `line(x0,y0,z0,x1,y1,z1,[r,g,b,a],widthPx)`, `box(...)`, `quad(...)`, `fillBox(...)`, `draw(ctx, { through })`. Positions are world coordinates. |
| `api.gl.rewrite("projection" \| "fog", fn(Float32Array))` | Edit the game's perspective matrix (64 bytes) or fog block (40 bytes) in place as it is uploaded; return `false` for "unchanged". `api.game.cam` then describes what is really drawn. |
| `api.gl.post.set("color", { saturation, brightness, contrast })`, `set("blur", { amount })` | Effects on the finished world picture (before the hand and HUD). `null` switches one off. |
| `api.gl.fx.set(name, value)` | Values of the patches in the game's shaders: `oc_outline` (rgba) and `oc_outlineW`, `oc_hitbox`, `oc_glint`, `oc_hit`. |
| `api.gl.mat4.mul(a, b)` | Column-major multiply. |

### Drawing into the world

`onWorld` runs inside the game's frame, right after the terrain, entities and translucent blocks are drawn and just before the
game clears the depth buffer for the hand and the HUD. The game's framebuffer holds the whole scene with its depth, so geometry you
draw is **depth-tested against the real world**. Things to know:

- The game renders with **reverse-Z**: use `depthFunc(GEQUAL)` (`cam.reverseZ` tells you). Pull geometry that sits exactly on a real
  block face towards the camera with `polygonOffset(1, 1)` to avoid z-fighting. (`api.gl.batch` does both.)
- Terrain is positioned as `projection * view * (world - camera)`, with the subtraction done in doubles first. Do the same:
  `gl_Position = uPV * vec4(local + uOffset, 1.0)` with `uPV = mat4.mul(cam.proj, cam.view)` and `uOffset = origin - cam.pos` computed in JS.
  Positions far from the origin keep full precision this way.
- `gl` state is saved before and restored after your hooks (program, VAO, buffers, textures on units you bound with `ctx.bindTexture`,
  frame buffer bindings, viewport, scissor, blend / depth / cull / polygon offset, colour mask, pixel-store state, draw buffers). Colour
  writes are switched on for you.
- Texture bindings made with `ctx.bindTexture` only last for that pass: bind every frame.
- A hook that throws five times is switched off.
- Late patching of `WebGL2RenderingContext` draw methods does not work (the game keeps its own references); use `onWorld`. Shader
  sources can only be patched before the game compiles them, which is why `client/fx.js` does it for everyone (the patches do
  nothing until a mod sets a value).

## Litematica (OneClient port)

Load the Litematica jar (any version; only its name is used) or just a schematic, and use the Litematica page in the Mods menu.

- Formats: `.litematic` (all regions, negative sizes), Sponge `.schem` v1-v3, vanilla structure `.nbt`, legacy MCEdit `.schematic`; old
  block names are renamed to this game version's, blocks the game does not have are shown as magenta cubes.
- A see-through copy of the structure is drawn in the world with the game's own block models and textures (blockstates, multipart,
  rotations, uvlock, biome tints, translucent glass and water; resource packs you have on are used). Stand anywhere, press **Move to my
  position**, nudge with the buttons.
- Placement: X/Y/Z, rotate 90 degrees, mirror X / Z (same mapping as the game's own structure placement), layer slicing, opacity,
  see-through-terrain, outline box, draw distance, per-region switches.
- **Verifier**: compares the schematic with the world the game has loaded (from the chunk packets) and boxes what is missing (blue),
  wrong (red), has other properties (orange) or is extra (pink).
- **Selection** (two corners, or where you look) saved as a `.litematic` in the browser; **Paste into the world** builds a schematic with
  `/setblock` and `/fill` commands where cheats are allowed.
- Material list with stack counts and the number still missing, copy as text. Schematics you load are kept in the browser.
- Hotkeys (rebindable): **K** shows or hides the overlay; layer up/down, rotate and move-to-me can be bound.
- Blocks the game draws with entity models (chests, beds, signs, banners, heads) are shown as approximate boxes.

## Tips

- Put `window.__ocDebug = true` in the console before loading a mod to expose some mods' internals (`window.__lm` for Litematica).
- `node build.js --mods-only` rebuilds `mods/*.ocmod` in a fraction of a second; loading it again with the Load mods button replaces the running copy.
- `node build.js --shim --out=somewhere/OneClient-test.html` builds a page with a pointer-lock simulator for automated testing.
- Mods are full-trust page scripts. Only load mods from people you trust.
