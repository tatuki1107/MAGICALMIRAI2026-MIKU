(() => {
  "use strict";

  const APP_TOKEN = "473zGS4UYYBAd2OR";
  const DEFAULT_SONG_URL = "https://piapro.jp/t/E2i3/20251215092113";
  const REQUIRES_HTTP = window.location.protocol === "file:";
  const HTTP_REQUIRED_MESSAGE =
    "file:// では歌詞取得が CORS で失敗します。localhost などの HTTP サーバーで開いてください";

  const $ = (selector) => document.querySelector(selector);

  const elements = {
    status: $("#status"),
    phrase: $("#phrase"),
    word: $("#word"),
    char: $("#char"),
    songTitle: $("#songTitle"),
    artistName: $("#artistName"),
    position: $("#position"),
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
    duration: $("#duration"),
    volume: $("#volume"),
    volumeVal: $("#volumeVal"),
    media: $("#media"),
  };

  if (!window.TextAliveApp) {
    setStatus("TextAlive App API を読み込めませんでした", "error");
    addEvent("API script load failed");
    return;
  }

  if (REQUIRES_HTTP) {
    setStatus(HTTP_REQUIRED_MESSAGE, "error");
    addEvent("open via http://localhost to enable lyrics");
  }

  const { Player, Ease } = window.TextAliveApp;

  let duration = 0;
  let isSeeking = false;
  let isLoadingSong = false;
  let loadSequence = 0;
  let playerGeneration = 0;
  let queuedSongUrl = REQUIRES_HTTP ? "" : DEFAULT_SONG_URL;
  let lastPhraseText = "";
  let lastWordText = "";
  let lastCharText = "";
  let player = createPlayer();

  function createPlayer() {
    const generation = ++playerGeneration;
    const nextPlayer = new Player({
      app: {
        token: APP_TOKEN,
        appName: "TextAlive API Test Site",
        appAuthor: "Codex",
        parameters: [
          {
            title: "文字サイズ",
            name: "fontScale",
            className: "Slider",
            params: [72, 128],
            initialValue: 100,
          },
          {
            title: "アクセント色",
            name: "accentColor",
            className: "Color",
            initialValue: "#39c5bb",
          },
        ],
      },
      mediaElement: elements.media,
      throttleInterval: 100,
    });

    nextPlayer.addListener({
      onAppReady: (app) => {
        if (generation === playerGeneration) {
          onAppReady(app);
        }
      },
      onAppMediaChange: (mediaUrl) => {
        if (generation === playerGeneration) {
          onAppMediaChange(mediaUrl);
        }
      },
      onAppParameterUpdate: (name, value) => {
        if (generation === playerGeneration) {
          onAppParameterUpdate(name, value);
        }
      },
      onVideoReady: (video) => {
        if (generation === playerGeneration) {
          onVideoReady(video);
        }
      },
      onTimerReady: () => {
        if (generation === playerGeneration) {
          onTimerReady();
        }
      },
      onPlay: () => {
        if (generation !== playerGeneration) {
          return;
        }
        setStatus("再生中", "ready");
        addEvent("play");
        if (window.MusicBG) window.MusicBG.isPlaying = true;
      },
      onPause: () => {
        if (generation !== playerGeneration) {
          return;
        }
        setStatus("一時停止", "ready");
        addEvent("pause");
        if (window.MusicBG) window.MusicBG.isPlaying = false;
      },
      onStop: () => {
        if (generation !== playerGeneration) {
          return;
        }
        setStatus("停止", "ready");
        addEvent("stop");
        updatePosition(0);
        if (window.MusicBG) window.MusicBG.isPlaying = false;
      },
      onTimeUpdate: (position) => {
        if (generation === playerGeneration) {
          onTimeUpdate(position);
        }
      },
      onThrottledTimeUpdate: (position) => {
        if (generation === playerGeneration) {
          updatePosition(position);
        }
      },
    });

    return nextPlayer;
  }

  elements.volume.addEventListener("input", () => {
    const v = Number(elements.volume.value);
    elements.volumeVal.textContent = v;
    if (player) player.requestVolume(v);
  });

  elements.play.addEventListener("click", () => {
    if (player.video) {
      const accepted = player.requestPlay();
      if (!accepted) {
        setStatus("音源準備待ち");
      } else {
        setStatus("再生要求送信済み", "ready");
      }
    }
  });

  elements.pause.addEventListener("click", () => {
    if (player.video) {
      player.requestPause();
    }
  });

  elements.stop.addEventListener("click", () => {
    if (player.video) {
      player.requestStop();
    }
  });

  elements.rewind.addEventListener("click", () => {
    if (player.video) {
      player.requestMediaSeek(0);
    }
  });

  elements.jump.addEventListener("click", () => {
    const firstPhrase = player.video && player.video.firstPhrase;
    if (firstPhrase) {
      player.requestMediaSeek(firstPhrase.startTime);
    }
  });

  elements.seek.addEventListener("input", () => {
    isSeeking = true;
    elements.position.textContent = formatTime(Number(elements.seek.value));
  });

  elements.seek.addEventListener("change", () => {
    if (player.video) {
      player.requestMediaSeek(Number(elements.seek.value));
    }
    isSeeking = false;
  });

  function onAppReady(app) {
    const mode = app.managed ? "TextAlive ホスト接続" : "スタンドアロン";
    setStatus(mode, "ready");
    addEvent(`app ready: ${mode}`);

    elements.controlPanel.classList.toggle("is-managed", app.managed);
    if (app.songUrl) {
      queuedSongUrl = "";
    }

    if (!app.songUrl && !app.managed && queuedSongUrl) {
      const songUrl = queuedSongUrl;
      queuedSongUrl = "";
      loadSong(songUrl);
    }
  }

  function onAppMediaChange(mediaUrl) {
    if (mediaUrl) {
      addEvent("media changed");
      resetLyrics();
      disableTransport(true);
    }
  }

  function onAppParameterUpdate(name, value) {
    if (name === "fontScale") {
      document.documentElement.style.setProperty("--font-scale", Number(value) / 100);
    }

    if (name === "accentColor") {
      const color = typeof value === "string" ? value : `rgb(${value.r}, ${value.g}, ${value.b})`;
      document.documentElement.style.setProperty("--accent", color);
    }

    addEvent(`parameter: ${name}`);
  }

  function loadSong(songUrl, options = {}) {
    const normalizedSongUrl = normalizeSongUrl(songUrl);

    if (!songUrl) {
      setStatus("URL を入力してください", "error");
      return;
    }

    if (REQUIRES_HTTP) {
      setStatus(HTTP_REQUIRED_MESSAGE, "error");
      addEvent("load blocked on file:// origin");
      return;
    }

    if (isLoadingSong || player.isLoading) {
      if (options.replaceBusy) {
        replacePlayerAndLoad(normalizedSongUrl);
        return;
      }

      setStatus("読み込み処理中");
      addEvent("load skipped: busy");
      return;
    }

    isLoadingSong = true;
    loadSequence += 1;
    const sequence = loadSequence;
    setStatus("楽曲情報を読み込み中");
    addEvent("loading song");
    disableTransport(true);
    resetLyrics();

    player
      .createFromSongUrl(normalizedSongUrl)
      .catch((error) => {
        if (sequence !== loadSequence) {
          return;
        }

        isLoadingSong = false;
        disableTransport(false);

        const message = error && error.message ? error.message : String(error);
        setStatus("読み込みに失敗しました", "error");
        addEvent(message);
      })
      .finally(() => {
        if (sequence === loadSequence && isLoadingSong && !player.isLoading) {
          isLoadingSong = false;
        }
      });
  }

  function replacePlayerAndLoad(songUrl) {
    queuedSongUrl = songUrl;
    loadSequence += 1;
    isLoadingSong = false;
    setStatus("楽曲を切り替え中");
    addEvent("switch song");
    disableTransport(true);
    resetLyrics();

    const previousPlayer = player;
    playerGeneration += 1;
    safe(() => previousPlayer.requestStop());
    safe(() => previousPlayer.dispose());
    elements.media.replaceChildren();
    player = createPlayer();
  }

  function normalizeSongUrl(songUrl) {
    try {
      const url = new URL(songUrl);

      if (url.hostname === "youtu.be") {
        const videoId = url.pathname.replace(/^\/+/, "").split("/")[0];
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : songUrl;
      }

      if (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") {
        const videoId = url.searchParams.get("v");
        return videoId ? `https://www.youtube.com/watch?v=${videoId}` : songUrl;
      }

      if (url.hostname === "nico.ms") {
        const videoId = url.pathname.replace(/^\/+/, "").split("/")[0];
        return videoId ? `https://www.nicovideo.jp/watch/${videoId}` : songUrl;
      }

      if (url.hostname === "www.nicovideo.jp" || url.hostname === "nicovideo.jp") {
        const videoId = url.pathname.match(/\/watch\/([^/?#]+)/);
        return videoId ? `https://www.nicovideo.jp/watch/${videoId[1]}` : songUrl;
      }

      return songUrl;
    } catch (_error) {
      return songUrl;
    }
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

    const song = player.data && player.data.song;
    elements.songTitle.textContent = song && song.name ? song.name : "-";
    elements.artistName.textContent =
      song && song.artist && song.artist.name ? song.artist.name : "-";

    if (!video.firstPhrase) {
      elements.phrase.textContent = "歌詞なし";
    }

    disableTransport(false);
    isLoadingSong = false;
    setStatus("動画データ準備完了", "ready");
    addEvent("video ready");
  }

  function onTimerReady() {
    disableTransport(false);
    player.requestVolume(Number(elements.volume.value));
    setStatus("再生準備完了", "ready");
    addEvent("timer ready");
  }

  function onTimeUpdate(position) {
    updatePosition(position);
    updateBeat(position);
    updateHarmony(position);
  }

  function animatePhrase(now, unit) {
    if (!unit.contains(now)) {
      return;
    }

    const progress = clamp01(unit.progress(now));
    document.documentElement.style.setProperty("--phrase-progress", progress.toFixed(3));

    if (unit.text !== lastPhraseText) {
      lastPhraseText = unit.text;
      if (window.Lyrics3D) {
        window.Lyrics3D.onPhrase(unit, now);
      }
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderPhraseChars(text) {
    if (!text || text === "-" || text === "歌詞なし" || text === "歌詞を読み込み中") {
      elements.phrase.textContent = text;
      return;
    }
    const chars = [...text];
    elements.phrase.innerHTML = chars
      .map((ch, i) =>
        `<span class="pv-char" style="--ci:${i};--cn:${chars.length}">${ch === " " ? "&nbsp;" : escapeHtml(ch)}</span>`,
      )
      .join("");
  }

  function animateWord(now, unit) {
    if (unit.contains(now) && unit.text !== lastWordText) {
      lastWordText = unit.text;
      if (elements.word) elements.word.textContent = unit.text || "-";
    }
  }

  function animateChar(now, unit) {
    if (unit.contains(now) && unit.text !== lastCharText) {
      lastCharText = unit.text;
      if (elements.char) elements.char.textContent = unit.text || "-";
    }
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
      elements.beat.textContent = "-";
      elements.beatBar.style.width = "0%";
      document.documentElement.style.setProperty("--beat-progress", "0");
      return;
    }

    const progress = clamp01(beat.progress(position));
    const easedProgress = Ease ? Ease.circIn(progress) : progress;
    elements.beat.textContent = `#${beat.index} ${Math.round(progress * 100)}%`;
    elements.beatBar.style.width = `${Math.ceil(easedProgress * 100)}%`;
    document.documentElement.style.setProperty("--beat-progress", progress.toFixed(3));
    if (window.MusicBG) {
      window.MusicBG.beatProgress = progress;
      window.MusicBG.beatIndex    = beat.index;
    }
  }

  function updateHarmony(position) {
    const chord = safe(() => player.findChord(position));
    const chorus = safe(() => player.findChorus(position));

    elements.chord.textContent = chord && chord.name ? chord.name : "-";
    elements.chorus.textContent = chorus ? `${Math.round(chorus.progress(position) * 100)}%` : "-";
    if (window.MusicBG) window.MusicBG.isChorus = !!chorus;
  }

  function resetLyrics() {
    duration = 0;
    lastPhraseText = "";
    lastWordText = "";
    lastCharText = "";
    elements.phrase.textContent = "歌詞を読み込み中";
    if (elements.word) elements.word.textContent = "-";
    if (elements.char) elements.char.textContent = "-";
    elements.songTitle.textContent = "-";
    elements.artistName.textContent = "-";
    elements.phraseCount.textContent = "phrases -";
    elements.wordCount.textContent = "words -";
    elements.charCount.textContent = "chars -";
    elements.seek.value = "0";
    elements.seek.max = "0";
    elements.duration.textContent = "0:00.000";
    elements.beatBar.style.width = "0%";
    document.documentElement.style.setProperty("--beat-progress", "0");
    document.documentElement.style.setProperty("--phrase-progress", "0");
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
    const item = document.createElement("li");
    item.textContent = `${new Date().toLocaleTimeString("ja-JP")} ${message}`;
    elements.events.prepend(item);

    while (elements.events.children.length > 8) {
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
