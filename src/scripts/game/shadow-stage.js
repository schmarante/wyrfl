// Shadow mode stage, added to a cube scene: a wall a little behind the plate with the shadow on it, a stylised sun
// (light theme) or full moon (dark theme), facing the viewer, on the other side – and between them a soft beam of
// light with a little dust floating in it. Light from the front → back wall; from the right → left wall.
//
// The wall is a canvas texture: lit where the beam falls, the shadow half-transparent with a soft edge (penumbra),
// drawn cell by cell (exact, cheap – no real-time shadow maps); the grid stays visible so cubes can be counted.
// compare(candidate): the picked building's shadow laid over the wanted one – extra cells hatched, missing ones
// dashed (never colour alone).
// The dust is the only thing that moves: ~30 frames a second, paused while the stage is off screen or the tab is
// hidden, standing still with prefers-reduced-motion.
import * as THREE from 'three';

const PX = 96;          // texture pixels per cube
const MARGIN = 0.12;    // wall border around the cells (world units)
const DUST = 70;        // particles in the beam
const FPS = 30;

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
  let wallTexture = null;
  let skyTex = null;
  let canvas = null;
  let dust = null;        // { points, specks, near, far }
  let frame = 0;
  let last = 0;
  let visible = true;

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
    if (wallTexture) wallTexture.needsUpdate = true;
  }

  // ---- dust in the beam --------------------------------------------------------------------------

  function makeDust(near, far, col) {
    const specks = Array.from({ length: DUST }, () => ({
      t: 0.08 + Math.random() * 0.84,   // along the beam
      a: Math.random() - 0.5,           // across
      b: Math.random() - 0.5,           // up / down
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.8,
    }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUST * 3), 3));
    geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(DUST), 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: col.dust }, size: { value: 3.2 * Math.min(window.devicePixelRatio || 1, 2) } },
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 2;
    points.frustumCulled = false;
    dust = { points, specks, near, far };
    moveDust(0);
    return points;
  }

  /** dust drifts slowly and twinkles a little; it fades out towards the beam's edges instead of popping */
  function moveDust(time) {
    const { points, specks, near, far } = dust;
    const pos = points.geometry.attributes.position.array;
    const alpha = points.geometry.attributes.alpha.array;
    const s = time / 1000;
    specks.forEach((p, i) => {
      if (time) {
        p.a += Math.sin(s * 0.31 * p.speed + p.phase) * 0.0016;
        p.b += Math.cos(s * 0.23 * p.speed + p.phase * 1.7) * 0.0016 + 0.0005 * p.speed;   // rises a little
        p.t += Math.sin(s * 0.17 * p.speed + p.phase * 0.5) * 0.0009;
        if (p.b > 0.5) p.b -= 1;
        p.a = Math.max(-0.5, Math.min(0.5, p.a));
        p.t = Math.max(0.05, Math.min(0.95, p.t));
      }
      const w = near.w + (far.w - near.w) * p.t;
      const h = near.h + (far.h - near.h) * p.t;
      pos[i * 3] = near.x + (far.x - near.x) * p.t + p.a * 2 * w * 0.9;
      pos[i * 3 + 1] = near.y + (far.y - near.y) * p.t + p.b * 2 * h * 0.9;
      pos[i * 3 + 2] = near.z + (far.z - near.z) * p.t;
      const fade = Math.min(1, (0.5 - Math.abs(p.b)) * 6, (0.5 - Math.abs(p.a)) * 6);
      alpha[i] = Math.max(0, fade) * (0.45 + 0.35 * Math.sin(s * 1.3 * p.speed + p.phase));
    });
    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.alpha.needsUpdate = true;
  }

  function tick(now) {
    frame = 0;
    if (!dust || !visible || document.hidden || reducedMotion()) return;
    if (now - last >= 1000 / FPS) {
      last = now;
      moveDust(now);
      scene.redraw();
    }
    frame = requestAnimationFrame(tick);
  }
  const run = () => {
    if (!frame && dust && visible && !document.hidden && !reducedMotion()) frame = requestAnimationFrame(tick);
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
    wallTexture?.dispose();
    skyTex?.dispose();
    dust = null;
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
    wallTexture = new THREE.CanvasTexture(canvas);
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    wallTexture.anisotropy = 4;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.12),
      new THREE.MeshLambertMaterial({ color: col.edge }),
    );
    slab.position.set(0, height / 2 - MARGIN, back - 0.07);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: wallTexture }));
    face.position.set(0, height / 2 - MARGIN, back);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.1, gap), new THREE.MeshLambertMaterial({ color: col.floor }));
    floor.position.set(0, -0.05, -(size / 2 + 0.1) - gap / 2);

    // sun / moon on the other side: bigger and further out on bigger grids, high enough to stay clear of the building
    skyTex = skyTexture(theme() === 'light' ? 'sun' : 'moon');
    const sky = new THREE.Sprite(new THREE.SpriteMaterial({ map: skyTex, transparent: true, depthWrite: false }));
    const sun = 1.3 + size * 0.14;
    sky.scale.set(sun, sun, 1);
    const sunY = maxHeight + 1.2 + size * 0.1;
    const sunZ = size / 2 + 1.4 + maxHeight * 0.45;
    sky.position.set(0, sunY, sunZ);
    sky.renderOrder = 3;

    // beam from the sun to the lit part of the wall, with dust in it
    const near = { x: 0, y: sunY, z: sunZ, w: sun * 0.22, h: sun * 0.22 };
    const far = { x: 0, y: maxHeight / 2, z: back + 0.02, w: size / 2 + 0.05, h: maxHeight / 2 + 0.05 };
    const beam = new THREE.Mesh(
      beamGeometry(near, far),
      new THREE.ShaderMaterial({
        uniforms: { color: { value: col.beam }, opacity: { value: col.beamOpacity } },
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        }),
    );
    beam.renderOrder = 1;
    group.add(floor, slab, face, beam, makeDust(near, far, col), sky);
    // light from the right: the same set-up turned by 90° (wall on the left, sun on the right)
    group.rotation.y = view === 'side' ? Math.PI / 2 : 0;

    scene.setExtent([
      [height, Math.hypot(width / 2, -back + 0.15)],
      [-0.1, Math.hypot(width / 2, -back + 0.15)],
      [sunY + sun / 2, sunZ + sun / 2],
      [sunY - sun / 2, sunZ + sun / 2],
    ]);
    run();
  }

  const onTheme = () => {
    build();
    scene.renderNow();
  };
  window.addEventListener('wyrfl-theme', onTheme);
  scene.attach(group);

  return {
    /** a new puzzle: wall, wanted shadow, sun/moon, beam */
    set({ structure, view, shadow }) {
      puzzle = { size: structure.size, maxHeight: structure.maxHeight, view, shadow };
      candidate = null;
      build();
      scene.renderNow();
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
      puzzle = null;
      build();
      scene.detach(group);
    },
  };
}
