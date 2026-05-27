(() => {
  'use strict';

  window.MusicBG = {
    beatProgress: 0,
    beatIndex: -1,
    isChorus: false,
    isPlaying: false,
  };

  const canvas = document.getElementById('bg-canvas');
  if (!canvas || !window.THREE) return;

  const THREE = window.THREE;

  // ── Renderer ─────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x000510);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000510, 0.011);

  // Camera: audience looking toward stage
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
  camera.position.set(0, 4.5, 36);

  // ── Resize ───────────────────────────────────────────────────
  function onResize() {
    const parent = canvas.parentElement || canvas;
    const w = parent.clientWidth  || 1;
    const h = parent.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  onResize();
  new ResizeObserver(onResize).observe(canvas.parentElement || canvas);

  // ── Lights ───────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x030a1a, 1.8));

  const rigLeft  = new THREE.PointLight(0x39c5bb, 0.85, 65);
  rigLeft.position.set(-16, 22, 0);
  scene.add(rigLeft);

  const rigRight = new THREE.PointLight(0x5577ff, 0.85, 65);
  rigRight.position.set(16, 22, 0);
  scene.add(rigRight);

  // Beat flash from front-of-house
  const flashLight = new THREE.PointLight(0xffffff, 0, 120);
  flashLight.position.set(0, 14, 20);
  scene.add(flashLight);

  // Stage edge neon glow lights
  const edgeGlowL = new THREE.PointLight(0x39c5bb, 1.2, 22);
  edgeGlowL.position.set(-12, 0.8, 7.5);
  scene.add(edgeGlowL);

  const edgeGlowR = new THREE.PointLight(0x39c5bb, 1.2, 22);
  edgeGlowR.position.set(12, 0.8, 7.5);
  scene.add(edgeGlowR);

  // ── Floor ────────────────────────────────────────────────────
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 80),
    new THREE.MeshPhongMaterial({
      color: 0x01030c,
      specular: 0x081530,
      shininess: 100,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const gridHelper = new THREE.GridHelper(85, 24, 0x08163a, 0x060f2c);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // ── Stage platform ────────────────────────────────────────────
  const stageMesh = new THREE.Mesh(
    new THREE.BoxGeometry(40, 0.55, 25),
    new THREE.MeshPhongMaterial({
      color: 0x030715,
      specular: 0x0c1e50,
      shininess: 160,
    }),
  );
  stageMesh.position.set(0, 0.275, -3);
  scene.add(stageMesh);

  // Neon edge strip at front of stage
  const edgeStripMat = new THREE.MeshBasicMaterial({ color: 0x39c5bb });
  const edgeStrip = new THREE.Mesh(
    new THREE.BoxGeometry(40, 0.06, 0.1),
    edgeStripMat,
  );
  edgeStrip.position.set(0, 0.6, 9.5);
  scene.add(edgeStrip);

  // ── Crowd silhouettes ─────────────────────────────────────────
  const crowdMat  = new THREE.MeshBasicMaterial({ color: 0x010306, transparent: true, opacity: 0.95 });
  const bodyGeo   = new THREE.BoxGeometry(1, 1, 0.28);
  const headGeo   = new THREE.SphereGeometry(0.28, 6, 5);

  for (let row = 0; row < 5; row++) {
    const zRow  = 14 + row * 4.8;
    const count = 13 + row * 3;
    const span  = 26 + row * 7;

    for (let c = 0; c < count; c++) {
      const bodyH = 1.05 + Math.random() * 0.55;
      const xPos  = -span / 2 + (c / (count - 1)) * span + (Math.random() - 0.5) * 1.8;
      const zOff  = zRow + (Math.random() - 0.5) * 1.5;

      const body = new THREE.Mesh(bodyGeo, crowdMat);
      body.scale.y = bodyH;
      body.position.set(xPos, bodyH / 2, zOff);
      scene.add(body);

      const head = new THREE.Mesh(headGeo, crowdMat);
      head.position.set(xPos, bodyH + 0.28, zOff);
      scene.add(head);
    }
  }

  // ── Spotlight beams (ceiling → floor) ────────────────────────
  const BEAM_X      = [-22, -11, 0, 11, 22];
  const COLORS_NORM = [0x39c5bb, 0x4466ff, 0xffd166, 0x4466ff, 0x39c5bb];
  const COLORS_CHO  = [0xff70cc, 0xff3388, 0xffaa22, 0xff3388, 0xff70cc];

  const beams = BEAM_X.map((x, i) => {
    const geo = new THREE.CylinderGeometry(0.07, 2.5, 21, 7, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: COLORS_NORM[i],
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 10.5, -4);
    scene.add(mesh);

    const poolMat = new THREE.MeshBasicMaterial({
      color: COLORS_NORM[i],
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.3, 20), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.58, -4);
    scene.add(pool);

    return { mesh, mat, pool, poolMat, phase: (i / BEAM_X.length) * Math.PI * 2, baseX: x };
  });

  // ── LED backdrop panels ───────────────────────────────────────
  const PANEL_N   = 11;
  const PANEL_H   = 9.5;
  const PANEL_W   = 3.2;
  const PANEL_GAP = 4.3;

  const panels = Array.from({ length: PANEL_N }, (_, i) => {
    const mat = new THREE.MeshPhongMaterial({
      color:    new THREE.Color(0x39c5bb),
      emissive: new THREE.Color(0x061e16),
      specular: new THREE.Color(0x55ffcc),
      shininess: 80,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, PANEL_H, 0.25), mat);
    mesh.position.set(
      (i - (PANEL_N - 1) / 2) * PANEL_GAP,
      PANEL_H / 2,
      -18,
    );
    scene.add(mesh);
    return { mesh, mat, phase: (i / PANEL_N) * Math.PI * 2, h: 1 };
  });

  // ── Haze particles ────────────────────────────────────────────
  const HAZE_N  = 300;
  const hazePos = new Float32Array(HAZE_N * 3);
  for (let k = 0; k < HAZE_N; k++) {
    hazePos[k * 3]     = (Math.random() - 0.5) * 65;
    hazePos[k * 3 + 1] = Math.random() * 24;
    hazePos[k * 3 + 2] = Math.random() * 45 - 22;
  }
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute('position', new THREE.BufferAttribute(hazePos, 3));
  scene.add(new THREE.Points(hazeGeo, new THREE.PointsMaterial({
    color: 0x5577aa,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.22,
  })));

  // ── Confetti (chorus) ─────────────────────────────────────────
  const CONF_N  = 380;
  const confP1  = new Float32Array(CONF_N * 3);
  const confP2  = new Float32Array(CONF_N * 3);
  const confVX  = new Float32Array(CONF_N);
  const confVY  = new Float32Array(CONF_N);

  for (let i = 0; i < CONF_N; i++) {
    confP1[i * 3]     = (Math.random() - 0.5) * 55;
    confP1[i * 3 + 1] = -10 - Math.random() * 10;
    confP1[i * 3 + 2] = (Math.random() - 0.5) * 28 - 5;
    confP2[i * 3]     = confP1[i * 3];
    confP2[i * 3 + 1] = confP1[i * 3 + 1] - Math.random() * 4;
    confP2[i * 3 + 2] = confP1[i * 3 + 2];
    confVX[i]         = (Math.random() - 0.5) * 0.14;
    confVY[i]         = 0.06 + Math.random() * 0.11;
  }

  const confGeo1 = new THREE.BufferGeometry();
  confGeo1.setAttribute('position', new THREE.BufferAttribute(confP1, 3));
  const confMat1 = new THREE.PointsMaterial({
    color: 0xff88cc,
    size: 0.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  scene.add(new THREE.Points(confGeo1, confMat1));

  const confGeo2 = new THREE.BufferGeometry();
  confGeo2.setAttribute('position', new THREE.BufferAttribute(confP2, 3));
  const confMat2 = new THREE.PointsMaterial({
    color: 0x39c5bb,
    size: 0.16,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  scene.add(new THREE.Points(confGeo2, confMat2));

  // ── Color palette ─────────────────────────────────────────────
  const C_N  = new THREE.Color(0x39c5bb);
  const C_C  = new THREE.Color(0xff70cc);
  const E_N  = new THREE.Color(0x061e16);
  const E_C  = new THREE.Color(0x3a0820);
  const col  = new THREE.Color();
  const emit = new THREE.Color();
  const cn   = new THREE.Color();
  const cc   = new THREE.Color();

  // ── State ─────────────────────────────────────────────────────
  let prevBeat = -1;
  let beatPulse = 0;
  let chorus    = 0;
  let camBob    = 0;

  // ── Render loop ───────────────────────────────────────────────
  function animate(ts) {
    requestAnimationFrame(animate);
    const t  = ts * 0.001;
    const mb = window.MusicBG;

    // Beat detection
    if (mb.beatIndex !== prevBeat && mb.beatIndex >= 0) {
      beatPulse = 1;
      prevBeat  = mb.beatIndex;
    }
    beatPulse  = Math.max(0, beatPulse - 0.04);
    chorus    += ((mb.isChorus ? 1 : 0) - chorus) * 0.03;

    col.lerpColors(C_N, C_C, chorus);
    emit.lerpColors(E_N, E_C, chorus);

    // Dynamic lights
    flashLight.intensity  = beatPulse * 4.5;
    flashLight.color.copy(col);
    rigLeft.color.copy(col);
    rigRight.color.copy(col);
    rigLeft.intensity  = 0.5 + beatPulse * 1.6 + chorus * 0.9;
    rigRight.intensity = 0.5 + beatPulse * 1.6 + chorus * 0.9;

    const edgeI = 0.8 + beatPulse * 1.4 + chorus * 0.6;
    edgeGlowL.intensity = edgeI;
    edgeGlowR.intensity = edgeI;
    edgeGlowL.color.copy(col);
    edgeGlowR.color.copy(col);
    edgeStripMat.color.copy(col);

    const playScale = mb.isPlaying ? 1 : 0.28;

    // Spotlight beams: sway + beat pulse
    beams.forEach((b, i) => {
      const sway       = Math.sin(t * 0.4 + b.phase) * 0.22;
      const centerDist = Math.abs(i - 2) / 2;
      const pulse      = 0.09 + beatPulse * 0.22 * (1 - centerDist * 0.15) + chorus * 0.08;
      b.mat.opacity     = (pulse + 0.02) * (playScale * 0.65 + 0.35);
      b.poolMat.opacity = Math.min(0.75, (pulse * 3.0 + beatPulse * 0.3) * (playScale * 0.65 + 0.35));

      cn.set(COLORS_NORM[i]);
      cc.set(COLORS_CHO[i]);
      b.mat.color.lerpColors(cn, cc, chorus);
      b.poolMat.color.lerpColors(cn, cc, chorus);

      b.mesh.rotation.z = sway;
      b.pool.position.x = b.baseX + Math.sin(t * 0.4 + b.phase) * 3.5;
    });

    // LED backdrop panels: wave + beat
    panels.forEach((p, i) => {
      const w1       = Math.sin(t * 1.2 + p.phase) * 0.5 + 0.5;
      const distNorm = Math.abs(i - (PANEL_N - 1) / 2) / ((PANEL_N - 1) / 2);
      const bp       = beatPulse * (1 - distNorm * 0.45);
      const base     = (0.5 + w1 * (1.6 + chorus * 3.0)) * playScale;
      const target   = base + bp * 3.2;

      p.h += (target - p.h) * 0.14;
      p.mesh.scale.y    = p.h;
      p.mesh.position.y = p.h * (PANEL_H / 2);

      p.mat.color.copy(col);
      p.mat.emissive.copy(emit);
      p.mat.emissiveIntensity = 0.1 + bp * 0.9 + chorus * 0.35;
    });

    // Confetti (active during chorus)
    const confTarget  = mb.isChorus ? (0.52 + beatPulse * 0.3) : 0;
    confMat1.opacity += (confTarget       - confMat1.opacity) * 0.06;
    confMat2.opacity += (confTarget * 0.7 - confMat2.opacity) * 0.06;

    if (confMat1.opacity > 0.005) {
      const a1 = confGeo1.attributes.position.array;
      const a2 = confGeo2.attributes.position.array;
      for (let i = 0; i < CONF_N; i++) {
        a1[i * 3]     += confVX[i];
        a1[i * 3 + 1] += confVY[i];
        a2[i * 3]     += confVX[i] * 0.75;
        a2[i * 3 + 1] += confVY[i] * 1.1;
        if (a1[i * 3 + 1] > 28) {
          a1[i * 3]     = (Math.random() - 0.5) * 55;
          a1[i * 3 + 1] = -10 - Math.random() * 5;
          a1[i * 3 + 2] = (Math.random() - 0.5) * 28 - 5;
          a2[i * 3]     = a1[i * 3];
          a2[i * 3 + 1] = a1[i * 3 + 1] - Math.random() * 3;
        }
      }
      confGeo1.attributes.position.needsUpdate = true;
      confGeo2.attributes.position.needsUpdate = true;
    }

    // Camera: gentle audience sway + beat nudge
    camBob += 0.001;
    camera.position.x = Math.sin(camBob * 0.42) * 1.6;
    camera.position.y = 4.5 + Math.sin(camBob * 0.28) * 0.35 + beatPulse * 0.18;
    camera.lookAt(0, 7, 0);

    renderer.render(scene, camera);
  }

  animate(0);
})();
