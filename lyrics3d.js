(() => {
  'use strict';

  // ── Layer ─────────────────────────────────────────────────────
  const layer = document.createElement('div');
  layer.id = 'lyrics-special-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.querySelector('.stage-shell')?.appendChild(layer);


  // ── Styles ────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `

    #lyrics-special-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 20;
      overflow: hidden;
    }
    .lsp-word {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Zen Kaku Gothic New', 'Noto Sans JP', sans-serif;
      font-weight: 900;
      color: #fff;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      will-change: opacity, transform, filter;
    }
    @keyframes lsp-punch {
      0%   { opacity: 0; transform: translate(-50%,-50%) scale(2.2); filter: blur(8px); }
      18%  { opacity: 1; transform: translate(-50%,-50%) scale(0.92); filter: blur(0); }
      55%  { opacity: 1; transform: translate(-50%,-50%) scale(1.0); }
      85%  { opacity: 1; transform: translate(-50%,-50%) scale(1.0); }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(1.04); }
    }
    @keyframes lsp-slide {
      0%   { opacity: 0; transform: translate(-50%,-50%) translateY(28px) scale(0.85); }
      22%  { opacity: 1; transform: translate(-50%,-50%) translateY(0)   scale(1.0);  }
      75%  { opacity: 1; transform: translate(-50%,-50%) translateY(0)   scale(1.0);  }
      100% { opacity: 0; transform: translate(-50%,-50%) translateY(-12px); }
    }
    @keyframes lsp-flash {
      0%   { opacity: 0; transform: translate(-50%,-50%) scaleX(2.5) scaleY(0.6); filter: blur(6px); }
      20%  { opacity: 1; transform: translate(-50%,-50%) scale(1.0); filter: blur(0); }
      70%  { opacity: 1; }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(1.08); }
    }
    @keyframes lsp-recede {
      0%   { opacity: 1; transform: translate(-50%,-50%) scale(1);    filter: blur(0);    letter-spacing: 0.05em; }
      60%  { opacity: 0.6; transform: translate(-50%,-50%) scale(0.38); filter: blur(1px);  letter-spacing: 0.3em; }
      100% { opacity: 0;   transform: translate(-50%,-50%) scale(0.08); filter: blur(6px);  letter-spacing: 0.6em; }
    }
    @keyframes lsp-clap {
      0%   { opacity: 0;   letter-spacing: 0.55em;  transform: translate(-50%,-50%) scale(0.82); filter: blur(3px); }
      22%  { opacity: 1;   letter-spacing: -0.06em; transform: translate(-50%,-50%) scale(1.06); filter: blur(0) brightness(2.2); }
      36%  { letter-spacing: 0.03em;  transform: translate(-50%,-50%) scale(0.97); filter: brightness(1); }
      55%  { letter-spacing: 0.03em;  transform: translate(-50%,-50%) scale(1.0);  opacity: 1; }
      85%  { opacity: 1; }
      100% { opacity: 0;   transform: translate(-50%,-50%) scale(1.04); }
    }


    /* ── 通常フレーズ 左右分割ブロック ── */
    .lsp-block {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      font-family: 'Zen Kaku Gothic New', 'Noto Sans JP', sans-serif;
      font-weight: 900;
      color: #fff;
      line-height: 1.25;
      pointer-events: none;
      opacity: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.08em;
    }
    .lsp-block--left  { left: 4%;  text-align: left;  justify-content: flex-start; max-width: 44%; }
    .lsp-block--right { right: 4%; text-align: right; justify-content: flex-end;   max-width: 44%; }
    .lsp-block .particle { color: inherit; }
    .lsp-block .content  { color: inherit; }
    @keyframes lsp-block-in-left {
      0%   { opacity: 0; transform: translateY(-50%) translateX(-18px); }
      30%  { opacity: 1; transform: translateY(-50%) translateX(0); }
      80%  { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes lsp-block-in-right {
      0%   { opacity: 0; transform: translateY(-50%) translateX(18px); }
      30%  { opacity: 1; transform: translateY(-50%) translateX(0); }
      80%  { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // ── Utilities ─────────────────────────────────────────────────
  const timers = [];

  function clearAll() {
    timers.forEach(id => clearTimeout(id));
    timers.length = 0;
    layer.innerHTML = '';
  }

  function schedule(fn, delayMs) {
    timers.push(setTimeout(fn, Math.max(0, delayMs)));
  }

  function getWords(unit) {
    const words = [];
    let w = unit.firstWord;
    while (w) { words.push(w); w = w.next; }
    return words;
  }

  // ── Element spawner（特殊フレーズ用） ────────────────────────
  function spawn({ text, delay, duration, fontSize, color, glow, anim = 'lsp-punch', offsetY = '0px' }) {
    schedule(() => {
      const el = document.createElement('div');
      el.className = 'lsp-word';
      el.textContent = text;
      el.style.fontSize = fontSize;
      el.style.color = color;
      el.style.textShadow = `0 0 24px ${glow}, 0 0 60px ${glow}, 0 0 120px ${glow}`;
      el.style.top = `calc(50% + ${offsetY})`;
      el.style.animation = `${anim} ${duration}ms cubic-bezier(.22,.61,.36,1) forwards`;
      layer.appendChild(el);
      schedule(() => el.remove(), duration + 50);
    }, delay);
  }

  // ── 特殊フレーズ検出 ─────────────────────────────────────────
  const TRIPLE_WORDS = ['Love', 'Wrap', 'Na'];

  const TRIPLE_STYLE = {
    Love: { color: '#ffb3e6', glow: '#ff5ca8', fontSize: '20vw' },
    Wrap: { color: '#ffd166', glow: '#ff9900', fontSize: '20vw' },
    Na:   { color: '#aaeeff', glow: '#4488ff', fontSize: '18vw' },
  };

  function detectSpecial(words) {
    if (!words.length) return null;

    for (const target of TRIPLE_WORDS) {
      const hits = words.filter(w => w.text === target);
      if (hits.length >= 3) return { type: 'triple', word: target, hits };
    }

    return null;
  }

  // ── 特殊フレーズ ハンドラ ─────────────────────────────────────
  function handleTriple({ word, hits }, songTimeMs) {
    const s = TRIPLE_STYLE[word];
    const anim = word === 'Clap' ? 'lsp-clap' : 'lsp-punch';
    hits.slice(0, 4).forEach(w => {
      const dur = Math.min((w.endTime - w.startTime) * 2.2, 480);
      spawn({ text: word.toUpperCase(), delay: w.startTime - songTimeMs,
        duration: Math.max(dur, 300), fontSize: s.fontSize,
        color: s.color, glow: s.glow, anim });
    });
  }

  // ── 通常フレーズ 左右分割ロジック ────────────────────────────

  // 助詞リスト（完全一致判定）
  const PARTICLES = new Set([
    'は','が','を','に','で','と','も','の','へ','や',
    'より','から','まで','ばかり','だけ','しか',
    'ので','けど','て','も','し','な','ね','よ','か','わ',
    'って','ってな','じゃ',
  ]);

  function isParticle(text) {
    return PARTICLES.has(text);
  }

  // フレーズ文字数カウント（記号除外）
  function countChars(words) {
    return words.reduce((n, w) => n + [...w.text].filter(c => /\S/.test(c)).length, 0);
  }

  // 最大ギャップ位置を返す（インデックス i = words[i].endTime と words[i+1].startTime の間）
  function findSplitIndex(words) {
    let maxGap = -1;
    let splitAt = -1;
    for (let i = 0; i < words.length - 1; i++) {
      const gap = words[i + 1].startTime - words[i].endTime;
      if (gap > maxGap) { maxGap = gap; splitAt = i; }
    }
    return splitAt;
  }

  // 単語配列からブロック DOM を生成
  function buildBlockEl(words, baseFontSize) {
    const el = document.createElement('div');
    words.forEach(w => {
      const span = document.createElement('span');
      span.textContent = w.text;
      if (isParticle(w.text)) {
        span.className = 'particle';
        span.style.fontSize = `${baseFontSize * 0.62}vw`;
        span.style.opacity = '0.7';
      } else {
        span.className = 'content';
        span.style.fontSize = `${baseFontSize}vw`;
      }
      el.appendChild(span);
    });
    return el;
  }

  // 文字数に応じたベースフォントサイズ（vw）
  function calcBaseFontSize(charCount) {
    if (charCount <= 4)  return 9.0;
    if (charCount <= 7)  return 7.5;
    if (charCount <= 10) return 6.0;
    if (charCount <= 14) return 5.0;
    return 4.2;
  }

  function handleNormal(words, unit, songTimeMs) {
    const charCount = countChars(words);
    if (charCount < 9) return; // 8文字以下はスキップ

    const splitAt = findSplitIndex(words);
    if (splitAt < 0) return;

    const front = words.slice(0, splitAt + 1);
    const back  = words.slice(splitAt + 1);

    // 極端な分割（片方が1単語だけ）は避ける
    if (front.length < 2 || back.length < 2) return;

    const frontCharCount = countChars(front);
    const backCharCount  = countChars(back);
    const baseFront = calcBaseFontSize(frontCharCount);
    const baseBack  = calcBaseFontSize(backCharCount);

    const phraseDur  = unit.endTime - unit.startTime;
    const frontDelay = front[0].startTime - songTimeMs;
    const backDelay  = back[0].startTime  - songTimeMs;
    // アウト時刻: フレーズ終了時刻から少し前
    const frontDur   = Math.max((unit.endTime - front[0].startTime) * 0.95, 300);
    const backDur    = Math.max((unit.endTime - back[0].startTime)  * 0.95, 300);

    const glow = '#39c5bb';
    const textShadow = `0 0 18px ${glow}, 0 0 48px ${glow}`;

    // 前半ブロック（左）
    schedule(() => {
      const el = buildBlockEl(front, baseFront);
      el.className = 'lsp-block lsp-block--left';
      el.style.textShadow = textShadow;
      el.style.animation = `lsp-block-in-left ${frontDur}ms cubic-bezier(.22,.61,.36,1) forwards`;
      layer.appendChild(el);
      schedule(() => el.remove(), frontDur + 50);
    }, frontDelay);

    // 後半ブロック（右）
    schedule(() => {
      const el = buildBlockEl(back, baseBack);
      el.className = 'lsp-block lsp-block--right';
      el.style.textShadow = textShadow;
      el.style.animation = `lsp-block-in-right ${backDur}ms cubic-bezier(.22,.61,.36,1) forwards`;
      layer.appendChild(el);
      schedule(() => el.remove(), backDur + 50);
    }, backDelay);
  }


  // ── 曲終了 遠ざかり演出 ───────────────────────────────────────
  function handleEnd() {
    clearAll();
    const el = document.createElement('div');
    el.className = 'lsp-word';
    el.textContent = 'TAKEOVER';
    el.style.fontSize = '14vw';
    el.style.color = '#ffffff';
    el.style.textShadow = '0 0 24px #39c5bb, 0 0 80px #39c5bb, 0 0 160px #39c5bb';
    el.style.letterSpacing = '0.05em';
    el.style.opacity = '1';
    el.style.animation = 'lsp-recede 3200ms cubic-bezier(.4,0,.8,1) forwards';
    layer.appendChild(el);
    schedule(() => el.remove(), 3300);
  }

  // ── Public API ────────────────────────────────────────────────
  window.Lyrics3D = {
    onEnd() { handleEnd(); },
    onPhrase(unit, songTimeMs) {
      clearAll();
      const words = getWords(unit);
      const special = detectSpecial(words);

      if (special) {
        switch (special.type) {
          case 'triple': handleTriple(special, songTimeMs); break;
        }
      }
    },
  };
})();
