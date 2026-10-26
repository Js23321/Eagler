/* OneClient inventory: what is in your inventory, read from the packets the server sends (see net.js). Read only.
 *
 * OC.inventory.slot(i)         the stack in slot i of your inventory window (0 crafting output, 1-4 crafting grid, 5-8 armor: head chest legs feet,
 *                              9-35 backpack, 36-44 hotbar, 45 off hand), or null
 * OC.inventory.armor()         [head, chest, legs, feet] (each a stack or null)
 * OC.inventory.mainHand()      the stack in the selected hotbar slot        OC.inventory.offHand()
 * OC.inventory.held            selected hotbar slot, 0-8
 * OC.inventory.count(name)     how many of an item (name without minecraft:) you carry in the backpack, hotbar and off hand
 * OC.inventory.onChange(fn)    fn() whenever something changed
 * OC.inventory.recipeOpen    the crafting recipe book is open (it moves your inventory screen to the right)
 * OC.inventory.window()      the window the server opened and that is open now (a chest, a shulker box, a furnace ...): { id, type, title, slots }, else null
 *                              (your own inventory screen is not a window the server hears about; slots of a window are its own slots followed by your 36)
 * a stack is { id, name, count, damage, maxDamage, enchants: [{ id, level }], color, unknown, contents, bundle, title }
 *   contents: for a shulker box (or anything with a container), an array indexed by slot (0-26) of stacks and nulls; bundle: the stacks in a bundle; title: the custom name as text
 *   damage / maxDamage: points of wear / total durability (maxDamage 0: the item has no durability); unknown: some of its details could not be read
 *
 * The item numbers of protocol 776 come from client/items26.json (embedded as <script id="oc-items">). A stack carries "components"; the
 * ones that can be read are listed in COMP below. A component that is not known cannot be skipped, so the rest of that packet is lost:
 * single slot updates always carry on, a whole-window update (login, opening the inventory) loses the slots after the odd item and
 * the next updates repair them. ASCII-only source. */
(function () {
  "use strict";
  var OC = window.OneClient, net = OC && OC.net;
  if (!net) return;
  var CB = net.IDS.cb;
  var inv = OC.inventory = { held: 0, ready: false };
  var NAMES = [], slots = [], subs = [];
  try { var el = document.getElementById("oc-items"); if (el && el.textContent) NAMES = JSON.parse(el.textContent).names || []; } catch (e) { /* no table: items show as numbers */ }

  /* vanilla durability by item name (the server does not send a maximum unless it was changed) */
  var TIER = { wooden: 59, stone: 131, copper: 190, iron: 250, golden: 32, diamond: 1561, netherite: 2031 };
  var ARMOR = { helmet: 11, chestplate: 16, leggings: 15, boots: 13 };
  var ARMOR_TIER = { leather: 5, chainmail: 15, copper: 11, iron: 15, golden: 7, diamond: 33, netherite: 37 };
  var FIXED = { bow: 384, crossbow: 465, trident: 250, fishing_rod: 64, flint_and_steel: 64, shears: 238, carrot_on_a_stick: 25, warped_fungus_on_a_stick: 100, brush: 64, mace: 500, shield: 336, elytra: 432, turtle_helmet: 275, wolf_armor: 64, spyglass: 0 };
  function maxDamageOf(name) {
    var m;
    if (FIXED[name] !== undefined) return FIXED[name];
    if ((m = /^(wooden|stone|copper|iron|golden|diamond|netherite)_(sword|pickaxe|axe|shovel|hoe|spear)$/.exec(name))) return TIER[m[1]];
    if ((m = /^(leather|chainmail|copper|iron|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)$/.exec(name))) return ARMOR[m[2]] * ARMOR_TIER[m[1]];
    return 0;
  }
  inv.maxDamageOf = maxDamageOf;

  /* component codecs: type id -> function(reader, stack) that reads the value (and may store something on the stack) */
  function nbtOrSkip(r) { r.nbt(); }
  function textOf(c) {                                                      // a text component read from NBT -> plain text (a string, or { text, extra: [...] })
    if (c === null || c === undefined) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map(textOf).join("");
    if (typeof c !== "object") return String(c);
    var t = typeof c.text === "string" ? c.text : "";
    if (!t && typeof c.translate === "string") t = c.translate;
    return t + (Array.isArray(c.extra) ? c.extra.map(textOf).join("") : "");
  }
  function vi(r) { return r.varint(); }
  function listOf(r, one) { var n = r.varint(); for (var i = 0; i < n; i++) one(r); }
  function enchants(r) { var n = r.varint(), out = []; for (var i = 0; i < n; i++) out.push({ id: r.varint(), level: r.varint() }); return out; }
  var COMP = {
    0: nbtOrSkip,                                                           // custom_data
    1: vi,                                                                  // max_stack_size
    2: function (r, s) { s.maxDamage = r.varint(); },                       // max_damage
    3: function (r, s) { s.damage = r.varint(); },                          // damage
    4: function () {},                                                      // unbreakable (no value)
    6: function (r, s) { s.customName = true; s.title = textOf(r.nbt()); },  // custom_name
    9: nbtOrSkip,                                                           // item_name
    10: function (r) { r.string(); },                                       // item_model
    11: function (r) { listOf(r, function (x) { x.nbt(); }); },             // lore
    12: vi,                                                                 // rarity
    13: function (r, s) { s.enchants = enchants(r); },                      // enchantments
    17: function (r) {                                                      // custom_model_data: floats, flags, strings, colours
      listOf(r, function (x) { x.f32(); }); listOf(r, function (x) { x.bool(); }); listOf(r, function (x) { x.string(); }); listOf(r, function (x) { x.i32(); });
    },
    18: function (r) { r.bool(); listOf(r, function (x) { x.varint(); }); }, // tooltip_display: hide all, hidden components
    19: function (r, s) { s.repairCost = r.varint(); },                     // repair_cost
    21: function (r) { r.bool(); },                                         // enchantment_glint_override
    22: function () {},                                                     // intangible_projectile (no value)
    34: function () {},                                                     // glider (no value)
    35: function (r) { r.string(); },                                       // tooltip_style
    42: function (r, s) { s.stored = enchants(r); },                        // stored_enchantments
    44: function (r, s) { s.color = r.i32() & 0xffffff; },                  // dyed_color
    45: function (r) { r.i32(); },                                          // map_color
    46: vi,                                                                 // map_id
    50: function (r, s) { var n = r.varint(), out = []; for (var i = 0; i < n; i++) out.push(template(r)); s.bundle = out; },        // bundle_contents: item, count, patch each
    51: function (r) {                                                      // potion_contents: potion, colour, extra effects, name
      if (r.bool()) r.varint();
      if (r.bool()) r.i32();
      listOf(r, effect);
      if (r.bool()) r.string();
    },
    52: function (r) { r.f32(); },                                          // potion_duration_scale
    53: function (r) { listOf(r, function (x) { x.varint(); x.varint(); }); }, // suspicious_stew_effects: effect, duration
    56: function (r, s) { r.varint(); r.varint(); s.trimmed = true; },      // trim: material, pattern
    63: vi,                                                                 // ominous_bottle_amplifier
    73: vi,                                                                 // base_color
    75: function (r, s) {                                                   // container (shulker boxes ...): one entry per slot up to the last one used: present flag, then item, count, patch
      var n = r.varint(), out = [];
      for (var i = 0; i < n; i++) out.push(r.bool() ? template(r) : null);
      s.contents = out;
    }
  };
  function effect(r) {                                                      // a potion effect: type, then amplifier, duration, ambient, visible, icon and maybe a hidden one
    r.varint(); details(r);
  }
  function details(r) { r.varint(); r.varint(); r.bool(); r.bool(); r.bool(); if (r.bool()) details(r); }

  /* a stack as a container or bundle keeps it: item, count, component patch (the count does not come first there) */
  function template(r) {
    var id = r.varint(), count = r.varint();
    var s = { id: id, name: NAMES[id] || "item_" + id, count: count, damage: 0, maxDamage: 0, enchants: [], color: -1, unknown: false };
    s.maxDamage = maxDamageOf(s.name);
    if (!readPatch(r, s)) throw new Error("nested");
    return s;
  }
  /* the component patch of a stack: [added][removed] then the added ones (type id + value) and the ids of the removed ones; false when one could not be read */
  function readPatch(r, s) {
    var added = r.varint(), removed = r.varint();
    for (var i = 0; i < added; i++) {
      var t = r.varint(), fn = COMP[t];
      if (!fn) { s.unknown = true; return false; }
      try { fn(r, s); } catch (e) { s.unknown = true; return false; }
    }
    for (var k = 0; k < removed; k++) r.varint();
    return true;
  }
  /* an item stack; returns { stack, ok } where ok = false when a component could not be read (the reader is then somewhere in the middle of the packet) */
  function readStack(r) {
    var count = r.varint();
    if (count <= 0) return { stack: null, ok: true };
    var id = r.varint();
    var s = { id: id, name: NAMES[id] || "item_" + id, count: count, damage: 0, maxDamage: 0, enchants: [], color: -1, unknown: false };
    s.maxDamage = maxDamageOf(s.name);
    return { stack: s, ok: readPatch(r, s) };
  }
  inv.readStack = readStack;

  function emit() { for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) { try { console.warn("[OneClient inventory] " + e.message); } catch (x) {} } } }
  inv.onChange = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };
  inv.slot = function (i) { return slots[i] || null; };
  inv.armor = function () { return [slots[5] || null, slots[6] || null, slots[7] || null, slots[8] || null]; };
  inv.mainHand = function () { return slots[36 + inv.held] || null; };
  inv.offHand = function () { return slots[45] || null; };
  inv.count = function (name) {
    name = String(name || "").replace(/^minecraft:/, "");
    var n = 0, i;
    for (i = 9; i <= 45; i++) if (slots[i] && slots[i].name === name) n += slots[i].count;
    return n;
  };
  inv.items = function () { return slots.slice(); };

  /* windows the server opens (chests, furnaces, shulker boxes ...): open_screen names one, its content packets fill it, a close packet (either way) ends it */
  var wins = {}, cur = null;
  inv.recipeOpen = false;                                                    // the crafting recipe book (the server sends its settings when you join, you toggle it with a click)
  net.on("in", CB.recipeBookSettings, function (r) { inv.recipeOpen = r.bool(); emit(); });
  net.on("out", net.IDS.sb.recipeBookSettings, function (r) { var book = r.varint(), open = r.bool(); if (book === 0) { inv.recipeOpen = open; emit(); } });
  inv.carried = false;                                                       // the cursor holds something (known from your own clicks and from window content packets)
  inv.window = function () { return cur; };
  function hashedStack(r) {                                                  // a stack as the client hashes it for the server: present, item, count, added { type, hash }, removed { type }
    if (!r.bool()) return false;
    r.varint(); r.varint();
    var added = r.varint(), k;
    for (k = 0; k < added; k++) { r.varint(); r.i32(); }
    var removed = r.varint();
    for (k = 0; k < removed; k++) r.varint();
    return true;
  }
  net.on("in", CB.openScreen, function (r) {
    var id = r.varint(), type = r.varint(), title = null;
    try { title = textOf(r.nbt()); } catch (e) { /* a title we cannot read */ }
    cur = wins[id] = { id: id, type: type, title: title, slots: [] };
    emit();
  });
  function closeWindow(id) { if (cur && cur.id === id) cur = null; delete wins[id]; inv.carried = false; emit(); }
  net.on("in", CB.containerClose, function (r) { closeWindow(r.varint()); });
  net.on("out", net.IDS.sb.containerClose, function (r) { closeWindow(r.varint()); });
  net.on("out", net.IDS.sb.containerClick, function (r) {
    try {
      r.varint(); r.varint(); r.i16(); r.i8(); r.varint();                  // window, state id, slot, button, kind of click
      var n = r.varint(), i;
      for (i = 0; i < n; i++) { r.i16(); hashedStack(r); }                   // the slots this click changed
      inv.carried = hashedStack(r);                                          // and what the cursor holds after it
      emit();
    } catch (e) { /* a layout we do not know: keep what we had */ }
  });

  /* the last 36 slots of a window are your own inventory: keep slots[] (window 0) in step, the server does not repeat them when the window closes */
  function mirror(w, j) {
    var n = w.size;
    if (!n || n < 36 || j < n - 36) return;
    var k = j - (n - 36);
    slots[k < 27 ? 9 + k : 36 + (k - 27)] = w.slots[j] || null;
  }
  net.on("in", CB.containerSetSlot, function (r) {
    var cid = r.varint(); r.varint(); var slot = r.i16();
    if (slot < 0) return;                                                    // the cursor
    var got = readStack(r);
    if (cid === 0) { slots[slot] = got.stack; inv.ready = true; }
    else if (wins[cid]) { wins[cid].slots[slot] = got.stack; mirror(wins[cid], slot); }       // a chest, a furnace ...: its own slots, then yours
    else return;
    emit();
  });
  net.on("in", CB.containerSetContent, function (r) {
    var cid = r.varint(); r.varint();
    var n = r.varint(), i, ok = true, into = cid === 0 ? slots : wins[cid] ? wins[cid].slots : null;
    if (!into) return;
    for (i = 0; i < n; i++) {
      if (!ok) { into[i] = null; continue; }                                 // an item we cannot read ended the list: the next slot updates fill these in
      var got = readStack(r);
      into[i] = got.stack; ok = got.ok;
    }
    if (cid !== 0) { wins[cid].size = n; for (i = Math.max(0, n - 36); i < n; i++) mirror(wins[cid], i); }
    if (ok) { var held = readStack(r); if (held.ok) inv.carried = !!held.stack; }
    if (cid === 0) inv.ready = true;
    emit();
  });
  net.on("in", CB.setHeldSlot, function (r) { inv.held = r.varint() & 7; emit(); });
  net.on("out", net.IDS.sb.setCarriedItem, function (r) { inv.held = r.i16() & 7; emit(); });                  // you pick another hotbar slot (the client tells the server: a short)
  net.on("in", CB.login, function () { slots.length = 0; inv.held = 0; inv.ready = false; wins = {}; cur = null; inv.carried = false; emit(); });
  net.onState(function (s) { if (s === "none") { slots.length = 0; inv.ready = false; wins = {}; cur = null; inv.carried = false; } });
})();
