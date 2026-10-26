/* ==OneClientMod==
 * @id oc-autotext
 * @name Auto Text Hot Key
 * @version 1.0
 * @author OneClient
 * @description Send a chat message or a command with one key press: gg, a team call, /spawn, /home ...
 * @category Utility
 * @icon chat
 * @order 61
 * @needs camera
 * ==/OneClientMod== */
var kit = api.kit;
var live = false, SLOTS = 6, rows = [];

function slotText(i) { return String(api.settings.get("text" + i) || "").trim(); }

/* the same thing a player does: open chat, type, press Enter (works on every server) */
function typeIt(text) {
  var target = window;
  function ev(type, key, code, kc) { var e = new KeyboardEvent(type, { key: key, code: code, keyCode: kc, which: kc, bubbles: true, cancelable: true }); e.__oc = true; target.dispatchEvent(e); }
  var codes = { " ": "Space", "/": "Slash", ".": "Period", ",": "Comma", "-": "Minus", "_": "Minus", ":": "Semicolon", ";": "Semicolon", "'": "Quote", "=": "Equal", "+": "Equal", "!": "Digit1", "?": "Slash", "@": "Digit2" };
  var i = 0, chars = text.split("");
  ev("keydown", "t", "KeyT", 84); ev("keyup", "t", "KeyT", 84);                          // open chat
  function next() {
    if (i >= chars.length) { setTimeout(function () { ev("keydown", "Enter", "Enter", 13); ev("keyup", "Enter", "Enter", 13); }, 40); return; }
    var ch = chars[i++], isL = /[a-z]/i.test(ch), code = isL ? "Key" + ch.toUpperCase() : /[0-9]/.test(ch) ? "Digit" + ch : (codes[ch] || "Unidentified"), kc = isL ? ch.toUpperCase().charCodeAt(0) : ch.charCodeAt(0);
    ev("keydown", ch, code, kc); ev("keypress", ch, code, kc); ev("keyup", ch, code, kc);
    setTimeout(next, 8);
  }
  setTimeout(next, 220);
}

function send(i) {
  if (!live) { api.ui.toast("Switch Auto Text Hot Key on first, then use these buttons."); return; }
  var text = slotText(i);
  if (!text) { api.ui.toast("Text " + i + " is empty. Type something in its box first."); return; }
  if (!api.game.inWorld) { api.ui.toast("Join a world first."); return; }
  var OC = OneClient, active = OC.net && OC.net.active;
  /* commands can be sent as they are on every connection. A chat message goes out as a packet only in singleplayer: a server that has sent you
   * other players' messages expects them to be acknowledged in the next one, so there it is typed in like you would (open chat, type, Enter) */
  if (active && text.charAt(0) === "/") OC.net.command(text);
  else if (active && OC.net.transport === "singleplayer") OC.net.chat(text);
  else typeIt(text);
}

for (var n = 1; n <= SLOTS; n++) (function (i) {
  api.keys.register({ id: "send" + i, label: "Send text " + i, def: "", consume: true, onDown: function () { send(i); } });
  rows.push({ k: "text" + i, type: "text", label: "Text " + i, note: i === 1 ? "A message, or a command that starts with /" : "", placeholder: i === 1 ? "gg" : i === 2 ? "/spawn" : "", def: "" });
  rows.push({ type: "button", label: "Send text " + i + " now", text: "Send", onClick: function () { send(i); } });
})(n);

api.settings.define([{ type: "section", label: "Auto Text Hot Key" }, { type: "info", label: "Type the text for each slot, then pick its key further down. Messages that start with / are sent as commands. A key you pick here is used only while you play." }].concat(rows));
if (api.schemaOnly) return;
live = true;
