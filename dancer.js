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

// ── Keypose interpolation system ─────────────────────────────
const easeOutCubic = t => 1 - (1 - t) ** 3;

// 各ポーズ: la/ra = { sh:{x,z}, el:{x} }, spine/hips/neck = {x,y,z}
// la = side:1(右腕), ra = side:-1(左腕)
const POSES = [
  // 0: 片手挙げ (la=右腕を上げる)
  {
    la:    { sh: { x: -2.2, z:  0.20 }, el: { x: 0.20 } },
    ra:    { sh: { x: -0.1, z: -0.20 }, el: { x: 0.10 } },
    spine: { z:  0.05, x:  0.00 },
    hips:  { z:  0.05, y:  0.00 },
    neck:  { y:  0.15, x:  0.00 },
  },
  // 1: 胸の前で両手
  {
    la:    { sh: { x: -0.90, z:  0.30 }, el: { x: 1.10 } },
    ra:    { sh: { x: -0.90, z: -0.30 }, el: { x: 1.10 } },
    spine: { z:  0.00, x:  0.05 },
    hips:  { z:  0.00, y:  0.00 },
    neck:  { y:  0.00, x: -0.10 },
  },
  // 2: 手を横に流す
  {
    la:    { sh: { x:  0.00, z:  1.20 }, el: { x: 0.10 } },
    ra:    { sh: { x:  0.00, z: -1.20 }, el: { x: 0.10 } },
    spine: { z:  0.00, x:  0.00 },
    hips:  { z:  0.08, y:  0.12 },
    neck:  { y:  0.15, x:  0.00 },
  },
  // 3: 腰に手
  {
    la:    { sh: { x:  0.40, z:  0.65 }, el: { x: 1.40 } },
    ra:    { sh: { x:  0.40, z: -0.65 }, el: { x: 1.40 } },
    spine: { z:  0.00, x: -0.05 },
    hips:  { z:  0.00, y:  0.00 },
    neck:  { y:  0.00, x:  0.08 },
  },
  // 4: 指差し (la=右腕を前に伸ばす)
  {
    la:    { sh: { x: -1.40, z:  0.10 }, el: { x: 0.00 } },
    ra:    { sh: { x: -0.20, z: -0.18 }, el: { x: 0.25 } },
    spine: { z: -0.08, x:  0.00 },
    hips:  { z: -0.05, y: -0.12 },
    neck:  { y: -0.20, x: -0.05 },
  },
];

const _kp = {
  cur:          0,
  prev:         0,
  beatBase:     -1,
  transStart:   0,
  transDur:     220, // ms — 素早く移行してピタッと止める
  prevProgress: 1,   // フレーズ頭検知用
  holdUntil:    0,   // 声量ホールド終了時刻 (performance.now ms)
};

/**
 * キーポーズ補間ダンス
 * セクションで緩急:
 *   間奏(lyric.active=false) — ポーズ切り替え停止、軽く揺れるだけ
 *   通常(Aメロ/Bメロ)       — 振幅 60%、4拍ごと切り替え
 *   サビ(isChorus)          — 振幅 100%、2拍ごと切り替え
 */
function tickProcedural(fig, t, beat, cho, L) {
  const r  = fig._rig;
  const mb = window.MusicBG || {};
  const bi = mb.beatIndex ?? 0;

  const isInterlude = !L.phrase || !mb.lyric?.active;
  const isChorus    = mb.isChorus;

  // セクションで切り替え間隔を決定 (間奏はポーズ固定)
  const beatInterval = isChorus ? 2 : 4;
  // 振幅係数: 間奏=0、通常=0.6、サビ=1.0
  const amp = isInterlude ? 0 : isChorus ? 1.0 : 0.6;

  if (!isInterlude) {
    const now = performance.now();
    const prog = L.progress ?? 1;

    // 声量が 0.8 超えた瞬間: 0.3秒ホールド
    if (L.vocal > 0.8 && _kp.holdUntil < now) {
      _kp.holdUntil = now + 300;
    }

    // フレーズ頭(progress が前フレームより大きく巻き戻った): 次ポーズへ即切り替え
    if (_kp.prevProgress > 0.15 && prog < 0.05 && now >= _kp.holdUntil) {
      _kp.prev       = _kp.cur;
      _kp.cur        = (_kp.cur + 1) % POSES.length;
      _kp.beatBase   = bi;
      _kp.transStart = now;
    }
    _kp.prevProgress = prog;

    // ビート定期切り替え (ホールド中はスキップ)
    if (_kp.beatBase < 0) _kp.beatBase = bi;
    if (bi - _kp.beatBase >= beatInterval && now >= _kp.holdUntil) {
      _kp.prev       = _kp.cur;
      _kp.cur        = (_kp.cur + 1) % POSES.length;
      _kp.beatBase   = bi;
      _kp.transStart = now;
    }
  }

  const e  = easeOutCubic(Math.min((performance.now() - _kp.transStart) / _kp.transDur, 1));
  const pA = POSES[_kp.prev];
  const pB = POSES[_kp.cur];
  // amp=0 のときはニュートラル(ゼロ)へ、それ以外はポーズ間を補間
  const lrp = (a, b) => (a + (b - a) * e) * amp;

  // 腕
  r.la.sh.rotation.x = lrp(pA.la.sh.x, pB.la.sh.x);
  r.la.sh.rotation.z = lrp(pA.la.sh.z, pB.la.sh.z);
  r.la.el.rotation.x = lrp(pA.la.el.x, pB.la.el.x);
  r.ra.sh.rotation.x = lrp(pA.ra.sh.x, pB.ra.sh.x);
  r.ra.sh.rotation.z = lrp(pA.ra.sh.z, pB.ra.sh.z);
  r.ra.el.rotation.x = lrp(pA.ra.el.x, pB.ra.el.x);

  // 体幹・首
  r.spine.rotation.z = lrp(pA.spine.z, pB.spine.z);
  r.spine.rotation.x = lrp(pA.spine.x, pB.spine.x);
  r.hips.rotation.z  = lrp(pA.hips.z,  pB.hips.z);
  r.hips.rotation.y  = lrp(pA.hips.y,  pB.hips.y);
  r.neck.rotation.y  = lrp(pA.neck.y,  pB.neck.y) + (isInterlude ? Math.sin(t * 0.7) * 0.1 : 0);
  r.neck.rotation.x  = lrp(pA.neck.x,  pB.neck.x);

  // 膝バウンス — 常時継続
  const kAmp = 0.18 + beat * 0.10;
  r.ll.kn.rotation.x = Math.max(0, Math.sin(t * 4))           * kAmp;
  r.rl.kn.rotation.x = Math.max(0, Math.sin(t * 4 + Math.PI)) * kAmp;

  // 体全体の小さなボブ (間奏はさらに穏やか)
  r.root.position.y = Math.abs(Math.sin(t * 4)) * (isInterlude ? 0.012 : 0.03);

  // 色: サビで桃色へ、ビートで発光が強まる
  tmpCol.lerpColors(C_NORMAL, C_CHORUS, cho);
  tmpEm.copy(tmpCol).multiplyScalar(0.2 + beat * 0.35);
  fig._mats.forEach(m => { m.color.copy(tmpCol); m.emissive.copy(tmpEm); });

  fig.scale.setScalar(1 + beat * 0.04);
}

// ── GLTF loading ─────────────────────────────────────────────
let figure = null;
let mixer  = null;
let isProcedural = false;

new GLTFLoader().load(
  './model.glb',
  // './3D/test-animationn.glb',
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
// az: 方位角(deg), el: 仰角(deg), r: 距離, lx: lookAt X, ly: lookAt Y, f: FOV
// lx>0 → モデルが画面左寄り、lx<0 → 右寄り (字幕との重複を避けやすい)
const SHOTS = [
  { az:   0, el:  5,  r: 4.2, lx:  0.0, ly: 1.0,  f: 36 }, // 0 FRONT (中央)
  { az:   5, el: 38,  r: 4.6, lx:  0.0, ly: 0.85, f: 38 }, // 1 HIGH (俯瞰)
  { az:   0, el:  8,  r: 1.9, lx:  0.0, ly: 1.58, f: 26 }, // 2 CLOSE (顔アップ)
  { az: -55, el:  5,  r: 4.2, lx:  0.0, ly: 1.0,  f: 40 }, // 3 SIDE_L
  { az:  55, el:  5,  r: 4.2, lx:  0.0, ly: 1.0,  f: 40 }, // 4 SIDE_R
  { az: 175, el: 28,  r: 4.5, lx:  0.0, ly: 1.1,  f: 44 }, // 5 BACK (後ろ俯瞰)
  { az:   0, el:  8,  r: 4.0, lx:  1.3, ly: 1.0,  f: 38 }, // 6 LEFT_THIRD (モデル左寄り)
  { az:   0, el:  8,  r: 4.0, lx: -1.3, ly: 1.0,  f: 38 }, // 7 RIGHT_THIRD (モデル右寄り)
];
// 正面ど真ん中(0)が連続しないようにオフセットショットを間に挿入
const VERSE_SEQ  = [6, 3, 7, 1, 6, 4, 7, 5, 6, 2, 7, 3];
const CHORUS_SEQ = [6, 2, 7, 1, 6, 4, 7, 5];

let shotSeqIdx    = 0;
let prevPhraseIdx = -1;
// 現在の球座標パラメータ (常に lerp で更新)
let curAz  = 0, curEl  = 5,  curR  = 4.2, curLx  = 0.0, curLy  = 1.0, curFov  = 36;
let tgtAz  = 0, tgtEl  = 5,  tgtR  = 4.2, tgtLx  = 0.0, tgtLy  = 1.0, tgtFov  = 36;

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
    tgtLx  = shot.lx;
    tgtLy  = shot.ly;
    tgtFov = shot.f;
  }
  // 方位角は最短経路でゆっくり補間 (直線ではなく弧)
  const azDiff = ((tgtAz - curAz + 540) % 360) - 180;
  const k = 0.014; // ゆっくり
  curAz  += azDiff * k;
  curEl  += (tgtEl  - curEl)  * k;
  curR   += (tgtR   - curR)   * k;
  curLx  += (tgtLx  - curLx)  * k;
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
  camera.lookAt(curLx, curLy + wordPulse * 0.06, 0);
  camera.fov = curFov;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
})();
