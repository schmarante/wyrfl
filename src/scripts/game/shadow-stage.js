// Shadow mode stage, added to a cube scene: a wall behind the plate with the shadow on it, and a stylised sun (light
// theme) or moon (dark theme) on the other side. Light from the front → back wall; from the right → left wall.
// The shadow is drawn into a canvas texture cell by cell (exact, crisp, cheap – no real-time shadow maps).
// compare(candidate): the shadow of the building that was picked, laid over the wanted one – cells it adds are
// hatched, cells it misses get a dashed outline (never colour alone).
import * as THREE from 'three';

const PX = 96;          // texture pixels per cube
const MARGIN = 0.12;    // wall border around the cells (world units)

const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const COLORS = {
  dark: { wall: '#46506a', edge: 0x353d50, floor: 0x262c3a, line: 'rgba(255,255,255,0.12)', shadow: 'rgba(6,8,14,0.92)', accent: '#ffc53d' },
  light: { wall: '#e3e8f1', edge: 0xc9d0dc, floor: 0xc3cad8, line: 'rgba(20,30,50,0.10)', shadow: 'rgba(40,46,60,0.82)', accent: '#4f8cff' },
};

/** sun with rays (light theme) or a crescent moon with a few stars (dark theme) */
function skyTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  if (kind === 'sun') {
    const glow = g.createRadialGradient(0, 0, 40, 0, 0, 128);
    glow.addColorStop(0, 'rgba(255,197,61,0.45)');
    glow.addColorStop(1, 'rgba(255,197,61,0)');
    g.fillStyle = glow;
    g.fillRect(-128, -128, 256, 256);
    g.fillStyle = '#ffb21f';
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate((i / 12) * Math.PI * 2);
      g.beginPath();
      g.moveTo(-11, -62);
      g.lineTo(0, -104);
      g.lineTo(11, -62);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, 54, 0, Math.PI * 2);
    g.fillStyle = '#ffc53d';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#e8a10f';
    g.stroke();
  } else {
    const glow = g.createRadialGradient(0, 0, 30, 0, 0, 128);
    glow.addColorStop(0, 'rgba(255,236,170,0.30)');
    glow.addColorStop(1, 'rgba(255,236,170,0)');
    g.fillStyle = glow;
    g.fillRect(-128, -128, 256, 256);
    // crescent: a disc with a shifted disc cut out
    g.beginPath();
    g.arc(0, 0, 64, 0, Math.PI * 2);
    g.fillStyle = '#ffe9a8';
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(30, -22, 58, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#fff6d6';
    for (const [x, y, r] of [[70, 40, 5], [52, 82, 3.5], [92, -6, 3]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createShadowStage(scene) {
  const group = new THREE.Group();
  let puzzle = null;      // { size, maxHeight, view, shadow }
  let candidate = null;   // shadow grid of the picked building, or null
  let wallTexture = null;
  let skyTex = null;
  let canvas = null;

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
    g.fillStyle = col.wall;
    g.fillRect(0, 0, w, h);
    const m = MARGIN * PX;
    const cell = (r, c) => [m + c * PX, m + r * PX];
    // grid: the cubes can be counted on the wall
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
    // the wanted shadow
    g.fillStyle = col.shadow;
    shadow.forEach((row, r) => row.forEach((on, c) => {
      if (!on) return;
      const [x, y] = cell(r, c);
      g.fillRect(x - 0.5, y - 0.5, PX + 1, PX + 1);   // overlap: no seams between the cells
    }));
    // the picked building's shadow over it
    if (candidate) {
      g.strokeStyle = col.accent;
      g.fillStyle = col.accent;
      shadow.forEach((row, r) => row.forEach((wanted, c) => {
        const cast = candidate[r]?.[c];
        if (cast === wanted) return;
        const [x, y] = cell(r, c);
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

  function build() {
    for (const child of [...group.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      group.remove(child);
    }
    wallTexture?.dispose();
    skyTex?.dispose();
    if (!puzzle) return;
    const { size, maxHeight, view } = puzzle;
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
    // the wall: a thin slab, its front face carries the shadow
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.12),
      new THREE.MeshLambertMaterial({ color: COLORS[theme()].edge }),
    );
    slab.position.set(0, height / 2 - MARGIN, back - 0.07);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: wallTexture }));
    face.position.set(0, height / 2 - MARGIN, back);

    // sun / moon on the other side, a little above the tallest possible building
    skyTex = skyTexture(theme() === 'light' ? 'sun' : 'moon');
    const sky = new THREE.Sprite(new THREE.SpriteMaterial({ map: skyTex, transparent: true, depthWrite: false }));
    // bigger and further out on bigger grids, high enough to stay clear of the building in the tilted view
    const sun = 1.3 + size * 0.14;
    sky.scale.set(sun, sun, 1);
    const sunY = maxHeight + 1.2 + size * 0.1;
    const sunZ = size / 2 + 1.4 + maxHeight * 0.45;
    sky.position.set(0, sunY, sunZ);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.2, 0.1, gap),
      new THREE.MeshLambertMaterial({ color: COLORS[theme()].floor }),
    );
    floor.position.set(0, -0.05, -(size / 2 + 0.1) - gap / 2);
    group.add(floor, slab, face, sky);
    // light from the right: the same set-up turned by 90° (wall on the left, sun on the right)
    group.rotation.y = view === 'side' ? Math.PI / 2 : 0;

    scene.setExtent([
      [height, Math.hypot(width / 2, -back + 0.15)],
      [-0.1, Math.hypot(width / 2, -back + 0.15)],
      [sunY + sun / 2, sunZ + sun / 2],
      [sunY - sun / 2, sunZ + sun / 2],
    ]);
  }

  const onTheme = () => {
    build();
    scene.renderNow();
  };
  window.addEventListener('wyrfl-theme', onTheme);
  scene.attach(group);

  return {
    /** a new puzzle: wall, wanted shadow, sun/moon */
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
      puzzle = null;
      build();
      scene.detach(group);
    },
  };
}
