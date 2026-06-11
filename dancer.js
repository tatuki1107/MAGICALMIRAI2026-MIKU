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

const damp = (cur, target, k) => cur + (target - cur) * k;
const C_NORMAL = new THREE.Color(0x39c5bb);
const C_CHORUS = new THREE.Color(0xff70cc);
const tmpCol = new THREE.Color();
const tmpEm  = new THREE.Color();

/**
 * 歌詞同期ダンス
 * L = { phrase: 発声中量0..1, progress: フレーズ進行0..1,
 *       word: 単語アクセント1→0, charTick: 文字アクセント1→0,
 *       side: 腕の左右 ±1, vocal: 声量0..1 }
 */
function tickProcedural(fig, t, beat, cho, L) {
  const r = fig._rig;
  // 歌っている間ほど運動量が上がり、間奏は静かに揺れる
  const energy = 0.35 + L.phrase * 0.4 + L.vocal * 0.45 + cho * 0.3;
  const sp = 1.1 + cho * 0.5;

  // 拍のバウンス (声量で振幅が変わる)
  r.root.position.y = Math.abs(Math.sin(t * sp * 2)) * 0.055 * energy - 0.02;

  // フレーズの進行に合わせて体が左右へ大きくスイング
  const sweep = Math.sin(L.progress * Math.PI * 2) * L.phrase;
  r.hips.rotation.z  = Math.sin(t * sp) * 0.07 * energy + sweep * 0.1;
  r.hips.rotation.y  = Math.sin(t * sp * 0.5) * 0.07 * energy + sweep * 0.2;
  r.spine.rotation.z = -sweep * 0.13 - Math.sin(t * sp + 0.3) * 0.04 * energy;
  r.spine.rotation.x = Math.sin(t * sp * 0.7) * 0.04 * energy;

  // 単語の頭で首を振り、文字の刻みで小さくうなずく
  r.neck.rotation.y = L.side * L.word * 0.3 + Math.sin(t * sp * 1.3) * 0.12 * energy;
  r.neck.rotation.x = -L.word * 0.1 + L.charTick * 0.08 + Math.sin(t * sp * 0.9) * 0.05;

  // 腕: 単語ごとに左右交互に突き上げ、歌っていない間はゆったり揺れる
  const idle = Math.sin(t * sp) * 0.5 * energy;
  const lift = L.word * (1.7 + cho * 0.6);
  const up   = L.side > 0 ? r.la : r.ra;
  const dn   = L.side > 0 ? r.ra : r.la;
  const sgn  = L.side > 0 ? 1 : -1;

  up.sh.rotation.x = damp(up.sh.rotation.x, -lift + idle * (1 - L.word) * 0.6, 0.3);
  up.sh.rotation.z = damp(up.sh.rotation.z, sgn * (0.22 + L.word * 0.55), 0.3);
  up.el.rotation.x = damp(up.el.rotation.x, L.word * 0.5 + Math.max(0, idle) * (1 - L.word), 0.3);

  dn.sh.rotation.x = damp(dn.sh.rotation.x, -idle * 0.6, 0.2);
  dn.sh.rotation.z = damp(dn.sh.rotation.z, -sgn * 0.22, 0.2);
  dn.el.rotation.x = damp(dn.el.rotation.x, Math.max(0, -idle) * 0.7, 0.2);

  // 足は拍でステップ、運動量に追従
  r.ll.hip.rotation.x = Math.sin(t * sp) * 0.42 * energy;
  r.rl.hip.rotation.x = Math.sin(t * sp + Math.PI) * 0.42 * energy;
  r.ll.kn.rotation.x = Math.max(0, Math.sin(t * sp + Math.PI * 0.5)) * 0.5 * energy;
  r.rl.kn.rotation.x = Math.max(0, Math.sin(t * sp + Math.PI * 1.5)) * 0.5 * energy;

  // 色: サビで桃色へ、単語アクセントで発光が強まる
  tmpCol.lerpColors(C_NORMAL, C_CHORUS, cho);
  tmpEm.copy(tmpCol).multiplyScalar(0.2 + L.word * 0.4 + beat * 0.15);
  fig._mats.forEach(m => { m.color.copy(tmpCol); m.emissive.copy(tmpEm); });

  fig.scale.setScalar(1 + beat * 0.04 + L.word * 0.05);
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
// 歌詞同期の状態
let prevWordStart = -1, wordPulse = 0, armSide = 1;
let prevCharStart = -1, charPulse = 0;
let phraseAmt = 0, vocalAmt = 0;
const clock = new THREE.Clock();

// ── Camera shot system (spherical coords) ──────────────────
// az: 方位角(deg), el: 仰角(deg), r: 距離, ly: lookAt Y, f: FOV
const SHOTS = [
  { az:   0, el:  5,  r: 4.2, ly: 1.0,  f: 36 }, // 0 FRONT
  { az:   5, el: 38,  r: 4.6, ly: 0.85, f: 38 }, // 1 HIGH (俯瞰)
  { az:   0, el:  8,  r: 1.9, ly: 1.58, f: 26 }, // 2 CLOSE (顔アップ)
  { az: -55, el:  5,  r: 4.2, ly: 1.0,  f: 40 }, // 3 SIDE_L
  { az:  55, el:  5,  r: 4.2, ly: 1.0,  f: 40 }, // 4 SIDE_R
  { az: 175, el: 28,  r: 4.5, ly: 1.1,  f: 44 }, // 5 BACK (後ろ俯瞰)
];
const VERSE_SEQ  = [0, 3, 1, 4, 2, 5, 0, 4];
const CHORUS_SEQ = [0, 2, 5, 1, 4, 3];

let shotSeqIdx    = 0;
let prevPhraseIdx = -1;
// 現在の球座標パラメータ (常に lerp で更新)
let curAz  = 0, curEl  = 5,  curR  = 4.2, curLy  = 1.0, curFov  = 36;
let tgtAz  = 0, tgtEl  = 5,  tgtR  = 4.2, tgtLy  = 1.0, tgtFov  = 36;

(function animate() {
  requestAnimationFrame(animate);
  const dt  = clock.getDelta();
  const t   = clock.elapsedTime;
  const mb  = window.MusicBG || {};
  const lyr = mb.lyric || {};
  const playing = mb.isPlaying || false;

  if (mb.beatIndex !== prevBeat && mb.beatIndex >= 0) { beatPulse = 1; prevBeat = mb.beatIndex; }
  beatPulse = Math.max(0, beatPulse - 0.055);
  choAmt   += ((mb.isChorus ? 1 : 0) - choAmt) * 0.04;

  // 単語の頭でパルスを立て、腕を振る側を左右交互に切り替える
  if (lyr.wordStart !== prevWordStart && lyr.wordStart >= 0) {
    wordPulse = 1;
    armSide   = -armSide;
    prevWordStart = lyr.wordStart;
  }
  wordPulse = Math.max(0, wordPulse - dt * 3.2);

  // 文字の刻み (うなずき用の短いパルス)
  if (lyr.charStart !== prevCharStart && lyr.charStart >= 0) {
    charPulse = 1;
    prevCharStart = lyr.charStart;
  }
  charPulse = Math.max(0, charPulse - dt * 7);

  phraseAmt += (((playing && lyr.active) ? 1 : 0) - phraseAmt) * 0.08;
  vocalAmt  += ((playing ? (lyr.vocal || 0) : 0) - vocalAmt) * 0.18;

  if (figure) {
    if (mixer) {
      // 歌声に合わせてアニメーション速度を変える
      mixer.update(playing ? dt * (0.7 + phraseAmt * 0.4 + vocalAmt * 0.3) : 0);
    }

    if (isProcedural) {
      if (playing) {
        tickProcedural(figure, t, beatPulse, choAmt, {
          phrase:   phraseAmt,
          progress: lyr.progress || 0,
          word:     wordPulse,
          charTick: charPulse,
          side:     armSide,
          vocal:    vocalAmt,
        });
      } else {
        figure._rig.neck.rotation.y = Math.sin(t * 0.6) * 0.1;
        figure._rig.root.position.y = Math.sin(t * 0.9) * 0.015;
        figure.scale.setScalar(1);
      }
    } else {
      figure.scale.setScalar(1 + beatPulse * 0.03 + wordPulse * 0.04);
    }

    figure.rotation.y = Math.sin(t * 0.28) * 0.18;
  }

  tmpCol.lerpColors(C_NORMAL, C_CHORUS, choAmt);
  key.color.copy(tmpCol);
  key.intensity = 2.5 + beatPulse * 2.5 + choAmt * 1.5 + wordPulse * 1.2;
  fill.intensity = 1.2 + choAmt * 1.0;

  // ── Camera — フレーズごとにショット切り替え、弧を描いて移動 ──
  const phraseIdx = mb.phraseIndex || 0;
  if (phraseIdx !== prevPhraseIdx) {
    prevPhraseIdx = phraseIdx;
    shotSeqIdx++;
    const seq  = choAmt > 0.5 ? CHORUS_SEQ : VERSE_SEQ;
    const shot = SHOTS[seq[shotSeqIdx % seq.length]];
    tgtAz  = shot.az;
    tgtEl  = shot.el;
    tgtR   = shot.r;
    tgtLy  = shot.ly;
    tgtFov = shot.f;
  }
  // 方位角は最短経路でゆっくり補間 (直線ではなく弧)
  const azDiff = ((tgtAz - curAz + 540) % 360) - 180;
  const k = 0.014; // ゆっくり
  curAz  += azDiff * k;
  curEl  += (tgtEl  - curEl)  * k;
  curR   += (tgtR   - curR)   * k;
  curLy  += (tgtLy  - curLy)  * k;
  curFov += (tgtFov - curFov) * k;

  // 球座標 → XYZ に変換してカメラ位置を計算
  const azRad = curAz * Math.PI / 180;
  const elRad = curEl * Math.PI / 180;
  const cosEl = Math.cos(elRad);
  const bx = Math.sin(t * 0.17) * 0.04 + (Math.random() - 0.5) * beatPulse * 0.02;
  const by = Math.sin(t * 0.23) * 0.03 + (Math.random() - 0.5) * beatPulse * 0.015;
  camera.position.set(
    Math.sin(azRad) * cosEl * curR + bx,
    Math.sin(elRad) * curR + 1.0   + by,
    Math.cos(azRad) * cosEl * curR,
  );
  camera.lookAt(0, curLy + wordPulse * 0.06, 0);
  camera.fov = curFov;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
})();
