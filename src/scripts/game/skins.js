// Cube styles for the 3D scene. Every material is shared (userData.shared – the scene never disposes it per cube) and
// uses vertex colors, so the fake ambient occlusion (lighting.js) works in every style.
// - classic: the Wyrfl blue
// - colors:  seven bright colors, picked per cube position (stays the same while building around it)
// - pixel:   original pixel-art blocks drawn in code – grass on top of a column, earth below, stone at the bottom
// - eyes:    'googly eyes' – only eyes (own design, drawn in the shader); they follow the pointer and blink now and then
// - galaxy:  every cube a window into the same night sky (shader), glowing cyan outline
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
// Only eyes, and only on one side face per cube (picked from its position – they turn away when the building turns) –
// drawn in the shader, so every pupil can look at the pointer on its own: the scene passes the pointer as a point in
// 3D (lookAt), each eye turns its pupil towards it. All other faces stay plain. Blinking: the scene swaps a
// cube to the "closed" twin of its material for a moment.

const EYE_COLORS = [0xffcf3f, 0xff8a65, 0x5fd3a8, 0xb69cff];

const EYES_VERTEX = /* glsl */ `
  vEyeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vEyeNormal = normalize(mat3(modelMatrix) * objectNormal);
  vEyeCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vEyeFront = dot(objectNormal, EYE_DIR);   // eyes only on one face of the cube (turns with the building)`;

const EYES_FRAGMENT = /* glsl */ `
  float eyeGlow = 0.0;   // the eye white glows a little so it reads as white on the shaded side faces
  {
    vec3 n = normalize(vEyeNormal);
    if (vEyeFront > 0.5) {   // the cube's eye face only
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

// the face that gets the eyes: +z, +x, -z, -x (per cube, from its position)
const EYE_FACES = ['vec3(0.0, 0.0, 1.0)', 'vec3(1.0, 0.0, 0.0)', 'vec3(0.0, 0.0, -1.0)', 'vec3(-1.0, 0.0, 0.0)'];

function eyeMaterial(color, face, closed, target) {
  const material = lambert({ color });
  material.defines = { EYE_DIR: EYE_FACES[face], ...(closed ? { EYES_CLOSED: '' } : {}) };
  material.onBeforeCompile = shader => {
    shader.uniforms.uEyeTarget = target;   // shared object – one update moves every pupil
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeWorld;\nvarying vec3 vEyeNormal;\nvarying vec3 vEyeCenter;\nvarying float vEyeFront;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>${EYES_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEyeTarget;\nvarying vec3 vEyeWorld;\nvarying vec3 vEyeNormal;\nvarying vec3 vEyeCenter;\nvarying float vEyeFront;')
      .replace('#include <color_fragment>', `#include <color_fragment>${EYES_FRAGMENT}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.38) * eyeGlow;');
  };
  material.customProgramCacheKey = () => `wyrfl-eyes-${face}-${closed ? 'closed' : 'open'}`;
  return material;
}

function eyesSkin() {
  const target = { value: new THREE.Vector3(10, 10, 10) };
  // per color × eye face one material, and its closed twin for blinking
  const open = EYE_COLORS.map(color => EYE_FACES.map((_, face) => eyeMaterial(color, face, false, target)));
  const closed = EYE_COLORS.map(color => EYE_FACES.map((_, face) => eyeMaterial(color, face, true, target)));
  const closedOf = new Map(open.flatMap((row, c) => row.map((m, f) => [m, closed[c][f]])));
  const edge = edges(0x3b2412, 0.35);
  return {
    material: (x, y, z) => {
      const h = cellHash(x, y, z);
      return open[h % EYE_COLORS.length][(h >>> 5) % EYE_FACES.length];
    },
    /** the same cube with closed eyes (the scene blinks a few cubes now and then) */
    blink: base => closedOf.get(base),
    /** point in world space the pupils look at (pointer / finger, or the camera when idle) */
    lookAt(point) {
      target.value.copy(point);
    },
    edge,
    dispose() {
      [...open.flat(), ...closed.flat()].forEach(m => m.dispose());
      edge.dispose();
    },
  };
}

// ---- galaxy ------------------------------------------------------------------------------------
// Every cube is a window into the same night sky (nebulae + stars, drawn in the shader, continuous across all cubes
// and fixed to the view – the building turns "in front of" space) with a glowing cyan outline. Opaque on purpose: real
// transparency would let the cubes overlap and the puzzle could no longer be read.

const GALAXY_VERTEX = /* glsl */ `
  vGalaxyView = (modelViewMatrix * vec4(transformed, 1.0)).xy;
  vGalaxyLocal = transformed;
  vGalaxyNormal = normal;   // MeshBasicMaterial has no objectNormal – the attribute is always there
  vGalaxyWorldN = normalize(mat3(modelMatrix) * normal);`;

const GALAXY_FUNCTIONS = /* glsl */ `
  varying vec2 vGalaxyView;
  varying vec3 vGalaxyLocal;
  varying vec3 vGalaxyNormal;
  varying vec3 vGalaxyWorldN;
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float gFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * gNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  float gStars(vec2 p, float density, float size) {
    vec2 cell = floor(p * density), f = fract(p * density) - 0.5;
    float h = gHash(cell);
    vec2 offset = vec2(gHash(cell + 1.7), gHash(cell + 5.3)) - 0.5;
    return smoothstep(size, 0.0, length(f - offset * 0.7)) * step(0.72, h) * (0.55 + 0.45 * h);
  }
  vec3 galaxy(vec2 p) {
    vec2 q = p * 0.33;
    float n = gFbm(q + gFbm(q * 1.7));
    vec3 col = mix(vec3(0.02, 0.01, 0.07), vec3(0.16, 0.04, 0.30), smoothstep(0.25, 0.85, n));
    col += vec3(0.90, 0.25, 0.62) * pow(smoothstep(0.52, 0.95, gFbm(q * 1.3 + 3.1)), 2.0) * 0.65;   // pink nebula
    col += vec3(0.20, 0.60, 1.00) * pow(smoothstep(0.55, 1.00, gFbm(q * 0.8 - 7.3)), 2.0) * 0.55;  // blue nebula
    col += vec3(1.0) * gStars(p, 7.0, 0.09);                                                      // small stars
    col += vec3(0.85, 0.92, 1.0) * gStars(p + 13.7, 2.2, 0.06) * 1.4;                              // a few bright ones
    return col;
  }`;

const GALAXY_FRAGMENT = /* glsl */ `
  {
    vec3 sky = galaxy(vGalaxyView);
    vec3 nW = normalize(vGalaxyWorldN);
    float shade = 0.82 + 0.28 * max(nW.y, 0.0);   // top a bit brighter, so the shape still reads
    // glowing rim along the edges of every face
    vec3 a = abs(vGalaxyLocal), nL = abs(vGalaxyNormal);
    float e = max(max(a.x * (1.0 - nL.x), a.y * (1.0 - nL.y)), a.z * (1.0 - nL.z));
    // thin, crisp rim: a hard edge, only ~1 pixel of anti-aliasing (fwidth)
    float aa = fwidth(e);
    float rim = smoothstep(0.481 - aa, 0.481, e);
    diffuseColor.rgb = mix(sky * shade, vec3(0.55, 0.97, 1.0), rim);
  }`;

function galaxySkin() {
  const material = new THREE.MeshBasicMaterial({ vertexColors: true });   // unlit: space glows by itself (AO still darkens corners)
  material.userData.shared = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGalaxyView;\nvarying vec3 vGalaxyLocal;\nvarying vec3 vGalaxyNormal;\nvarying vec3 vGalaxyWorldN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>${GALAXY_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${GALAXY_FUNCTIONS}`)
      .replace('#include <color_fragment>', `${GALAXY_FRAGMENT}\n#include <color_fragment>`);
  };
  material.customProgramCacheKey = () => 'wyrfl-galaxy';
  const edge = edges(0x8ef6ff);
  return {
    material: () => material,
    edge,
    dispose() {
      material.dispose();
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
  return { colors: colorSkin, pixel: pixelSkin, eyes: eyesSkin, galaxy: galaxySkin, gifts: giftSkin }[name]?.() ?? classicSkin();
}
