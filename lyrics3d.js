/**
 * lyrics3d.js — 3D Lyric PV Engine
 * TextAlive App API × Three.js
 * Pattern system: { patternId, params } based design
 */

import * as THREE from 'three';

// ── Renderer ─────────────────────────────────────────────────
const canvas = document.getElementById('lyrics3d-canvas');
if (!canvas) throw new Error('lyrics3d-canvas not found');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
camera.position.set(0, 0, 9);
camera.lookAt(0, 0, 0);

function onResize() {
  const w = canvas.clientWidth  || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
onResize();
new ResizeObserver(onResize).observe(canvas.parentElement || canvas);

// ── Font preload ──────────────────────────────────────────────
document.fonts.load("900 72px 'Noto Sans JP'").catch(() => {});

// ── Visible-width at z=0 ─────────────────────────────────────
function visibleWidth() {
  // half-width = tan(fov/2) * distance * aspect
  const fovRad = camera.fov * (Math.PI / 180);
  return 2 * Math.tan(fovRad / 2) * camera.position.z * camera.aspect;
}

// ── Easing ───────────────────────────────────────────────────
const easeOut2 = t => 1 - (1 - t) ** 2;
const easeOut4 = t => 1 - (1 - t) ** 4;
const spring   = t => 1 + 2.5 * (t - 1) ** 3 + 1.5 * (t - 1) ** 2;
const clamp    = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Text mesh factory ────────────────────────────────────────
function makeTextMesh(text, { meshHeight = 1.6, glowColor = '#39c5bb', textColor = '#ffffff' } = {}) {
  const fs   = 76;
  const font = `900 ${fs}px 'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif`;

  const tmp = document.createElement('canvas').getContext('2d');
  tmp.font  = font;
  const tw  = tmp.measureText(text).width;

  const pad = fs * 0.55;
  const W   = Math.ceil(tw + pad * 2);
  const H   = Math.ceil(fs * 1.72);
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.font          = font;
  ctx.textBaseline  = 'middle';
  ctx.textAlign     = 'left';

  // Outer glow
  ctx.shadowColor = glowColor;
  ctx.shadowBlur  = 28;
  ctx.fillStyle   = glowColor;
  ctx.fillText(text, pad, H / 2);
  // Mid glow
  ctx.shadowBlur  = 12;
  ctx.fillStyle   = textColor;
  ctx.fillText(text, pad, H / 2);
  // Sharp text
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = textColor;
  ctx.fillText(text, pad, H / 2);

  const meshW = Math.max(1.5, (W / H) * meshHeight);
  const geo   = new THREE.PlaneGeometry(meshW, meshHeight);
  const tex   = new THREE.CanvasTexture(cvs);
  const mat   = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  return { mesh: new THREE.Mesh(geo, mat), width: meshW, height: meshHeight };
}

// ── Pattern definitions ───────────────────────────────────────
// Each pattern: { init, in, active, out }
// state = { mesh, params, ghosts, phaseStart, phase, ... }

const P = {

  /** A2: FlowThrough — 横から流れ込んで通過 */
  A2: {
    init(s) {
      s.dir   = s.params.dir ?? 1;
      s.baseY = s.params.y   ?? 0;
      s.mesh.position.set(s.dir * 12, s.baseY, s.params.z ?? -1);
      s.mesh.rotation.z = s.dir * 0.1;
    },
    in(s, t) {
      const e = easeOut4(t);
      s.mesh.position.x       = s.dir * 12 * (1 - e);
      s.mesh.material.opacity = clamp(t * 3.5, 0, 1);
      // スライドイン中は傾け、止まる瞬間に水平へ戻す
      s.mesh.rotation.z       = s.dir * 0.1 * (1 - e);
    },
    active(s, _t, mb) {
      s.mesh.rotation.z       = 0;
      s.mesh.position.x      -= s.dir * 0.022 * 60;
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.09);
    },
    out(s, t) {
      // 逆側へ加速して画面外へ抜ける
      s.mesh.position.x      += s.dir * 0.022 * 60 * (2 + t * 4);
      s.mesh.material.opacity = clamp(1 - t * 2.5, 0, 1);
    },
  },

  /** A5: BlurFocus — ぼけから鮮明に（イントロ・落ちサビ） */
  A5: {
    init(s) {
      s.baseY = s.params.y ?? 0;
      s.mesh.position.set(0, s.baseY, -0.5);
      s.mesh.scale.setScalar(1.7);
    },
    in(s, t) {
      const e = easeOut4(t);
      s.mesh.scale.setScalar(1.7 - e * 0.7);
      s.mesh.material.opacity = e;
      s.mesh.position.z       = -0.5 + e * 0.5;
    },
    active(s, _t) {
      s.mesh.position.y       = s.baseY + Math.sin(performance.now() * 0.00085) * 0.13;
      s.mesh.material.opacity = 0.92;
    },
    out(s, t) {
      s.mesh.scale.setScalar(1 + t * 0.55);
      s.mesh.material.opacity = 1 - easeOut2(t);
    },
  },

  /** A6: ZoomIn — 奥から高速で迫る（サビ） */
  A6: {
    init(s) {
      s.mesh.position.set(0, s.params.y ?? 0, -18);
      s.mesh.scale.setScalar(0.2);
    },
    in(s, t) {
      const e               = easeOut4(t);
      s.mesh.position.z     = -18 + e * 18;
      s.mesh.scale.setScalar(0.2 + e * 0.8);
      s.mesh.material.opacity = clamp(t * 4, 0, 1);
    },
    active(s, _t, mb) {
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.16);
      s.mesh.material.opacity = 1;
    },
    out(s, t) {
      s.mesh.position.z      += t * 5;
      s.mesh.material.opacity = 1 - easeOut4(t);
    },
  },

  /** A3: CharPop — バネで跳ねて出現（英語フック） */
  A3: {
    init(s) {
      s.mesh.position.set(s.params.x ?? 0, s.params.y ?? 0, 0.5);
      s.mesh.scale.setScalar(0.04);
    },
    in(s, t) {
      s.mesh.scale.setScalar(spring(clamp(t * 2.2, 0, 1)));
      s.mesh.material.opacity = clamp(t * 7, 0, 1);
    },
    active(s, _t, mb) {
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.11);
    },
    out(s, t) {
      s.mesh.material.opacity = 1 - easeOut4(t);
      s.mesh.scale.setScalar(1 + t * 0.45);
    },
  },

  /** A7: DropIn — 上から落下してバウンド */
  A7: {
    init(s) {
      s.baseY = s.params.y ?? 0;
      s.mesh.position.set(s.params.x ?? 0, s.baseY + 4.5, s.params.z ?? 0);
    },
    in(s, t) {
      s.mesh.position.y       = s.baseY + 4.5 * (1 - spring(clamp(t * 1.3, 0, 1)));
      s.mesh.material.opacity = clamp(t * 4, 0, 1);
    },
    active(s, _t, mb) {
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.09);
    },
    out(s, t) {
      s.mesh.position.y      -= t * 4.5;
      s.mesh.material.opacity = 1 - easeOut2(t);
    },
  },

  /** A8: GlitchFlash — グリッチで点滅しながら出現 */
  A8: {
    init(s) {
      s.baseX = s.params.x ?? 0;
      s.baseY = s.params.y ?? 0;
      s.mesh.position.set(s.baseX, s.baseY, 0);
      s.mesh.material.opacity = 0;
    },
    in(s, t) {
      const flicker = t < 0.65 ? (Math.floor(t * 14) % 2) : 1;
      s.mesh.material.opacity = flicker;
      if (t < 0.65) {
        s.mesh.position.x = s.baseX + (Math.random() - 0.5) * 0.45 * (1 - t);
        s.mesh.position.y = s.baseY + (Math.random() - 0.5) * 0.18;
        s.mesh.scale.setScalar(0.92 + Math.random() * 0.16 * (1 - t));
      } else {
        s.mesh.position.x += (s.baseX - s.mesh.position.x) * 0.4;
        s.mesh.position.y += (s.baseY - s.mesh.position.y) * 0.4;
        s.mesh.scale.setScalar(1);
        s.mesh.material.opacity = 1;
      }
    },
    active(s, _t, mb) {
      s.mesh.material.opacity = 0.96;
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.1);
      if (Math.random() < 0.025) {
        s.mesh.position.x = s.baseX + (Math.random() - 0.5) * 0.12;
      } else {
        s.mesh.position.x += (s.baseX - s.mesh.position.x) * 0.35;
      }
    },
    out(s, t) {
      s.mesh.material.opacity = 1 - t;
      if (Math.random() < 0.08) s.mesh.position.x = s.baseX + (Math.random() - 0.5) * 0.3;
    },
  },

  /** A9: SlideUp — 下から滑り上がる */
  A9: {
    init(s) {
      s.baseY = s.params.y ?? 0;
      s.mesh.position.set(s.params.x ?? 0, s.baseY - 3.8, s.params.z ?? 0);
      s.mesh.material.opacity = 0;
    },
    in(s, t) {
      s.mesh.position.y       = s.baseY - 3.8 * (1 - easeOut4(t));
      s.mesh.material.opacity = clamp(t * 2.8, 0, 1);
    },
    active(s, _t, mb) {
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.08);
    },
    out(s, t) {
      s.mesh.position.y      += t * 3.5;
      s.mesh.material.opacity = 1 - easeOut2(t);
    },
  },

  /** EMPH: EmphasisWord — サビ最長単語を中央で2倍サイズ強調 */
  EMPH: {
    init(s) {
      s.mesh.position.set(0, 0, 0.5);
      s.mesh.scale.setScalar(0.05);
      s.mesh.material.opacity = 0;
    },
    in(s, t) {
      s.mesh.scale.setScalar(spring(clamp(t * 2, 0, 1)));
      s.mesh.material.opacity = clamp(t * 5, 0, 1);
    },
    active(s, _t, mb) {
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.13);
      s.mesh.material.opacity = 1;
    },
    out(s, t) {
      s.mesh.scale.setScalar(1 + t * 0.6);
      s.mesh.material.opacity = 1 - easeOut4(t);
    },
  },

  /** A10: TwistIn — 薄い板から展開する */
  A10: {
    init(s) {
      s.baseY = s.params.y ?? 0;
      s.mesh.position.set(s.params.x ?? 0, s.baseY, 0);
      s.mesh.scale.set(1.35, 0.01, 1);
      s.mesh.material.opacity = 0;
    },
    in(s, t) {
      const e = spring(clamp(t * 1.4, 0, 1));
      s.mesh.scale.set(1.35 - e * 0.35, clamp(e, 0.01, 1), 1);
      s.mesh.material.opacity = clamp(t * 3, 0, 1);
    },
    active(s, _t, mb) {
      s.mesh.scale.setScalar(1 + (mb.beatProgress ?? 0) * 0.1);
    },
    out(s, t) {
      s.mesh.scale.set(1 + t * 0.3, clamp(1 - t * 1.6, 0.01, 1), 1);
      s.mesh.material.opacity = 1 - easeOut2(t);
    },
  },
};

// Exit patterns
const EXIT = {
  B1: (s, t) => { s.mesh.position.z -= t * 9;   s.mesh.material.opacity = 1 - easeOut2(t); },
  B2: (s, t) => { s.mesh.position.y -= t * 4.5; s.mesh.material.opacity = 1 - easeOut2(t); },
  B3: (s, t) => { s.mesh.scale.setScalar(1 - easeOut2(t)); s.mesh.material.opacity = 1 - t; },
  B4: (s, t) => { s.mesh.position.x += t * 6;   s.mesh.material.opacity = 1 - easeOut2(t); },
  B5: (s, t) => { s.mesh.position.x -= t * 6;   s.mesh.material.opacity = 1 - easeOut2(t); },
  B6: (s, t) => { s.mesh.material.opacity = 1 - t; },
};

// ── Emphasis word detection ───────────────────────────────────
function findLongestWord(unit) {
  const words = unit.words
    ?? (unit.children ?? []).filter(c => c.text && /\S/.test(c.text));
  if (!words || words.length === 0) return null;
  let best = null, bestDur = 0;
  for (const w of words) {
    const dur = (w.endTime ?? 0) - (w.startTime ?? 0);
    if (dur > bestDur) { bestDur = dur; best = w; }
  }
  return best && bestDur > 0 ? best : null;
}

// ── Section → Config resolver ────────────────────────────────
let _dirToggle = 1;
const _ySlots  = [-1.2, 0, 1.2, -0.6, 0.6];
let   _yIdx    = 0;
let   _verseIdx = 0;
let   _chorIdx  = 0;

// Verse patterns: 6種類をローテーション
const VERSE_CFGS = [
  (dir, y) => ({ pat: 'A2',  exit: 'B1', meshH: 1.5, glow: '#39c5bb', params: { dir, y } }),
  (_,   y) => ({ pat: 'A9',  exit: 'B2', meshH: 1.5, glow: '#4488ff', params: { y } }),
  (_,   y) => ({ pat: 'A8',  exit: 'B6', meshH: 1.6, glow: '#aaeeff', params: { y } }),
  (_,   y) => ({ pat: 'A10', exit: 'B3', meshH: 1.5, glow: '#39c5bb', params: { y } }),
  (_,   y) => ({ pat: 'A7',  exit: 'B2', meshH: 1.5, glow: '#88ffee', params: { y } }),
  (_,   y) => ({ pat: 'A5',  exit: 'B6', meshH: 1.5, glow: '#39c5bb', params: { y } }),
];

// Chorus patterns: 4種類をローテーション
const CHORUS_CFGS = [
  () => ({ pat: 'A6',  exit: 'B1', meshH: 2.2, glow: '#ff70cc', params: { y: 0 } }),
  () => ({ pat: 'A3',  exit: 'B3', meshH: 2.0, glow: '#ff70cc', params: { y: 0 } }),
  () => ({ pat: 'A7',  exit: 'B1', meshH: 2.2, glow: '#ffd166', params: { y: 0 } }),
  () => ({ pat: 'A10', exit: 'B3', meshH: 2.0, glow: '#ff88cc', params: { y: 0 } }),
];

function resolveConfig(mb, songTime, unit) {
  if (songTime < 12000) {                              // イントロ
    return { pat: 'A5', exit: 'B6', meshH: 1.5, glow: '#39c5bb', params: { y: 0 } };
  }
  if (mb.isChorus) {                                   // サビ
    const emphWord = unit ? findLongestWord(unit) : null;
    if (emphWord) {
      return { pat: 'EMPH', exit: 'B6', meshH: 3.2, glow: '#ff70cc', params: { emphWord } };
    }
    return CHORUS_CFGS[_chorIdx++ % CHORUS_CFGS.length]();
  }
  // Aメロ・Bメロ
  _dirToggle = -_dirToggle;
  const y = _ySlots[_yIdx++ % _ySlots.length];
  return VERSE_CFGS[_verseIdx++ % VERSE_CFGS.length](_dirToggle, y);
}

// ── Ghost trail ───────────────────────────────────────────────
const GHOST_N = 5;

function addGhosts(s) {
  s.ghosts = [];
  for (let i = 0; i < GHOST_N; i++) {
    const g  = s.mesh.clone();
    // Remove scrim child — ghosts don't need backing panels
    while (g.children.length > 0) g.remove(g.children[0]);
    g.material = s.mesh.material.clone();
    g.material.opacity = 0;
    scene.add(g);
    s.ghosts.push(g);
  }
}

function updateGhosts(s) {
  const p  = s.mesh.position;
  const op = s.mesh.material.opacity;
  const sc = s.mesh.scale;

  for (let i = GHOST_N - 1; i >= 0; i--) {
    const g = s.ghosts[i];
    if (i === 0) {
      g.position.lerp(p,  0.18);
      g.scale.copy(sc);
      g.material.opacity = op * 0.42;
    } else {
      g.position.lerp(s.ghosts[i - 1].position, 0.14);
      g.scale.copy(s.ghosts[i - 1].scale);
      g.material.opacity = s.ghosts[i - 1].material.opacity * 0.52;
    }
  }
}

function disposePhrase(s) {
  scene.remove(s.mesh);
  s.mesh.geometry.dispose();
  s.mesh.material.map?.dispose();
  s.mesh.material.dispose();
  s.scrimMat?.dispose();
  s.ghosts.forEach(g => { scene.remove(g); g.material.dispose(); });
  s.dead = true;
}

// ── Phrase pool ───────────────────────────────────────────────
const pool = [];

function spawnPhrase(unit, songTimeMs) {
  const mb  = window.MusicBG || {};
  const cfg = resolveConfig(mb, songTimeMs, unit);
  const dur = unit.endTime - unit.startTime;
  const displayText = (cfg.params?.emphWord?.text ?? unit.text ?? '').toUpperCase();

  const { mesh, width: mw, height: mh } = makeTextMesh(displayText, {
    meshHeight: cfg.meshH,
    glowColor:  cfg.glow,
  });

  // Dark scrim behind text for readability
  const scrimMat = new THREE.MeshBasicMaterial({
    color: 0x020810,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const scrim = new THREE.Mesh(
    new THREE.PlaneGeometry(mw + 0.6, mh + 0.35),
    scrimMat,
  );
  scrim.position.z = -0.04;
  mesh.add(scrim);

  scene.add(mesh);

  // clampScale: max uniform scale so mesh width stays within 90% of screen
  const maxAllowed = visibleWidth() * 0.9;
  const clampScale = mw > maxAllowed ? maxAllowed / mw : 1;

  const pat = P[cfg.pat] || P.A2;
  const s   = {
    mesh,
    scrimMat,
    pattern: pat,
    exitFn:  EXIT[cfg.exit] || EXIT.B6,
    params:  cfg.params || {},
    phase:   'in',
    inDur:   dur * 0.18,
    actDur:  dur * 0.64,
    outDur:  dur * 0.18,
    t0:      performance.now(),
    dead:    false,
    ghosts:  [],
    clampScale,
    meshWidth: mw,
  };

  pat.init(s);
  addGhosts(s);
  pool.push(s);
}

// ── Public API ────────────────────────────────────────────────
window.Lyrics3D = {
  onPhrase(unit, songTimeMs) { spawnPhrase(unit, songTimeMs); },
};

// ── Render loop ───────────────────────────────────────────────
let prevBeat = -1;

(function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const mb  = window.MusicBG || {};

  if (mb.beatIndex !== prevBeat && mb.beatIndex >= 0) prevBeat = mb.beatIndex;

  for (let i = pool.length - 1; i >= 0; i--) {
    const s = pool[i];
    if (s.dead) { pool.splice(i, 1); continue; }

    const elapsed = now - s.t0;

    if (s.phase === 'in') {
      const t = clamp(elapsed / s.inDur, 0, 1);
      s.pattern.in(s, t);
      if (t >= 1) { s.phase = 'active'; s.t0 = now; }
    } else if (s.phase === 'active') {
      const t = clamp(elapsed / s.actDur, 0, 1);
      s.pattern.active(s, t, mb);
      if (t >= 1) { s.phase = 'out'; s.t0 = now; }
    } else {
      const t = clamp(elapsed / s.outDur, 0, 1);
      s.exitFn(s, t);
      if (t >= 1) { disposePhrase(s); continue; }
    }

    // Clamp scale so mesh stays within 90% of visible width (recalc each frame for resize)
    const liveClamp = Math.min(s.clampScale, visibleWidth() * 0.9 / s.meshWidth);
    if (s.mesh.scale.x > liveClamp) s.mesh.scale.multiplyScalar(liveClamp / s.mesh.scale.x);

    // Sync scrim opacity with text opacity
    if (s.scrimMat) s.scrimMat.opacity = s.mesh.material.opacity * 0.52;

    updateGhosts(s);
  }

  renderer.render(scene, camera);
})();
