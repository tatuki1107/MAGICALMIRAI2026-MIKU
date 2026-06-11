/**
 * bg.js — GRAND BLUE background scene
 * ES module | Three.js via importmap
 * Deep blue space: camera tunnel, light streaks, bloom, afterimage
 */

import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass }  from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

// Shared state bus (read by dancer.js / lyrics3d.js / app.js)
window.MusicBG = {
  beatProgress: 0,
  beatIndex:    -1,
  isChorus:     false,
  isPlaying:    false,
  phraseIndex:  0,
  lyric: {
    active:    false,
    progress:  0,
    wordStart: -1,
    charStart: -1,
    vocal:     0,
  },
};

const canvas = document.getElementById('bg-canvas');
if (!canvas) throw new Error('bg-canvas not found');

// ── Renderer ─────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;

// ── Scene ─────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050e22);
scene.fog = new THREE.FogExp2(0x050e22, 0.014);

// ── Camera ─────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 250);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

// ── Lights ─────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x0b1535, 4));

const keyLight = new THREE.DirectionalLight(0x39c5bb, 2.2);
keyLight.position.set(0, 6, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x1a4fb0, 1.4);
fillLight.position.set(-4, 2, 6);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xff88cc, 0.8);
rimLight.position.set(0, 1, -6);
scene.add(rimLight);

// Beat flash
const flashLight = new THREE.PointLight(0xffffff, 0, 60);
flashLight.position.set(0, 0, 8);
scene.add(flashLight);

// ── Star field ─────────────────────────────────────────────────
{
  const STAR_N = 900;
  const pos    = new Float32Array(STAR_N * 3);
  for (let i = 0; i < STAR_N; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 130;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 2] = -Math.random() * 110;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x4488bb,
    size: 0.13,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
  })));
}

// ── Light streaks (速度感: 光の筋がカメラ脇を後方へ流れる) ─────
const STREAK_N  = 72;
const streakArr = [];

function makeStreak() {
  const len = 1.8 + Math.random() * 4.5;
  const geo = new THREE.BoxGeometry(0.014, 0.014, len);
  geo.translate(0, 0, -len / 2);  // pivot at front

  const r = Math.random();
  const color = r < 0.45 ? 0x39c5bb : r < 0.75 ? 0x4488ff : 0xaaeeff;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  resetStreak(mesh, true);
  scene.add(mesh);
  return { mesh, mat, speed: 0.3 + Math.random() * 0.55, len };
}

function resetStreak(mesh, initial = false) {
  const r = 6 + Math.random() * 3;
  const a = Math.random() * Math.PI * 2;
  mesh.position.set(
    Math.cos(a) * r,
    Math.sin(a) * r,
    initial ? (-Math.random() * 70) : (-70),
  );
  mesh.lookAt(mesh.position.x * 0.05, mesh.position.y * 0.05, camera.position.z + 20);
}

for (let i = 0; i < STREAK_N; i++) streakArr.push(makeStreak());

// ── Concentric ring pulses (ミク周囲の波紋) ────────────────────
const ringPool = [];
for (let i = 0; i < 6; i++) {
  const geo = new THREE.RingGeometry(0.9, 0.96, 52);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x39c5bb,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -2.2, 0);
  scene.add(mesh);
  ringPool.push({ mesh, mat, scale: 1, active: false });
}
let ringIdx = 0;

function emitRing(chorus) {
  const r = ringPool[ringIdx % ringPool.length];
  r.scale = 0.8;
  r.mat.opacity = 0.9;
  r.mat.color.set(chorus > 0.5 ? 0xff70cc : 0x39c5bb);
  r.active = true;
  ringIdx++;
}

// ── EffectComposer ─────────────────────────────────────────────
let composer;

function buildComposer(w, h) {
  if (composer) {
    composer.passes.length = 0;
    composer.dispose?.();
  }
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  composer._afterimage = new AfterimagePass(0.88);
  composer.addPass(composer._afterimage);

  composer._bloom = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.42,   // strength
    0.38,   // radius
    0.76,   // threshold
  );
  composer.addPass(composer._bloom);
  composer.addPass(new OutputPass());
}

// ── Resize ─────────────────────────────────────────────────────
function onResize() {
  const w = canvas.clientWidth  || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  buildComposer(w, h);
}
onResize();
new ResizeObserver(onResize).observe(canvas.parentElement || canvas);

// ── State ──────────────────────────────────────────────────────
let prevBeat  = -1;
let beatPulse = 0;
let chorusAmt = 0;
let energy    = 0;
let flashAmt  = 0;
let prevT = 0;

// Reusable color objects (avoid per-frame allocation)
const C_NORMAL = new THREE.Color(0x39c5bb);
const C_CHORUS = new THREE.Color(0xff70cc);
const tmpColor  = new THREE.Color();

// ── Render loop ────────────────────────────────────────────────
function animate(ts) {
  requestAnimationFrame(animate);
  const t  = ts * 0.001;
  const dt = Math.min(t - prevT, 0.05);
  prevT    = t;
  const mb = window.MusicBG;

  // Beat detection
  if (mb.beatIndex !== prevBeat && mb.beatIndex >= 0) {
    beatPulse = 1;
    prevBeat  = mb.beatIndex;
    emitRing(chorusAmt);
  }
  beatPulse  = Math.max(0, beatPulse - 0.052);
  chorusAmt += ((mb.isChorus ? 1 : 0) - chorusAmt) * 0.04;
  energy    += (beatPulse * 0.55 + chorusAmt * 0.45 - energy) * 0.09;

  // Chorus flash
  if (mb.isChorus && beatPulse > 0.88) flashAmt = 1.0;
  flashAmt = Math.max(0, flashAmt - 0.065);

  // Lights
  flashLight.intensity = flashAmt * 5 + beatPulse * 1.5;
  keyLight.intensity   = 1.8 + chorusAmt * 1.8 + beatPulse * 0.8;
  tmpColor.lerpColors(C_NORMAL, C_CHORUS, chorusAmt);
  keyLight.color.copy(tmpColor);
  rimLight.intensity = 0.6 + chorusAmt * 1.4;

  // Bloom & afterimage dynamics
  composer._bloom.strength  = 0.32 + energy * 0.55 + chorusAmt * 0.18;
  composer._bloom.threshold = Math.max(0.55, 0.82 - chorusAmt * 0.25);
  composer._afterimage.uniforms['damp'].value = 0.87 + chorusAmt * 0.05;

  // Light streaks — 音楽と無関係に一定速度で流れる
  const STREAK_SPEED = 0.28;
  for (const s of streakArr) {
    s.mesh.position.z += s.speed * STREAK_SPEED * dt * 60;
    if (s.mesh.position.z > camera.position.z + 2) resetStreak(s.mesh);
    s.mesh.scale.z = 2.2;
    s.mat.opacity  = 0.38;
  }

  // Ring pulses (expand + fade)
  for (const r of ringPool) {
    if (!r.active) continue;
    r.scale          += 0.04 + energy * 0.02;
    r.mat.opacity    -= 0.022;
    r.mesh.scale.setScalar(r.scale);
    r.mesh.rotation.z += 0.004;
    if (r.mat.opacity <= 0) { r.active = false; r.mat.opacity = 0; }
  }

  // Fog / background color: shift hue toward magenta on chorus
  const bgL = 0.05 + chorusAmt * 0.02;
  tmpColor.setHSL(0.62 - chorusAmt * 0.08, 0.85, bgL);
  scene.fog.color.copy(tmpColor);
  scene.background.copy(tmpColor);

  // Camera: gentle bob + energy-driven FOV expansion
  camera.position.x = Math.sin(t * 0.31) * 0.35 + beatPulse * 0.06;
  camera.position.y = Math.sin(t * 0.19) * 0.22 + beatPulse * 0.09;
  camera.fov        = 60 + energy * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0, -6);

  composer.render();
}

animate(0);
