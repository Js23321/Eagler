# OneClient for Eaglercraft 26.2

`OneClient-26.2.html` is the finished client: the original `eaglercraft-26.2-zeus-skins.html` plus the
OneClient mods, menus and two bundled resource packs (Vanilla+ and Moss Panorama). Open it like the original file.

## Menus
OneClient replaces the game's title screen, its Singleplayer screens, server list and profile screen with its own, and the game's
own menus do not show while you use them. **The Esc menu and the Options screens are the game's own** (they were OneClient's own
pages for a while; that was taken out on request, and the old code is kept in `_archive/custom-esc-and-options-2026-10-11/`).
- **Home** (title screen): Singleplayer, Multiplayer, Options (the game's own Options screen), Mods, Profile. Leaving a world from
  the game's Esc menu (Save and quit / Disconnect) covers the screen at once, so OneClient's pages come back without the game's
  title ever flashing, and you land on the page you came from (the world list or the server list).
- **Singleplayer**: your worlds, last played first, each with its game mode, difficulty, version and when you last played (read
  from the game's own saved worlds). **Play** presses the game's buttons behind OneClient's own **Loading** card, which follows the
  game's loading screens (starting the world server, loading chunks, loading terrain) and ends in **Click to play** when the
  browser wants a click before it hands the mouse over. **Create world** is a form (name, Survival / Creative / Hardcore,
  difficulty, world type, seed, cheats, structures, bonus chest) that fills in the game's Create New World screen for you and
  starts the world. **Delete** asks first, then uses the game's own Delete and its confirmation, and checks the world is really
  gone. The pencil opens the game's own Edit World screen (rename, back up, optimize) and **Import or LAN** opens the game's
  "What would you like to do?" box (import an EPK or vanilla world, join a LAN world); you use those directly and OneClient
  comes back when you leave them. A search box appears once you have more than five worlds. The game's Edit World and Create New
  World screens crash the whole game when they get the Escape key (the game's own bug, also without OneClient); OneClient turns
  Escape on those two screens into their Cancel button.
- **Multiplayer**: your server list. It is stored in the game's own `servers.dat`, so it also shows in the
  game's list (the game's default server, ArchMC, is always first and cannot be edited or removed, as in the
  game). *Join* presses the game's buttons for you, but behind OneClient's own **Joining** screen: you never see
  the game's server list or its connecting screen. If the connection fails (or a server kicks you later) a card
  shows the game's real reason with **Back to servers** and **Try again**. Cancel works while connecting. When the
  world has loaded and the browser would not hand the mouse over (more than a few seconds after your click),
  OneClient shows **Click to play** instead of letting the game fall back to its Esc menu.
  The game's "Caution: Third-Party Online Play" screen is switched off by default (set once per profile). On a brand-new
  profile the game's own FPS / TPS counters are switched off too, since OneClient has its own widgets for them (they come
  back with the game's "Show FPS & TPS" option).
  **Add server** and **Direct connect** save addresses the way the game itself does for each connection mode:
  **Relay** (the default, as in the game) takes the Minecraft server, `play.example.com` or
  `play.example.com:25565`, and saves it as your multiplayer relay plus the server to reach
  (`wss://<relay>/minecraft?target=play.example.com%3A25565`). The relay is the game's *Multiplayer default*, the first
  relay in its Relays list that can carry multiplayer. **EaglerX** takes the server's own `wss://` address (`ws://` for
  local servers); typing a `ws://` or `wss://` address while Relay is selected switches the entry to EaglerX, as the
  game does. **Relays** on the Multiplayer page opens the game's own Relays screen (add, reorder, remove relays) and
  comes back to OneClient when you press Done there. Relay servers saved by older builds as plain `wss://host` are
  repaired the next time the Multiplayer page opens. **Java account** is the third connection mode (the game calls it Wisp):
  for online-mode servers that check your Minecraft account, such as `donutsmp.net`. It needs a signed-in Microsoft account, see
  *Java accounts* below; Relay and EaglerX servers do not need one.
  **Each server card shows the server's own picture** (instead of the first letter), **how many players are on** (`12 / 100`)
  and **how fast it answers** (milliseconds with signal bars, green / yellow / orange), or "Offline" in red. OneClient asks the
  servers itself when the page opens (and every half minute while it stays open; the round arrow in the corner asks again at
  once): relay servers get the normal Minecraft list ping through their relay, Java-account servers the same ping through the
  Wisp tunnel, EaglerX servers the Eagler query (`Accept: MOTD`, tried on the real ArchMC server). The server's message of the day replaces the address under its name (hover for the full text,
  the version and some player names). The last known picture and numbers are kept in the browser and shown dimmed until the
  answer comes. A server that does not answer the list ping shows "No status" (a Java-account server shows "Bridge off" while OneClient
  Bridge is the chosen sign-in and is not running). The game's own server list is never involved, so nothing about this needs the game's list screen
  to be open.
- **Profile**: your username and your skin, the same choices as the game's Edit Profile screen. The skins are
  the game's 24 default skins plus your own: **Upload skin** takes a 64x64 (or old 64x32) PNG, picks Classic or
  Slim arms for you (you can change it) and adds it to the game's list. **Remove my skins** clears your own skins.
  Apply sets everything through the game's real Edit Profile screen and checks what the game saved.
  A name the game made up for you is flagged on the page; if the game then asks "Default Username Detected"
  OneClient answers Continue Anyway behind its own screen.
  If a screen is not one OneClient knows (the game asks about a server resource pack, for example), the game
  is shown so you can answer it.

How it works: OneClient puts a tiny nearly invisible marker next to the title of the screens it knows
(title, Singleplayer list, Create World, the import box, server list, profile, the Esc menu (only to know when you leave a world), the
world loading screens, connecting, disconnected), and reads it from every rendered
frame while the mouse is free (`client/detect.js`), so its cover goes up in the same frame a screen first appears.
The markers (a few lines of the game's English text and one font picture) are written into the game's own built-in
assets when the page is built, so they are always on and there is no resource pack to see, switch off or delete:
**Options > Resource Packs** lists only the packs you chose. (Older builds installed a resource pack called
"OneClient" for this; a profile that still has it gets it removed once, at the next start.)
Menus are skins over the real screens, so if a marker is ever missing (for example the game language is not English)
the game's own menus simply show. Add `?native` to the page URL to turn the new menus off.

## Java accounts (online-mode servers such as donutsmp.net)
A server in *online mode* checks that you own Minecraft, so a relay cannot carry you in ("requires a Microsoft-authenticated
account"). Signing in is something a web page cannot do on its own: Minecraft's account servers send no CORS headers, and a page
cannot open TCP connections. OneClient solves both **inside the page**, with nothing to install (this works on a Chromebook):

1. **Multiplayer > Java account**. Pick how to sign in (below), press **Sign in with Microsoft**, and enter the code it shows on
   `microsoft.com/link` (Microsoft asks for your password there, never OneClient).
2. **Add server > Java account** (or the one-click DonutSMP button on the Java account page), type `donutsmp.net`, **Join**.
   The server card shows a *Java* tag and its players / ping like any other.

**Two ways to sign in** (the switch on the Java account page; it needs an app ID because Microsoft makes the code you type FOR an app):
- **Quick sign-in**, no Azure account needed and the default while no Azure app is set up. It is the sign-in Mineflayer and prismarine-auth
  (the "live" flow) use: OneClient signs in as *Minecraft on a Nintendo Switch*, with Microsoft's own app ID for that game, a device token of
  type Nintendo and a title token (Xbox's signed requests, `client/mcauth.js`), so Microsoft's page names that app and not OneClient.
  Microsoft and Mojang do not offer this to third-party clients: it could stop working one day, and if you share OneClient widely your own
  app (below) is the better choice. `login.live.com` only speaks TLS 1.2, so `client/tls.js` has a TLS 1.2 mode (ECDHE with AES-GCM, nothing
  else) that is used for that host only.
- **My own Azure app**, the supported way. Paste the *Application (client) ID* of an Azure app. **Mojang has to approve that app for
  Minecraft once** (https://aka.ms/mce-reviewappid); until it does, Minecraft's servers answer 403 and the sign-in stops with a message
  saying so. To get one:
  1. Register an app: `portal.azure.com` > *App registrations* > *New registration*, any name, account type *Personal Microsoft accounts
     only*, no redirect address; then *Authentication* > *Allow public client flows* on; copy the *Application (client) ID*. If Azure asks
     for a subscription or a card: its free sign-up only verifies you (Microsoft says it does not charge unless you upgrade); students can
     use *Azure for Students* (school email, no card); or ask somebody you trust who has an Azure account to do this step and send you only
     the ID (an ID is not a password and does not open your account).
  2. Send the ID with the form at https://aka.ms/mce-reviewappid (once; whether and when it is approved is Mojang's decision).
  3. Use it: each player pastes it into the Java account page once, or you build it into the page so players only press *Sign in*:
     `node build.js --client-id=11111111-2222-3333-4444-555555555555` (the environment variable `ONECLIENT_CLIENT_ID` works too; an ID is
     public, it is only an app's name tag). Such a page always uses that app and hides the switch and the ID box.

OneClient ships no other launcher's ID (Lunar, Prism ...): Microsoft's page would say *that launcher* is signing you in, which it is not.
The OneClient Bridge (below) only supports your own Azure app.

How it works: the game already has a Java-account connection mode (the *Wisp* mode of the Wispcraft script). `client/account.js` is
OneClient's version of that script's side of the deal (the `wispcraft` object the game looks for) and hands the game's two Mojang
calls (the profile check, the session join) to `client/mcauth.js`, which runs the Microsoft / Xbox / Minecraft sign-in in the page.
To reach those servers the page needs a TCP tunnel: **Wisp** servers carry TCP streams over a WebSocket (public ones are built in;
**Test** on the Java account page checks them, and you can type your own). `client/tls.js` is a small TLS 1.3 client (plus the TLS 1.2 mode for `login.live.com`) that runs in the
page, so the secure connection to Microsoft and Mojang is made end to end and the tunnel's operator only sees scrambled bytes. It
trusts only DigiCert Global Root G2 and Microsoft's own roots (pinned in the file), checks the whole certificate chain, the host name,
the dates and the server's signatures, and it was tested against the real servers and against forged ones. The game itself connects to
the server through the same kind of tunnel, and does its own encryption and session join, as the normal game does.

You do the link-and-code step once: the sign-in is saved and renews itself whenever you play (Microsoft ends one that goes unused for about
90 days), so you only repeat it after **Sign out**, after clearing this site's data (or using a private window), or after a long break.
What is kept in this browser: the renewable Microsoft sign-in and the day's Minecraft token (localStorage `oneclient.msauth.v1`). Scripts of
the page (mods are scripts of the page) can read them; sign out removes them. The game only ever holds a stand-in string that
`mcauth.js` swaps for the real token.

**OneClient Bridge** (`bridge/`, needs Node.js 18 or newer on a computer; see `bridge/README.md`) is the optional desktop alternative:
the sign-in and the tunnel run in a small program on your own machine (the Java account page has a link to switch). It keeps the
tokens out of the page, connects from your own internet connection instead of a public tunnel, and it signs in to the server itself, so
OneClient's packet mods (minimap, shulker tooltip, armor, potions ...) can read the server.

**Mods on Java-account servers (the login gate).** An online-mode server asks the game to encrypt the connection, with keys only the game
knows, so nothing else could read it. With the built-in sign-in, `client/gate.js` does that part instead: it keeps the server's Encryption
Request from the game, answers it itself (RSA with the server's key, Mojang's session join with your token through the same tunnel, a fresh
AES key) and from then on decrypts what the server sends and encrypts what the game sends, inside the Wisp frames of that one connection.
The game and the packet layer see a plain connection, exactly as with the Bridge, so the minimap, shulker tooltip, armor, potions and the
other packet mods work on Java-account servers (the Time and Weather changers too). A server list ping, a server that needs no account and
anything the gate does not understand pass through untouched. The switch **Let mods read Java-account servers** on the Java account page
turns it off (the game then does the encryption itself and those mods show nothing there). If the gate fails after it took a login over,
that server is remembered for a day: the next join is left to the game, and switching the gate off and on forgets it. Tested against an
online-mode stand-in server (the whole login, Mojang's session record, 3 MB down and 200 KB up in random pieces, a refused join, a broken
request, a status ping, a server without encryption) and in the game; a real server (DonutSMP) has not been tried by the author.

What was tested: the in-page TLS client against Microsoft's, Xbox's and Mojang's real servers through public Wisp servers (real answers
to made-up credentials: 400 / 401 / 403 as they should be) and against local servers with RSA and ECDSA certificates and both cipher
suites, plus forged certificates, wrong host names, wrong clocks and flipped bits; the whole sign-in, token renewal, the game's profile
and join calls and the encrypted login with a server against stand-ins for Microsoft, Xbox, Mojang and an online-mode server (also in
the game); a real server list ping to `donutsmp.net` through the tunnel (Velocity, protocol 776). For Quick sign-in: the TLS 1.2 mode against
local TLS 1.2 servers (RSA, ECDSA P-256 / P-384, both AES-GCM suites, both curves, 120 KB down and 70 KB up, forged and damaged
handshakes and records) and against the real `login.live.com` (it answers a made-up app ID with `invalid_client`), the Xbox request signing
byte for byte against prismarine-auth's own signer, and the whole sign-in (code, cookie, signed user / device / title / XSTS requests,
saving, a reload, renewal with no code) against stand-ins that check every signature. On 2026-10-11 the project owner reported a real
Quick sign-in and a real join of a Java-account server working on their own account. The "own app" way has not been tried with a real
account (it needs an approved client ID), so expect to report back about that one.
The game tells servers its client brand is `eagler`, and OneClient's mods are modifications: servers that forbid Eaglercraft or
modified clients (or certain mods) can ban for it. Read a server's rules first, and consider an account you can afford to lose.

## Right Shift: HUD editor and Mods menu
Right Shift blurs the game, the HUD widgets become draggable straight away (drag to move, they snap to edges and
centre, scroll over one to resize) and a glass **Mods** button appears in the centre. Click it for the **Mods menu**:
one blurred glass rectangle with a card per mod. Each card shows the mod's icon, its name, and a green **Enabled** /
red **Disabled** button that is the bottom edge of the card: click that button to switch the mod on or off, click the
rest of the card to change its settings. Above the cards: a **search box**, **category chips** (HUD, World, Visual,
Utility, Yours) and an **Enabled** filter, each with a count.

Every on-screen mod shares the same appearance settings: text colour, label on/off, glass background and its opacity,
corner roundness, text shadow and size (the same size you get with the mouse wheel). A mod's settings page starts with a **live
preview** of its widgets, so you see a change as you make it. Hotkeys are chosen by clicking the key and pressing the new one
(Esc cancels, Backspace clears). Esc steps back one layer (hotkey capture, a settings page, the Mods menu, then the overlay).
**Reset layout** in the menu header puts the HUD widgets back where they started.

**Mod settings per server.** The strip under the title of the Mods menu knows which server you are on (the host and port in the game's
handshake; singleplayer has none). Tick **Own settings for this server** and that server gets a copy of your current choices: which mods are
on, their options, where the HUD widgets sit, the zoom strength. From then on whatever you change in the Mods menu or the HUD editor is kept
with that server only; they come into force by themselves whenever you join it and your normal settings come back when you leave
(a short note says so). Unticking the box gives the server your normal settings again but keeps its own for the next time you tick it.
Your normal settings are never touched while a server's own are in force, not even if the tab is closed then (`client/profiles.js`; the
saved file always holds the normal ones, the servers' settings are kept in `oneclient.serverprofiles.v1`).

**Ctrl+W.** Sprint plus forward is Ctrl+W, which the browser reads as "close this tab". A page cannot cancel that, but OneClient softens
it two ways (`client/core.js`): in fullscreen Chrome lets a page claim keys, so while you play OneClient claims W, A, S and D and Ctrl+W
reaches the game; and in a normal window, closing or reloading the tab while the game has your mouse asks "Leave site?" first (Cancel
keeps the game). The Toggle Sprint mod avoids holding Ctrl altogether.

### Relays and resource packs out of the box
- **Relays are preset.** A new profile starts with a working list (written once by `client/pack.js`, never over a list you changed): `lax1dude relay #2` for LAN worlds, the game's own public 26.2 relay (Heroku) for multiplayer, and a spare shared-world relay. Adding a Relay-mode server or using Direct connect works at once; the game's own first relay (`relay.deev.is`) was down when this was checked, so it is left out.
- **OneClient X-Ray** is bundled but never switched on: it waits in Options > Resource Packs. It is an original pack (made by `packs-src/make-xray.js` from the game's own block list): stone, dirt, grass, sand, gravel, deepslate, netherrack and the plants on them are not drawn, and ores, ancient debris, spawners and trial chamber blocks glow through the ground. Most servers forbid X-ray.
- The well-known *X-Ray Ultimate* (Filmjolk, CurseForge) is **not** bundled: its licence forbids redistribution and inclusion in other downloads. You can import the official zip yourself in Options > Resource Packs.

### The mods
47 mods are built in: the 7 OneClient started with (FPS, CPS, Keystrokes, Fullbright, Zoom, Toggle Sprint, Crosshair, switched on or off as
before) and 40 new ones, which all start switched **off**: switch on what you want. The new list follows the mods of Lunar Client.

| Category | Mod | What it does (main settings) |
| --- | --- | --- |
| HUD | FPS, CPS, Keystrokes | as before |
| HUD | Minimap | a map of the ground around you (top right): the colour of every block taken from the game's own textures, grass / leaves / water tinted by biome, relief shading, water depth, a cave view that takes over when you are deep underground (or by choice), mobs, players and your Waypoints; square or round, size, zoom keys (`=` / `-`), rotate with you or north up, chunk grid, compass letters, coordinates and biome name, hide key (`M`) |
| HUD | Coordinates | X Y Z (decimals, one line or one per line, round down, the Nether / Overworld equivalent) |
| HUD | Direction HUD | compass strip or text, degrees, axis |
| HUD | Clock | real time, game time or both, 12 / 24 hours, seconds |
| HUD | Day Counter | the world's day count, first day is 0 or 1, time of day |
| HUD | Playtime | this visit or all time, keep counting in menus |
| HUD | Stopwatch | start / stop / lap / reset with keys or buttons, hundredths, laps |
| HUD | Server Address | the server you are on (or Singleplayer), its name, hide the address |
| HUD | Memory Usage | used / limit / percent, colour when it runs low |
| HUD | Ping, TPS | latency and server tick rate, colour by quality |
| HUD | Speedometer | blocks per second, km/h, mph, up and down too |
| HUD | Saturation, Health, Experience | your hidden saturation and food, health in points or hearts, level / progress / points |
| HUD | Combo Counter, Reach Display | hits in a row, how far your last hit was (timeouts, decimals) |
| HUD | Potion Effects | the game's own effect icons, level, time left, harmful ones in red |
| HUD | Armor Status | the four armor pieces and what you hold, with the game's item pictures and a durability bar (points / percent / fraction), row or column |
| HUD | Item Counter | counts up to three items you pick (golden apples, arrows, pearls ... or any item by name) |
| HUD | Cooldowns | the items you cannot use for a moment (ender pearls, chorus fruit, shields ...) with their picture and the time left |
| HUD | WAILA | the block or mob under the crosshair, its position and block state |
| HUD | Pack Display | the resource packs that are switched on |
| World | Chunk Borders | the chunk edges around you (range, height, colours, thickness, through walls) |
| World | Block Outline | the game's block selection box: colour, opacity, thickness, cycling colour |
| World | Hitbox | the game's own F3+B hitboxes (exact), in the colour you pick |
| World | Waypoints | named places per world and server with a floating name, distance and a beam; a Death waypoint; a list with colours, coordinates and add / delete on its page |
| World | TNT Countdown | the time left floats over every lit TNT (and TNT minecart), green to red, in seconds or game ticks |
| Visual | Fullbright, Crosshair | as before |
| Visual | FOV Changer | 30 to 150 degrees (the game's slider ends at 110), optionally keeping the sprint / potion zoom |
| Visual | Fog Customizer | where the fog starts and ends, no fog, a fog colour |
| Visual | Color Saturation | saturation, brightness, contrast of the world picture |
| Visual | Motion Blur | frame blending with a trail that lasts the same at any frame rate |
| Visual | Hit Color, Glint Colorizer | the flash on a hurt mob (any colour, strength, cycling) and the enchantment shimmer (any colour, cycling) |
| Visual | Time Changer, Weather Changer | the time of day and the weather you see, on your screen only (singleplayer worlds and servers whose connection is not encrypted) |
| Visual | Hurt Cam | tone down or remove the camera tilt when you take damage |
| Utility | Zoom, Toggle Sprint | Zoom (hold C; scroll changes the strength) narrows the game's own view like a spyglass: the HUD, the crosshair, the chat and the held item keep their size (it tightens the world's projection, `client/core.js` + `client/sense.js`, instead of scaling the whole screen). Toggle Sprint as before |
| Utility | Toggle Sneak | press the sneak key once to sneak, again to stop (re-applied after a screen) |
| Utility | Auto Text Hot Key | six keys that send a message or a /command |
| Utility | Shulker Tooltip | point at a shulker box that is not empty in your inventory, your hotbar (inventory open) or a chest and its contents show as a picture of its 27 slots, in the colour of the box, with counts, durability bars and the shimmer of enchanted items (size, colour, counts and the rest can be switched; the game's text list is covered by it) |

Some mods of Lunar Client are **not** included because they cannot be built on what a browser can see of this game: Freelook /
Snaplook (the view itself would have to be turned without turning the player), Boss Bar / Chat / Scoreboard / Titles / Tab Editor /
Nametags / Scrollable Tooltips (the game draws these into its own frame, there is nothing to restyle), Item Physics, 2D
Items, 3D Skins, Particle Changer, Shiny Pots, Better Sounds, Nick Hider, Menu Blur, Replay Mod, Mumble Link, Screenshot Uploader, and
the server-specific ones (Hypixel, UHC, PvP Info, Quickplay).

**Crosshair** replaces the game's own: the game draws its crosshair as a single quad per frame with a unique
"invert" blend, so OneClient skips exactly that draw while the mod is on (and the mouse is captured) and draws
your design in the middle of the screen instead, shown only while the game itself would show a crosshair (not in
third person, with the HUD hidden, or under a menu). Switch the mod off and the game's crosshair is back.

The overlay does not open the Esc menu: OneClient releases the mouse but keeps telling the game it is still captured,
then takes the mouse back when you close. If the browser refuses to give it back (closing with Esc after
being idle), the game falls back to its normal pause menu.

## How OneClient sees the game
The game is a sealed WebAssembly build, so mods work at the browser layer. Three things are visible from there:
- **What the game draws.** The camera and projection come from the game's own uniform buffers (`client/sense.js`), mods can draw into
  the game's frame (`api.gl.onWorld`), patch a few of its shaders (`client/fx.js`: block outline, hitbox colour, enchantment glint,
  the hurt flash), change its projection and fog as they are uploaded, and post-process the finished world picture (`client/gfx.js`).
- **What the game and its server say to each other** (`client/net.js`). In singleplayer the game's server runs in a worker and talks the
  real Minecraft protocol (26.2 is protocol 776) in messages; on a server the same protocol travels over a WebSocket (through a relay, or
  direct): a stream of `[length][packet]`, possibly deflate-compressed after the server's `set_compression`. OneClient reads both
  (read only), follows the connection through handshake, login, configuration and play, and decodes what mods need: the world's blocks
  (`world.js`, with the block state table in `blocks26.json`, measured from the live game), your health / food / saturation / experience /
  effects / game mode / ping / position / the day clock / weather (`player.js`), the entities around you (`entities.js`) and your
  inventory (`inventory.js`, with the item table in `items26.json`). It can also send: commands, chat messages, and a few
  serverbound packets.
- **Changing what the game receives**: a listener in front of the game's own lets a mod rewrite or drop a packet and hand the game
  one it never got (Time Changer, Weather Changer). In singleplayer that is the message from the game's server; on a server it is the
  WebSocket: the stream is followed packet by packet (a packet may be cut between two messages), only packets in the play state that
  are not deflated are touched, and a changed packet goes out uncompressed, which the game accepts. It is only ever your own screen:
  the server never learns of it. It needs a connection that is not encrypted.

Limits, so nothing surprises you:
- A server that runs in **online mode** asks the game to encrypt the connection. The keys never leave the game, so the traffic of such a
  server can only be read when you joined it through a Java account of OneClient with the login gate on (see "Mods on Java-account
  servers"): then every packet mod works there. Any other encrypted server cannot be read: mods that need packets (health, inventory,
  WAILA's mobs, the world for Litematica's verifier ...) show nothing there. Servers that browsers can join without a Mojang login (the
  usual case for Eaglercraft) do not encrypt.
- Server connections other than a relay (EaglerX, Wisp) are read with the same code but only the relay path has been tried against a
  stand-in server; an EaglerX server that frames packets differently may not be understood.
- Time Changer and Weather Changer (the only two mods that change packets) work on servers too, as long as the connection can be read
  (not encrypted, or a Java-account server with the login gate on): they cannot touch any other online-mode server. Every other visual mod works on any
  server, because it only changes how the game draws.
- Inventory: a few rarely used item details (maps of a particular kind, written books ...) are not decoded; when one is met the slots
  after it are filled in by the next updates, so a stack can be missing for a moment.
- Block Outline, Hit Color and Glint Colorizer patch the game's own shaders when it starts, so they work at any time; they only recolour.

## Loading mods

The Mods menu has a **Load mods** button (or drop files on the menu). It takes OneClient mods (`.js`, `.ocmod`), real Minecraft
mod `.jar` files and schematics (`.litematic`, `.schem`, `.schematic`, `.nbt`); loaded mods show up as cards under **Your mods**,
can be switched on and off, have their own settings pages and are remembered by the browser. Full details and the mod API are in
[MODDING.md](MODDING.md).

- **Real Minecraft mods (.jar)** are Java code, and this client is the game compiled to WebAssembly (no Java VM, no class
  loading, no mixins), so a jar's own code cannot run. Nothing can change that without the game's source: a jar needs the real
  Minecraft classes it was written against, and this build has no classes, only compiled code with no names. OneClient reads the
  jar's details and, when it has a **port** of that mod, installs and starts the port. Today that is **Litematica**: load
  `.litematic` / `.schem` / `.nbt` and see the structure as a see-through copy in your world (the game's own block models and
  textures), move, rotate, mirror, slice by layer, material list, per-region switches, **Verifier** (compares the schematic with the
  world the game has loaded and boxes what is missing, wrong or extra), **Selection** (two corners, saved as a schematic) and **Paste**
  (builds a schematic with commands where cheats are allowed). Every other jar is listed as "Can't run" with the reason; library
  jars (malilib, Fabric API ...) are recognised and explained. The way forward for a specific mod is a port written for OneClient's
  API, which can use everything in "How OneClient sees the game".
- Example mods are in `mods/examples/`; `mods/litematica.ocmod` is the port as a loadable package.

## Default packs and settings
Installed on a profile's first run and selected automatically, in this order (lowest first):
`Vanilla+ 1.21.11.zip` and `Moss Panorama.zip`. Players can switch off or delete either in **Options > Resource Packs**;
they are never added back unless a pack changes. The OneClient branding text and screen markers are not a pack: they are part of
the game's built-in assets (always on, never listed). The GUI scale is set to 2 once per profile (change it in Video
Settings and it sticks), and the multiplayer caution screen is switched off once per profile. Each default is
applied once, so a newer build never undoes a setting you changed. The main menu text reads
"OneClient 26.2 (Junsheng13)". The game's own credits are still in Options > Credits & Attribution.

## Rebuilding
```
node build.js                          # OneClient-26.2.html with the bundled packs
node build.js --no-pack                # without any bundled packs
node build.js --client-id=<Azure app ID> # the Java-account sign-in comes with that approved app (see "About the client ID")
node build.js --shim                   # OneClient-test.html with a pointer-lock simulator + trace (testing only)
node build.js --out=C:/somewhere/x.html  # write the page anywhere (also with --shim)
node build.js --mods-only              # just refresh mods/*.ocmod from mods-src/ (fast, for working on a mod)
```
Bundled packs are listed in `client/packs.json`. Source is in `client/`, in the order the page loads it:
`core.js` (settings, mouse lock, fullbright, zoom, sprint), `sense.js` (camera / projection from the game's uniform buffers, the
world-pass hook, uniform buffer rewriting), `fx.js` (shader patches), `gfx.js` (line / quad batches, post-processing), `net.js`
(the packet layer: worker and WebSocket readers, rewriting, injection, sending), `blocks.js` + `blocks26.json`, `world.js`,
`tls.js` (a TLS 1.3 client for the page), `wisp.js` (Wisp tunnels + HTTPS over them), `mcauth.js` (the in-page Microsoft / Xbox / Minecraft sign-in), `account.js` (Java accounts: the `wispcraft` object the game looks for, the link to the sign-in or OneClient Bridge), `gate.js` (the login gate: AES-CFB8, RSA, the encryption handshake of online-mode servers, so mods can read them), `player.js`, `entities.js`,
`inventory.js` + `items26.json`, `hudkit.js` (the shared HUD widgets and settings), `pack.js` (first-run
install), `modloader.js` (the mod loader), `ui.js` (HUD + overlay), `mods.js` (Mods menu), `profiles.js` (own mod settings per server), `detect.js` (screen detection, input
bridge, NBT), `status.js` (server status: picture, players, speed), `worlds.js` (the saved worlds and the buttons of the game's Singleplayer
screens), `menu.js` + `menu.css` (the menus), `markers.json` (screen
markers) and `lang-overrides.json` (branding text); the build writes both into the game's own asset pack (`build.js`: `patchEpk`).
Mods shipped with the client live in `mods-src/`: `lunar/` (the 40 one-file built-in mods, embedded in the page), `litematica/`
(the port, built into `mods/litematica.ocmod`), `examples/`. The build also copies the game's 24 default skins, its potion-effect and
item pictures and the English names of blocks, items, entities and effects out of its own asset pack. `client/preview.html` shows the
overlay over a fake scene for quick design work. `bridge/` is OneClient Bridge (a separate Node program, not part of the page).

## Credits
- Moss Panorama by AREKKUZZERA, CC BY 4.0 (https://modrinth.com/resourcepack/moss-panorama).
- Vanilla+ V2 by Marlowww.
- The built-in mods follow the mod list of Lunar Client; they are OneClient's own code and use no Lunar Client code or assets.
- Litematica is a mod by masa; the OneClient port is a separate implementation of its idea.

## Notes
- The game has no "join this server" function to call, so OneClient presses the real buttons, hidden behind its own screens.
- `_analysis/` holds notes and extracted loader scripts from reverse-engineering the file.
