(() => {
  const winsEl = document.getElementById("wins");
  const lossesEl = document.getElementById("losses");
  const hintEl = document.getElementById("hint");
  const subEl = document.getElementById("subhint");
  const meter = document.getElementById("meter-fill");
  const arena = document.getElementById("arena");
  const cardYou = document.getElementById("card-you");
  const cardFoe = document.getElementById("card-foe");
  const result = document.getElementById("result");
  const resultTitle = document.getElementById("result-title");
  const resultDetail = document.getElementById("result-detail");
  const resultEyebrow = document.getElementById("result-eyebrow");
  const btnStart = document.getElementById("btn-start");
  const btnPerm = document.getElementById("btn-perm");
  const tabPhone = document.getElementById("tab-phone");
  const tabPc = document.getElementById("tab-pc");

  const WINDOW_MS = 1400;
  const COUNTDOWN = 3;

  let mode = "pc"; // phone | pc
  let wins = 0;
  let losses = 0;
  let phase = "idle"; // idle | countdown | measure | resolve
  let power = 0;
  let samples = [];
  let raf = 0;
  let measureUntil = 0;
  let motionHandler = null;
  let lastMouse = null;
  let mouseActive = false;

  function preferPhone() {
    return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
  }

  function setMode(next, manual = false) {
    mode = next;
    tabPhone.setAttribute("aria-selected", mode === "phone" ? "true" : "false");
    tabPc.setAttribute("aria-selected", mode === "pc" ? "true" : "false");
    btnPerm.hidden = mode !== "phone";
    if (phase === "idle") {
      hintEl.textContent = mode === "phone" ? "スタート後、スマホを振れ！" : "スタート後、アリーナ上でマウスを振り回せ！";
      subEl.textContent = manual
        ? "手動で切り替えました"
        : mode === "phone"
          ? "端末判定: スマホ向けを自動選択"
          : "端末判定: PC向けを自動選択";
    }
  }

  function setMeter(v) {
    const pct = Math.max(0, Math.min(100, v));
    meter.style.width = pct + "%";
  }

  function stopListeners() {
    mouseActive = false;
    lastMouse = null;
    arena.classList.remove("listening");
    if (motionHandler) {
      window.removeEventListener("devicemotion", motionHandler);
      motionHandler = null;
    }
    arena.removeEventListener("pointermove", onPointerMove);
    arena.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onPointerDown(e) {
    if (phase !== "measure" || mode !== "pc") return;
    mouseActive = true;
    lastMouse = { x: e.clientX, y: e.clientY, t: performance.now() };
    try {
      arena.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
  }

  function onPointerMove(e) {
    if (phase !== "measure" || mode !== "pc" || !mouseActive || !lastMouse) return;
    const now = performance.now();
    const dt = Math.max(0.008, (now - lastMouse.t) / 1000);
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    const speed = Math.hypot(dx, dy) / dt; // px/s
    samples.push(speed);
    lastMouse = { x: e.clientX, y: e.clientY, t: now };
  }

  function onPointerUp() {
    mouseActive = false;
    lastMouse = null;
  }

  function onMotion(e) {
    if (phase !== "measure" || mode !== "phone") return;
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    // Resting ~9.8; shake adds spikes
    const shake = Math.max(0, mag - 10.2);
    samples.push(shake * 90);
  }

  function tickMeter() {
    if (phase !== "measure") return;
    const recent = samples.slice(-18);
    const avg = recent.length ? recent.reduce((s, n) => s + n, 0) / recent.length : 0;
    // Normalize differently per mode
    const score = mode === "phone" ? avg : avg / 18;
    power = Math.min(100, score);
    setMeter(power);
    if (performance.now() < measureUntil) {
      raf = requestAnimationFrame(tickMeter);
    }
  }

  async function ensureMotionPermission() {
    if (typeof DeviceMotionEvent === "undefined") {
      throw new Error("このブラウザはモーション非対応です。PCタブを使ってください。");
    }
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") throw new Error("センサー許可が必要です");
    }
  }

  function resetCards() {
    cardYou.classList.remove("flipped", "slam");
    cardFoe.classList.remove("flipped", "hit");
  }

  function startRound() {
    if (phase !== "idle") return;
    result.classList.add("hidden");
    resetCards();
    power = 0;
    samples = [];
    setMeter(0);
    phase = "countdown";
    btnStart.disabled = true;
    let left = COUNTDOWN;
    hintEl.textContent = String(left);
    subEl.textContent = mode === "phone" ? "許可済みなら、合図で振れ" : "合図でアリーナをドラッグしまくれ";

    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        hintEl.textContent = String(left);
        return;
      }
      clearInterval(timer);
      beginMeasure();
    }, 700);
  }

  function beginMeasure() {
    phase = "measure";
    samples = [];
    power = 0;
    setMeter(0);
    measureUntil = performance.now() + WINDOW_MS;
    arena.classList.add("listening");
    hintEl.textContent = "今だ！";
    subEl.textContent = mode === "phone" ? "振り続けろ！" : "マウスを激しく動かせ！";

    if (mode === "phone") {
      motionHandler = onMotion;
      window.addEventListener("devicemotion", motionHandler);
    } else {
      arena.addEventListener("pointerdown", onPointerDown);
      arena.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    }
    tickMeter();
    setTimeout(finishMeasure, WINDOW_MS + 30);
  }

  function finishMeasure() {
    if (phase !== "measure") return;
    stopListeners();
    phase = "resolve";

    const recent = samples.slice(-24);
    const raw = recent.length ? recent.reduce((s, n) => s + n, 0) / recent.length : 0;
    const youPower = Math.min(100, mode === "phone" ? raw : raw / 16);
    // AI: random but beatable
    const foePower = 28 + Math.random() * 55;

    setMeter(youPower);
    hintEl.textContent = "めんこ！";
    subEl.textContent = `自分 ${youPower.toFixed(0)} / 相手 ${foePower.toFixed(0)}`;

    cardYou.classList.add("slam");
    setTimeout(() => {
      cardFoe.classList.add("hit");
      const win = youPower >= foePower;
      if (win) {
        cardFoe.classList.add("flipped");
        wins += 1;
        winsEl.textContent = String(wins);
        resultEyebrow.textContent = "めんこ成立";
        resultTitle.textContent = "勝ち";
        resultTitle.style.color = "var(--ok)";
        resultDetail.textContent = `勢い ${youPower.toFixed(0)} が相手 ${foePower.toFixed(0)} を上回った。`;
      } else {
        cardYou.classList.add("flipped");
        losses += 1;
        lossesEl.textContent = String(losses);
        resultEyebrow.textContent = "弾かれた…";
        resultTitle.textContent = "負け";
        resultTitle.style.color = "var(--danger)";
        resultDetail.textContent = `勢い ${youPower.toFixed(0)} では相手 ${foePower.toFixed(0)} に負けた。`;
      }
      setTimeout(() => {
        result.classList.remove("hidden");
        phase = "idle";
        btnStart.disabled = false;
        hintEl.textContent = mode === "phone" ? "もう一回振る？" : "もう一回振り回す？";
        subEl.textContent = "";
      }, 520);
    }, 280);
  }

  tabPhone.addEventListener("click", () => {
    if (phase !== "idle") return;
    stopListeners();
    setMode("phone", true);
  });
  tabPc.addEventListener("click", () => {
    if (phase !== "idle") return;
    stopListeners();
    setMode("pc", true);
  });

  btnStart.addEventListener("click", async () => {
    try {
      if (mode === "phone") await ensureMotionPermission();
      startRound();
    } catch (err) {
      hintEl.textContent = err.message || "センサーを使えません";
      subEl.textContent = "PCタブに切り替えるか、許可し直してください";
      btnPerm.hidden = false;
    }
  });

  btnPerm.addEventListener("click", async () => {
    try {
      await ensureMotionPermission();
      subEl.textContent = "センサー許可OK。はじめるを押して";
      hintEl.textContent = "準備できた";
    } catch (err) {
      hintEl.textContent = err.message || "許可に失敗";
    }
  });

  document.getElementById("btn-again").addEventListener("click", () => {
    result.classList.add("hidden");
    startRound();
  });
  document.getElementById("btn-close").addEventListener("click", () => {
    result.classList.add("hidden");
    phase = "idle";
    btnStart.disabled = false;
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      result.classList.add("hidden");
      if (phase === "measure" || phase === "countdown") {
        stopListeners();
        phase = "idle";
        btnStart.disabled = false;
        hintEl.textContent = "やめた";
      }
    }
    if ((e.code === "Enter" || e.code === "Space") && phase === "idle" && !e.repeat) {
      e.preventDefault();
      btnStart.click();
    }
  });

  // Auto-select mode
  setMode(preferPhone() ? "phone" : "pc", false);
})();
