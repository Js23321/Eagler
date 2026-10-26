/* Legacy (Minecraft 1.12 and older, MCEdit / WorldEdit .schematic) numeric block ids -> modern block states.
 * Covers the common blocks and their usual variants (colours, wood types, stairs / slabs / logs / doors / torches / chests ...);
 * anything unknown becomes stone so the shape of the build is still visible. */
var Legacy = (function () {
  var COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
  var WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"];
  var HFACE = ["south", "west", "north", "east"];            // data & 3 for doors / fence gates / beds / skulls: 0 south 1 west 2 north 3 east
  var FACE6 = ["down", "up", "north", "south", "west", "east"];
  function S(name, props) { return { name: "minecraft:" + name, props: props || {} }; }
  function stairsFacing(d) { return ["east", "west", "south", "north"][d & 3]; }
  function chestFacing(d) { return ["north", "north", "north", "south", "west", "east"][d] || "north"; }   // 2 north 3 south 4 west 5 east

  var SIMPLE = {
    0: "air", 2: "grass_block", 4: "cobblestone", 7: "bedrock", 8: "water", 9: "water", 10: "lava", 11: "lava", 13: "gravel", 14: "gold_ore", 15: "iron_ore",
    16: "coal_ore", 20: "glass", 21: "lapis_ore", 22: "lapis_block", 25: "note_block", 41: "gold_block", 42: "iron_block", 45: "bricks", 46: "tnt", 47: "bookshelf",
    48: "mossy_cobblestone", 49: "obsidian", 52: "spawner", 56: "diamond_ore", 57: "diamond_block", 58: "crafting_table", 73: "redstone_ore", 74: "redstone_ore",
    79: "ice", 80: "snow_block", 81: "cactus", 82: "clay", 84: "jukebox", 86: "carved_pumpkin", 87: "netherrack", 88: "soul_sand", 89: "glowstone", 90: "nether_portal",
    91: "jack_o_lantern", 101: "iron_bars", 102: "glass_pane", 103: "melon", 110: "mycelium", 112: "nether_bricks", 113: "nether_brick_fence",
    116: "enchanting_table", 119: "end_portal", 121: "end_stone", 122: "dragon_egg", 123: "redstone_lamp", 124: "redstone_lamp", 129: "emerald_ore", 133: "emerald_block",
    137: "command_block", 138: "beacon", 152: "redstone_block", 153: "nether_quartz_ore", 165: "slime_block", 166: "barrier", 169: "sea_lantern", 170: "hay_block",
    173: "coal_block", 174: "packed_ice", 198: "end_rod", 201: "purpur_block", 206: "end_stone_bricks", 208: "dirt_path", 210: "repeating_command_block",
    211: "chain_command_block", 212: "frosted_ice", 213: "magma_block", 214: "nether_wart_block", 215: "red_nether_bricks", 216: "bone_block", 217: "structure_void",
    255: "structure_block", 30: "cobweb", 32: "dead_bush", 37: "dandelion", 39: "brown_mushroom", 40: "red_mushroom", 51: "fire", 59: "wheat", 60: "farmland",
    83: "sugar_cane", 92: "cake", 105: "melon_stem", 104: "pumpkin_stem", 111: "lily_pad", 115: "nether_wart", 117: "brewing_stand", 118: "cauldron", 127: "cocoa",
    141: "carrots", 142: "potatoes", 207: "beetroots", 140: "flower_pot", 145: "anvil", 154: "hopper", 151: "daylight_detector", 120: "end_portal_frame", 78: "snow",
    131: "tripwire_hook", 132: "tripwire", 106: "vine", 199: "chorus_plant", 200: "chorus_flower", 36: "moving_piston", 34: "piston_head", 209: "end_gateway"
  };
  var STAIRS = { 53: "oak_stairs", 67: "cobblestone_stairs", 108: "brick_stairs", 109: "stone_brick_stairs", 114: "nether_brick_stairs", 128: "sandstone_stairs", 134: "spruce_stairs",
    135: "birch_stairs", 136: "jungle_stairs", 156: "quartz_stairs", 163: "acacia_stairs", 164: "dark_oak_stairs", 180: "red_sandstone_stairs", 203: "purpur_stairs" };
  var FENCES = { 85: "oak_fence", 188: "spruce_fence", 189: "birch_fence", 190: "jungle_fence", 191: "dark_oak_fence", 192: "acacia_fence" };
  var GATES = { 107: "oak_fence_gate", 183: "spruce_fence_gate", 184: "birch_fence_gate", 185: "jungle_fence_gate", 186: "dark_oak_fence_gate", 187: "acacia_fence_gate" };
  var DOORS = { 64: "oak_door", 71: "iron_door", 193: "spruce_door", 194: "birch_door", 195: "jungle_door", 196: "acacia_door", 197: "dark_oak_door" };
  var SLABS = ["smooth_stone_slab", "sandstone_slab", "oak_slab", "cobblestone_slab", "brick_slab", "stone_brick_slab", "nether_brick_slab", "quartz_slab"];
  var DOUBLE = ["smooth_stone", "sandstone", "oak_planks", "cobblestone", "bricks", "stone_bricks", "nether_bricks", "quartz_block"];
  var AXES = ["y", "x", "z", "y"];

  function state(id, d) {
    if (SIMPLE[id] !== undefined) {
      if (id === 8 || id === 9 || id === 10 || id === 11) return S(SIMPLE[id], { level: String(d & 15) });
      if (id === 123 || id === 124 || id === 73 || id === 74) return S(SIMPLE[id], { lit: String(id === 124 || id === 74) });
      if (id === 78) return S("snow", { layers: String((d & 7) + 1) });
      return S(SIMPLE[id]);
    }
    switch (id) {
      case 1: return S(["stone", "granite", "polished_granite", "diorite", "polished_diorite", "andesite", "polished_andesite"][d] || "stone");
      case 3: return S(["dirt", "coarse_dirt", "podzol"][d] || "dirt");
      case 5: return S((WOODS[d & 7] || "oak") + "_planks");
      case 6: return S((WOODS[d & 7] || "oak") + "_sapling");
      case 12: return S(d === 1 ? "red_sand" : "sand");
      case 17: return d & 12 ? ((d & 12) === 12 ? S((WOODS[d & 3] || "oak") + "_wood", { axis: "y" }) : S((WOODS[d & 3] || "oak") + "_log", { axis: AXES[(d >> 2) & 3] })) : S((WOODS[d & 3] || "oak") + "_log", { axis: "y" });
      case 162: return S((WOODS[4 + (d & 1)] || "acacia") + "_log", { axis: AXES[(d >> 2) & 3] });
      case 18: return S((WOODS[d & 3] || "oak") + "_leaves", { persistent: "true" });
      case 161: return S((WOODS[4 + (d & 1)] || "acacia") + "_leaves", { persistent: "true" });
      case 19: return S(d === 1 ? "wet_sponge" : "sponge");
      case 24: return S(["sandstone", "chiseled_sandstone", "cut_sandstone"][d] || "sandstone");
      case 179: return S(["red_sandstone", "chiseled_red_sandstone", "cut_red_sandstone"][d] || "red_sandstone");
      case 31: return S(d === 2 ? "fern" : "short_grass");
      case 35: return S(COLORS[d & 15] + "_wool");
      case 95: return S(COLORS[d & 15] + "_stained_glass");
      case 160: return S(COLORS[d & 15] + "_stained_glass_pane");
      case 159: return S(COLORS[d & 15] + "_terracotta");
      case 172: return S("terracotta");
      case 171: return S(COLORS[d & 15] + "_carpet");
      case 251: return S(COLORS[d & 15] + "_concrete");
      case 252: return S(COLORS[d & 15] + "_concrete_powder");
      case 38: return S(["poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy"][d] || "poppy");
      case 43: return S(DOUBLE[d & 7] || "stone");
      case 44: return S(SLABS[d & 7] || "smooth_stone_slab", { type: d & 8 ? "top" : "bottom", waterlogged: "false" });
      case 125: return S((WOODS[d & 7] || "oak") + "_planks");
      case 126: return S((WOODS[d & 7] || "oak") + "_slab", { type: d & 8 ? "top" : "bottom", waterlogged: "false" });
      case 181: return S("red_sandstone");
      case 182: return S("red_sandstone_slab", { type: d & 8 ? "top" : "bottom", waterlogged: "false" });
      case 204: return S("purpur_block");
      case 205: return S("purpur_slab", { type: d & 8 ? "top" : "bottom", waterlogged: "false" });
      case 97: return S(["infested_stone", "infested_cobblestone", "infested_stone_bricks", "infested_mossy_stone_bricks", "infested_cracked_stone_bricks", "infested_chiseled_stone_bricks"][d] || "infested_stone");
      case 98: return S(["stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks", "chiseled_stone_bricks"][d & 3] || "stone_bricks");
      case 139: return S(d === 1 ? "mossy_cobblestone_wall" : "cobblestone_wall", { up: "true" });
      case 155: return d >= 2 ? S("quartz_pillar", { axis: ["y", "x", "z"][d - 2] || "y" }) : S(d === 1 ? "chiseled_quartz_block" : "quartz_block");
      case 168: return S(["prismarine", "prismarine_bricks", "dark_prismarine"][d] || "prismarine");
      case 175: return d & 8 ? S(["sunflower", "lilac", "tall_grass", "large_fern", "rose_bush", "peony"][d & 7] || "sunflower", { half: "upper" }) : S(["sunflower", "lilac", "tall_grass", "large_fern", "rose_bush", "peony"][d & 7] || "sunflower", { half: "lower" });
      case 202: return S("purpur_pillar", { axis: AXES[(d >> 2) & 3] });
      case 99: return S("brown_mushroom_block");
      case 100: return S("red_mushroom_block");
      case 54: return S("chest", { facing: chestFacing(d), type: "single", waterlogged: "false" });
      case 146: return S("trapped_chest", { facing: chestFacing(d), type: "single", waterlogged: "false" });
      case 130: return S("ender_chest", { facing: chestFacing(d), waterlogged: "false" });
      case 61: case 62: return S("furnace", { facing: chestFacing(d), lit: String(id === 62) });
      case 23: return S("dispenser", { facing: FACE6[d & 7] || "north", triggered: "false" });
      case 158: return S("dropper", { facing: FACE6[d & 7] || "north", triggered: "false" });
      case 29: return S("sticky_piston", { facing: FACE6[d & 7] || "north", extended: String(!!(d & 8)) });
      case 33: return S("piston", { facing: FACE6[d & 7] || "north", extended: String(!!(d & 8)) });
      case 218: return S("observer", { facing: FACE6[d & 7] || "north", powered: "false" });
      case 50: case 76: case 75: {
        var lit = id === 50 || id === 76, t = id === 50 ? "torch" : "redstone_torch";
        if (d === 5 || d === 0) return S(t, id === 50 ? {} : { lit: String(lit) });
        var f = ["", "east", "west", "south", "north"][d] || "north";
        return S(id === 50 ? "wall_torch" : "redstone_wall_torch", id === 50 ? { facing: f } : { facing: f, lit: String(lit) });
      }
      case 65: return S("ladder", { facing: chestFacing(d), waterlogged: "false" });
      case 68: return S("oak_wall_sign", { facing: chestFacing(d), waterlogged: "false" });
      case 63: return S("oak_sign", { rotation: String(d & 15), waterlogged: "false" });
      case 66: return S("rail", { shape: ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south", "south_east", "south_west", "north_west", "north_east"][d & 15] || "north_south", waterlogged: "false" });
      case 27: case 28: case 157: return S(id === 27 ? "powered_rail" : id === 28 ? "detector_rail" : "activator_rail", { shape: ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south"][d & 7] || "north_south", powered: String(!!(d & 8)), waterlogged: "false" });
      case 55: return S("redstone_wire", { power: String(d & 15), north: "none", east: "none", south: "none", west: "none" });
      case 69: return S("lever", { face: ["ceiling", "wall", "wall", "wall", "wall", "floor", "floor", "ceiling"][d & 7], facing: ["north", "east", "west", "south", "north", "south", "east", "west"][d & 7], powered: String(!!(d & 8)) });
      case 77: case 143: return S(id === 77 ? "stone_button" : "oak_button", { face: (d & 7) === 0 ? "ceiling" : (d & 7) === 5 ? "floor" : "wall", facing: ["north", "east", "west", "south", "north"][(d & 7) % 5] || "north", powered: String(!!(d & 8)) });
      case 70: return S("stone_pressure_plate", { powered: String(!!d) });
      case 72: return S("oak_pressure_plate", { powered: String(!!d) });
      case 147: return S("light_weighted_pressure_plate", { power: String(d) });
      case 148: return S("heavy_weighted_pressure_plate", { power: String(d) });
      case 93: case 94: return S("repeater", { facing: ["north", "east", "south", "west"][d & 3], delay: String(((d >> 2) & 3) + 1), powered: String(id === 94), locked: "false" });
      case 96: return S("oak_trapdoor", { facing: ["north", "south", "west", "east"][d & 3], half: d & 8 ? "top" : "bottom", open: String(!!(d & 4)), powered: "false", waterlogged: "false" });
      case 167: return S("iron_trapdoor", { facing: ["north", "south", "west", "east"][d & 3], half: d & 8 ? "top" : "bottom", open: String(!!(d & 4)), powered: "false", waterlogged: "false" });
      case 26: return S("red_bed", { facing: HFACE[d & 3], part: d & 8 ? "head" : "foot", occupied: "false" });
      case 144: return S(["skeleton_skull", "wither_skeleton_skull", "zombie_head", "player_head", "creeper_head"][0] || "skeleton_skull", {});
      case 176: return S("white_banner", { rotation: String(d & 15) });
      case 177: return S("white_wall_banner", { facing: chestFacing(d) });
      case 149: case 150: return S("comparator", { facing: ["north", "east", "south", "west"][d & 3], mode: d & 4 ? "subtract" : "compare", powered: String(id === 150) });
      case 178: return S("daylight_detector", { inverted: "true", power: "0" });
      default: break;
    }
    if (STAIRS[id]) return S(STAIRS[id], { facing: stairsFacing(d), half: d & 4 ? "top" : "bottom", shape: "straight", waterlogged: "false" });
    if (FENCES[id]) return S(FENCES[id], { north: "false", east: "false", south: "false", west: "false", waterlogged: "false" });
    if (GATES[id]) return S(GATES[id], { facing: HFACE[d & 3], open: String(!!(d & 4)), in_wall: "false", powered: "false" });
    if (DOORS[id]) {
      if (d & 8) return S(DOORS[id], { half: "upper", hinge: d & 1 ? "right" : "left", facing: "north", open: "false", powered: "false" });
      return S(DOORS[id], { half: "lower", hinge: "left", facing: ["east", "south", "west", "north"][d & 3], open: String(!!(d & 4)), powered: "false" });
    }
    if (id >= 219 && id <= 234) return S(COLORS[id - 219] + "_shulker_box", { facing: "up" });
    if (id >= 235 && id <= 250) return S(COLORS[id - 235] + "_glazed_terracotta", { facing: HFACE[d & 3] });
    return S("stone");
  }
  return { state: state };
})();
