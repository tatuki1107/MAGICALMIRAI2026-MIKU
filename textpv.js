(() => {
  "use strict";

  const layer = document.getElementById("typography-layer");
  const activePhrases = [];
  const timers = new Set();
  const MAX_PHRASES = 3;
  const MAX_WORD_HITS = 7;
  const MAX_CHAR_TICKS = 12;

  let lastPhraseIndex = 0;
  let wordHitIndex = 0;
  let charTickIndex = 0;

  // ── セクションごとの視覚言語 ──
  // 出てきた順番ではなく「曲のどこか」で見た目が決まるようにする。
  // variants/tones は許容セットで、フレーズ本文のハッシュ+直前回避で選ぶ。
  const SECTION_STYLE = {
    intro: { variants: ["slide", "slash", "echo", "glitch"], tones: ["cyan", "white"] },
    amelo: { variants: ["slide", "slash", "echo", "glitch"], tones: ["cyan", "white"] },
    bmelo: { variants: ["vertical", "slash", "echo"], tones: ["cyan", "white"] },
    chorus: { variants: ["burst", "glitch", "slide"], tones: ["hot", "warm", "white"] },
    interlude: { variants: ["echo", "slash", "vertical"], tones: ["cyan", "warm"] },
    finale: { variants: ["burst", "slide", "glitch"], tones: ["warm", "white", "hot"] },
  };
  const FALLBACK_STYLE = SECTION_STYLE.amelo;

  // 直前と同じ見た目を避けるための記憶
  let lastVariant = "";
  let lastTone = "";
  let lastWordLane = -1;
  let lastTickDot = -1;

  let bannerElement = null;
  let bannerTimer = 0;
  let vocalRaf = 0;

  window.TextPV = {
    onPhrase,
    onWord,
    onChar,
    onSection,
    reset,
  };

  if (!layer) return;
  startVocalLoop();

  function onPhrase(phrase) {
    const text = normalizeText(phrase?.text);
    if (!text) return;

    const index = Math.max(1, Number(phrase?.index) || lastPhraseIndex + 1);
    const duration = clamp((Number(phrase?.endTime) || 0) - (Number(phrase?.startTime) || 0), 1800, 7800);

    // セクション + 本文ハッシュで見た目を決める (順番循環をやめる)
    const style = SECTION_STYLE[currentSectionId()] || FALLBACK_STYLE;
    const seed = hashText(text) + index;
    const variant = pickFrom(style.variants, seed, lastVariant);
    const tone = pickFrom(style.tones, seed >> 2, lastTone);
    lastVariant = variant;
    lastTone = tone;

    const words = sanitizeWords(phrase?.words, text);
    const phraseElement = buildPhraseElement({
      text,
      words,
      index,
      variant,
      tone,
      duration,
      isChorus: !!phrase?.isChorus,
      seed,
    });
    const entry = { element: phraseElement, index, text };

    lastPhraseIndex = index;
    activePhrases.push(entry);
    layer.appendChild(phraseElement);
    trimActivePhrases();

    schedule(() => removePhrase(entry), duration + 1200);
  }

  function onWord(word) {
    const text = normalizeText(word?.text);
    if (!text) return;

    const lane = nextLane(6, () => lastWordLane, (v) => (lastWordLane = v));
    const hit = document.createElement("span");
    hit.className = `pv-word-hit lane-${lane}`;
    hit.textContent = text;
    hit.style.setProperty("--hit-index", String(lane));
    hit.style.setProperty("--hit-tilt", `${-12 + ((hashText(text) % 6) * 5)}deg`);
    layer.appendChild(hit);
    wordHitIndex += 1;

    trimFloating(".pv-word-hit", MAX_WORD_HITS);
    schedule(() => hit.remove(), 720);
  }

  function onChar(char) {
    const text = normalizeText(char?.text);
    if (!text || text.length > 2) return;

    const dot = nextLane(8, () => lastTickDot, (v) => (lastTickDot = v));
    const tick = document.createElement("span");
    tick.className = `pv-char-tick dot-${dot}`;
    tick.textContent = text;
    tick.style.setProperty("--tick-index", String(dot));
    layer.appendChild(tick);
    charTickIndex += 1;

    trimFloating(".pv-char-tick", MAX_CHAR_TICKS);
    schedule(() => tick.remove(), 420);
  }

  // セクション切替: 節目の大型ステータス文字と SYSTEM SCAN のスキャンライン (D-5)
  function onSection(section) {
    const id = section?.id || "intro";
    const name = section?.name || "";
    layer.classList.toggle("is-scan", id === "bmelo");
    showBanner(name, id);
  }

  function showBanner(text, id) {
    if (!text) return;
    if (!bannerElement) {
      bannerElement = document.createElement("div");
      bannerElement.className = "pv-section-banner";
      layer.appendChild(bannerElement);
    }
    bannerElement.textContent = text;
    bannerElement.dataset.section = id;
    bannerElement.classList.remove("show");
    void bannerElement.offsetWidth; // reflow でアニメーションを再起動
    bannerElement.classList.add("show");
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => bannerElement?.classList.remove("show"), 2200);
  }

  function reset() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    window.clearTimeout(bannerTimer);
    activePhrases.splice(0, activePhrases.length);
    lastPhraseIndex = 0;
    wordHitIndex = 0;
    charTickIndex = 0;
    lastVariant = "";
    lastTone = "";
    lastWordLane = -1;
    lastTickDot = -1;
    bannerElement = null;
    layer.classList.remove("is-scan");
    layer.style.removeProperty("--pv-vocal");
    layer.replaceChildren();
  }

  function buildPhraseElement(config) {
    const { text, words, index, variant, tone, duration, isChorus, seed } = config;
    const phrase = document.createElement("section");
    phrase.className = [
      "pv-phrase",
      `pv-${variant}`,
      `tone-${tone}`,
      lengthClass(text),
      isChorus ? "is-chorus" : "",
    ]
      .filter(Boolean)
      .join(" ");
    phrase.dataset.text = text;
    phrase.dataset.index = String(index);
    phrase.style.setProperty("--pv-duration", `${duration}ms`);
    phrase.style.setProperty("--pv-angle", `${-12 + (index % 5) * 6}deg`);
    phrase.style.setProperty("--pv-seed", String(index % 9));
    // 同じ variant でも着地点を散らして反復感を消す (translate は transform と別プロパティ)
    phrase.style.setProperty("--pv-ox", `${jitter(seed, 11) * 4.2}vw`);
    phrase.style.setProperty("--pv-oy", `${jitter(seed, 7) * 3.4}vh`);

    const mask = document.createElement("div");
    mask.className = "pv-mask";

    const textWrap = document.createElement("div");
    textWrap.className = "pv-text";
    textWrap.dataset.text = text;
    const hasKey = appendCharacters(textWrap, text, words);
    if (hasKey) textWrap.classList.add("has-key");

    mask.appendChild(textWrap);
    phrase.appendChild(mask);

    if (variant === "echo" || variant === "burst" || variant === "glitch") {
      appendEchoCopies(phrase, text, variant);
    }

    appendCuts(phrase, index);
    return phrase;
  }

  // 文字を 1 つずつ span 化し、フレーズの「核」になる単語だけを強調する
  function appendCharacters(parent, text, words) {
    const keyRange = keyWordRange(text, words);
    let charIndex = 0;
    [...text].forEach((char) => {
      const span = document.createElement("span");
      const isKey = keyRange && charIndex >= keyRange.start && charIndex < keyRange.end;
      span.className = isKey ? "pv-char is-key" : "pv-char";
      span.textContent = char === " " ? " " : char;
      span.style.setProperty("--i", String(charIndex));
      span.style.setProperty("--char-tilt", `${-8 + (charIndex % 5) * 4}deg`);
      parent.appendChild(span);
      charIndex += 1;
    });
    return !!keyRange;
  }

  function appendEchoCopies(parent, text, variant) {
    const count = variant === "glitch" ? 2 : 3;
    for (let i = 0; i < count; i += 1) {
      const copy = document.createElement("div");
      copy.className = `pv-echo-copy copy-${i + 1}`;
      copy.textContent = text;
      copy.dataset.text = text;
      parent.appendChild(copy);
    }
  }

  function appendCuts(parent, index) {
    for (let i = 0; i < 3; i += 1) {
      const cut = document.createElement("i");
      cut.className = `pv-cut cut-${i + 1}`;
      cut.style.setProperty("--cut-delay", `${90 + ((index + i) % 5) * 70}ms`);
      parent.appendChild(cut);
    }
  }

  function trimActivePhrases() {
    while (activePhrases.length > MAX_PHRASES) {
      removePhrase(activePhrases[0]);
    }
  }

  function removePhrase(entry) {
    const index = activePhrases.indexOf(entry);
    if (index >= 0) activePhrases.splice(index, 1);
    if (!entry?.element?.isConnected) return;

    entry.element.classList.add("is-exiting");
    schedule(() => entry.element.remove(), 360);
  }

  function trimFloating(selector, max) {
    const nodes = layer.querySelectorAll(selector);
    nodes.forEach((node, index) => {
      if (index < nodes.length - max) node.remove();
    });
  }

  function schedule(fn, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      fn();
    }, Math.max(0, delay));
    timers.add(timer);
    return timer;
  }

  // 声量(と拍)を CSS 変数へ流し、サビのキーワードを脈動させる
  function startVocalLoop() {
    const pump = () => {
      const bg = window.MusicBG;
      const vocal = clamp01(bg?.lyric?.vocal);
      layer.style.setProperty("--pv-vocal", vocal.toFixed(3));
      vocalRaf = window.requestAnimationFrame(pump);
    };
    if (!vocalRaf) vocalRaf = window.requestAnimationFrame(pump);
  }

  function currentSectionId() {
    return window.MusicBG?.section?.id || "intro";
  }

  // フレーズ内で一番「重い」単語の文字範囲を返す (なければ null)
  function keyWordRange(text, words) {
    if (!words || words.length < 2) return null;
    let best = null;
    let cursor = 0;
    const total = [...text].length;
    words.forEach((word) => {
      const len = [...word].length;
      // 句読点・記号のみ / 1 文字の助詞などは核にしない
      const meaningful = len >= 2 && /[\p{Letter}\p{Number}]/u.test(word);
      if (meaningful && (!best || len > best.len)) {
        best = { start: cursor, end: cursor + len, len };
      }
      cursor += len;
    });
    // フレーズ全体が核 = 強調にならないので無効化
    if (best && best.end - best.start >= total) return null;
    return best;
  }

  // words が phrase 全文と一致しない場合に備えて整える
  function sanitizeWords(words, text) {
    if (!Array.isArray(words) || words.length === 0) return null;
    const joined = words.join("");
    const stripped = String(text || "").replace(/\s+/g, "");
    return joined.replace(/\s+/g, "") === stripped ? words : null;
  }

  function pickFrom(list, seed, avoid) {
    if (!list || list.length === 0) return "slide";
    let idx = Math.abs(seed) % list.length;
    if (list.length > 1 && list[idx] === avoid) idx = (idx + 1) % list.length;
    return list[idx];
  }

  // lane/dot を直前回避つきで選ぶ
  function nextLane(count, get, set) {
    let next = Math.floor(Math.random() * count);
    if (count > 1 && next === get()) next = (next + 1) % count;
    set(next);
    return next;
  }

  function hashText(text) {
    let hash = 0;
    const str = String(text || "");
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  // seed から -1..1 のばらつきを得る (擬似乱数, 同じ seed では安定)
  function jitter(seed, salt) {
    const value = Math.sin((seed + 1) * (salt + 1) * 12.9898) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function lengthClass(text) {
    const length = [...text].length;
    if (length <= 9) return "pv-short";
    if (length <= 20) return "pv-medium";
    return "pv-long";
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 3200;
    return Math.max(min, Math.min(max, number));
  }

  function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
  }
})();
