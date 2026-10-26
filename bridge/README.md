# OneClient Bridge

A small program that runs on **your own computer** so OneClient can use a real Java (Microsoft) account on
online-mode servers such as `donutsmp.net`. A web page cannot do this by itself: Minecraft's account servers
send no CORS headers, and a page cannot open TCP connections.

**You only need this if you want the desktop route.** OneClient also has a built-in sign-in that runs inside the page through a
public Wisp tunnel (nothing to install; it is the default, and the only option on a Chromebook). Use the bridge when you want the
tokens kept out of the browser, the connection to come from your own internet connection, and OneClient's packet mods (minimap,
shulker tooltip ...) to keep working on online-mode servers (the built-in sign-in leaves the encryption to the game, so they
cannot read those servers). On the Java account page, choose "Use OneClient Bridge instead".

What it does:

1. **Sign-in** - Microsoft's device-code sign-in, the Xbox / Minecraft token chain and the token renewal. The tokens stay in
   `state.json` in your local app data folder; OneClient only ever holds an opaque stand-in string for the account.
2. **Server login** - when the game connects to an online-mode server, the bridge does what a Minecraft client does: the
   encryption handshake and Mojang's session join with your account. The game itself sees a plain connection, so OneClient's
   packet mods (minimap, shulker tooltip, armor HUD ...) keep working on those servers.
3. **Connections** - a Wisp server (WebSocket to TCP), so the game reaches the server from your own internet connection.

Safety: it listens on `127.0.0.1` only, every request needs the pairing code, only the two Mojang calls the game makes are
forwarded, and connections to private / loopback addresses are refused (so a web page cannot use it to poke at your
network) unless you start it with `--allow-private`.

## Start it

* Windows: double-click `OneClient Bridge.bat`
* macOS / Linux: `sh start-bridge.sh`
* or: `node oneclient-bridge.js`

It needs **Node.js 18 or newer** (https://nodejs.org, the LTS version). No packages to install.

Keep the window open while you play. The first start prints a **pairing code**; type it into OneClient once:
Multiplayer > **Java account**.

## Sign in

OneClient asks for the **Application (client) ID** of an Azure app, then shows a code to enter on
`microsoft.com/link`. Microsoft (not OneClient) asks for your password there.

To get a client ID: on `portal.azure.com` open *App registrations* > *New registration*, account type *Personal Microsoft
accounts only* (no redirect address needed); under *Authentication* turn on *Allow public client flows*; copy the
*Application (client) ID*. **Mojang has to approve the app
for Minecraft** once (form: https://aka.ms/mce-reviewappid); until then Minecraft's servers answer 403 and the sign-in
stops with a message saying so.

## Options

```
--port <n>           port to listen on (default 8742)
--client-id <id>     the client ID of your Azure app (OneClient can also send it)
--allow-private      let the game connect to private / loopback addresses (a server on your own network)
--data-dir <folder>  where state.json is kept
--new-pairing        make a new pairing code (OneClient has to be paired again)
--pass-encryption    leave the encryption to the game (then OneClient's mods cannot read online-mode servers)
```

## Good to know

* The game tells servers its client brand is `eagler`. Servers that do not allow Eaglercraft or modified clients can see
  that; the bridge does not hide it.
* Signing out in OneClient removes the account (and its refresh token) from `state.json`.
* To forget everything, close the bridge and delete its data folder (the path is printed when it starts).
