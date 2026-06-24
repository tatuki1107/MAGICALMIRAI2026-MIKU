(() => {
  "use strict";

  const APP_TOKEN = "473zGS4UYYBAd2OR";
  const DEFAULT_SONG_URL = "https://piapro.jp/t/E2i3/20251215092113";
  const REQUIRES_HTTP = window.location.protocol === "file:";
  const HTTP_REQUIRED_MESSAGE = "Open this project through http://localhost so TextAlive can fetch song data.";

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

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    status: $("#status"),
    songTitle: $("#songTitle"),
    artistName: $("#artistName"),
    position: $("#position"),
    duration: $("#duration"),
    beat: $("#beat"),
    chord: $("#chord"),
    chorus: $("#chorus"),
    phraseCount: $("#phraseCount"),
    wordCount: $("#wordCount"),
    charCount: $("#charCount"),
    beatBar: $("#beatBar"),
    events: $("#events"),
    controlPanel: $("#controlPanel"),
    play: $("#play"),
    pause: $("#pause"),
    stop: $("#stop"),
    rewind: $("#rewind"),
    jump: $("#jump"),
    seek: $("#seek"),
    media: $("#media"),
  };

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

  const { Player, Ease } = window.TextAliveApp;
  let player = createPlayer();
  let duration = 0;
  let maxVocalAmplitude = 0;
  let isSeeking = false;
  let lastPhraseStartTime = -1;
  let lastWordStartTime = -1;
  let lastCharStartTime = -1;
  let lastPlayRequestAt = -Infinity;
  let choruses = [];
  let firstPhraseTime = -1;
  let committedSectionId = "intro";
  let pendingSectionId = "intro";
  let pendingSectionSince = 0;

  bindControls();

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
      onThrottledTimeUpdate: updatePosition,
    });

    return nextPlayer;
  }

  function bindControls() {
    elements.play.addEventListener("pointerdown", requestPlayFromGesture);
    elements.play.addEventListener("click", requestPlayFromGesture);

    elements.pause.addEventListener("click", () => {
      if (player.video) player.requestPause();
    });

    elements.stop.addEventListener("click", () => {
      if (player.video) player.requestStop();
    });

    elements.rewind.addEventListener("click", () => {
      if (player.video) player.requestMediaSeek(0);
    });

    elements.jump.addEventListener("click", () => {
      const firstPhrase = player.video && player.video.firstPhrase;
      if (firstPhrase) {
        player.requestMediaSeek(firstPhrase.startTime);
        registerPhrase(firstPhrase, firstPhrase.startTime);
      }
    });

    elements.seek.addEventListener("input", () => {
      isSeeking = true;
      elements.position.textContent = formatTime(Number(elements.seek.value));
    });

    elements.seek.addEventListener("change", () => {
      if (player.video) player.requestMediaSeek(Number(elements.seek.value));
      isSeeking = false;
    });
  }

  function requestPlayFromGesture(event) {
    const now = performance.now();
    if (now - lastPlayRequestAt < 300) {
      event?.preventDefault?.();
      return;
    }

    lastPlayRequestAt = now;
    event?.preventDefault?.();

    if (!player.video) return;

    unlockMediaElement();
    const accepted = player.requestPlay();
    setStatus(accepted ? "Play requested" : "Waiting for audio permission", accepted ? "ready" : undefined);
  }

  function unlockMediaElement() {
    const media = elements.media.querySelector("audio, video");
    if (!media || !media.paused) return;

    const wasMuted = media.muted;
    media.muted = true;

    try {
      const playPromise = media.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise
          .then(() => {
            window.setTimeout(() => {
              media.muted = wasMuted;
            }, 80);
          })
          .catch(() => {
            media.muted = wasMuted;
          });
      } else {
        window.setTimeout(() => {
          media.muted = wasMuted;
        }, 80);
      }
    } catch (_error) {
      media.muted = wasMuted;
      // TextAlive will report playback readiness through its own listener.
    }
  }

  function onAppReady(app) {
    const mode = app.managed ? "Connected to TextAlive host" : "Standalone mode";
    setStatus(mode, "ready");
    addEvent(`app ready: ${mode}`);
    player.volume = 8;
    elements.controlPanel.classList.toggle("is-managed", app.managed);

    if (REQUIRES_HTTP) {
      setStatus(HTTP_REQUIRED_MESSAGE, "error");
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
    disableTransport(true);
  }

  function loadSong(songUrl) {
    if (!songUrl) {
      setStatus("Song URL is missing.", "error");
      return;
    }

    setStatus("Loading TextAlive song data");
    disableTransport(true);
    resetSongState();

    player.createFromSongUrl(songUrl).catch((error) => {
      const message = error && error.message ? error.message : String(error);
      setStatus("Song data load failed", "error");
      addEvent(message);
      disableTransport(false);
    });
  }

  function onVideoReady(video) {
    duration = Math.max(0, Math.ceil(video.duration || video.endTime || 0));
    elements.seek.max = String(duration);
    elements.duration.textContent = formatTime(duration);
    elements.phraseCount.textContent = `phrases ${video.phraseCount || 0}`;
    elements.wordCount.textContent = `words ${video.wordCount || 0}`;
    elements.charCount.textContent = `chars ${video.charCount || 0}`;
    elements.jump.disabled = !video.firstPhrase;

    assignAnimation(video.firstPhrase, animatePhrase);
    assignAnimation(video.firstWord, animateWord);
    assignAnimation(video.firstChar, animateChar);

    maxVocalAmplitude = safe(() => player.getMaxVocalAmplitude()) || 0;
    choruses = (safe(() => player.getChoruses()) || []).slice().sort((a, b) => a.startTime - b.startTime);
    firstPhraseTime = video.firstPhrase ? video.firstPhrase.startTime : -1;

    const song = player.data && player.data.song;
    elements.songTitle.textContent = song && song.name ? song.name : "TAKEOVER";
    elements.artistName.textContent = song && song.artist && song.artist.name ? song.artist.name : "Twinfield";

    if (!video.firstPhrase) {
      // phrase panel removed
    }

    disableTransport(false);
    setStatus("Song ready", "ready");
    addEvent("video ready");
  }

  function onTimerReady() {
    disableTransport(false);
    setStatus("Playback ready", "ready");
    addEvent("timer ready");
  }

  function onPlay() {
    state.isPlaying = true;
    setStatus("Playing", "ready");
    addEvent("play");
  }

  function onPause() {
    state.isPlaying = false;
    setStatus("Paused", "ready");
    addEvent("pause");
  }

  function onStop() {
    state.isPlaying = false;
    setStatus("Stopped", "ready");
    addEvent("stop");
    window.Lyrics3D?.onEnd?.();
    updatePosition(0);
    resetLiveState();
  }

  function onTimeUpdate(position) {
    state.position = position;
    updatePosition(position);
    updateBeat(position);
    updateHarmony(position);
    updateLyricState(position);
    updateSection(position);
  }

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

    console.log(`[phrase] ${(unit.startTime/1000).toFixed(1)}s - ${(unit.endTime/1000).toFixed(1)}s\t${unit.text}`);
    let w = unit.firstWord; while (w) { console.log(`  [word] ${(w.startTime/1000).toFixed(2)}s - ${(w.endTime/1000).toFixed(2)}s\t"${w.text}"`); w = w.next; }
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
    const safePosition = Math.max(0, Number(position) || 0);
    elements.position.textContent = formatTime(safePosition);
    if (!isSeeking) {
      elements.seek.value = String(Math.min(duration, safePosition));
    }
  }

  function updateBeat(position) {
    const beat = safe(() => player.findBeat(position));
    if (!beat) {
      state.beatIndex = -1;
      state.beatProgress = 0;
      elements.beat.textContent = "-";
      elements.beatBar.style.width = "0%";
      document.documentElement.style.setProperty("--beat-progress", "0");
      return;
    }

    const progress = clamp01(beat.progress(position));
    const easedProgress = Ease ? Ease.circIn(progress) : progress;
    state.beatIndex = beat.index;
    state.beatProgress = progress;
    elements.beat.textContent = `#${beat.index} ${Math.round(progress * 100)}%`;
    elements.beatBar.style.width = `${Math.ceil(easedProgress * 100)}%`;
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
    elements.songTitle.textContent = "TAKEOVER";
    elements.artistName.textContent = "Twinfield";
    elements.phraseCount.textContent = "phrases -";
    elements.wordCount.textContent = "words -";
    elements.charCount.textContent = "chars -";
    elements.seek.value = "0";
    elements.seek.max = "0";
    elements.duration.textContent = "0:00.000";
    elements.beatBar.style.width = "0%";
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
    window.ModelStage?.reset?.();
    window.TextPV?.reset?.();
  }

  function disableTransport(disabled) {
    [elements.play, elements.pause, elements.stop, elements.rewind, elements.seek].forEach((element) => {
      element.disabled = disabled;
    });
    elements.jump.disabled = disabled || !(player.video && player.video.firstPhrase);
  }

  function setStatus(message, variant) {
    elements.status.textContent = message;
    elements.status.classList.toggle("ready", variant === "ready");
    elements.status.classList.toggle("error", variant === "error");
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

  function formatTime(ms) {
    const totalMilliseconds = Math.max(0, Math.floor(Number(ms) || 0));
    const minutes = Math.floor(totalMilliseconds / 60000);
    const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
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
