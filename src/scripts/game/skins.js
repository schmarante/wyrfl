// Cube styles for the 3D scene. Every material is shared (userData.shared – the scene never disposes it per cube) and
// uses vertex colors, so the fake ambient occlusion (lighting.js) works in every style.
// - classic: the Wyrfl blue
// - colors:  seven bright colors, picked per cube position (stays the same while building around it)
// - pixel:   original pixel-art blocks drawn in code – grass on top of a column, earth below, stone at the bottom
// - eyes:    'googly eyes' – only eyes (own design, drawn in the shader); they follow the pointer and blink now and then
// - galaxy:  every cube a window into the same night sky (shader), glowing cyan outline
// - city:    skyscrapers – one building per column, a floor per cube; windows glow at night (dark theme)
// - jelly:   slime – rounded, a little lumpy, watery cubes (own shape: `geometry`): translucent, light scattering
//            inside faked in the shader (glowing body and rims – no real subsurface scattering, too expensive for old
//            phones), wet highlight and sky streak
// - gifts:   six wrapping papers with a ribbon cross
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
          // Look where the pointer is ON SCREEN (orthographic: view-space xy = screen): the screen direction from this
          // eye to the pointer is turned into the face's own axes (u, up as they appear on screen), so the pupil moves
          // exactly towards the pointer – also right next to the eye. Idle (w = 0): straight at the viewer.
          vec3 eye = face + u * c.x + vec3(0.0, c.y, 0.0);
          vec2 look = vec2(0.0);
          vec2 d = (viewMatrix * vec4(uEyeTarget.xyz, 1.0)).xy - (viewMatrix * vec4(eye, 1.0)).xy;
          if (uEyeTarget.w > 0.5 && length(d) > 0.0001) {
            vec2 su = (viewMatrix * vec4(u, 0.0)).xy;
            vec2 sy = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
            float det = su.x * sy.y - su.y * sy.x;
            det = det < 0.0 ? min(det, -0.05) : max(det, 0.05);   // face nearly edge-on: no blow-up
            vec2 dir = normalize(d);
            vec2 ab = vec2(dir.x * sy.y - dir.y * sy.x, su.x * dir.y - su.y * dir.x) / det;
            float reach = smoothstep(0.0, 0.45, length(d));   // pointer on the eye → centered, further away → full
            look = normalize(ab) * 0.07 * reach;
          }
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
      .replace('#include <common>', '#include <common>\nuniform vec4 uEyeTarget;\nvarying vec3 vEyeWorld;\nvarying vec3 vEyeNormal;\nvarying vec3 vEyeCenter;\nvarying float vEyeFront;')
      .replace('#include <color_fragment>', `#include <color_fragment>${EYES_FRAGMENT}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.38) * eyeGlow;');
  };
  material.customProgramCacheKey = () => `wyrfl-eyes-${face}-${closed ? 'closed' : 'open'}`;
  return material;
}

function eyesSkin() {
  const target = { value: new THREE.Vector4(0, 0, 0, 0) };   // xyz: pointer on screen (any depth), w: 0 = idle
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
    /** a world point under the pointer / finger (only its screen position counts); null = look at the viewer */
    lookAt(point) {
      if (point) target.value.set(point.x, point.y, point.z, 1);
      else target.value.w = 0;
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

// ---- skyscrapers ----------------------------------------------------------------------------------
// Every column is one building (facade + window layout picked from its position), every cube a floor, a flat roof on
// top. Dark theme: windows glow (emissive map) – each floor lit differently: warm and cool light, TV glow, half-closed
// blinds, slatted blinds, some floors nearly dark, some nearly all lit – no people in the windows. Light theme: dark glass.

const grid = (cols, rows, x0, y0, w, h, gx, gy) => {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([x0 + c * (w + gx), y0 + r * (h + gy), w, h]);
  return out;
};
const FACADES = [
  { wall: '#9aa3ad', trim: '#7f8893', glass: '#2b3a52', windows: grid(3, 2, 8, 8, 12, 18, 6, 10) },               // concrete
  { wall: '#4f6d8f', trim: '#3d5878', glass: '#1d2b43', windows: grid(4, 3, 5, 5, 11, 14, 3.67, 4.5), panes: true }, // glass tower
  { wall: '#a5563f', trim: '#87442f', glass: '#272c37', windows: grid(2, 2, 9, 6, 17, 19, 12, 9), sill: true },      // brick
  { wall: '#c9b58b', trim: '#ad9a71', glass: '#2b3346', windows: grid(3, 1, 9, 7, 11, 46, 7.5, 0) },                // sandstone
  { wall: '#353c47', trim: '#262c35', glass: '#1a2233', windows: grid(4, 2, 3, 8, 13.5, 16, 1, 14), ribbon: true },  // modern, window bands
];
const LIGHTS = ['#ffd27a', '#ffe3a3', '#ffbf5e', '#fff1c9', '#f4f7ff', '#ffcf8a'];
const TV = ['#8fb8ff', '#a6c8ff', '#7fa7f5'];

function citySkin() {
  const rng = createRng('wyrfl-city');
  const textures = [];
  const tex = draw => {
    const t = canvasTexture(64, draw);
    textures.push(t);
    return t;
  };
  // facade per building type (the same for every floor)
  const facadeMaps = FACADES.map(f => tex((ctx, s) => {
    ctx.fillStyle = f.wall;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = f.trim;   // floor ledge
    ctx.fillRect(0, s - 4, s, 4);
    if (f.ribbon) {   // continuous bands behind the panes
      ctx.fillStyle = f.trim;
      for (const y of [6, 36]) ctx.fillRect(0, y, s, 20);
    }
    for (const [x, y, w, h] of f.windows) {
      ctx.fillStyle = f.trim;
      if (!f.ribbon) ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
      const glass = ctx.createLinearGradient(x, y, x + w, y + h);   // a little reflection
      glass.addColorStop(0, '#6f86a8');
      glass.addColorStop(0.35, f.glass);
      glass.addColorStop(1, f.glass);
      ctx.fillStyle = glass;
      ctx.fillRect(x, y, w, h);
      if (f.panes) {   // mullions
        ctx.fillStyle = f.trim;
        ctx.fillRect(x + w / 2 - 0.5, y, 1, h);
      }
      if (f.sill) {
        ctx.fillStyle = '#d8c7b8';
        ctx.fillRect(x - 2, y + h + 1.5, w + 4, 2);
      }
    }
  }));
  // lit windows (emissive): per facade several patterns, each with its own mood (how many lights are on)
  const paint = (ctx, [x, y, w, h]) => {
    const kind = rng();
    if (kind < 0.12) {   // TV glow: dim bluish
      ctx.fillStyle = TV[rng.int(0, TV.length - 1)];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = LIGHTS[rng.int(0, LIGHTS.length - 1)];
    if (kind < 0.27) {   // blinds half down
      const down = h * (0.3 + rng() * 0.4);
      ctx.fillRect(x, y + down, w, h - down);
    } else if (kind < 0.37) {   // slatted blinds
      for (let yy = y; yy < y + h; yy += 3) ctx.fillRect(x, yy, w, 1.6);
    } else {
      ctx.fillRect(x, y, w, h);   // no people in the windows (user's decision)
    }
  };
  const lightMaps = FACADES.map(f => Array.from({ length: 6 }, () => tex((ctx, s) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    const on = [0.15, 0.35, 0.5, 0.6, 0.75, 0.9][rng.int(0, 5)];   // mood of this floor
    for (const rect of f.windows) if (rng() < on) paint(ctx, rect);
  })));
  const roof = lambert({
    map: tex((ctx, s) => {
      ctx.fillStyle = '#5d636d';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#767d88';   // parapet
      ctx.fillRect(0, 0, s, 5); ctx.fillRect(0, s - 5, s, 5); ctx.fillRect(0, 0, 5, s); ctx.fillRect(s - 5, 0, 5, s);
      ctx.fillStyle = '#8a919b';   // a small roof box
      ctx.fillRect(38, 14, 14, 11);
      ctx.fillStyle = '#4b5059';
      ctx.fillRect(38, 25, 14, 3);
    }),
  });
  const night = () => document.documentElement.dataset.theme !== 'light';
  const sides = FACADES.map((_, f) => lightMaps[f].map(emissiveMap => lambert({ map: facadeMaps[f], emissiveMap, emissive: night() ? 0xffffff : 0x000000 })));
  const sets = new Map();
  const edge = edges(0x1b2230, 0.5);
  return {
    material: (x, y, z) => {
      const f = cellHash(x, 0, z) % FACADES.length;       // one facade per column = one building
      const l = (cellHash(x, y, z) >>> 4) % lightMaps[f].length;   // lights differ per floor
      const key = `${f}:${l}`;
      if (!sets.has(key)) {
        const side = sides[f][l];
        sets.set(key, [side, side, roof, roof, side, side]);
      }
      return sets.get(key);
    },
    /** light theme: windows are dark glass – dark theme: the lit ones glow */
    onTheme() {
      sides.flat().forEach(m => m.emissive.setHex(night() ? 0xffffff : 0x000000));
    },
    edge,
    dispose() {
      [...sides.flat(), roof].forEach(m => m.dispose());
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

// classic: the main color of the theme – blue in the dark theme, yellow in the light one (the two colors swap)
const classicColor = () => (document.documentElement.dataset.theme === 'light' ? 0xffc53d : 0x4f8cff);
function classicSkin() {
  const material = lambert({ color: classicColor() });
  const edge = edges(0x0b1530);
  return {
    material: () => material,
    onTheme: () => material.color.setHex(classicColor()),
    edge,
    dispose: () => (material.dispose(), edge.dispose()),
  };
}

// ---- slime ------------------------------------------------------------------------------------------------------

const JELLY_COLORS = [0x74f05a, 0x45e389, 0xa3f04c, 0x36d9a0];   // a few juicy slime greens, picked per cube

const JELLY_NOISE = /* glsl */ `
  varying vec3 vJellyWorld;
  float jHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float jNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(jHash(i), jHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(jHash(i + vec3(0.0, 1.0, 0.0)), jHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(jHash(i + vec3(0.0, 0.0, 1.0)), jHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(jHash(i + vec3(0.0, 1.0, 1.0)), jHash(i + vec3(1.0)), f.x), f.y),
      f.z);
  }`;

// lumpy: every vertex pushed in or out a little by a noise over the world position (the same for every viewer)
const JELLY_VERTEX = /* glsl */ `
  vJellyWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  transformed += objectNormal * (jNoise(vJellyWorld * 2.6) - 0.5) * 0.08;`;

// watery slime: translucent (rims more opaque – fresnel, like real gel), light scattered strongly inside (the body
// glows, shading gets soft, much light comes through at the thin rims), wet look: sharp white highlight + a bright
// streak where the rounded edges reflect the sky above
const JELLY_FRAGMENT = /* glsl */ `
  {
    vec3 jView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
    float jFacing = clamp(abs(dot(normal, jView)), 0.0, 1.0);
    float jFres = pow(1.0 - jFacing, 2.0);
    float jDensity = jNoise(vJellyWorld * 3.5);
    vec3 jBody = diffuseColor.rgb;
    vec3 jGlow = mix(jBody, vec3(0.86, 1.0, 0.62), 0.45);
    vec3 jScatter = jBody * (0.62 + 0.25 * jDensity) + jGlow * jFres * 1.1;
    outgoingLight = mix(outgoingLight, jScatter, 0.6) + jGlow * jFres * 0.25;
    vec3 jReflect = reflect(-jView, normal);
    outgoingLight += vec3(1.0) * (pow(max(jReflect.y, 0.0), 14.0) * 0.55 + pow(jFres, 5.0) * 0.4);
    diffuseColor.a *= mix(0.72, 1.0, jFres);
  }`;

function jellySkin() {
  const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.17);
  const materials = JELLY_COLORS.map(color => {
    // transparent: cubes behind shimmer through (sorted back to front per cube); depthWrite stays on
    const material = new THREE.MeshPhongMaterial({ color, vertexColors: true, shininess: 45, specular: 0x9fb39a, transparent: true });
    material.userData.shared = true;
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${JELLY_NOISE}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${JELLY_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${JELLY_NOISE}`)
        .replace('#include <opaque_fragment>', `${JELLY_FRAGMENT}\n#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'wyrfl-jelly';
    return material;
  });
  return {
    geometry,   // own cube shape: rounded (the scene clones it per cube)
    material: (x, y, z) => materials[cellHash(x, y, z) % materials.length],
    dispose() {
      materials.forEach(m => m.dispose());
      geometry.dispose();
    },
  };
}

export function createSkin(name) {
  return { colors: colorSkin, pixel: pixelSkin, eyes: eyesSkin, galaxy: galaxySkin, city: citySkin, jelly: jellySkin, gifts: giftSkin }[name]?.() ?? classicSkin();
}
