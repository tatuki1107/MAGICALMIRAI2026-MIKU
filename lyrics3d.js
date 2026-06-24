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
    onPhrase() { clearAll(); },
  };
})();
