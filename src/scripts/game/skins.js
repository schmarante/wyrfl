// Cube styles for the 3D scene. Every material is shared (userData.shared – the scene never disposes it per cube) and
// uses vertex colors, so the fake ambient occlusion (lighting.js) works in every style.
// - classic: the Wyrfl blue
// - colors:  seven bright colors, picked per cube position (stays the same while building around it)
// - pixel:   original pixel-art blocks drawn in code – grass on top of a column, earth below, stone at the bottom
// - gifts:   six wrapping papers with a ribbon cross
import * as THREE from 'three';
import { createRng } from './rng.js';

const PALETTE = [0x22c3ee, 0xfacc15, 0xa855f7, 0x22c55e, 0xef4444, 0x3b82f6, 0xf97316];

/** stable pseudo-random number per cube position */
const cellHash = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;

function lambert(options) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, ...options });
  material.userData.shared = true;
  return material;
}
function edges(color, opacity = 1) {
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  material.userData.shared = true;
  return material;
}
function canvasTexture(size, draw, { pixel = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
  } else {
    texture.anisotropy = 4;
  }
  return texture;
}

// ---- pixel blocks ------------------------------------------------------------------------------

function noisy(ctx, size, colors, rng) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(x, y, 1, 1);
  }
}
const GRASS = ['#5aa83a', '#4f9a33', '#67b845', '#5fae3f', '#4a8f2e'];
const EARTH = ['#8b5a34', '#7c4f2d', '#966540', '#86552f', '#6f4527'];
const STONE = ['#8e9196', '#7f8287', '#9a9da2', '#878a8f', '#74777c'];

function pixelSkin() {
  const rng = createRng('wyrfl-pixel');
  const tex = draw => canvasTexture(16, (ctx, s) => draw(ctx, s), { pixel: true });
  const grassTop = tex((ctx, s) => noisy(ctx, s, GRASS, rng));
  const earth = tex((ctx, s) => noisy(ctx, s, EARTH, rng));
  const stone = tex((ctx, s) => {
    noisy(ctx, s, STONE, rng);
    ctx.fillStyle = '#6a6d72';   // a few cracks
    for (let i = 0; i < 6; i++) ctx.fillRect(rng.int(0, s - 3), rng.int(0, s - 1), rng.int(2, 4), 1);
  });
  const grassSide = tex((ctx, s) => {
    noisy(ctx, s, EARTH, rng);
    for (let x = 0; x < s; x++) {   // grass hanging over the edge, a bit irregular
      const depth = rng.int(2, 5);
      for (let y = 0; y < depth; y++) {
        ctx.fillStyle = GRASS[rng.int(0, GRASS.length - 1)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  const m = map => lambert({ map });
  const top = m(grassTop), side = m(grassSide), dirt = m(earth), rock = m(stone);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const grassBlock = [side, side, top, dirt, side, side];
  const textures = [grassTop, earth, stone, grassSide];
  return {
    material: (x, y, z, { topFree }) => (topFree ? grassBlock : y === 0 ? rock : dirt),
    dependsOnNeighbours: true,
    edge: null,
    dispose() {
      [top, side, dirt, rock].forEach(mat => mat.dispose());
      textures.forEach(t => t.dispose());
    },
  };
}

// ---- wrapping paper ----------------------------------------------------------------------------

function star(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const PAPERS = [
  { bg: '#d62839', ribbon: '#f6d860', draw: (ctx, s) => { ctx.fillStyle = '#ffffff'; for (let y = 6; y < s; y += 16) for (let x = (y / 16) % 2 ? 14 : 6; x < s; x += 16) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); } } },
  { bg: '#1f8a4c', ribbon: '#ffffff', draw: (ctx, s) => { ctx.strokeStyle = '#e9f7ee'; ctx.lineWidth = 4; for (let i = -s; i < s * 2; i += 14) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke(); } } },
  { bg: '#1d3f9a', ribbon: '#f6d860', draw: (ctx, s) => { ctx.fillStyle = '#f6d860'; for (let y = 8; y < s; y += 20) for (let x = (y / 20) % 2 ? 18 : 8; x < s; x += 20) star(ctx, x, y, 5); } },
  { bg: '#f7f3ea', ribbon: '#d62839', draw: (ctx, s) => { ctx.fillStyle = '#e04a5a'; for (let x = 0; x < s; x += 12) ctx.fillRect(x, 0, 5, s); } },
  { bg: '#7b3fb5', ribbon: '#ffffff', draw: (ctx, s) => { ctx.fillStyle = '#9a62d0'; for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) ctx.fillRect(x, y, 8, 8); } },
  { bg: '#e8b53b', ribbon: '#1f8a4c', draw: (ctx, s) => { ctx.strokeStyle = '#c98c12'; ctx.lineWidth = 3; for (let y = 8; y < s; y += 14) { ctx.beginPath(); for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y + (x / 8) % 2 * 5); ctx.stroke(); } } },
];

function giftSkin() {
  const textures = PAPERS.map(paper =>
    canvasTexture(64, (ctx, s) => {
      ctx.fillStyle = paper.bg;
      ctx.fillRect(0, 0, s, s);
      paper.draw(ctx, s);
      // ribbon cross with a thin darker edge
      const w = 9;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(s / 2 - w / 2 - 1, 0, w + 2, s);
      ctx.fillRect(0, s / 2 - w / 2 - 1, s, w + 2);
      ctx.fillStyle = paper.ribbon;
      ctx.fillRect(s / 2 - w / 2, 0, w, s);
      ctx.fillRect(0, s / 2 - w / 2, s, w);
    }),
  );
  const materials = textures.map(map => lambert({ map }));
  const edge = edges(0x2b1d10, 0.45);
  return {
    material: (x, y, z) => materials[cellHash(x, y, z) % materials.length],
    edge,
    dispose() {
      materials.forEach(m => m.dispose());
      textures.forEach(t => t.dispose());
      edge.dispose();
    },
  };
}

// ---- solid colors ----------------------------------------------------------------------------------

function colorSkin() {
  const materials = PALETTE.map(color => lambert({ color }));
  const edge = edges(0x111827, 0.7);
  return {
    material: (x, y, z) => materials[cellHash(x, y, z) % materials.length],
    edge,
    dispose() {
      materials.forEach(m => m.dispose());
      edge.dispose();
    },
  };
}

function classicSkin() {
  const material = lambert({ color: 0x4f8cff });
  const edge = edges(0x0b1530);
  return { material: () => material, edge, dispose: () => (material.dispose(), edge.dispose()) };
}

export function createSkin(name) {
  return { colors: colorSkin, pixel: pixelSkin, gifts: giftSkin }[name]?.() ?? classicSkin();
}
