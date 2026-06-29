/**
 * app.js — TextAlive App API コントローラー
 * TextAlive Player を初期化し、再生・歌詞・拍・サビ・声量イベントを
 * window.MusicBG 経由で他モジュール (stage3d.js / 歌詞 PV エンジン 等) へ配信する。
 */
(() => {
  "use strict";

  // ── 定数 / 設定 ───────────────────────────────────────────
  const APP_TOKEN = "473zGS4UYYBAd2OR";
  const DEFAULT_SONG_URL = "https://piapro.jp/t/E2i3/20251215092113";
  const PLAYER_VOLUME = 80;
  const MEDIA_VOLUME = 0.8;
  const REQUIRES_HTTP = window.location.protocol === "file:";
  const HTTP_REQUIRED_MESSAGE = "HTTPサーバ経由で開いてください";
  const START_LABEL = {
    loading: "LOADING...",
    ready: "TOUCH TO START",
    retry: "TOUCH AGAIN TO START",
  };
  const LOAD_ERROR_LABEL = {
    textAliveApi: "TEXTALIVE API LOAD ERROR",
    song: "SONG LOAD FAILED",
    stage: "3D LOAD FAILED",
  };

  // ── セクション構成 (①〜⑤) ──
  // amelo=SIGNAL LOST / bmelo=SYSTEM SCAN / chorus=TAKEOVER /
  // interlude=SIGNAL EXPANSION / finale=SIGNAL ACQUIRED
  const SECTION_NAMES = {
    intro: "SIGNAL LOST",
    amelo: "SIGNAL LOST",
    bmelo: "SYSTEM SCAN",
    chorus: "TAKEOVER",
    interlude: "SIGNAL EXPANSION",
    finale: "SIGNAL ACQUIRED",
  };
  const SECTION_INDEX = { intro: 1, amelo: 1, bmelo: 2, chorus: 3, interlude: 4, finale: 5 };
  const BMELO_WINDOW_MS = 12000; // サビ直前のこの時間を Bメロ(SYSTEM SCAN)扱い
  const SECTION_DEBOUNCE_MS = 350; // 短い歌の切れ目で section がチラつくのを防ぐ
  const INTERLUDE_DEBOUNCE_MS = 1800; // フレーズ間の短い無音を間奏と誤判定しない猶予

  // ── DOM 参照 ──────────────────────────────────────────────
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    beat: $("#beat"),
    chord: $("#chord"),
    chorus: $("#chorus"),
    phraseCount: $("#phraseCount"),
    wordCount: $("#wordCount"),
    charCount: $("#charCount"),
    events: $("#events"),
    media: $("#media"),
  };

  const startScreen = document.getElementById("start-screen");
  const startCta = document.getElementById("startCta");
  const blackout = document.getElementById("blackout");
  const replayScreen = document.getElementById("replay-screen");
  const replayBtn = document.getElementById("replayBtn");
  let replayTimer = null;
  let blackoutTimer = null;
  let ahaEndTime = -1;    // onVideoReady で最後の「Aha」endTime を設定、再生中トリガー後に -1 にリセット
  let lastAhaEndTime = -1; // 曲データから求めた固定値（stop → play 時の復元用）

  // ── 共有状態バス (window.MusicBG) ────────────────────────────
  // 他モジュールはこのオブジェクトを読み取って再生状態・歌詞情報を取得する
  const state = window.MusicBG || (window.MusicBG = {});
  state.beatProgress = 0;
  state.beatIndex = -1;
  state.isChorus = false;
  state.isPlaying = false;
  state.phraseIndex = 0;
  state.phrase = state.phrase || { index: 0, text: "", startTime: -1, endTime: -1, progress: 0 };
  state.lyric = state.lyric || { active: false, progress: 0, wordStart: -1, charStart: -1, vocal: 0 };
  state.section = state.section || { id: "intro", name: "SIGNAL LOST", index: 1, progress: 0 };

  if (!window.TextAliveApp) {
    setStatus("TextAlive App API could not be loaded.", "error");
    return;
  }

  const { Player } = window.TextAliveApp;
  // ── TextAlive Player と内部状態 ──────────────────────────────
  let player = createPlayer();
  let duration = 0;
  let maxVocalAmplitude = 0;
  let lastPhraseStartTime = -1;
  let lastWordStartTime = -1;
  let lastCharStartTime = -1;
  // TextAlive は準備中にも play/pause を発火するため、ユーザー操作由来かを分けて扱う。
  const playbackState = {
    waitingForReady: false,
    timerReady: false,
    userRequested: false,
    active: false,
    reachedEnd: false,
    endSequenceActive: false,
    verifyTimer: null,
  };
  const startupLoad = {
    songReady: false,
    timerReady: false,
    stageReady: !!window.ModelStage?.isReady?.(),
    failed: false,
  };
  let choruses = [];
  let firstPhraseTime = -1;
  let committedSectionId = "intro";
  let pendingSectionId = "intro";
  let pendingSectionSince = 0;

  // ── 初期化 ────────────────────────────────────────────────
  bindStartScreen();
  bindReplay();
  bindStageLoadEvents();
  initStartStars();
  initReplayStars();

  // ── Player / スタート・リプレイ画面 ──────────────────────────
  function createPlayer() {
    const nextPlayer = new Player({
      app: {
        token: APP_TOKEN,
        appName: "TAKEOVER Camera Stage",
        appAuthor: "Takumin",
      },
      mediaElement: elements.media,
      throttleInterval: 80,
    });

    nextPlayer.addListener({
      onAppReady,
      onAppMediaChange,
      onVideoReady,
      onTimerReady,
      onPlay,
      onPause,
      onStop,
      onTimeUpdate,
    });

    return nextPlayer;
  }

  function bindStartScreen() {
    if (!startScreen) return;

    const activate = () => {
      requestStartFromUserGesture();
    };

    startScreen.addEventListener("click", activate);
    startScreen.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") activate();
    });
  }

  function bindReplay() {
    if (!replayBtn || !replayScreen) return;
    replayBtn.addEventListener("click", () => {
      location.reload();
    });
  }

  function bindStageLoadEvents() {
    if (window.ModelStage?.isReady?.()) {
      startupLoad.stageReady = true;
    }
    if (window.ModelStage?.getLoadError?.()) {
      markStartupFailed(LOAD_ERROR_LABEL.stage);
    }

    window.addEventListener("modelstage:ready", () => {
      startupLoad.stageReady = true;
      updateStartCtaForLoadState();
    });
    window.addEventListener("modelstage:error", () => {
      markStartupFailed(LOAD_ERROR_LABEL.stage);
    });

    updateStartCtaForLoadState();
  }

  function drawStarsToCanvas(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const r = Math.random() * 1.3 + 0.2;
      const opacity = Math.random() * 0.65 + 0.3;
      const cyan = Math.random() < 0.28;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = cyan ? `rgba(57,197,187,${opacity})` : `rgba(255,255,255,${opacity})`;
      ctx.fill();
    }
    const glow = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, W * 0.44);
    glow.addColorStop(0, "rgba(57,197,187,0.10)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  function initStartStars() {
    drawStarsToCanvas(document.getElementById("start-stars"));
  }

  function initReplayStars() {
    drawStarsToCanvas(document.getElementById("replay-stars"));
  }

  function dismissStartScreen() {
    if (!startScreen) return;
    startScreen.classList.add("is-dismissed");
    window.setTimeout(() => { startScreen.hidden = true; }, 750);
  }

  function requestStartFromUserGesture() {
    if (!isPlaybackReady()) {
      playbackState.waitingForReady = true;
      setStatus("Loading TextAlive song data");
      return;
    }

    startPlaybackFromUserGesture();
  }

  function isPlaybackReady() {
    return !!player.video && areStartupAssetsReady();
  }

  function startPlaybackFromUserGesture() {
    playbackState.waitingForReady = false;
    playbackState.userRequested = true;
    applyVolume();

    const media = currentMedia();
    const startTime = media ? media.currentTime : 0;

    try {
      player.requestPlay();
    } catch (error) {
      addEvent(`requestPlay failed: ${error && error.message ? error.message : String(error)}`);
    }

    requestMediaPlay(media);

    verifyPlaybackStarted(startTime);
  }

  function requestMediaPlay(media) {
    if (!media) return;

    const playPromise = media.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        addEvent(`media play failed: ${error && error.message ? error.message : String(error)}`);
        promptStartAgain();
      });
    }
  }

  // ── TextAlive イベントハンドラ ────────────────────────────────
  function onAppReady(app) {
    const mode = app.managed ? "Connected to TextAlive host" : "Standalone mode";
    setStatus(mode, "ready");
    addEvent(`app ready: ${mode}`);
    applyVolume();

    if (REQUIRES_HTTP) {
      markStartupFailed(HTTP_REQUIRED_MESSAGE);
      addEvent("file origin blocked");
      return;
    }

    if (!app.songUrl && !app.managed) {
      loadSong(DEFAULT_SONG_URL);
    }
  }

  function onAppMediaChange(mediaUrl) {
    if (!mediaUrl) return;
    addEvent("media changed");
    resetSongState();
  }

  function loadSong(songUrl) {
    if (!songUrl) {
      markStartupFailed("SONG URL MISSING");
      return;
    }

    setStatus("Loading TextAlive song data");
    resetSongState();

    player.createFromSongUrl(songUrl).catch((error) => {
      const message = error && error.message ? error.message : String(error);
      markStartupFailed(LOAD_ERROR_LABEL.song);
      addEvent(message);
    });
  }

  function onVideoReady(video) {
    startupLoad.songReady = true;
    duration = Math.max(0, Math.ceil(video.duration || video.endTime || 0));
    applyVolume();
    elements.phraseCount.textContent = `phrases ${video.phraseCount || 0}`;
    elements.wordCount.textContent = `words ${video.wordCount || 0}`;
    elements.charCount.textContent = `chars ${video.charCount || 0}`;

    assignAnimation(video.firstPhrase, animatePhrase);
    assignAnimation(video.firstWord, animateWord);
    assignAnimation(video.firstChar, animateChar);

    maxVocalAmplitude = safe(() => player.getMaxVocalAmplitude()) || 0;
    choruses = (safe(() => player.getChoruses()) || []).slice().sort((a, b) => a.startTime - b.startTime);
    firstPhraseTime = video.firstPhrase ? video.firstPhrase.startTime : -1;

    // 最後のサビ以降で「Aha」にマッチするフレーズの endTime を固定記録
    const lastChorus = choruses.length ? choruses[choruses.length - 1] : null;
    let p = video.firstPhrase;
    lastAhaEndTime = -1;
    while (p) {
      if (/aha/i.test(p.text || "") && (!lastChorus || p.startTime >= lastChorus.startTime)) {
        lastAhaEndTime = p.endTime;
      }
      p = p.next;
    }
    ahaEndTime = lastAhaEndTime;

    updateStartCtaForLoadState();
    addEvent("video ready");
  }

  function onTimerReady() {
    playbackState.timerReady = true;
    startupLoad.timerReady = true;
    applyVolume();
    if (playbackState.waitingForReady && areStartupAssetsReady()) {
      playbackState.waitingForReady = false;
      promptStartAgain();
    } else {
      updateStartCtaForLoadState();
    }
    addEvent("timer ready");
  }

  function onPlay() {
    applyVolume();
    if (ignoreInternalPlaybackEvent("play")) {
      return;
    }
    playbackState.active = true;
    playbackState.reachedEnd = false;
    playbackState.endSequenceActive = false;
    state.isPlaying = true;
    addEvent("play");
    clearTimeout(blackoutTimer);
    clearTimeout(replayTimer);
    if (blackout) blackout.hidden = true;
    if (replayScreen) replayScreen.hidden = true;
    dismissStartScreen();
  }

  function onPause() {
    if (ignoreInternalPlaybackEvent("pause")) {
      return;
    }
    const shouldShowReplay = playbackState.active && playbackState.reachedEnd;
    state.isPlaying = false;
    if (!shouldShowReplay) setStatus("Paused", "info");
    addEvent("pause");
    // TextAlive は曲の自然終了時に onStop ではなく onPause を呼ぶ場合がある
    if (shouldShowReplay) {
      playbackState.endSequenceActive = true;
      scheduleReplaySequence();
    }
  }

  function onStop() {
    if (!playbackState.active && !playbackState.userRequested) {
      addEvent("internal stop ignored");
      return;
    }
    const nearEnd = duration > 0 && state.position >= duration * 0.88;
    const shouldShowReplay = playbackState.active && (playbackState.reachedEnd || nearEnd);
    playbackState.active = false;
    playbackState.userRequested = false;
    playbackState.reachedEnd = false;
    state.isPlaying = false;
    if (!shouldShowReplay) setStatus("Stopped", "info");
    addEvent("stop");
    window.Lyrics3D?.onEnd?.();
    updatePosition(0);
    resetLiveState();

    // onPause でリプレイシーケンス開始済みの場合はタイマーを維持する
    const wasEndSequenceActive = playbackState.endSequenceActive;
    playbackState.endSequenceActive = false;
    if (!wasEndSequenceActive) {
      clearTimeout(blackoutTimer);
      clearTimeout(replayTimer);
    }
    if (shouldShowReplay && !wasEndSequenceActive) {
      scheduleReplaySequence();
    }
  }

  function onTimeUpdate(position) {
    state.position = position;
    if (duration > 0 && position >= duration - 2000) {
      playbackState.reachedEnd = true;
    }
    if (ahaEndTime > 0 && position >= ahaEndTime) {
      window.ModelStage?.startOutroFade?.();
      ahaEndTime = -1;
    }
    updatePosition(position);
    updateBeat(position);
    updateHarmony(position);
    updateLyricState(position);
    updateSection(position);
  }

  // ── セクション推定 ────────────────────────────────────────────
  // 再生位置とサビ/歌詞状態から ①〜⑤ のセクションを推定して配信する
  function updateSection(position) {
    const rawId = rawSectionId(position);
    const nowMs = performance.now();

    if (rawId !== pendingSectionId) {
      pendingSectionId = rawId;
      pendingSectionSince = nowMs;
    }

    // サビ/フィナーレ突入は即時、それ以外はチラつき防止で少し待つ
    const immediate = rawId === "chorus" || rawId === "finale" || committedSectionId === "chorus";
    const threshold = rawId === "interlude" ? INTERLUDE_DEBOUNCE_MS : SECTION_DEBOUNCE_MS;
    const stable = nowMs - pendingSectionSince >= threshold;

    if (rawId !== committedSectionId && (immediate || stable)) {
      committedSectionId = rawId;
      applySection(rawId, position);
    }

    const inChorus = safe(() => player.findChorus(position));
    state.section.progress = inChorus ? clamp01(inChorus.progress(position)) : 0;
  }

  function rawSectionId(position) {
    const inChorus = safe(() => player.findChorus(position));
    const last = choruses.length ? choruses[choruses.length - 1] : null;

    if (inChorus) {
      return last && inChorus.startTime >= last.startTime ? "finale" : "chorus";
    }
    if (last && position > last.endTime) {
      return "finale"; // 最終サビ後の余韻
    }
    if (state.lyric.active) {
      const next = choruses.find((c) => c.startTime > position);
      const timeToChorus = next ? next.startTime - position : Infinity;
      return timeToChorus <= BMELO_WINDOW_MS ? "bmelo" : "amelo";
    }
    // 歌なし区間: イントロは SIGNAL LOST、それ以外は間奏
    if (firstPhraseTime >= 0 && position < firstPhraseTime) return "amelo";
    return "interlude";
  }

  function applySection(id, position) {
    state.section = {
      id,
      name: SECTION_NAMES[id] || id,
      index: SECTION_INDEX[id] || 0,
      progress: state.section.progress || 0,
    };
    addEvent(`section: ${state.section.index} ${state.section.name}`);
    window.ModelStage?.onSection?.(state.section, position);
    window.TextPV?.onSection?.(state.section, position);
  }

  // ── 歌詞状態 / アニメーション割り当て ────────────────────────
  function updateLyricState(position) {
    const video = player.video;
    const lyric = state.lyric;
    const phrase = video ? safe(() => video.findPhrase(position)) : null;
    const word = video ? safe(() => video.findWord(position)) : null;
    const char = video ? safe(() => video.findChar(position)) : null;

    lyric.active = !!phrase;
    lyric.progress = phrase ? clamp01(phrase.progress(position)) : 0;
    lyric.wordStart = word ? word.startTime : -1;
    lyric.charStart = char ? char.startTime : -1;

    if (maxVocalAmplitude > 0) {
      const amp = safe(() => player.getVocalAmplitude(position));
      lyric.vocal = clamp01((amp || 0) / maxVocalAmplitude);
    } else {
      lyric.vocal = lyric.active ? 0.55 : 0;
    }

    if (phrase) {
      state.phrase.progress = lyric.progress;
      document.documentElement.style.setProperty("--phrase-progress", lyric.progress.toFixed(3));
      registerPhrase(phrase, position);
      registerWord(word, position);
      registerChar(char, position);
    } else {
      state.phrase.progress = 0;
      document.documentElement.style.setProperty("--phrase-progress", "0");
    }
  }

  function animatePhrase(now, unit) {
    if (!unit.contains(now)) return;
    const progress = clamp01(unit.progress(now));
    state.phrase.progress = progress;
    document.documentElement.style.setProperty("--phrase-progress", progress.toFixed(3));
    registerPhrase(unit, now);
  }

  function animateWord(now, unit) {
    registerWord(unit, now);
  }

  function animateChar(now, unit) {
    registerChar(unit, now);
  }

  function registerPhrase(unit, now) {
    if (!unit || unit.startTime === lastPhraseStartTime) return;

    lastPhraseStartTime = unit.startTime;
    state.phraseIndex = (state.phraseIndex || 0) + 1;
    state.phrase = {
      index: state.phraseIndex,
      text: unit.text || "",
      startTime: unit.startTime,
      endTime: unit.endTime,
      progress: clamp01(unit.progress(now)),
    };

    window.ModelStage?.onPhrase?.(state.phrase, now);
    window.Lyrics3D?.onPhrase?.(unit, now);
    window.TextPV?.onPhrase?.(
      { ...state.phrase, isChorus: state.isChorus, words: collectWords(unit) },
      now,
    );

  }

  // フレーズを構成する単語テキストを順に取り出す (キーワード強調用)
  function collectWords(phrase) {
    const words = [];
    let word = safe(() => phrase.firstWord);
    const last = safe(() => phrase.lastWord);
    let guard = 0;
    while (word && guard < 64) {
      words.push(String(word.text || ""));
      if (word === last) break;
      word = word.next;
      guard += 1;
    }
    return words;
  }

  function registerWord(unit, now) {
    if (!unit || !unit.contains(now) || unit.startTime === lastWordStartTime) return;

    lastWordStartTime = unit.startTime;
    window.TextPV?.onWord?.(
      {
        text: unit.text || "",
        startTime: unit.startTime,
        endTime: unit.endTime,
        phraseIndex: state.phrase?.index || 0,
        phraseText: state.phrase?.text || "",
        progress: typeof unit.progress === "function" ? clamp01(unit.progress(now)) : 0,
      },
      now,
    );
  }

  function registerChar(unit, now) {
    if (!unit || !unit.contains(now) || unit.startTime === lastCharStartTime) return;

    lastCharStartTime = unit.startTime;
    window.TextPV?.onChar?.(
      {
        text: unit.text || "",
        startTime: unit.startTime,
        endTime: unit.endTime,
        phraseIndex: state.phrase?.index || 0,
        phraseText: state.phrase?.text || "",
        progress: typeof unit.progress === "function" ? clamp01(unit.progress(now)) : 0,
      },
      now,
    );
  }

  function assignAnimation(unit, handler) {
    let current = unit;
    while (current) {
      current.animate = handler;
      current = current.next;
    }
  }

  function updatePosition(position) {
    state.position = Math.max(0, Number(position) || 0);
  }

  function updateBeat(position) {
    const beat = safe(() => player.findBeat(position));
    if (!beat) {
      state.beatIndex = -1;
      state.beatProgress = 0;
      elements.beat.textContent = "-";
      document.documentElement.style.setProperty("--beat-progress", "0");
      return;
    }

    const progress = clamp01(beat.progress(position));
    state.beatIndex = beat.index;
    state.beatProgress = progress;
    elements.beat.textContent = `#${beat.index} ${Math.round(progress * 100)}%`;
    document.documentElement.style.setProperty("--beat-progress", progress.toFixed(3));
  }

  function updateHarmony(position) {
    const chord = safe(() => player.findChord(position));
    const chorus = safe(() => player.findChorus(position));
    state.isChorus = !!chorus;
    elements.chord.textContent = chord && chord.name ? chord.name : "-";
    elements.chorus.textContent = chorus ? `${Math.round(chorus.progress(position) * 100)}%` : "-";
  }

  function resetSongState() {
    duration = 0;
    maxVocalAmplitude = 0;
    lastPhraseStartTime = -1;
    lastWordStartTime = -1;
    lastCharStartTime = -1;
    startupLoad.songReady = false;
    startupLoad.timerReady = false;
    resetPlaybackState();
    elements.phraseCount.textContent = "phrases -";
    elements.wordCount.textContent = "words -";
    elements.charCount.textContent = "chars -";
    document.documentElement.style.setProperty("--beat-progress", "0");
    document.documentElement.style.setProperty("--phrase-progress", "0");
    resetLiveState();
  }

  function resetLiveState() {
    lastPhraseStartTime = -1;
    lastWordStartTime = -1;
    lastCharStartTime = -1;
    state.beatProgress = 0;
    state.beatIndex = -1;
    state.isChorus = false;
    playbackState.userRequested = false;
    state.phraseIndex = 0;
    state.phrase = { index: 0, text: "", startTime: -1, endTime: -1, progress: 0 };
    state.lyric.active = false;
    state.lyric.progress = 0;
    state.lyric.wordStart = -1;
    state.lyric.charStart = -1;
    state.lyric.vocal = 0;
    state.section = { id: "intro", name: "SIGNAL LOST", index: 1, progress: 0 };
    committedSectionId = "intro";
    pendingSectionId = "intro";
    pendingSectionSince = 0;
    ahaEndTime = lastAhaEndTime; // 曲データから求めた固定値を復元（stop→play 対応）
    window.ModelStage?.reset?.();
    window.TextPV?.reset?.();
  }

  // ── UI / ユーティリティ ───────────────────────────────────────
  function setStatus(message, variant = "info", _options = {}) {
    if (!startCta) return;

    if (variant === "error") {
      markStartupFailed(message);
      return;
    }

    if (/loading/i.test(message)) {
      setStartCta(START_LABEL.loading, "loading");
      return;
    }

    if (variant === "ready" && /song ready|playback ready/i.test(message)) {
      updateStartCtaForLoadState();
    }
  }

  function updateStartCtaForLoadState() {
    if (startupLoad.failed || !startCta) return;

    if (!areStartupAssetsReady()) {
      setStartCta(START_LABEL.loading, "loading");
      return;
    }

    setStartCta(playbackState.waitingForReady ? START_LABEL.retry : START_LABEL.ready, "ready");
  }

  function areStartupAssetsReady() {
    return startupLoad.songReady && startupLoad.timerReady && startupLoad.stageReady;
  }

  function markStartupFailed(message) {
    startupLoad.failed = true;
    setStartCta(message, "error");
  }

  function setStartCta(message, stateName = "") {
    if (!startCta) return;
    startCta.textContent = message;
    startCta.classList.toggle("is-loading", stateName === "loading");
    startCta.classList.toggle("is-error", stateName === "error");
    startCta.classList.toggle("is-ready", stateName === "ready");
  }

  function applyVolume() {
    player.volume = PLAYER_VOLUME;
    const media = currentMedia();
    if (media) {
      media.muted = false;
      media.volume = MEDIA_VOLUME;
    }
  }

  function currentMedia() {
    return elements.media?.querySelector?.("audio, video") || null;
  }

  function showStartScreen() {
    if (!startScreen) return;
    startScreen.hidden = false;
    startScreen.classList.remove("is-dismissed");
  }

  function promptStartAgain() {
    showStartScreen();
    setStartCta(START_LABEL.retry, "ready");
  }

  function ignoreInternalPlaybackEvent(eventName) {
    const shouldIgnore = !playbackState.userRequested || (!playbackState.active && eventName !== "play");
    if (shouldIgnore) {
      addEvent(`internal ${eventName} ignored`);
    }
    return shouldIgnore;
  }

  function verifyPlaybackStarted(startTime) {
    clearTimeout(playbackState.verifyTimer);
    playbackState.verifyTimer = window.setTimeout(() => {
      const media = currentMedia();
      const advanced = media && !media.paused && media.currentTime > startTime + 0.25;
      if (advanced) return;

      state.isPlaying = false;
      promptStartAgain();
      addEvent("playback did not advance");
    }, 1600);
  }

  function resetPlaybackState() {
    clearTimeout(playbackState.verifyTimer);
    playbackState.waitingForReady = false;
    playbackState.timerReady = false;
    playbackState.userRequested = false;
    playbackState.active = false;
    playbackState.reachedEnd = false;
    playbackState.endSequenceActive = false;
    playbackState.verifyTimer = null;
  }

  function scheduleReplaySequence() {
    clearTimeout(blackoutTimer);
    clearTimeout(replayTimer);
    blackoutTimer = window.setTimeout(() => showAnimatedOverlay(blackout), 1000);
    replayTimer = window.setTimeout(() => showAnimatedOverlay(replayScreen), 2500);
  }

  function showAnimatedOverlay(element) {
    if (!element) return;
    element.style.animation = "none";
    void element.offsetWidth;
    element.style.animation = "";
    element.hidden = false;
  }

  function addEvent(message) {
    if (!elements.events) return;
    const item = document.createElement("li");
    item.textContent = `${new Date().toLocaleTimeString("ja-JP")} ${message}`;
    elements.events.prepend(item);
    while (elements.events.children.length > 10) {
      elements.events.removeChild(elements.events.lastElementChild);
    }
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function safe(fn) {
    try {
      return fn();
    } catch (_error) {
      return null;
    }
  }
})();
