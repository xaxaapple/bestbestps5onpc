// Мост интерфейса для Windows: имитирует window.webkit.messageHandlers.couch (WebKitGTK) через HTTP.
// Вставляется сервером в index.html до всех модулей. __PC5_TOKEN__ подставляет сервер.
(function () {
  var TOKEN = "__PC5_TOKEN__";
  var H = { "X-PC5-Token": TOKEN, "Content-Type": "application/json" };
  window.webkit = { messageHandlers: { couch: {
    postMessage: function (msg) {
      return fetch("/rpc", { method: "POST", headers: H, body: msg }).then(function (r) { return r.text(); });
    } } } };

  // События Python -> страница (длинный опрос)
  var since = 0;
  function poll() {
    fetch("/poll?since=" + since, { headers: H }).then(function (r) { return r.json(); }).then(function (res) {
      since = res.seq;
      (res.events || []).forEach(function (e) {
        if (e.event === "pc5.reload") { location.search = res.query; return; }
        var tries = 0;
        (function send() {
          if (window.__couch && window.__couch.dispatch) window.__couch.dispatch(e.event, e.payload);
          else if (tries++ < 100) setTimeout(send, 50);
        })();
      });
      poll();
    }).catch(function () { setTimeout(poll, 1000); });
  }
  poll();

  // DualSense / DualShock 4 / прочие HID-геймпады: через Gamepad API браузерного движка (WebView2), он знает их
  // «стандартную» раскладку. XInput-устройства (Xbox) читает Python (pad.py), их здесь пропускаем, чтобы не
  // получать каждое нажатие дважды. Нажатия приходят только пока окно лаунчера в фокусе.
  var PAD_BTN = { 0: "cross", 1: "circle", 2: "square", 3: "triangle", 4: "l1", 5: "r1", 6: "l2", 7: "r2",
    8: "create", 9: "options", 10: "l3", 11: "r3", 12: "up", 13: "down", 14: "left", 15: "right" };
  var PAD_REPEAT = { up: 1, down: 1, left: 1, right: 1, "rs-up": 1, "rs-down": 1, l1: 1, r1: 1 };
  var padHeld = {}, psSince = 0, psDone = false;
  function padActive(gp) {
    var on = {}, i;
    for (i = 0; i < gp.buttons.length; i++) {
      var b = gp.buttons[i];
      if (PAD_BTN[i] && (b.pressed || b.value > 0.5)) on[PAD_BTN[i]] = 1;
    }
    var ax = gp.axes || [];
    if (ax[0] < -0.55) on.left = 1; else if (ax[0] > 0.55) on.right = 1;
    if (ax[1] < -0.55) on.up = 1; else if (ax[1] > 0.55) on.down = 1;
    if (ax[3] < -0.55) on["rs-up"] = 1; else if (ax[3] > 0.55) on["rs-down"] = 1;
    return on;
  }
  function padTick() {
    var list = (navigator.getGamepads && navigator.getGamepads()) || [], gp = null, i;
    for (i = 0; i < list.length; i++) {
      var g = list[i];
      if (g && g.connected && g.mapping === "standard" && !/xinput/i.test(g.id || "")) { gp = g; break; }
    }
    var now = performance.now(), on = gp ? padActive(gp) : {};
    var ps = !!(gp && gp.buttons[16] && gp.buttons[16].pressed);
    if ((on.create && on.options) || ps) {                      // PS-Taste или Create+Options, 1,2 с: «PS долго»
      if (!psSince) { psSince = now; psDone = false; }
      else if (!psDone && now - psSince >= 1200) {
        psDone = true;
        window.__couch && window.__couch.dispatch("ps", { kind: "long" });
      }
      padHeld = {};
      return;
    }
    psSince = 0;
    Object.keys(padHeld).forEach(function (k) { if (!on[k]) delete padHeld[k]; });
    Object.keys(on).forEach(function (k) {
      var due = padHeld[k];
      if (due === undefined) {
        padHeld[k] = now + 400;
        window.__couch && window.__couch.dispatch("pad", { button: k, repeat: false });
      } else if (now >= due && PAD_REPEAT[k]) {
        padHeld[k] = now + 90;
        window.__couch && window.__couch.dispatch("pad", { button: k, repeat: true });
      }
    });
  }
  setInterval(padTick, 16);

  // Клавиатура -> кнопки геймпада (на Linux их даёт настоящий контроллер)
  var KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "cross", " ": "cross",
    Escape: "circle", Backspace: "circle", o: "options", x: "square", y: "triangle", q: "l1", e: "r1", 1: "l2", 3: "r2",
    PageUp: "rs-up", PageDown: "rs-down" };
  window.addEventListener("keydown", function (e) {
    if (e.key === "F11") { e.preventDefault();
      fetch("/rpc", { method: "POST", headers: H, body: JSON.stringify({ method: "win.fullscreen", params: {} }) }); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target && e.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA") return;
    if (e.key === "Home") { e.preventDefault(); window.__couch && window.__couch.dispatch("ps", { kind: "long" }); return; }
    var b = KEYS[e.key]; if (!b) return;
    e.preventDefault();
    window.__couch && window.__couch.dispatch("pad", { button: b, repeat: e.repeat });
  }, true);
})();
