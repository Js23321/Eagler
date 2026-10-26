/* TEST ONLY (build.js --shim): simulates browser pointer lock, because the embedded test browser
 * refuses it. Behaves like Chrome: requestPointerLock() resolves async and fires pointerlockchange,
 * exitPointerLock() fires it again, and __lockshim.forceUnlock() is "the player pressed Esc". */
(function () {
  "use strict";
  var locked = null, log = [];
  window.__ocTrace = [];
  Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get: function () { return locked; } });
  Element.prototype.requestPointerLock = function () {
    var el = this;
    log.push("request");
    return new Promise(function (resolve) {
      setTimeout(function () { locked = el; log.push("locked"); document.dispatchEvent(new Event("pointerlockchange")); resolve(); }, 15);
    });
  };
  Document.prototype.exitPointerLock = function () {
    log.push("exit");
    if (!locked) return;
    setTimeout(function () { locked = null; log.push("unlocked"); document.dispatchEvent(new Event("pointerlockchange")); }, 15);
  };
  window.__lockshim = {
    forceUnlock: function () { locked = null; log.push("force-unlock"); document.dispatchEvent(new Event("pointerlockchange")); },
    get locked() { return !!locked; },
    log: log
  };
})();
