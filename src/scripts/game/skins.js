// Cube styles for the 3D scene. Every material is shared (userData.shared – the scene never disposes it per cube) and
// uses vertex colors, so the fake ambient occlusion (lighting.js) works in every style.
// - classic: the Wyrfl blue
// - colors:  seven bright colors, picked per cube position (stays the same while building around it)
// - pixel:   original pixel-art blocks drawn in code – grass on top of a column, earth below, stone at the bottom
// - eyes:    'googly eyes' – only eyes (own design, drawn in the shader); they follow the pointer and blink now and then
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

// ---- googly eyes ---------------------------------------------------------------------------------
// Only eyes – drawn in the shader, so every pupil can look at the pointer on its own: the scene passes the pointer as a
// point in 3D (lookAt), each eye turns its pupil towards it. Top and bottom stay plain. Blinking: the scene swaps a
// cube to the "closed" twin of its material for a moment.

const EYE_COLORS = [0xffcf3f, 0xff8a65, 0x5fd3a8, 0xb69cff];

const EYES_VERTEX = /* glsl */ `
  vEyeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vEyeNormal = normalize(mat3(modelMatrix) * objectNormal);
  vEyeCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;`;

const EYES_FRAGMENT = /* glsl */ `
  float eyeGlow = 0.0;   // the eye white glows a little so it reads as white on the shaded side faces
  {
    vec3 n = normalize(vEyeNormal);
    if (abs(n.y) < 0.5) {   // side faces only
      vec3 u = normalize(cross(vec3(0.0, 1.0, 0.0), n));
      vec3 face = vEyeCenter + n * 0.5;
      vec3 rel = vEyeWorld - face;
      vec2 p = vec2(dot(rel, u), rel.y);
      vec3 ink = vec3(0.09, 0.06, 0.04);
      for (int i = 0; i < 2; i++) {
        vec2 c = vec2(i == 0 ? -0.18 : 0.18, 0.06);
        float r = length(p - c);
        #ifdef EYES_CLOSED
          // closed, happy: an arc
          float arc = (1.0 - smoothstep(0.014, 0.026, abs(r - 0.085))) * step(c.y, p.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, ink, arc);
        #else
          vec3 eye = face + u * c.x + vec3(0.0, c.y, 0.0);
          vec3 d = uEyeTarget - eye;
          vec3 l = vec3(dot(d, u), d.y, dot(d, n));
          vec2 look = l.xy / (length(l) + 0.0001) * 0.07;   // pupil moves towards the target
          float white = 1.0 - smoothstep(0.128, 0.138, r);
          float rim = smoothstep(0.112, 0.124, r) * white;
          float pupil = 1.0 - smoothstep(0.058, 0.066, length(p - c - look));
          float shine = 1.0 - smoothstep(0.012, 0.02, length(p - c - look - vec2(-0.022, 0.024)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb, white);   // white eye (keeps the AO shading)
          diffuseColor.rgb = mix(diffuseColor.rgb, ink, max(pupil * white, rim * 0.55));
          diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb, shine * pupil * white);
          eyeGlow = max(eyeGlow, white * (1.0 - max(pupil, rim * 0.55)) + shine * pupil * white);
        #endif
      }
    }
  }`;

function eyeMaterial(color, closed, target) {
  const material = lambert({ color });
  if (closed) material.defines = { EYES_CLOSED: '' };
  material.onBeforeCompile = shader => {
    shader.uniforms.uEyeTarget = target;   // shared object – one update moves every pupil
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeWorld;\nvarying vec3 vEyeNormal;\nvarying vec3 vEyeCenter;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>${EYES_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEyeTarget;\nvarying vec3 vEyeWorld;\nvarying vec3 vEyeNormal;\nvarying vec3 vEyeCenter;')
      .replace('#include <color_fragment>', `#include <color_fragment>${EYES_FRAGMENT}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.38) * eyeGlow;');
  };
  material.customProgramCacheKey = () => (closed ? 'wyrfl-eyes-closed' : 'wyrfl-eyes');
  return material;
}

function eyesSkin() {
  const target = { value: new THREE.Vector3(10, 10, 10) };
  const open = EYE_COLORS.map(color => eyeMaterial(color, false, target));
  const closed = EYE_COLORS.map(color => eyeMaterial(color, true, target));
  const closedOf = new Map(open.map((m, i) => [m, closed[i]]));
  const edge = edges(0x3b2412, 0.35);
  return {
    material: (x, y, z) => open[cellHash(x, y, z) % open.length],
    /** the same cube with closed eyes (the scene blinks a few cubes now and then) */
    blink: base => closedOf.get(base),
    /** point in world space the pupils look at (pointer / finger, or the camera when idle) */
    lookAt(point) {
      target.value.copy(point);
    },
    edge,
    dispose() {
      [...open, ...closed].forEach(m => m.dispose());
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
  return { colors: colorSkin, pixel: pixelSkin, eyes: eyesSkin, gifts: giftSkin }[name]?.() ?? classicSkin();
}
