/**
 * stage3d.js — 3D メインステージ
 * GLB モデルを読み込み、TextAlive の拍・フレーズ・セクション情報に同期して
 * カメラ演出・ライティング・エフェクトを制御する。
 * app.js からのイベントを受け取る公開 API を window.ModelStage として提供する。
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ── DOM / 共有状態 ────────────────────────────────────────────
const canvas = document.getElementById("stage-canvas");
const shotName = document.getElementById("shotName");
const animationName = document.getElementById("animationName");
const statusPill = document.getElementById("status");
const state = window.MusicBG || {};

// ── レンダラー ────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// ── シーン / カメラ / ライト ──────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000308);
// 星空を遠くまで見せるため霧はごく薄く(奥行き程度)
scene.fog = new THREE.FogExp2(0x01030a, 0.006);

const camera = new THREE.PerspectiveCamera(42, 1, 0.08, 120);
camera.position.set(0, 1.45, 7.0);

const modelRoot = new THREE.Group();
scene.add(modelRoot);

const target = new THREE.Vector3(0, 1.35, 0);
const currentTarget = target.clone();
const cameraPos = new THREE.Vector3();

const hemi = new THREE.HemisphereLight(0x89fff4, 0x05000d, 1.15);
scene.add(hemi);

const key = new THREE.DirectionalLight(0x39c5bb, 4.2);
key.position.set(4, 7, 5);
scene.add(key);

const rim = new THREE.DirectionalLight(0xff5ca8, 3.4);
rim.position.set(-5, 3, -5);
scene.add(rim);

const warm = new THREE.PointLight(0xffd166, 3.5, 14);
warm.position.set(0, 2.2, 3.5);
scene.add(warm);

const floorGroup = new THREE.Group();
scene.add(floorGroup);
buildFloor();

// ── 再生状態 ──────────────────────────────────────────────────
let mixer = null;
let modelLoaded = false;
let modelHeight = 2.4;
let modelCenterY = 1.2;
let phrasePulse = 0;
let beatPulse = 0;
let previousBeat = -1;
let lastPhraseIndex = 0;
let previousPlaying = false;
let introTriggered = false;
let outroTriggered = false;
let outroFadeStartTime = -1;
let lastSceneCueId = null;

const OUTRO_FADE_DELAY = 3500;
const OUTRO_FADE_DURATION = 3000;

// 表情モーフ (D-3) — モデルに morphTarget があれば歌唱に同期
let morphMesh = null;
const morph = { mouth: -1, blink: -1, smile: -1 };
let mouthValue = 0;
let blinkValue = 0;
let blinkTimer = 1.5;

// セクション演出 (D-4/D-5) — app.js の section に追従
const SECTION_VIS = {
  intro: { energy: 0.1, motif: 0.2 },
  amelo: { energy: 0.3, motif: 0.25 },
  bmelo: { energy: 0.5, motif: 0.6 },
  chorus: { energy: 1.0, motif: 0.8 },
  interlude: { energy: 0.45, motif: 1.0 },
  finale: { energy: 1.0, motif: 1.0 },
};
let sectionId = "intro";
let sectionEnergy = 0; // 0=静 .. 1=最高潮
let targetEnergy = 0.1;
let motifIntensity = 0; // 信号モチーフ強度 0..1
let targetMotif = 0.2;
let ringPulse = 0;

const clock = new THREE.Clock();
const colorA = new THREE.Color(0x39c5bb);
const colorB = new THREE.Color(0xff5ca8);
const colorC = new THREE.Color(0xffd166);
const tmpColor = new THREE.Color();

// ── Stage spotlight rig ───────────────────────────────────────
const SPOT_COUNT = 0;
const SPOT = {
  baseIntensity: 16,
  beatBoost: 24,
  chorusBoost: 12,
  vocalBoost: 9,
  angle: 0.28,
  penumbra: 0.82,
  distance: 32,
  decay: 1.1,
  height: 7.6,
  ringRadius: 6.6,
  scanRadius: 1.7,
  scanSpeed: 0.5,
  beamOpacity: 0.05,
};
const SPOT_COLORS = [colorA, colorB, colorC, colorB];
const spotAim = new THREE.Vector3();
const spotTmp = new THREE.Color();
let spotTime = 0;
const spotlights = buildSpotlights();

// ── Bloom ───────────────────────────────────────────────────
const BLOOM = {
  strength: 0.55,
  radius: 0.4,
  threshold: 0.82,
  beatBoost: 0.35,
  chorusBoost: 0.3,
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(1, 1),
  BLOOM.strength,
  BLOOM.radius,
  BLOOM.threshold,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
composer.setPixelRatio(renderer.getPixelRatio());

// ── 星空 / オーディオビジュアライザー / 流れ星 ───────────────
const VIZ_BARS = 72;
const VIZ_INNER = 0.7;
const VIZ_MAX_LEN = 3.2;
const vizValues = new Float32Array(VIZ_BARS);
let vizGeo = null;

const SHOOT_MAX = 18;
const SHOOT_HIDDEN = -9999;
const shootState = [];
let shootSpawnTimer = 0;
let shootHeadGeo = null;
let shootLineGeo = null;

const stars = buildStarfield();
scene.add(stars);

const vizGroup = new THREE.Group();
scene.add(vizGroup);
const viz = buildVisualizer();
vizGroup.add(viz);

const shooting = buildShootingStars();
scene.add(shooting.points);
scene.add(shooting.lines);

// ── カメラショット定義 ────────────────────────────────────────
// 各ショットは球座標(az/el/radius)と FOV で定義。
// OPENING/INTRO は特殊用途、SHOTS はフレーズ連動ループ、SCENE_CUES は時刻指定の演出カット。
const OPENING_SHOT = { label: "Opening / Front", az: 0, orbit: 0, el0: 8, el1: 10, radius0: 5.8, radius1: 5.6, y: 1.22, fov: 40 };
const INTRO_SHOT   = { label: "Intro / Fly in",   az: 180, orbit: -180, el0: 32, el1: 10, radius0: 80.0, radius1: 5.8, y: 1.22, fov: 42 };

const SHOTS = [
  { label: "Shot 01 / Front rise", az: -18, orbit: 54, el0: 7, el1: 15, radius0: 7.0, radius1: 6.0, y: 1.18, fov: 42 },
  { label: "Shot 02 / Close face arc", az: 28, orbit: -32, el0: 12, el1: 18, radius0: 3.45, radius1: 3.0, y: 1.48, fov: 31 },
  { label: "Shot 03 / Left runway", az: -82, orbit: 48, el0: 4, el1: 9, radius0: 5.4, radius1: 4.9, y: 1.12, x: -0.18, fov: 38 },
  { label: "Shot 04 / High sweep", az: 142, orbit: 76, el0: 34, el1: 48, radius0: 7.2, radius1: 6.2, y: 1.18, fov: 48 },
  { label: "Shot 05 / Low front", az: 22, orbit: -30, el0: -8, el1: 2, radius0: 5.2, radius1: 4.2, y: 0.9, fov: 46 },
  { label: "Shot 06 / Back halo", az: 176, orbit: 42, el0: 10, el1: 22, radius0: 4.8, radius1: 4.2, y: 1.28, fov: 36 },
  { label: "Shot 07 / Wide front", az: -28, orbit: 62, el0: 7, el1: 13, radius0: 7.8, radius1: 6.6, y: 1.12, fov: 50 },
  { label: "Shot 08 / Side close", az: 84, orbit: -44, el0: 8, el1: 15, radius0: 3.8, radius1: 3.3, y: 1.36, x: 0.18, fov: 33 },
  { label: "Shot 09 / Front drop", az: 18, orbit: -52, el0: 40, el1: 9, radius0: 6.2, radius1: 4.8, y: 1.15, fov: 42 },
  { label: "Shot 10 / Long chase", az: 322, orbit: 68, el0: 3, el1: 10, radius0: 9.0, radius1: 7.2, y: 1.05, x: -0.28, fov: 52 },
];

const SCENE_CUES = [
  { id: "S1",  startMs:  1300, endMs:  2400,
    label: "S1 Face extreme",
    az:   5, orbit:   8, el0: 16, el1: 18, radius0: 1.8, radius1: 1.6, y: 1.65, fov: 22, dur: 1500 },
  { id: "S1b", startMs:  2400, endMs:  3700,
    label: "S1b Bust",
    az:  15, orbit: -18, el0: 12, el1: 14, radius0: 2.8, radius1: 2.6, y: 1.42, fov: 28, dur: 1800 },
  { id: "S2",  startMs:  3700, endMs:  6800,
    label: "S2 Side arc",
    az: -55, orbit:  70, el0:  6, el1: 12, radius0: 4.2, radius1: 3.8, y: 1.15, fov: 38, dur: 2500 },
  { id: "S3",  startMs:  6800, endMs:  8840,
    label: "S3 Diagonal",
    az:  40, orbit: -30, el0:  8, el1: 12, radius0: 3.6, radius1: 3.2, y: 1.22, fov: 34, dur: 1200 },
  { id: "S3a", startMs:  8840, endMs:  9200,
    label: "S3a Arrow snap",
    az:   0, orbit:   0, el0:  8, el1:  8, radius0: 2.6, radius1: 2.6, y: 1.35, fov: 30, dur: 400 },
  { id: "S4",  startMs:  9200, endMs: 12450,
    label: "S4 High angle",
    az: 150, orbit:  60, el0: 38, el1: 50, radius0: 6.0, radius1: 5.2, y: 1.18, fov: 46, dur: 1800 },
  { id: "S6",  startMs: 13400, endMs: 15200,
    label: "S6 Side slide",
    az: -75, orbit:  80, el0:  5, el1: 10, radius0: 4.0, radius1: 3.6, y: 1.10, fov: 38, dur: 900 },
  { id: "S7",  startMs: 15200, endMs: 17400,
    label: "S7 低アングル煽り",
    az:  10, orbit: -20, el0: -12, el1: -6, radius0: 3.2, radius1: 2.8, y: 0.5, fov: 44, dur: 1000 },
  { id: "S8",  startMs: 17400, endMs: 20200,
    label: "S8 Dynamic wide",
    az: -120, orbit: 100, el0:  5, el1: 14, radius0: 6.5, radius1: 5.5, y: 1.10, fov: 50, dur: 1500 },
  { id: "S9",  startMs: 20200, endMs: 22500,
    label: "S9 180ターン",
    az: 175, orbit: 185, el0:  8, el1: 12, radius0: 3.8, radius1: 3.5, y: 1.20, fov: 38, dur: 800 },
  { id: "S10", startMs: 22500, endMs: 99000,
    label: "S10 Outro front",
    az:   0, orbit:   0, el0:  8, el1:  8, radius0: 6.0, radius1: 6.0, y: 1.22, fov: 46, dur: 800 },
];

const cam = {
  az: OPENING_SHOT.az,
  el: OPENING_SHOT.el0,
  radius: OPENING_SHOT.radius0,
  x: 0,
  y: OPENING_SHOT.y,
  fov: OPENING_SHOT.fov,
};

let activeShot = {
  ...OPENING_SHOT,
  startedAt: performance.now(),
  duration: 5000,
  from: { ...cam },
};

let interludeShotIndex = 0;
let interludeNextShotAt = 0;

// ── パーティクルテキスト ──────────────────────────────────────
// spawnBgBoard: DotGothic16 でテキストをタイプライター表示し、dissolve() で流れ出て消える。
// 歌詞 PV エンジンの particle variant から window.ModelStage.spawnParticle() 経由で呼ばれる。
let activeParticle = null;

function drawSpacedText(ctx, text, cx, cy, spacing) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  for (let i = 0; i < chars.length; i += 1) {
    ctx.fillText(chars[i], x + widths[i] / 2, cy);
    x += widths[i] + spacing;
  }
}

function spawnBgBoard(text, color) {
  const col = color || "#39c5bb";
  let mesh = null, geo = null, mat = null, tex = null, cv = null, ctx = null;
  let dissolved = false;
  let rafId = 0;

  const cleanup = () => {
    cancelAnimationFrame(rafId);
    if (mesh) scene.remove(mesh);
    geo?.dispose(); mat?.dispose(); tex?.dispose();
    mesh = geo = mat = tex = cv = ctx = null;
  };

  const build = () => {
    const H = 160;
    const SPACING = 24;
    const FONT_FAMILY = `"DotGothic16", sans-serif`;
    let fontSize = 72;

    const mctx = document.createElement("canvas").getContext("2d");
    const measureW = (fs) => {
      mctx.font = `${fs}px ${FONT_FAMILY}`;
      const ws = [...text].map((c) => mctx.measureText(c).width);
      return ws.reduce((s, w) => s + w, 0) + SPACING * Math.max(0, ws.length - 1);
    };

    const MAX_PLANE_W = 9.0;
    const MAX_CANVAS_W = Math.floor((MAX_PLANE_W / 1.2) * H);
    while (measureW(fontSize) > MAX_CANVAS_W - 80 && fontSize > 24) fontSize -= 4;

    const textW = measureW(fontSize);
    const W = Math.min(Math.ceil(textW) + 100, MAX_CANVAS_W);
    const chars = [...text];

    cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    ctx = cv.getContext("2d");

    const redraw = (count) => {
      ctx.clearRect(0, 0, W, H);
      if (count === 0) { tex.needsUpdate = true; return; }
      ctx.font = `${fontSize}px ${FONT_FAMILY}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.88;
      drawSpacedText(ctx, chars.slice(0, count).join(""), W / 2, H / 2, SPACING);
      tex.needsUpdate = true;
    };

    tex = new THREE.CanvasTexture(cv);
    const planeW = (W / H) * 1.2;
    geo = new THREE.PlaneGeometry(planeW, 1.2);
    mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, modelCenterY + 0.15, -1.5);
    scene.add(mesh);

    let visibleCount = 0;
    const CHAR_MS = Math.max(40, Math.min(100, 700 / chars.length));
    let lastCharAt = performance.now();

    const typeLoop = (now) => {
      if (!mat) return;
      const newChars = Math.floor((now - lastCharAt) / CHAR_MS);
      if (newChars > 0) {
        visibleCount = Math.min(visibleCount + newChars, chars.length);
        lastCharAt = now;
        redraw(visibleCount);
      }
      if (visibleCount < chars.length) {
        rafId = requestAnimationFrame(typeLoop);
      }
    };
    rafId = requestAnimationFrame(typeLoop);
  };

  document.fonts.load(`72px "DotGothic16"`).then(() => {
    if (!dissolved) build();
  });

  return function dissolveBoard() {
    dissolved = true;
    cancelAnimationFrame(rafId);
    if (!mat) return;

    const flowOut = () => {
      if (!mat) return;
      mesh.position.x -= 0.15;
      mat.opacity = Math.max(0, mat.opacity - 0.022);
      if (mat.opacity > 0) {
        rafId = requestAnimationFrame(flowOut);
      } else {
        cleanup();
      }
    };
    rafId = requestAnimationFrame(flowOut);
  };
}

// ── 公開 API (window.ModelStage) ─────────────────────────────
// app.js が onPhrase / onSection / reset を呼び出し、
// 歌詞 PV エンジンが spawnParticle を呼び出す。
window.ModelStage = {
  /** フレーズ開始時にカメラショットを切り替える */
  onPhrase,
  /** セクション変化時にエネルギー・ショットを更新する */
  onSection,
  /** 再生リセット時に全状態を初期値へ戻す */
  reset,
  /** Aha 終了と同時にフェードアウトを即起動する (遅延なし) */
  startOutroFade,
  /** テキストをステージ背景にタイプライター表示し、dissolve 関数を返す */
  spawnParticle(text, color) {
    activeParticle?.dissolve?.();
    activeParticle = { dissolve: spawnBgBoard(text, color) };
    return function dissolve() {
      activeParticle?.dissolve?.();
      activeParticle = null;
    };
  },
};

loadModel();
resize();
window.addEventListener("resize", resize);
requestAnimationFrame(tick);

// ── モデル読み込み ────────────────────────────────────────────
function loadModel() {
  setStageStatus("Loading GLB animation");
  const modelUrl = new URL("./3D/素体9.glb", import.meta.url).href;
  new GLTFLoader().load(
    modelUrl,
    (gltf) => {
      normalizeModel(gltf.scene);
      setupMorphs(gltf.scene);
      modelRoot.add(gltf.scene);

      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        const danceClips = gltf.animations.filter((clip) =>
          typeof clip.name === "string" && clip.name.trim().toLowerCase() === "dance"
        );
        const clipsToPlay = danceClips.length > 0 ? danceClips : gltf.animations;

        clipsToPlay.forEach((clip) => {
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        });
        animationName.textContent = `Animation: ${clipsToPlay.map((clip) => clip.name || "clip").join(", ")}`;
      } else {
        animationName.textContent = "Animation: none";
      }

      modelLoaded = true;
      setStageStatus("Model ready", "ready");
    },
    undefined,
    (error) => {
      console.error(error);
      animationName.textContent = "Animation load failed";
      setStageStatus("GLB load failed", "error");
    },
  );
}

function normalizeModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const targetHeight = 2.28;
  const scale = targetHeight / Math.max(size.y, 0.001);

  object.scale.setScalar(scale);
  object.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  modelHeight = size.y * scale;
  modelCenterY = modelHeight * 0.52;
  target.set(0, modelCenterY, 0);
  currentTarget.copy(target);

  object.traverse((node) => {
    if (!node.isMesh) return;
    node.frustumCulled = false;
    if (node.material) {
      node.material.side = THREE.DoubleSide;
      node.material.needsUpdate = true;
    }
  });
}

function onPhrase(phrase) {
  const index = Math.max(1, Number(phrase.index) || lastPhraseIndex + 1);
  lastPhraseIndex = index;

  let shot = SHOTS[(index - 1) % SHOTS.length];
  if (sectionId === "finale" && shot === SHOTS[3]) {
    shot = SHOTS[9];
  }
  const maxDur = sectionId === "interlude" ? 4200 : 8200;
  const dur = clamp((phrase.endTime - phrase.startTime) || 3600, 1400, maxDur);
  activeShot = {
    ...shot,
    startedAt: performance.now(),
    duration: dur,
    from: { ...cam },
  };

  // 間奏中はサイクルタイマーをフレーズに合わせてカメラが止まらないようにする
  if (sectionId === "interlude") {
    interludeNextShotAt = performance.now() + dur;
  }

  phrasePulse = 1;
  shotName.textContent = shot.label;
}

function reset() {
  activeParticle?.dissolve?.();
  activeParticle = null;
  lastPhraseIndex = 0;
  activeShot = {
    ...OPENING_SHOT,
    startedAt: performance.now(),
    duration: 5000,
    from: { ...cam },
  };
  previousPlaying = false;
  introTriggered = false;
  outroTriggered = false;
  outroFadeStartTime = -1;
  canvas.style.opacity = "1";
  lastSceneCueId = null;
  interludeShotIndex = 0;
  interludeNextShotAt = 0;
  phrasePulse = 0;
  sectionId = "intro";
  targetEnergy = SECTION_VIS.intro.energy;
  targetMotif = SECTION_VIS.intro.motif;
  ringPulse = 0;
  floorGroup.scale.setScalar(1);
  vizValues.fill(0);
  shootState.forEach((s) => {
    s.active = false;
  });
  shootSpawnTimer = 0;
  shotName.textContent = OPENING_SHOT.label;
}

// ── メインループ ──────────────────────────────────────────────
function tick(now) {
  requestAnimationFrame(tick);

  const dt = Math.min(clock.getDelta(), 0.05);
  const playing = !!state.isPlaying;

  // 再生開始 → イントロカメラ（遠くからステージへ飛び込む）
  if (!previousPlaying && playing && !introTriggered) {
    introTriggered = true;
    cam.radius = INTRO_SHOT.radius0;
    cam.el     = INTRO_SHOT.el0;
    cam.az     = INTRO_SHOT.az;
    cam.y      = INTRO_SHOT.y;
    cam.x      = 0;
    cam.fov    = INTRO_SHOT.fov;
    activeShot = {
      ...INTRO_SHOT,
      startedAt: performance.now(),
      duration: 5000,
      from: { ...cam },
    };
    shotName.textContent = INTRO_SHOT.label;
  }

  // 再生終了 → startOutroFade() 未呼出の場合はここでフォールバック
  if (previousPlaying && !playing && lastPhraseIndex > 0 && !outroTriggered) {
    outroTriggered = true;
    if (outroFadeStartTime < 0) outroFadeStartTime = now + OUTRO_FADE_DELAY;
  }

  // フェードアウト
  if (outroTriggered && outroFadeStartTime > 0 && now >= outroFadeStartTime) {
    const fadeProgress = Math.min(1, (now - outroFadeStartTime) / OUTRO_FADE_DURATION);
    canvas.style.opacity = String(1 - fadeProgress);
  }
  previousPlaying = playing;

  // シーン別カメラキュー (S1-S10): 時間ベースで activeShot を決定
  {
    const posMs = state.position || 0;
    const cue = playing && posMs > 0
      ? SCENE_CUES.find(c => posMs >= c.startMs && posMs < c.endMs) ?? null
      : null;
    const cueId = cue ? cue.id : null;
    if (cueId !== lastSceneCueId) {
      lastSceneCueId = cueId;
      if (cue) {
        activeShot = {
          label: cue.label,
          az: cue.az, orbit: cue.orbit,
          el0: cue.el0, el1: cue.el1,
          radius0: cue.radius0, radius1: cue.radius1,
          y: cue.y, fov: cue.fov,
          startedAt: performance.now(),
          duration: cue.dur,
          from: { ...cam },
        };
        shotName.textContent = cue.label;
      }
    }

    if (state.phraseIndex && state.phraseIndex !== lastPhraseIndex) {
      if (!cue) {
        onPhrase(state.phrase || { index: state.phraseIndex, startTime: 0, endTime: 3600 });
      } else {
        lastPhraseIndex = state.phraseIndex;
      }
    }
  }

  // 間奏中: 定期的にショットを切り替えてカメラを動かし続ける
  if (sectionId === "interlude" && playing && interludeNextShotAt > 0 && now >= interludeNextShotAt) {
    interludeShotIndex = (interludeShotIndex + 1) % SHOTS.length;
    const shotDur = 3600 + Math.random() * 1400;
    const shot = SHOTS[interludeShotIndex];
    activeShot = {
      ...shot,
      startedAt: now,
      duration: shotDur,
      from: { ...cam },
    };
    interludeNextShotAt = now + shotDur;
    shotName.textContent = shot.label;
  }

  if (mixer) {
    mixer.update(dt * (playing ? 1 : 0.16));
  }

  if (state.beatIndex !== previousBeat && state.beatIndex >= 0) {
    beatPulse = 1;
    ringPulse = Math.max(ringPulse, 0.6 + 0.4 * motifIntensity);
    previousBeat = state.beatIndex;
  }
  beatPulse = Math.max(0, beatPulse - dt * 4.2);
  phrasePulse = Math.max(0, phrasePulse - dt * 1.7);
  ringPulse = Math.max(0, ringPulse - dt * 1.4);

  updateMorphs(dt);
  updateCamera(now, dt);
  updateScene(dt);

  bloomPass.strength =
    BLOOM.strength + beatPulse * BLOOM.beatBoost + (state.isChorus ? BLOOM.chorusBoost : 0);
  composer.render();
}

function updateCamera(now, dt) {
  const elapsed = now - activeShot.startedAt;
  const p = clamp(elapsed / activeShot.duration, 0, 1);
  const pathP = easeInOutSine(p);
  const settle = easeOutCubic(clamp(elapsed / Math.min(760, activeShot.duration * 0.32), 0, 1));

  // ── アウトロ中は揺れ・ビートパルスを完全に止めて正面に静止させる ──
  const isOutro = outroTriggered;

  const desired = {
    az: activeShot.az + activeShot.orbit * pathP,
    el: lerp(activeShot.el0, activeShot.el1, pathP) + (isOutro ? 0 : Math.sin(now * 0.0007) * 1.2),
    radius: lerp(activeShot.radius0, activeShot.radius1, pathP) - (isOutro ? 0 : beatPulse * 0.08),
    x: activeShot.x || 0,
    y: activeShot.y || modelCenterY,
    fov: activeShot.fov - (isOutro ? 0 : phrasePulse * 1.5),
  };

  const narrowViewport = clamp((0.78 - camera.aspect) / 0.36, 0, 1);
  desired.radius *= 1 + narrowViewport * 0.42;
  desired.fov += narrowViewport * 8;

  cam.az = lerpAngle(activeShot.from.az, desired.az, settle);
  cam.el = lerp(activeShot.from.el, desired.el, settle);
  cam.radius = lerp(activeShot.from.radius, desired.radius, settle);
  cam.x = lerp(activeShot.from.x, desired.x, settle);
  cam.y = lerp(activeShot.from.y, desired.y, settle);
  cam.fov = lerp(activeShot.from.fov, desired.fov, settle);

  if (!state.phraseIndex && !outroTriggered) {
    cam.az += dt * 6;
  }

  const az = THREE.MathUtils.degToRad(cam.az);
  const el = THREE.MathUtils.degToRad(cam.el);
  const cosEl = Math.cos(el);
  const liveY = cam.y + (isOutro ? 0 : (state.lyric?.vocal || 0) * 0.08 + phrasePulse * 0.08);

  target.set(cam.x, liveY, 0);
  currentTarget.lerp(target, 0.16);
  cameraPos.set(
    Math.sin(az) * cosEl * cam.radius,
    currentTarget.y + Math.sin(el) * cam.radius,
    Math.cos(az) * cosEl * cam.radius,
  );

  camera.position.lerp(cameraPos, 0.42);
  camera.lookAt(currentTarget);
  camera.fov += (cam.fov - camera.fov) * 0.18;
  camera.updateProjectionMatrix();
}

function updateScene(dt) {
  const chorus = state.isChorus ? 1 : 0;
  const vocal = state.lyric?.vocal || 0;
  const beat = beatPulse;

  sectionEnergy += (targetEnergy - sectionEnergy) * Math.min(dt * 1.5, 1);
  motifIntensity += (targetMotif - motifIntensity) * Math.min(dt * 1.5, 1);
  const grade = Math.max(chorus, sectionEnergy);

  floorGroup.rotation.y += dt * (0.06 + grade * 0.1);
  stars.rotation.y += dt * 0.006;
  vizGroup.rotation.y += dt * 0.04;

  const ringScale = 1 + ringPulse * 0.22 * (0.5 + motifIntensity);
  floorGroup.scale.setScalar(ringScale);

  tmpColor.copy(colorA).lerp(colorB, grade).lerp(colorC, beat * 0.28);
  key.color.copy(tmpColor);
  key.intensity = 3.2 + beat * 2.6 + vocal * 1.8 + grade * 1.6;
  rim.intensity = 2.5 + phrasePulse * 2.2 + grade * 1.6;
  warm.intensity = 2.2 + beat * 2.4 + phrasePulse * 1.6;

  if (modelLoaded) {
    modelRoot.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      if ("emissiveIntensity" in node.material) {
        node.material.emissiveIntensity = 0.25 + beat * 0.5 + sectionEnergy * 0.6;
      }
    });
  }

  updateVisualizer(dt, beat, vocal, grade);
  updateShootingStars(dt);
  updateSpotlights(dt, beat, chorus, vocal);
}

function startOutroFade() {
  if (outroFadeStartTime > 0) return;
  outroTriggered = true;
  outroFadeStartTime = performance.now();
}


function onSection(section) {
  sectionId = section?.id || "intro";
  const vis = SECTION_VIS[sectionId] || SECTION_VIS.intro;
  targetEnergy = vis.energy;
  targetMotif = vis.motif;

  if (sectionId === "chorus" || sectionId === "finale") {
    const impact = sectionId === "finale" ? SHOTS[6] : SHOTS[3];
    activeShot = {
      ...impact,
      startedAt: performance.now(),
      duration: 5200,
      from: { ...cam },
    };
    phrasePulse = 1;
    ringPulse = 1;
    shotName.textContent = impact.label;
  }

  if (sectionId === "interlude") {
    interludeShotIndex = lastPhraseIndex % SHOTS.length;
    const shotDur = 4000;
    const shot = SHOTS[interludeShotIndex];
    activeShot = {
      ...shot,
      startedAt: performance.now(),
      duration: shotDur,
      from: { ...cam },
    };
    interludeNextShotAt = performance.now() + shotDur;
    shotName.textContent = shot.label;
  }
}

// ── 表情モーフ (D-3) ──────────────────────────────────────────
function setupMorphs(rootObj) {
  morphMesh = null;
  morph.mouth = morph.blink = morph.smile = -1;
  rootObj.traverse((node) => {
    if (morphMesh || !node.isMesh || !node.morphTargetDictionary) return;
    morphMesh = node;
  });
  if (!morphMesh) return;

  const dict = morphMesh.morphTargetDictionary;
  morph.mouth = resolveMorph(dict, ["あ", "aa", "A", "mouth", "口開け", "Fcl_MTH_A", "vrc.v_aa"]);
  morph.blink = resolveMorph(dict, ["まばたき", "blink", "目閉じ", "eye_close", "Fcl_EYE_Close"]);
  morph.smile = resolveMorph(dict, ["笑い", "笑顔", "smile", "joy", "happy", "Fcl_ALL_Joy"]);
}

function resolveMorph(dict, names) {
  for (const name of names) {
    if (name in dict) return dict[name];
  }
  const keys = Object.keys(dict);
  for (const name of names) {
    const hit = keys.find((key) => key.toLowerCase().includes(name.toLowerCase()));
    if (hit) return dict[hit];
  }
  return -1;
}

function updateMorphs(dt) {
  if (!morphMesh || !morphMesh.morphTargetInfluences) return;
  const infl = morphMesh.morphTargetInfluences;
  const playing = !!state.isPlaying;

  const mouthTarget = playing ? state.lyric?.vocal || 0 : 0;
  mouthValue += (mouthTarget - mouthValue) * (mouthTarget > mouthValue ? 0.5 : 0.12);

  blinkTimer -= dt;
  if (blinkTimer <= 0) {
    blinkValue = 1;
    blinkTimer = 2 + Math.random() * 3;
  }
  blinkValue = Math.max(0, blinkValue - dt * 7);

  const smileTarget = sectionId === "chorus" || sectionId === "finale" ? 0.6 : 0;

  if (morph.mouth >= 0) infl[morph.mouth] = clamp(mouthValue, 0, 1);
  if (morph.blink >= 0) infl[morph.blink] = clamp(blinkValue, 0, 1);
  if (morph.smile >= 0) {
    infl[morph.smile] = clamp(infl[morph.smile] + (smileTarget - infl[morph.smile]) * dt * 2, 0, 0.8);
  }
}

function buildSpotlights() {
  const rig = [];
  const beamGeo = SPOT.beamOpacity > 0 ? makeBeamGeometry(SPOT.height + 1.5, SPOT.angle) : null;

  for (let i = 0; i < SPOT_COUNT; i += 1) {
    const baseAngle = (i / SPOT_COUNT) * Math.PI * 2;
    const color = SPOT_COLORS[i % SPOT_COLORS.length];
    const spot = new THREE.SpotLight(
      color.getHex(),
      0,
      SPOT.distance,
      SPOT.angle,
      SPOT.penumbra,
      SPOT.decay,
    );
    spot.position.set(
      Math.cos(baseAngle) * SPOT.ringRadius,
      SPOT.height + (i % 2) * 1.1,
      Math.sin(baseAngle) * SPOT.ringRadius,
    );
    spot.target.position.set(0, modelCenterY, 0);
    scene.add(spot);
    scene.add(spot.target);

    let beam = null;
    if (beamGeo) {
      beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: color.clone(),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      beam.position.copy(spot.position);
      scene.add(beam);
    }

    rig.push({ spot, beam, phase: baseAngle, color });
  }
  return rig;
}

function makeBeamGeometry(length, angle) {
  const baseRadius = Math.tan(angle) * length;
  const geo = new THREE.ConeGeometry(baseRadius, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  geo.rotateX(Math.PI / 2);
  return geo;
}

function updateSpotlights(dt, beat, chorus, vocal) {
  if (!spotlights.length) return;
  spotTime += dt;

  const scanSpeed = SPOT.scanSpeed * (1 + chorus * 1.4);
  const scanRadius = SPOT.scanRadius * (1 + chorus * 0.8);

  for (let i = 0; i < spotlights.length; i += 1) {
    const { spot, beam, phase, color } = spotlights[i];

    spotAim.set(
      Math.sin(spotTime * scanSpeed + phase) * scanRadius,
      modelCenterY + Math.sin(spotTime * scanSpeed * 0.6 + phase * 1.7) * 0.5,
      Math.cos(spotTime * scanSpeed * 0.8 + phase) * scanRadius,
    );
    spot.target.position.lerp(spotAim, 0.1);
    spot.target.updateMatrixWorld();

    spotTmp.copy(color).lerp(colorB, chorus * 0.6);
    spot.color.copy(spotTmp);

    const beatPhase = 0.6 + 0.4 * Math.sin(phase * 2);
    spot.intensity =
      SPOT.baseIntensity +
      beat * SPOT.beatBoost * beatPhase +
      chorus * SPOT.chorusBoost +
      vocal * SPOT.vocalBoost;

    if (beam) {
      beam.lookAt(spot.target.position);
      beam.material.color.copy(spotTmp);
      beam.material.opacity = SPOT.beamOpacity * (0.5 + beat * 0.9 + chorus * 0.5 + vocal * 0.4);
    }
  }
}

function buildFloor() {
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x39c5bb,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  for (let i = 0; i < 9; i += 1) {
    const radius = 1.15 + i * 0.56;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius + 0.012, 96),
      ringMaterial.clone(),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012 + i * 0.001;
    ring.material.opacity = 0.24 - i * 0.016;
    floorGroup.add(ring);
  }
}

function buildStarfield() {
  const count = 1600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const r = 36 + Math.random() * 54;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    tint.copy(colorA).lerp(new THREE.Color(0xffffff), 0.45 + Math.random() * 0.55);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 2.0,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.95,
    vertexColors: true,
    depthWrite: false,
  });
  return new THREE.Points(geo, material);
}

function buildVisualizer() {
  const positions = new Float32Array(VIZ_BARS * 2 * 3);
  for (let i = 0; i < VIZ_BARS; i += 1) {
    const a = (i / VIZ_BARS) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    positions[i * 6] = cx * VIZ_INNER;
    positions[i * 6 + 1] = 0.05;
    positions[i * 6 + 2] = cz * VIZ_INNER;
    positions[i * 6 + 3] = cx * (VIZ_INNER + 0.2);
    positions[i * 6 + 4] = 0.05;
    positions[i * 6 + 5] = cz * (VIZ_INNER + 0.2);
  }
  vizGeo = new THREE.BufferGeometry();
  vizGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: colorA.clone(),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  return new THREE.LineSegments(vizGeo, material);
}

function updateVisualizer(dt, beat, vocal, grade) {
  if (!vizGeo) return;
  const pos = vizGeo.attributes.position.array;
  const t = clock.elapsedTime;
  for (let i = 0; i < VIZ_BARS; i += 1) {
    const shape = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.4 + t * 2.2)) * Math.abs(Math.cos(i * 0.13 - t * 1.3));
    const target = shape * (0.15 + beat * 0.6 + vocal * 1.0);
    vizValues[i] += (target - vizValues[i]) * Math.min(dt * 12, 1);
    const a = (i / VIZ_BARS) * Math.PI * 2;
    const outer = VIZ_INNER + 0.2 + vizValues[i] * VIZ_MAX_LEN;
    pos[i * 6 + 3] = Math.cos(a) * outer;
    pos[i * 6 + 5] = Math.sin(a) * outer;
  }
  vizGeo.attributes.position.needsUpdate = true;
  tmpColor.copy(colorA).lerp(colorB, grade);
  viz.material.color.copy(tmpColor);
  viz.material.opacity = 0.5 + beat * 0.35 + grade * 0.2;
}

function buildShootingStars() {
  const headPos = new Float32Array(SHOOT_MAX * 3).fill(SHOOT_HIDDEN);
  shootHeadGeo = new THREE.BufferGeometry();
  shootHeadGeo.setAttribute("position", new THREE.BufferAttribute(headPos, 3));
  const points = new THREE.Points(
    shootHeadGeo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  const linePos = new Float32Array(SHOOT_MAX * 2 * 3).fill(SHOOT_HIDDEN);
  shootLineGeo = new THREE.BufferGeometry();
  shootLineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lines = new THREE.LineSegments(
    shootLineGeo,
    new THREE.LineBasicMaterial({
      color: 0xbfefff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  for (let i = 0; i < SHOOT_MAX; i += 1) {
    shootState.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 });
  }
  points.frustumCulled = false;
  lines.frustumCulled = false;
  return { points, lines };
}

function spawnShootingStar(star) {
  const angle = Math.random() * Math.PI * 2;
  const r = 22 + Math.random() * 16;
  star.pos.set(Math.cos(angle) * r, 16 + Math.random() * 10, Math.sin(angle) * r);
  const speed = 24 + Math.random() * 18;
  star.vel
    .set(
      -Math.cos(angle) * 0.6 + (Math.random() - 0.5),
      -0.8 - Math.random() * 0.5,
      -Math.sin(angle) * 0.6 + (Math.random() - 0.5),
    )
    .normalize()
    .multiplyScalar(speed);
  star.life = 1.0 + Math.random() * 0.6;
  star.active = true;
}

function updateShootingStars(dt) {
  const headPos = shootHeadGeo.attributes.position.array;
  const linePos = shootLineGeo.attributes.position.array;
  const tailLen = 2.4;

  if (sectionId === "finale") {
    shootSpawnTimer -= dt;
    if (shootSpawnTimer <= 0) {
      const free = shootState.find((s) => !s.active);
      if (free) spawnShootingStar(free);
      shootSpawnTimer = 0.12 + Math.random() * 0.22;
    }
  }

  for (let i = 0; i < SHOOT_MAX; i += 1) {
    const s = shootState[i];
    if (s.active) {
      s.pos.addScaledVector(s.vel, dt);
      s.life -= dt;
      if (s.life <= 0 || s.pos.y < -2) s.active = false;
    }
    if (s.active) {
      const vlen = s.vel.length() || 1;
      headPos[i * 3] = s.pos.x;
      headPos[i * 3 + 1] = s.pos.y;
      headPos[i * 3 + 2] = s.pos.z;
      linePos[i * 6] = s.pos.x;
      linePos[i * 6 + 1] = s.pos.y;
      linePos[i * 6 + 2] = s.pos.z;
      linePos[i * 6 + 3] = s.pos.x - (s.vel.x / vlen) * tailLen;
      linePos[i * 6 + 4] = s.pos.y - (s.vel.y / vlen) * tailLen;
      linePos[i * 6 + 5] = s.pos.z - (s.vel.z / vlen) * tailLen;
    } else {
      headPos[i * 3] = headPos[i * 3 + 1] = headPos[i * 3 + 2] = SHOOT_HIDDEN;
      for (let k = 0; k < 6; k += 1) linePos[i * 6 + k] = SHOOT_HIDDEN;
    }
  }
  shootHeadGeo.attributes.position.needsUpdate = true;
  shootLineGeo.attributes.position.needsUpdate = true;
}

function resize() {
  const width = canvas.clientWidth || window.innerWidth || 1;
  const height = canvas.clientHeight || window.innerHeight || 1;
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function setStageStatus(message, variant) {
  if (!statusPill) return;
  statusPill.textContent = message;
  statusPill.classList.toggle("ready", variant === "ready");
  statusPill.classList.toggle("error", variant === "error");
}

// ── 数学ユーティリティ ────────────────────────────────────────
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return a + delta * t;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}