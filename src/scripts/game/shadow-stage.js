// Shadow mode stage, added to a cube scene: a wall a little behind the plate with the shadow on it, a stylised sun
// (light theme) or full moon (dark theme), facing the viewer, on the other side – and between them a soft beam of
// light with a little dust floating in it. Light from the front → back wall; from the right → left wall.
//
// The wall is a canvas texture: lit where the beam falls, the shadow half-transparent with a soft edge (penumbra),
// drawn cell by cell (exact, cheap – no real-time shadow maps); the grid stays visible so cubes can be counted.
// compare(candidate): the picked building's shadow laid over the wanted one – extra cells hatched, missing ones
// dashed (never colour alone).
// The dust is the only thing that moves: ~30 frames a second, paused while the stage is off screen or the tab is
// hidden, standing still with prefers-reduced-motion. It belongs to the room (see moveDust) – the light moves, not it.
import * as THREE from 'three';

const PX = 96;          // texture pixels per cube
const MARGIN = 0.12;    // wall border around the cells (world units)
const DUST = 220;       // dust specks in the room (only those in the beam are seen)
const FPS = 30;
// next puzzle: the old shadow fades out, the stage turns to the new side (and springs to a new grid size together
// with the plate – same timing and curve as GROW in scene.js), then the new shadow fades in. Nothing pops.
const TURN_MS = 750;
const GROW_MS = 700;
const FADE_MS = 280;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutElastic = t => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-9 * t) * Math.sin((t * 8 - 0.75) * ((2 * Math.PI) / 3)) + 1);

// Beam and dust count as opaque objects with their own blending, drawn after the cubes (high renderOrder, depth test
// on – hidden behind solid cubes, laid over what is in front): so they are part of the picture three.js draws for
// see-through materials (the slime's transmission refracts what is behind it – transparent objects would be missing
// there and leave dark cube-shaped holes in the light), and cubes fading in (transparent, drawn later) cut no holes.
const GLOW_BLENDING = {
  transparent: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  depthWrite: false,
};

const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const COLORS = {
  dark: {
    wall: '#2e3546', lit: '#5d6886', edge: 0x353d50, floor: 0x262c3a, line: 'rgba(255,255,255,0.13)',
    shadow: 'rgba(0,0,0,0.6)', accent: '#ffc53d', beam: new THREE.Color('#cfe0ff'), beamOpacity: 0.16, dust: new THREE.Color('#eef4ff'),
  },
  light: {
    wall: '#d3d9e4', lit: '#fbfcfe', edge: 0xc9d0dc, floor: 0xc3cad8, line: 'rgba(20,30,50,0.12)',
    shadow: 'rgba(22,30,48,0.5)', accent: '#4f8cff', beam: new THREE.Color('#ffcf4a'), beamOpacity: 0.16, dust: new THREE.Color('#fff4d0'),
  },
};

/** sun with rays (light theme) or a full moon with craters (dark theme) – both seen face on, with a soft glow */
function skyTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  const glow = g.createRadialGradient(0, 0, 40, 0, 0, 128);
  glow.addColorStop(0, kind === 'sun' ? 'rgba(255,200,70,0.55)' : 'rgba(225,235,255,0.42)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(-128, -128, 256, 256);
  if (kind === 'sun') {
    g.fillStyle = '#ffb21f';
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate((i / 12) * Math.PI * 2);
      g.beginPath();
      g.moveTo(-10, -64);
      g.quadraticCurveTo(0, -112, 10, -64);
      g.fill();
      g.restore();
    }
    const disc = g.createRadialGradient(-14, -16, 6, 0, 0, 58);
    disc.addColorStop(0, '#fff3b8');
    disc.addColorStop(0.55, '#ffd23f');
    disc.addColorStop(1, '#ffb21f');
    g.beginPath();
    g.arc(0, 0, 56, 0, Math.PI * 2);
    g.fillStyle = disc;
    g.fill();
  } else {
    const disc = g.createRadialGradient(-16, -18, 8, 0, 0, 62);
    disc.addColorStop(0, '#fbfcff');
    disc.addColorStop(0.7, '#e3e8f2');
    disc.addColorStop(1, '#c9d1e0');
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.fillStyle = disc;
    g.fill();
    g.fillStyle = 'rgba(150,162,186,0.45)';
    for (const [x, y, r] of [[-20, -14, 13], [18, 10, 9], [-6, 26, 7], [26, -22, 6], [-30, 18, 5], [6, -34, 4]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// the beam: soft towards its edges and its far end; plain alpha (additive light would turn black on the transparent
// canvas background)
const BEAM_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
    // fades in at the sun and out just before the wall – no veil over the shadow, where no light arrives
    float along = mix(1.0, 0.5, vUv.y) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
    gl_FragColor = vec4(color, opacity * edge * along);
  }`;
const DUST_VERTEX = /* glsl */ `
  attribute float alpha;
  uniform float size;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    gl_PointSize = size;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(color, smoothstep(0.5, 0.05, d) * vAlpha);
  }`;

/** four sides of a frustum from a small square (near) to a rectangle (far); uv: x across a side, y along the beam */
function beamGeometry(near, far) {
  const corners = rect => [[-rect.w, -rect.h], [rect.w, -rect.h], [rect.w, rect.h], [-rect.w, rect.h]]
    .map(([x, y]) => new THREE.Vector3(rect.x + x, rect.y + y, rect.z));
  const a = corners(near);
  const b = corners(far);
  const position = [];
  const uv = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (const [p, u, v] of [[a[i], 0, 0], [a[j], 1, 0], [b[j], 1, 1], [a[i], 0, 0], [b[j], 1, 1], [b[i], 0, 1]]) {
      position.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

export function createShadowStage(scene) {
  const group = new THREE.Group();
  let puzzle = null;      // { size, maxHeight, view, shadow }
  let candidate = null;   // shadow grid of the picked building, or null
  let wallTexture = null;   // made once and reused (only its picture changes) – no new GPU texture per puzzle
  const skyTextures = {};   // sun / moon, drawn once each
  let canvas = null;
  let frame = 0;
  let last = 0;
  let visible = true;
  let shadowAlpha = 1;
  let floorMesh = null;   // the strip between plate and wall – faded while the stage turns (it would cross the plate)    // fades the shadow (and the comparison) out and in between puzzles
  const tweens = new Set();
  let tweenFrame = 0;

  /** small tween runner for the transitions (with reduced motion: straight to the end) */
  function animate(duration, step, delay = 0) {
    if (reducedMotion()) {
      step(1);
      scene.redraw();
      return;
    }
    tweens.add({ start: performance.now() + delay, duration, step });
    tweenFrame ||= requestAnimationFrame(runTweens);
  }
  function runTweens(now) {
    tweenFrame = 0;
    for (const tw of tweens) {
      const t = Math.min(1, Math.max(0, (now - tw.start) / tw.duration));
      tw.step(t);
      if (t >= 1) tweens.delete(tw);
    }
    moveDust(now);   // which specks are lit changes while the light turns
    scene.redraw();
    if (tweens.size) tweenFrame = requestAnimationFrame(runTweens);
  }
  function finishTweens() {
    for (const tw of tweens) tw.step(1);
    tweens.clear();
    cancelAnimationFrame(tweenFrame);
    tweenFrame = 0;
  }
  const fadeShadow = (to, delay = 0) => {
    const from = shadowAlpha;
    animate(FADE_MS, t => {
      shadowAlpha = from + (to - from) * t;
      draw();
    }, delay);
  };

  function draw() {
    if (!puzzle) return;
    const { size, maxHeight, shadow } = puzzle;
    const col = COLORS[theme()];
    const w = Math.round((size + 2 * MARGIN) * PX);
    const h = Math.round((maxHeight + 2 * MARGIN) * PX);
    canvas ??= document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    const m = MARGIN * PX;
    // wall, brighter where the beam falls
    g.fillStyle = col.wall;
    g.fillRect(0, 0, w, h);
    const pool = g.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.max(w, h) * 0.62);
    pool.addColorStop(0, col.lit);
    pool.addColorStop(0.75, col.lit);
    pool.addColorStop(1, col.wall);
    g.fillStyle = pool;
    g.fillRect(0, 0, w, h);
    // the wanted shadow: one path for all cells (no seams), half-transparent with a soft edge. Drawn as the
    // canvas shadow of a shape outside the picture – blurred the same way in every browser.
    const off = w + 100;
    g.save();
    g.globalAlpha = shadowAlpha;
    g.shadowColor = col.shadow;
    g.shadowBlur = PX * 0.16;
    g.shadowOffsetX = off;
    g.beginPath();
    shadow.forEach((row, r) => row.forEach((on, c) => on && g.rect(m + c * PX - off, m + r * PX, PX, PX)));
    g.fillStyle = '#000';
    g.fill();
    g.restore();
    // grid on top: the cubes can be counted in the shadow too
    g.strokeStyle = col.line;
    g.lineWidth = 2;
    for (let c = 0; c <= size; c++) {
      g.beginPath();
      g.moveTo(m + c * PX, m);
      g.lineTo(m + c * PX, h - m);
      g.stroke();
    }
    for (let r = 0; r <= maxHeight; r++) {
      g.beginPath();
      g.moveTo(m, m + r * PX);
      g.lineTo(w - m, m + r * PX);
      g.stroke();
    }
    // the picked building's shadow over it
    if (candidate) {
      g.globalAlpha = shadowAlpha;
      g.strokeStyle = col.accent;
      shadow.forEach((row, r) => row.forEach((wanted, c) => {
        const cast = candidate[r]?.[c];
        if (cast === wanted) return;
        const x = m + c * PX;
        const y = m + r * PX;
        if (cast) {
          // too much: hatched
          g.save();
          g.beginPath();
          g.rect(x + 3, y + 3, PX - 6, PX - 6);
          g.clip();
          g.lineWidth = 7;
          for (let k = -PX; k < PX * 2; k += 22) {
            g.beginPath();
            g.moveTo(x + k, y + PX);
            g.lineTo(x + k + PX, y);
            g.stroke();
          }
          g.restore();
          g.lineWidth = 5;
          g.strokeRect(x + 4, y + 4, PX - 8, PX - 8);
        } else {
          // missing: dashed outline
          g.lineWidth = 6;
          g.setLineDash([14, 10]);
          g.strokeRect(x + 6, y + 6, PX - 12, PX - 12);
          g.setLineDash([]);
        }
      }));
    }
    g.globalAlpha = 1;
    if (wallTexture) wallTexture.needsUpdate = true;
  }

  // ---- dust ---------------------------------------------------------------------------------------
  // The dust belongs to the room, not to the light: it floats where it is (also while the light turns to the other
  // side or the next puzzle comes) and is only seen where the beam passes through it. It lives in the two regions the
  // beam can take (from the front / from the right); a speck that drifts out of them comes back elsewhere – always
  // unseen (outside the beam it is invisible anyway) and fading in.

  const room = new THREE.Group();   // not turned with the stage
  scene.attach(room);
  let spawn = [];      // boxes in room coordinates where dust lives
  let beamBox = null;  // the beam in stage coordinates
  const inverse = new THREE.Matrix4();
  const at = new THREE.Vector3();

  function makeDust() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUST * 3), 3));
    geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(DUST), 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: COLORS[theme()].dust.clone() }, size: { value: 3.2 * Math.min(window.devicePixelRatio || 1, 2) } },
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      ...GLOW_BLENDING,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 11;   // see GLOW_BLENDING
    points.frustumCulled = false;
    room.add(points);
    const specks = Array.from({ length: DUST }, () => ({
      x: 0, y: 0, z: 0, life: 0, placed: false,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.8,
    }));
    return { points, specks };
  }
  const dust = makeDust();

  const inBox = (b, x, y, z, m = 0) => x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m && z > b.z0 - m && z < b.z1 + m;
  function place(p, life) {
    const b = spawn[Math.floor(Math.random() * spawn.length)];
    p.x = b.x0 + Math.random() * (b.x1 - b.x0);
    p.y = b.y0 + Math.random() * (b.y1 - b.y0);
    p.z = b.z0 + Math.random() * (b.z1 - b.z0);
    p.life = life;
    p.placed = true;
  }
  /** how far inside the beam (soft at its edges) – in the stage's own coordinates, so it follows the turning light */
  function lit(x, y, z) {
    at.set(x, y, z).applyMatrix4(inverse);
    const b = beamBox;
    const edge = 0.35;
    const f = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / edge, (hi - v) / edge));
    return f(at.x, b.x0, b.x1) * f(at.y, b.y0, b.y1) * f(at.z, b.z0, b.z1);
  }

  /** drift a little (dt seconds), twinkle, light up only inside the beam */
  function moveDust(time, dt = 0) {
    if (!spawn.length || !beamBox) return;
    group.updateMatrix();
    inverse.copy(group.matrix).invert();
    const pos = dust.points.geometry.attributes.position.array;
    const alpha = dust.points.geometry.attributes.alpha.array;
    const s = time / 1000;
    dust.specks.forEach((p, i) => {
      if (!p.placed) place(p, Math.random());
      if (dt) {
        p.x += Math.sin(s * 0.31 * p.speed + p.phase) * 0.12 * dt;
        p.z += Math.cos(s * 0.27 * p.speed + p.phase * 1.3) * 0.12 * dt;
        p.y += (Math.cos(s * 0.23 * p.speed + p.phase * 1.7) * 0.1 + 0.05 * p.speed) * dt;   // rises a little
        p.life = Math.min(1, p.life + dt * 0.5);
      }
      if (!spawn.some(b => inBox(b, p.x, p.y, p.z, 0.3))) place(p, 0);   // out of the dusty regions: back, unseen
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      alpha[i] = lit(p.x, p.y, p.z) * p.life * (0.45 + 0.35 * Math.sin(s * 1.3 * p.speed + p.phase));
    });
    dust.points.geometry.attributes.position.needsUpdate = true;
    dust.points.geometry.attributes.alpha.needsUpdate = true;
  }

  function tick(now) {
    frame = 0;
    if (!puzzle || !visible || document.hidden || reducedMotion()) return;
    if (now - last >= 1000 / FPS) {
      moveDust(now, last ? Math.min(0.1, (now - last) / 1000) : 0);
      last = now;
      scene.redraw();
    }
    frame = requestAnimationFrame(tick);
  }
  const run = () => {
    if (!frame && puzzle && visible && !document.hidden && !reducedMotion()) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const watch = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  });
  watch.observe(scene.canvas);
  document.addEventListener('visibilitychange', run);

  // ---- building the stage ------------------------------------------------------------------------

  function build() {
    for (const child of [...group.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      group.remove(child);
    }
    if (!puzzle) return;
    const { size, maxHeight, view } = puzzle;
    const col = COLORS[theme()];
    const width = size + 2 * MARGIN;
    const height = maxHeight + 2 * MARGIN;
    // the wall stands a bit away from the plate: seen from above at an angle, the building would otherwise hide its
    // own shadow – this way building and shadow are both in view; a floor strip joins plate and wall
    const gap = Math.max(1.3, maxHeight * 0.4);
    const back = -(size / 2 + 0.1) - gap;

    draw();
    // a texture's GPU memory has a fixed size: new texture only when the grid size (and so the picture size) changes
    if (wallTexture && (wallTexture.userData.w !== canvas.width || wallTexture.userData.h !== canvas.height)) {
      wallTexture.dispose();
      wallTexture = null;
    }
    if (!wallTexture) {
      wallTexture = new THREE.CanvasTexture(canvas);
      wallTexture.userData = { w: canvas.width, h: canvas.height };
      wallTexture.colorSpace = THREE.SRGBColorSpace;
      wallTexture.anisotropy = 4;
    }
    wallTexture.needsUpdate = true;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.12),
      new THREE.MeshLambertMaterial({ color: col.edge }),
    );
    slab.position.set(0, height / 2 - MARGIN, back - 0.07);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: wallTexture }));
    face.position.set(0, height / 2 - MARGIN, back);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.1, gap), new THREE.MeshLambertMaterial({ color: col.floor, transparent: true }));
    floorMesh = floor;
    floor.position.set(0, -0.05, -(size / 2 + 0.1) - gap / 2);

    // sun / moon on the other side, LEVEL with the building (half its height): only light that comes in horizontally
    // and parallel casts exactly the view as a shadow. Far enough out to be seen beside the building in the tilted view.
    const kind = theme() === 'light' ? 'sun' : 'moon';
    skyTextures[kind] ??= skyTexture(kind);
    const sky = new THREE.Sprite(new THREE.SpriteMaterial({ map: skyTextures[kind], transparent: true, depthWrite: false }));
    const sun = 1.3 + size * 0.14;
    sky.scale.set(sun, sun, 1);
    const sunY = maxHeight / 2;
    const sunZ = size + 0.6 + sun * 0.6;
    sky.position.set(0, sunY, sunZ);
    sky.renderOrder = 3;

    // beam: parallel rays – a straight shaft as big as the shadow area, from the sun to the wall, with dust in it
    const far = { x: 0, y: maxHeight / 2, z: back + 0.02, w: size / 2 + 0.05, h: maxHeight / 2 + 0.05 };
    const near = { ...far, z: sunZ };
    const beam = new THREE.Mesh(
      beamGeometry(near, far),
      new THREE.ShaderMaterial({
        uniforms: { color: { value: col.beam }, opacity: { value: col.beamOpacity } },
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        ...GLOW_BLENDING,
        side: THREE.DoubleSide,
        }),
    );
    beam.renderOrder = 10;   // see GLOW_BLENDING
    group.add(floor, slab, face, beam, sky);
    dust.points.material.uniforms.color.value.copy(col.dust);
    // where dust lives (room): the beam's region from the front and from the right; the beam itself (stage coordinates)
    beamBox = { x0: -far.w, x1: far.w, y0: far.y - far.h, y1: far.y + far.h, z0: back, z1: sunZ };
    spawn = [beamBox, { x0: back, x1: sunZ, y0: beamBox.y0, y1: beamBox.y1, z0: -far.w, z1: far.w }];
    scene.setExtent([
      [height, Math.hypot(width / 2, -back + 0.15)],
      [-0.1, Math.hypot(width / 2, -back + 0.15)],
      [sunY + sun / 2, sunZ + sun / 2],
      [sunY - sun / 2, sunZ + sun / 2],
    ], { refit: false });
    scene.setBeamLight({ axis: view === 'side' ? 'x' : 'z', top: maxHeight });
    run();
  }

  const onTheme = () => {
    build();
    scene.renderNow();
  };
  window.addEventListener('wyrfl-theme', onTheme);
  scene.attach(group);

  return {
    /** a new puzzle: wall, wanted shadow, sun/moon, beam. animate: turn / grow from the previous one, fade in. */
    set({ structure, view, shadow }, { smooth = false } = {}) {
      finishTweens();
      const before = puzzle;
      puzzle = { size: structure.size, maxHeight: structure.maxHeight, view, shadow };
      candidate = null;
      build();
      // light from the right: the same set-up turned by 90° (wall on the left, sun on the right)
      const angle = view === 'side' ? Math.PI / 2 : 0;
      if (!before) scene.precompile();   // first puzzle: wall, beam, dust, sun ready once – later puzzles reuse them
      if (!smooth || !before) {
        group.rotation.y = angle;
        group.scale.setScalar(1);
        shadowAlpha = 1;
        draw();
        moveDust(performance.now());
        scene.renderNow();
        return;
      }
      const fromAngle = group.rotation.y;
      if (fromAngle !== angle) {
        animate(TURN_MS, t => {
          group.rotation.y = fromAngle + (angle - fromAngle) * easeInOut(t);
          if (floorMesh) floorMesh.material.opacity = 1 - Math.sin(Math.PI * t);
        });
      }
      if (before.size !== puzzle.size) {
        const ratio = (before.size + 0.2) / (puzzle.size + 0.2);
        group.scale.setScalar(ratio);
        animate(GROW_MS, t => group.scale.setScalar(ratio + (1 - ratio) * easeOutElastic(t)));
      }
      shadowAlpha = 0;
      draw();
      fadeShadow(1, Math.min(TURN_MS, GROW_MS) * 0.6);
    },
    /** the old puzzle goes: its shadow (and the comparison) fades out */
    fadeOut() {
      if (puzzle) fadeShadow(0);
    },
    /** the shadow of the picked building over the wanted one (null: only the wanted one) */
    compare(grid) {
      candidate = grid;
      draw();
      scene.renderNow();
    },
    dispose() {
      window.removeEventListener('wyrfl-theme', onTheme);
      document.removeEventListener('visibilitychange', run);
      watch.disconnect();
      cancelAnimationFrame(frame);
      finishTweens();
      dust.points.geometry.dispose();
      dust.points.material.dispose();
      wallTexture?.dispose();
      Object.values(skyTextures).forEach(t => t.dispose());
      scene.detach(room);
      scene.setBeamLight(null);
      puzzle = null;
      build();
      scene.detach(group);
    },
  };
}
