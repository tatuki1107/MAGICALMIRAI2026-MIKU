/**
 * textpv.js — 歌詞テキスト PV エンジン
 * フレーズ・単語・文字イベントを受け取り、セクションごとの variant / tone で
 * DOM アニメーション演出を生成する。
 * window.TextPV を公開し、app.js からイベントを受け取る。
 *
 * variant 一覧: typewriter / pixel / polygon / particle / slide /
 *               slash / echo / glitch / burst / vibrate / vertical
 */
(() => {
  "use strict";

  // ── DOM / 定数 ────────────────────────────────────────────
  const layer = document.getElementById("typography-layer");
  const activePhrases = [];
  const timers = new Set();
  const MAX_PHRASES = 2;
  const SPLIT_THRESHOLD = 9;
  const VERTICAL_SPLIT_THRESHOLD = 8;
  const PARTICLES = new Set([
    'は','が','を','に','で','と','も','の','へ','や',
    'より','から','まで','ばかり','だけ','しか','ので','けど',
    'て','し','な','ね','よ','か','わ','って','ってな','じゃ',
  ]);
  const MAX_WORD_HITS = 7;
  const MAX_CHAR_TICKS = 12;

  let lastPhraseIndex = 0;
  let wordHitIndex = 0;
  let charTickIndex = 0;

  // ── セクションごとの視覚言語 ─────────────────────────────────
  // variant/tones はフレーズ本文のハッシュ値でセクション内から選択されるため、
  // 同じフレーズは常に同じ見た目になる。
  // 出てきた順番ではなく「曲のどこか」で見た目が決まるようにする。
  // variants/tones は許容セットで、フレーズ本文のハッシュ+直前回避で選ぶ。
  const SECTION_STYLE = {
    intro:     { variants: ["typewriter", "slide", "slash", "pixel"],    tones: ["cyan", "white"] },
    amelo:     { variants: ["typewriter", "slide", "echo", "glitch"],    tones: ["cyan", "white"] },
    bmelo:     { variants: ["vibrate", "vertical", "slash", "pixel"],    tones: ["cyan", "white"] },
    chorus:    { variants: ["particle", "burst", "glitch", "slide"],     tones: ["hot", "warm", "white"] },
    interlude: { variants: ["vibrate", "polygon", "echo", "vertical"],   tones: ["cyan", "warm"] },
    finale:    { variants: ["particle", "polygon", "burst", "glitch"],   tones: ["warm", "white", "hot"] },
  };

  const TONE_COLOR = {
    cyan:  "#39c5bb",
    hot:   "#ff5ca8",
    warm:  "#ffd166",
    white: "#ffffff",
  };
  const FALLBACK_STYLE = SECTION_STYLE.amelo;

  // 直前と同じ見た目を避けるための記憶
  let lastVariant = "";
  let lastTone = "";
  let lastWordLane = -1;
  let lastTickDot = -1;

  let vocalRaf = 0;

  // ── 公開 API (window.TextPV) ──────────────────────────────
  window.TextPV = {
    /** フレーズ開始時に演出要素を生成する */
    onPhrase,
    /** 単語タイミング (現在は no-op) */
    onWord,
    /** 文字タイミング (現在は no-op) */
    onChar,
    /** セクション変化時 (現在は no-op) */
    onSection,
    /** 再生リセット時に全演出要素と状態を初期化する */
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
    const entry = { element: phraseElement, index, text, dissolve: null };

    lastPhraseIndex = index;
    activePhrases.push(entry);
    layer.appendChild(phraseElement);

    // variant 固有の後処理
    const color = TONE_COLOR[tone] || "#ffffff";
    if (variant === "typewriter") {
      applyTypewriter(phraseElement);
    } else if (variant === "pixel") {
      entry.dissolve = applyPixel(phraseElement, text, color);
    } else if (variant === "polygon") {
      entry.dissolve = spawnPolygons(layer, phraseElement);
    } else if (variant === "particle") {
      phraseElement.style.display = "none"; // 背景スコアボードのみ表示
      entry.dissolve = spawnParticle(text, color, duration);
    }

    trimActivePhrases();

    // 余韻を持たせて消す (唐突に消えると読めない)
    schedule(() => removePhrase(entry), duration + 1000);
  }

  function onWord(_word) {
    // 単語バッジ削除済み
  }

  function onChar(_char) {
    // キャラクタティック削除済み
  }

  function onSection(_section) {
    // セクションバナー・スキャンライン削除済み
  }

  // ── Step 1: typewriter ──────────────────────────────────────────
  function applyTypewriter(phraseEl) {
    const charSpans = Array.from(phraseEl.querySelectorAll(".pv-char"));
    if (!charSpans.length) return;

    const cursor = document.createElement("span");
    cursor.className = "pv-cursor";
    charSpans[0].before(cursor);

    let i = 0;
    const INTERVAL = 48;
    const timer = setInterval(() => {
      if (i < charSpans.length) {
        charSpans[i].style.opacity = "1";
        charSpans[i].after(cursor);
        i += 1;
      } else {
        clearInterval(timer);
        schedule(() => cursor.remove(), 200);
      }
    }, INTERVAL);
    timers.add(timer);
  }

  // ── Step 2: pixel ───────────────────────────────────────────────
  function applyPixel(phraseEl, text, color) {
    phraseEl.style.visibility = "hidden";

    const W = layer.clientWidth || window.innerWidth;
    const H = layer.clientHeight || window.innerHeight;

    const canvas = document.createElement("canvas");
    canvas.className = "pv-pixel-canvas";
    canvas.width = W;
    canvas.height = H;
    layer.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const STEP = 4;
    const off = new OffscreenCanvas(W, H);
    const octx = off.getContext("2d");
    const fontSize = Math.round(W * 0.055);
    octx.font = `900 ${fontSize}px "Zen Kaku Gothic New", sans-serif`;
    octx.fillStyle = "#fff";
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.fillText(text, W / 2, H / 2);

    const data = octx.getImageData(0, 0, W, H).data;
    const dots = [];
    for (let y = 0; y < H; y += STEP) {
      for (let x = 0; x < W; x += STEP) {
        if (data[(y * W + x) * 4 + 3] > 128) {
          dots.push({
            tx: x, ty: y,
            x: Math.random() * W,
            y: Math.random() * H,
            vx: 0, vy: 0,
          });
        }
      }
    }

    const SPRING = 0.14;
    const DAMPING = 0.72;
    let phase = "in";
    let rafId = 0;

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = color;
      for (const d of dots) {
        const tx = phase === "out" ? d.tx + (Math.random() - 0.5) * W * 2 : d.tx;
        const ty = phase === "out" ? d.ty + (Math.random() - 0.5) * H * 2 : d.ty;
        d.vx = (d.vx + (tx - d.x) * SPRING) * DAMPING;
        d.vy = (d.vy + (ty - d.y) * SPRING) * DAMPING;
        d.x += d.vx;
        d.y += d.vy;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return function dissolve() {
      phase = "out";
      schedule(() => {
        cancelAnimationFrame(rafId);
        canvas.remove();
      }, 800);
    };
  }

  // ── Step 3: polygon ─────────────────────────────────────────────
  function spawnPolygons(container, phraseEl) {
    const SHAPES = [
      "polygon(50% 0%, 0% 100%, 100% 100%)",
      "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
      "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
    ];
    const COUNT = 6;
    const rect = phraseEl.getBoundingClientRect();
    const base = container.getBoundingClientRect();
    const polys = [];

    for (let i = 0; i < COUNT; i += 1) {
      const el = document.createElement("div");
      const size = 16 + Math.random() * 24;
      const ox = rect.left - base.left + Math.random() * rect.width - size / 2;
      const oy = rect.top  - base.top  + Math.random() * rect.height - size / 2;
      el.className = "pv-poly";
      el.style.cssText = [
        `width:${size}px`, `height:${size}px`,
        `left:${ox}px`, `top:${oy}px`,
        `clip-path:${SHAPES[i % SHAPES.length]}`,
        `background:currentColor`,
        `color:var(--pv-main,#fff)`,
        `opacity:0`,
        `--px:${(Math.random() - 0.5) * 120}px`,
        `--py:${(Math.random() - 0.5) * 80}px`,
        `--pr:${(Math.random() - 0.5) * 180}deg`,
        `animation-delay:${i * 0.06}s`,
      ].join(";");
      container.appendChild(el);
      polys.push(el);
    }

    return function dissolve() {
      polys.forEach((p) => p.classList.add("is-out"));
      schedule(() => polys.forEach((p) => p.remove()), 500);
    };
  }

  // ── Step 4: particle（Three.js 側へ委譲）────────────────────────
  function spawnParticle(text, color) {
    const stage = window.ModelStage;
    if (!stage?.spawnParticle) return null;
    return stage.spawnParticle(text, color);
  }

  function reset() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    activePhrases.splice(0, activePhrases.length);
    lastPhraseIndex = 0;
    wordHitIndex = 0;
    charTickIndex = 0;
    lastVariant = "";
    lastTone = "";
    lastWordLane = -1;
    lastTickDot = -1;
    layer.style.removeProperty("--pv-vocal");
    layer.replaceChildren();
  }

  // ── DOM 構築 ──────────────────────────────────────────────
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
    phrase.style.setProperty("--pv-ox", `${jitter(seed, 11) * 2.2}vw`);
    phrase.style.setProperty("--pv-oy", `${jitter(seed, 7) * 2.0}vh`);

    const mask = document.createElement("div");
    mask.className = "pv-mask";

    const splitAt = findSplitChar(text, words, variant === 'vertical' ? VERTICAL_SPLIT_THRESHOLD : SPLIT_THRESHOLD);
    let hasKey = false;

    if (splitAt) {
      const chars = [...text];
      const line1 = chars.slice(0, splitAt).join("");
      const line2 = chars.slice(splitAt).join("");
      const [words1, words2] = splitWords(words, splitAt);

      const rows = document.createElement("div");
      rows.className = "pv-text-rows";

      const tw1 = document.createElement("div");
      tw1.className = "pv-text";
      tw1.dataset.text = line1;
      const hk1 = appendCharacters(tw1, line1, words1);
      if (hk1) { tw1.classList.add("has-key"); hasKey = true; }

      const tw2 = document.createElement("div");
      tw2.className = "pv-text";
      tw2.dataset.text = line2;
      const hk2 = appendCharacters(tw2, line2, words2);
      if (hk2) { tw2.classList.add("has-key"); hasKey = true; }

      rows.appendChild(tw1);
      rows.appendChild(tw2);
      mask.appendChild(rows);
    } else {
      const textWrap = document.createElement("div");
      textWrap.className = "pv-text";
      textWrap.dataset.text = text;
      hasKey = appendCharacters(textWrap, text, words);
      if (hasKey) textWrap.classList.add("has-key");
      mask.appendChild(textWrap);
    }
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
    const particleMap = makeCharParticleMap(text, words);
    let charIndex = 0;
    [...text].forEach((char) => {
      const span = document.createElement("span");
      const isKey = keyRange && charIndex >= keyRange.start && charIndex < keyRange.end;
      const classes = ["pv-char"];
      if (isKey) classes.push("is-key");
      if (particleMap[charIndex]) classes.push("is-particle");
      span.className = classes.join(" ");
      span.textContent = char === " " ? " " : char;
      span.style.setProperty("--i", String(charIndex));
      span.style.setProperty("--char-tilt", `${-8 + (charIndex % 5) * 4}deg`);
      parent.appendChild(span);
      charIndex += 1;
    });
    return !!keyRange;
  }

  function makeCharParticleMap(text, words) {
    const map = new Array([...text].length).fill(false);
    if (!Array.isArray(words)) return map;
    let cursor = 0;
    for (const word of words) {
      const len = [...word].length;
      if (PARTICLES.has(word)) {
        for (let i = 0; i < len; i++) map[cursor + i] = true;
      }
      cursor += len;
    }
    return map;
  }

  function findSplitChar(text, words, threshold = SPLIT_THRESHOLD) {
    const total = [...text].length;
    if (total <= threshold) return null;
    if (!Array.isArray(words) || words.length === 0) return threshold;
    let cursor = 0;
    for (const word of words) {
      cursor += [...word].length;
      // 分割後の2行目が1文字以上かつ1行目が1文字以上になる境界のみ有効
      if (cursor >= threshold && cursor < total) return cursor;
    }
    return null;
  }

  function splitWords(words, splitAt) {
    if (!Array.isArray(words)) return [null, null];
    let cursor = 0;
    for (let i = 0; i < words.length; i++) {
      cursor += [...words[i]].length;
      if (cursor >= splitAt) return [words.slice(0, i + 1), words.slice(i + 1)];
    }
    return [words, []];
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

  // ── フレーズ管理 ──────────────────────────────────────────
  function trimActivePhrases() {
    while (activePhrases.length > MAX_PHRASES) {
      removePhrase(activePhrases[0]);
    }
  }

  function removePhrase(entry) {
    const index = activePhrases.indexOf(entry);
    if (index >= 0) activePhrases.splice(index, 1);
    entry?.dissolve?.();
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

  // ── ユーティリティ ────────────────────────────────────────
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
