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

  const variants = ["slide", "vertical", "burst", "slash", "echo", "glitch"];
  const accents = ["cyan", "hot", "warm", "white"];

  window.TextPV = {
    onPhrase,
    onWord,
    onChar,
    reset,
  };

  if (!layer) return;

  function onPhrase(phrase) {
    const text = normalizeText(phrase?.text);
    if (!text) return;

    const index = Math.max(1, Number(phrase?.index) || lastPhraseIndex + 1);
    const duration = clamp((Number(phrase?.endTime) || 0) - (Number(phrase?.startTime) || 0), 1800, 7800);
    const variant = variants[(index - 1) % variants.length];
    const accent = accents[(index - 1) % accents.length];
    const phraseElement = buildPhraseElement(text, index, variant, accent, duration, !!phrase?.isChorus);
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

    const hit = document.createElement("span");
    hit.className = `pv-word-hit lane-${wordHitIndex % 6}`;
    hit.textContent = text;
    hit.style.setProperty("--hit-index", String(wordHitIndex % 6));
    hit.style.setProperty("--hit-tilt", `${-10 + (wordHitIndex % 5) * 5}deg`);
    layer.appendChild(hit);
    wordHitIndex += 1;

    trimFloating(".pv-word-hit", MAX_WORD_HITS);
    schedule(() => hit.remove(), 720);
  }

  function onChar(char) {
    const text = normalizeText(char?.text);
    if (!text || text.length > 2) return;

    const tick = document.createElement("span");
    tick.className = `pv-char-tick dot-${charTickIndex % 8}`;
    tick.textContent = text;
    tick.style.setProperty("--tick-index", String(charTickIndex % 8));
    layer.appendChild(tick);
    charTickIndex += 1;

    trimFloating(".pv-char-tick", MAX_CHAR_TICKS);
    schedule(() => tick.remove(), 420);
  }

  function reset() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    activePhrases.splice(0, activePhrases.length);
    lastPhraseIndex = 0;
    wordHitIndex = 0;
    charTickIndex = 0;
    layer.replaceChildren();
  }

  function buildPhraseElement(text, index, variant, accent, duration, isChorus) {
    const phrase = document.createElement("section");
    phrase.className = [
      "pv-phrase",
      `pv-${variant}`,
      `tone-${accent}`,
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

    const mask = document.createElement("div");
    mask.className = "pv-mask";

    const textWrap = document.createElement("div");
    textWrap.className = "pv-text";
    textWrap.dataset.text = text;
    appendCharacters(textWrap, text);

    mask.appendChild(textWrap);
    phrase.appendChild(mask);

    if (variant === "echo" || variant === "burst" || variant === "glitch") {
      appendEchoCopies(phrase, text, variant);
    }

    appendCuts(phrase, index);
    return phrase;
  }

  function appendCharacters(parent, text) {
    [...text].forEach((char, index) => {
      const span = document.createElement("span");
      span.className = "pv-char";
      span.textContent = char === " " ? "\u00a0" : char;
      span.style.setProperty("--i", String(index));
      span.style.setProperty("--char-tilt", `${-8 + (index % 5) * 4}deg`);
      parent.appendChild(span);
    });
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
})();
