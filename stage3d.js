import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("stage-canvas");
const shotName = document.getElementById("shotName");
const animationName = document.getElementById("animationName");
const statusPill = document.getElementById("status");
const state = window.MusicBG || {};

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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000308);
scene.fog = new THREE.FogExp2(0x000308, 0.035);

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
const railLines = buildRailLines();
scene.add(railLines);

const particles = buildParticles();
scene.add(particles);

let mixer = null;
let modelLoaded = false;
let modelHeight = 2.4;
let modelCenterY = 1.2;
let phrasePulse = 0;
let beatPulse = 0;
let previousBeat = -1;
let lastPhraseIndex = 0;

const clock = new THREE.Clock();
const colorA = new THREE.Color(0x39c5bb);
const colorB = new THREE.Color(0xff5ca8);
const colorC = new THREE.Color(0xffd166);
const tmpColor = new THREE.Color();

const SHOTS = [
  { label: "Shot 01 / Front rise", az: -18, orbit: 54, el0: 7, el1: 15, radius0: 7.0, radius1: 6.0, y: 1.18, fov: 42 },
  { label: "Shot 02 / Close face arc", az: 28, orbit: -32, el0: 12, el1: 18, radius0: 3.45, radius1: 3.0, y: 1.48, fov: 31 },
  { label: "Shot 03 / Left runway", az: -82, orbit: 48, el0: 4, el1: 9, radius0: 5.4, radius1: 4.9, y: 1.12, x: -0.18, fov: 38 },
  { label: "Shot 04 / High sweep", az: 142, orbit: 76, el0: 34, el1: 48, radius0: 7.2, radius1: 6.2, y: 1.18, fov: 48 },
  { label: "Shot 05 / Low chase", az: 212, orbit: -64, el0: -7, el1: 3, radius0: 5.8, radius1: 4.6, y: 0.9, fov: 46 },
  { label: "Shot 06 / Back halo", az: 176, orbit: 42, el0: 10, el1: 22, radius0: 4.8, radius1: 4.2, y: 1.28, fov: 36 },
  { label: "Shot 07 / Wide orbit", az: 250, orbit: 112, el0: 7, el1: 12, radius0: 8.0, radius1: 6.8, y: 1.12, fov: 50 },
  { label: "Shot 08 / Side close", az: 84, orbit: -44, el0: 8, el1: 15, radius0: 3.8, radius1: 3.3, y: 1.36, x: 0.18, fov: 33 },
  { label: "Shot 09 / Spiral drop", az: -132, orbit: 94, el0: 42, el1: 8, radius0: 6.5, radius1: 5.0, y: 1.15, fov: 42 },
  { label: "Shot 10 / Long chase", az: 322, orbit: 68, el0: 3, el1: 10, radius0: 9.0, radius1: 7.2, y: 1.05, x: -0.28, fov: 52 },
];

const cam = {
  az: SHOTS[0].az,
  el: SHOTS[0].el0,
  radius: SHOTS[0].radius0,
  x: 0,
  y: SHOTS[0].y,
  fov: SHOTS[0].fov,
};

let activeShot = {
  ...SHOTS[0],
  startedAt: performance.now(),
  duration: 4200,
  from: { ...cam },
};

window.ModelStage = {
  onPhrase,
  reset,
};

loadModel();
resize();
window.addEventListener("resize", resize);
requestAnimationFrame(tick);

function loadModel() {
  setStageStatus("Loading GLB animation");
  new GLTFLoader().load(
    "./3D/test-animationn.glb",
    (gltf) => {
      normalizeModel(gltf.scene);
      modelRoot.add(gltf.scene);

      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        gltf.animations.forEach((clip) => {
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
        });
        animationName.textContent = `Animation: ${gltf.animations.map((clip) => clip.name || "clip").join(", ")}`;
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

  const shot = SHOTS[(index - 1) % SHOTS.length];
  activeShot = {
    ...shot,
    startedAt: performance.now(),
    duration: clamp((phrase.endTime - phrase.startTime) || 3600, 1400, 8200),
    from: { ...cam },
  };

  phrasePulse = 1;
  shotName.textContent = shot.label;
}

function reset() {
  lastPhraseIndex = 0;
  activeShot = {
    ...SHOTS[0],
    startedAt: performance.now(),
    duration: 4200,
    from: { ...cam },
  };
  phrasePulse = 0;
  shotName.textContent = SHOTS[0].label;
}

function tick(now) {
  requestAnimationFrame(tick);

  const dt = Math.min(clock.getDelta(), 0.05);
  const playing = !!state.isPlaying;

  if (state.phraseIndex && state.phraseIndex !== lastPhraseIndex) {
    onPhrase(state.phrase || { index: state.phraseIndex, startTime: 0, endTime: 3600 });
  }

  if (mixer) {
    mixer.update(dt * (playing ? 1 : 0.16));
  }

  if (state.beatIndex !== previousBeat && state.beatIndex >= 0) {
    beatPulse = 1;
    previousBeat = state.beatIndex;
  }
  beatPulse = Math.max(0, beatPulse - dt * 4.2);
  phrasePulse = Math.max(0, phrasePulse - dt * 1.7);

  updateCamera(now, dt);
  updateScene(dt);
  renderer.render(scene, camera);
}

function updateCamera(now, dt) {
  const elapsed = now - activeShot.startedAt;
  const p = clamp(elapsed / activeShot.duration, 0, 1);
  const pathP = easeInOutSine(p);
  const settle = easeOutCubic(clamp(elapsed / Math.min(760, activeShot.duration * 0.32), 0, 1));

  const desired = {
    az: activeShot.az + activeShot.orbit * pathP,
    el: lerp(activeShot.el0, activeShot.el1, pathP) + Math.sin(now * 0.0007) * 1.2,
    radius: lerp(activeShot.radius0, activeShot.radius1, pathP) - beatPulse * 0.08,
    x: activeShot.x || 0,
    y: activeShot.y || modelCenterY,
    fov: activeShot.fov - phrasePulse * 1.5,
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

  if (!state.phraseIndex) {
    cam.az += dt * 6;
  }

  const az = THREE.MathUtils.degToRad(cam.az);
  const el = THREE.MathUtils.degToRad(cam.el);
  const cosEl = Math.cos(el);
  const liveY = cam.y + (state.lyric?.vocal || 0) * 0.08 + phrasePulse * 0.08;

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

  floorGroup.rotation.y += dt * (0.06 + chorus * 0.08);
  railLines.rotation.y -= dt * (0.025 + chorus * 0.04);
  particles.rotation.y += dt * 0.012;

  tmpColor.copy(colorA).lerp(colorB, chorus).lerp(colorC, beat * 0.28);
  key.color.copy(tmpColor);
  key.intensity = 3.2 + beat * 2.6 + vocal * 1.8 + chorus * 1.2;
  rim.intensity = 2.5 + phrasePulse * 2.2 + chorus * 1.4;
  warm.intensity = 2.2 + beat * 2.4 + phrasePulse * 1.6;

  if (modelLoaded) {
    modelRoot.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      if ("emissiveIntensity" in node.material) {
        node.material.emissiveIntensity = 0.15 + beat * 0.35 + chorus * 0.2;
      }
    });
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

  const spokeMaterial = new THREE.LineBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.18,
  });
  const positions = [];
  for (let i = 0; i < 28; i += 1) {
    const a = (i / 28) * Math.PI * 2;
    positions.push(Math.cos(a) * 1.0, 0.018, Math.sin(a) * 1.0);
    positions.push(Math.cos(a) * 6.1, 0.018, Math.sin(a) * 6.1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  floorGroup.add(new THREE.LineSegments(geo, spokeMaterial));
}

function buildRailLines() {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0xff5ca8,
    transparent: true,
    opacity: 0.22,
  });
  const positions = [];

  for (let i = 0; i < 34; i += 1) {
    const a = (i / 34) * Math.PI * 2;
    const inner = 4.4 + (i % 3) * 0.28;
    const outer = 9.0 + (i % 4) * 0.45;
    const y0 = 0.55 + (i % 5) * 0.16;
    const y1 = 3.8 + (i % 6) * 0.34;
    positions.push(Math.cos(a) * inner, y0, Math.sin(a) * inner);
    positions.push(Math.cos(a + 0.12) * outer, y1, Math.sin(a + 0.12) * outer);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  group.add(new THREE.LineSegments(geo, material));
  return group;
}

function buildParticles() {
  const count = 320;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 8 + Math.random() * 28;
    const angle = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0.8 + Math.random() * 12;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xb9fff5,
    size: 0.025,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  return new THREE.Points(geo, material);
}

function resize() {
  const width = canvas.clientWidth || window.innerWidth || 1;
  const height = canvas.clientHeight || window.innerHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function setStageStatus(message, variant) {
  if (!statusPill) return;
  statusPill.textContent = message;
  statusPill.classList.toggle("ready", variant === "ready");
  statusPill.classList.toggle("error", variant === "error");
}

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
