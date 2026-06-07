import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('dancer-canvas');
if (!canvas) throw new Error('dancer-canvas missing');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
camera.position.set(0, 1.1, 4.2);
camera.lookAt(0, 1.0, 0);

// Lights
const ambient = new THREE.AmbientLight(0x112244, 2.5);
scene.add(ambient);

const key = new THREE.DirectionalLight(0x39c5bb, 3.5);
key.position.set(1.5, 3, 2);
scene.add(key);

const fill = new THREE.DirectionalLight(0xff88cc, 1.8);
fill.position.set(-2, 1.5, 1.5);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffd166, 2.5);
rim.position.set(0, 1, -4);
scene.add(rim);

function onResize() {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
onResize();
new ResizeObserver(onResize).observe(canvas.parentElement || canvas);

// ── Procedural humanoid ──────────────────────────────────────
function buildFigure() {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({
    color: 0x39c5bb, emissive: 0x061e16, specular: 0x88ffee, shininess: 90,
  });

  const bx = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat.clone());
  const sp = (r) => new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat.clone());

  const root = new THREE.Group();
  g.add(root);

  const hips = new THREE.Group();
  hips.position.y = 0.93;
  root.add(hips);
  hips.add(bx(0.34, 0.2, 0.18));

  const spine = new THREE.Group();
  spine.position.y = 0.17;
  hips.add(spine);

  const torsoM = bx(0.38, 0.44, 0.2);
  torsoM.position.y = 0.22;
  spine.add(torsoM);

  const neck = new THREE.Group();
  neck.position.y = 0.46;
  spine.add(neck);
  const headM = sp(0.155);
  headM.position.y = 0.155;
  neck.add(headM);

  function arm(side) {
    const sh = new THREE.Group();
    sh.position.set(side * 0.25, 0.37, 0);
    spine.add(sh);
    const ua = bx(0.1, 0.3, 0.1);
    ua.position.y = -0.15;
    sh.add(ua);
    const el = new THREE.Group();
    el.position.y = -0.3;
    sh.add(el);
    const fa = bx(0.08, 0.27, 0.08);
    fa.position.y = -0.135;
    el.add(fa);
    return { sh, el };
  }

  function leg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0, 0);
    hips.add(hip);
    const th = bx(0.13, 0.36, 0.13);
    th.position.y = -0.18;
    hip.add(th);
    const kn = new THREE.Group();
    kn.position.y = -0.36;
    hip.add(kn);
    const sh = bx(0.1, 0.33, 0.1);
    sh.position.y = -0.165;
    kn.add(sh);
    return { hip, kn };
  }

  const la = arm(1), ra = arm(-1);
  const ll = leg(1), rl = leg(-1);

  g._rig = { root, hips, spine, neck, head: headM, la, ra, ll, rl };
  g._mats = scene.children.flatMap ? [] : [];
  // collect all materials for color updates
  g.traverse(o => { if (o.isMesh) g._mats.push(o.material); });

  return g;
}

function tickProcedural(fig, t, beat, cho) {
  const r = fig._rig;
  const sp = 1.15 + cho * 0.75;
  const am = 0.8 + cho * 0.5;

  r.root.position.y = Math.abs(Math.sin(t * sp * 2)) * 0.055 * am - 0.02;
  r.hips.rotation.z = Math.sin(t * sp) * 0.13 * am;
  r.hips.rotation.y = Math.sin(t * sp * 0.5) * 0.1 * am;
  r.spine.rotation.z = -Math.sin(t * sp + 0.3) * 0.07;
  r.spine.rotation.x = Math.sin(t * sp * 0.7) * 0.05;
  r.neck.rotation.y = Math.sin(t * sp * 1.3) * 0.22 * am;
  r.neck.rotation.x = Math.sin(t * sp * 0.9) * 0.07;

  r.la.sh.rotation.x = Math.sin(t * sp + Math.PI) * 0.95 * am;
  r.la.sh.rotation.z = 0.22 + Math.sin(t * sp * 0.5) * 0.14;
  r.ra.sh.rotation.x = Math.sin(t * sp) * 0.95 * am;
  r.ra.sh.rotation.z = -(0.22 + Math.sin(t * sp * 0.5 + Math.PI) * 0.14);
  r.la.el.rotation.x = Math.max(0, Math.sin(t * sp + Math.PI)) * am;
  r.ra.el.rotation.x = Math.max(0, Math.sin(t * sp)) * am;

  r.ll.hip.rotation.x = Math.sin(t * sp) * 0.48 * am;
  r.rl.hip.rotation.x = Math.sin(t * sp + Math.PI) * 0.48 * am;
  r.ll.kn.rotation.x = Math.max(0, Math.sin(t * sp + Math.PI * 0.5)) * 0.55 * am;
  r.rl.kn.rotation.x = Math.max(0, Math.sin(t * sp + Math.PI * 1.5)) * 0.55 * am;

  const cn = new THREE.Color(0x39c5bb);
  const cc = new THREE.Color(0xff70cc);
  const col = new THREE.Color().lerpColors(cn, cc, cho);
  const em = col.clone().multiplyScalar(0.25);
  fig._mats.forEach(m => { m.color.copy(col); m.emissive.copy(em); });

  fig.scale.setScalar(1 + beat * 0.055);
}

// ── GLTF loading ─────────────────────────────────────────────
let figure = null;
let mixer  = null;
let isProcedural = false;

new GLTFLoader().load(
  './model.glb',
  (gltf) => {
    figure = gltf.scene;
    const box3 = new THREE.Box3().setFromObject(figure);
    const sz   = box3.getSize(new THREE.Vector3());
    const ct   = box3.getCenter(new THREE.Vector3());
    const s    = 1.9 / Math.max(sz.x, sz.y, sz.z);
    figure.scale.setScalar(s);
    figure.position.set(-ct.x * s, -box3.min.y * s, -ct.z * s);

    if (gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(figure);
      gltf.animations.forEach(c => mixer.clipAction(c).play());
    }
    scene.add(figure);
  },
  undefined,
  () => {
    isProcedural = true;
    figure = buildFigure();
    scene.add(figure);
  },
);

// ── Render loop ───────────────────────────────────────────────
let prevBeat = -1, beatPulse = 0, choAmt = 0;
const clock = new THREE.Clock();

(function animate() {
  requestAnimationFrame(animate);
  const dt  = clock.getDelta();
  const t   = clock.elapsedTime;
  const mb  = window.MusicBG || {};
  const playing = mb.isPlaying || false;

  if (mb.beatIndex !== prevBeat && mb.beatIndex >= 0) { beatPulse = 1; prevBeat = mb.beatIndex; }
  beatPulse = Math.max(0, beatPulse - 0.055);
  choAmt   += ((mb.isChorus ? 1 : 0) - choAmt) * 0.04;

  if (figure) {
    if (mixer) mixer.update(playing ? dt : 0);

    if (isProcedural) {
      if (playing) {
        tickProcedural(figure, t, beatPulse, choAmt);
      } else {
        figure._rig.neck.rotation.y = Math.sin(t * 0.6) * 0.1;
        figure._rig.root.position.y = Math.sin(t * 0.9) * 0.015;
        figure.scale.setScalar(1);
      }
    } else {
      figure.scale.setScalar(1 + beatPulse * 0.03);
    }

    figure.rotation.y = Math.sin(t * 0.28) * 0.18;
  }

  const cn = new THREE.Color(0x39c5bb);
  const cc = new THREE.Color(0xff70cc);
  const lc = new THREE.Color().lerpColors(cn, cc, choAmt);
  key.color.copy(lc);
  key.intensity = 2.5 + beatPulse * 2.5 + choAmt * 1.5;
  fill.intensity = 1.2 + choAmt * 1.0;

  renderer.render(scene, camera);
})();
