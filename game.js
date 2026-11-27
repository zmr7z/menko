(() => {
  const stageEl = document.getElementById("stage-label");
  const foeNameEl = document.getElementById("foe-name");
  const hintEl = document.getElementById("hint");
  const subEl = document.getElementById("subhint");
  const needEl = document.getElementById("need-label");
  const meter = document.getElementById("meter-fill");
  const arena = document.getElementById("arena");
  const cardYou = document.getElementById("card-you");
  const cardFoe = document.getElementById("card-foe");
  const foeLabel = document.getElementById("foe-label");
  const rock = document.getElementById("rock");
  const result = document.getElementById("result");
  const resultTitle = document.getElementById("result-title");
  const resultDetail = document.getElementById("result-detail");
  const resultEyebrow = document.getElementById("result-eyebrow");
  const powerReadout = document.getElementById("power-readout");
  const btnStart = document.getElementById("btn-start");
  const btnNext = document.getElementById("btn-next");
  const btnShare = document.getElementById("btn-share");
  const btnRetry = document.getElementById("btn-retry");
  const btnPerm = document.getElementById("btn-perm");
  const tabPhone = document.getElementById("tab-phone");
  const tabPc = document.getElementById("tab-pc");

  const WINDOW_MS = 1400;
  const COUNTDOWN = 3;
  const PLAY_URL = "https://zmr7z.github.io/menko/";

  /** Stages 1..5 then rock challenge */
  const STAGES = [
    { id: 1, name: "練習めんこ", need: 16, kind: "card", cls: "" },
    { id: 2, name: "路地の強敵", need: 26, kind: "card", cls: "mid" },
    { id: 3, name: "商店街ボス", need: 36, kind: "card", cls: "mid" },
    { id: 4, name: "祭りの親方", need: 48, kind: "card", cls: "boss" },
    { id: 5, name: "伝説の札", need: 58, kind: "card", cls: "boss" },
    { id: 6, name: "最後の岩", need: 999, kind: "rock", cls: "" }, // need unused; always score post
  ];

  let mode = "pc";
  let stageIndex = 0;
  let phase = "idle"; // idle | countdown | measure | resolve
  let samples = [];
  let raf = 0;
  let measureUntil = 0;
  let motionHandler = null;
  let lastMouse = null;
  let mouseActive = false;
  let lastShareText = "";
  let lastOutcome = null; // clear | gameover | rock
  let lastPower = 0;

  function preferPhone() {
    return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;
  }

  function current() {
    return STAGES[stageIndex];
  }

  function isRock() {
    return current().kind === "rock";
  }

  /** PC mouse scores a bit higher raw, mild bump only */
  function effectiveNeed(stage = current()) {
    if (stage.kind === "rock") return stage.need;
    return mode === "pc" ? Math.round(stage.need * 1.08) : stage.need;
  }

  function refreshStageUI() {
    const s = current();
    foeNameEl.textContent = s.name;
    if (isRock()) {
      stageEl.textContent = "岩チャレンジ";
      needEl.textContent = "計測";
      cardFoe.classList.add("hidden");
      cardFoe.style.visibility = "hidden";
      rock.classList.remove("hidden");
      rock.classList.remove("cracked", "shake");
      rock.setAttribute("aria-hidden", "false");
    } else {
      stageEl.textContent = `STAGE ${s.id} / 5`;
      needEl.textContent = `必要 ${effectiveNeed(s)}+`;
      cardFoe.style.visibility = "visible";
      cardFoe.classList.remove("hidden", "mid", "boss", "flipped", "hit");
      if (s.cls) cardFoe.classList.add(s.cls);
      foeLabel.textContent = s.name.length > 2 ? s.name.slice(0, 2) : s.name;
      rock.classList.add("hidden");
      rock.setAttribute("aria-hidden", "true");
    }
    cardYou.classList.remove("flipped", "slam");
  }

  function setMode(next, manual = false) {
    mode = next;
    tabPhone.setAttribute("aria-selected", mode === "phone" ? "true" : "false");
    tabPc.setAttribute("aria-selected", mode === "pc" ? "true" : "false");
    btnPerm.hidden = mode !== "phone";
    if (phase === "idle") {
      hintEl.textContent = mode === "phone" ? "スタート後、端末を振れ" : "スタート後、押しながら振り回せ";
      subEl.textContent = manual ? "手動切替 · 失敗1回でアウト" : "失敗1回でアウト";
      refreshStageUI();
    }
  }

  function setMeter(v) {
    meter.style.width = Math.max(0, Math.min(100, v)) + "%";
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
    const dist = Math.hypot(e.clientX - lastMouse.x, e.clientY - lastMouse.y);
    // Ignore tiny jitter; cap insane single-frame spikes
    if (dist < 4) {
      lastMouse = { x: e.clientX, y: e.clientY, t: now };
      return;
    }
    const speed = Math.min(4500, dist / dt);
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
    samples.push(Math.max(0, mag - 10.2) * 90);
  }

  function tickMeter() {
    if (phase !== "measure") return;
    // Mild idle decay on PC (short pause OK)
    if (mode === "pc" && (!mouseActive || (lastMouse && performance.now() - lastMouse.t > 200))) {
      samples.push(0);
    }
    const score = livePower();
    setMeter(score);
    if (performance.now() < measureUntil) raf = requestAnimationFrame(tickMeter);
  }

  function livePower() {
    if (mode === "phone") {
      const recent = samples.slice(-18);
      const avg = recent.length ? recent.reduce((s, n) => s + n, 0) / recent.length : 0;
      return Math.min(100, avg);
    }
    // PC: sustained whip still helps, but short bursts count more
    const recent = samples.slice(-32);
    if (!recent.length) return 0;
    const avg = recent.reduce((s, n) => s + n, 0) / recent.length;
    const nonzero = recent.filter((n) => n > 0).length / recent.length;
    return Math.min(100, (avg / 28) * (0.72 + 0.28 * nonzero));
  }

  function calcPower() {
    return livePower();
  }

  async function ensureMotionPermission() {
    if (typeof DeviceMotionEvent === "undefined") {
      throw new Error("モーション非対応。PCタブを使ってください");
    }
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") throw new Error("センサー許可が必要です");
    }
  }

  function shareToX() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(lastShareText)}`;
    window.open(url, "_blank", "noopener");
  }

  function showResult({ eyebrow, title, color, detail, shareText, outcome, power }) {
    lastOutcome = outcome;
    lastPower = power || 0;
    lastShareText = shareText;
    resultEyebrow.textContent = eyebrow;
    resultTitle.textContent = title;
    resultTitle.style.color = color;
    resultDetail.textContent = detail;
    if (outcome === "rock") {
      powerReadout.classList.remove("hidden");
      powerReadout.textContent = `岩への威力スコア ${Math.round(power)}`;
    } else {
      powerReadout.classList.add("hidden");
    }

    if (outcome === "clear") {
      btnNext.textContent = stageIndex >= STAGES.length - 2 ? "岩チャレンジへ" : "次のステージ";
      btnNext.hidden = false;
      btnRetry.hidden = true;
    } else if (outcome === "rock") {
      btnNext.textContent = "もう一回岩";
      btnNext.hidden = false;
      btnRetry.hidden = false;
      btnRetry.textContent = "STAGE1から";
    } else {
      // gameover
      btnNext.hidden = true;
      btnRetry.hidden = false;
      btnRetry.textContent = "はじめから";
    }
    result.classList.remove("hidden");
  }

  function startRun() {
    stageIndex = 0;
    result.classList.add("hidden");
    refreshStageUI();
    startRound();
  }

  function startRound() {
    if (phase !== "idle") return;
    result.classList.add("hidden");
    refreshStageUI();
    samples = [];
    setMeter(0);
    phase = "countdown";
    btnStart.disabled = true;
    let left = COUNTDOWN;
    hintEl.textContent = String(left);
    subEl.textContent = isRock()
      ? "計測のみ · 振り続けろ"
      : `${current().name} · 必要 ${effectiveNeed()}+`;

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
    const youPower = calcPower();
    setMeter(youPower);
    cardYou.classList.add("slam");

    setTimeout(() => {
      if (isRock()) {
        rock.classList.add("shake");
        if (youPower >= 80) rock.classList.add("cracked");
        const share = [
          `めんこ・オブ・シェイク 岩チャレンジ`,
          `威力スコア ${Math.round(youPower)}`,
          `ボスまで突破したあとの計測`,
          PLAY_URL,
          `#めんこオブシェイク #ludofolio`,
        ].join("\n");
        showResult({
          eyebrow: "岩チャレンジ",
          title: youPower >= 80 ? "岩がひび割れた！" : "計測完了",
          color: "var(--you)",
          detail: "岩はひっくり返せなくてもOK。この数値を自慢しよう。",
          shareText: share,
          outcome: "rock",
          power: youPower,
        });
        phase = "idle";
        btnStart.disabled = false;
        return;
      }

      cardFoe.classList.add("hit");
      const need = effectiveNeed();
      const win = youPower >= need;
      if (win) {
        cardFoe.classList.add("flipped");
        const cleared = current().id;
        const more = stageIndex < STAGES.length - 2;
        const share = [
          `めんこ・オブ・シェイク STAGE ${cleared}「${current().name}」クリア！`,
          `勢い ${Math.round(youPower)} / 必要 ${need}`,
          more ? `次は STAGE ${cleared + 1}` : `全ボス突破。次は岩チャレンジ`,
          PLAY_URL,
          `#めんこオブシェイク #ludofolio`,
        ].join("\n");
        showResult({
          eyebrow: `STAGE ${cleared} クリア`,
          title: "ひっくり返し成功",
          color: "var(--ok)",
          detail: `勢い ${Math.round(youPower)} が必要 ${need} を超えた。`,
          shareText: share,
          outcome: "clear",
          power: youPower,
        });
      } else {
        cardYou.classList.add("flipped");
        const share = [
          `めんこ・オブ・シェイク GAME OVER`,
          `STAGE ${current().id}「${current().name}」で失敗`,
          `勢い ${Math.round(youPower)} / 必要 ${need}`,
          PLAY_URL,
          `#めんこオブシェイク #ludofolio`,
        ].join("\n");
        showResult({
          eyebrow: "ゲームオーバー",
          title: "ひっくり返せなかった",
          color: "var(--danger)",
          detail: `勢い ${Math.round(youPower)}（必要 ${need}+）。1回失敗で終了。`,
          shareText: share,
          outcome: "gameover",
          power: youPower,
        });
      }
      phase = "idle";
      btnStart.disabled = false;
      hintEl.textContent = win ? "クリア！" : "ゲームオーバー";
      subEl.textContent = "";
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
      if (stageIndex === 0 && lastOutcome == null) {
        startRound();
      } else if (!result.classList.contains("hidden")) {
        // ignore
      } else {
        startRound();
      }
    } catch (err) {
      hintEl.textContent = err.message || "センサーを使えません";
      subEl.textContent = "PCタブか、許可し直してください";
      btnPerm.hidden = false;
    }
  });

  btnPerm.addEventListener("click", async () => {
    try {
      await ensureMotionPermission();
      hintEl.textContent = "センサー許可OK";
      subEl.textContent = "はじめるを押して";
    } catch (err) {
      hintEl.textContent = err.message || "許可に失敗";
    }
  });

  btnNext.addEventListener("click", () => {
    result.classList.add("hidden");
    if (lastOutcome === "clear") {
      stageIndex += 1;
      refreshStageUI();
      startRound();
    } else if (lastOutcome === "rock") {
      // retry rock only
      startRound();
    }
  });

  btnShare.addEventListener("click", shareToX);

  btnRetry.addEventListener("click", () => {
    result.classList.add("hidden");
    lastOutcome = null;
    stageIndex = 0;
    refreshStageUI();
    phase = "idle";
    btnStart.disabled = false;
    hintEl.textContent = "STAGE 1 からやり直し";
    subEl.textContent = "はじめるを押して";
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
    if ((e.code === "Enter" || e.code === "Space") && phase === "idle" && result.classList.contains("hidden") && !e.repeat) {
      e.preventDefault();
      btnStart.click();
    }
  });

  setMode(preferPhone() ? "phone" : "pc", false);
  refreshStageUI();
})();
