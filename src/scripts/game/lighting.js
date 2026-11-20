// Fake global illumination for cube buildings – cheap enough for old phones, computed only when the building changes.
//
// 1. Voxel ambient occlusion: every face corner gets darker the more neighbouring cubes (or the ground) touch it
//    (the classic Minecraft trick, 0–3 occluders per corner) → written as vertex colors, free at render time.
// 2. Plate shadow: soft contact shadow around the foot of each column + a soft cast shadow away from the sun that
//    grows with the column height → small alpha texture on the base plate.
// 3. Drop shadow under the whole plate (static per grid size) so the board doesn't float.
// Pure functions (no three.js) – tested in tests/lighting.test.js.

/** brightness for 0 (fully occluded corner) … 3 (open corner) */
export const AO_LEVELS = [0.42, 0.62, 0.82, 1];

/**
 * Vertex colors (r = g = b = brightness) for one cube at (x, y, z).
 * @param {(x: number, y: number, z: number) => boolean} occupied  true for cubes and for the ground (y < 0)
 * @param {ArrayLike<number>} positions  vertex positions of a unit box (±0.5), xyz per vertex
 * @param {ArrayLike<number>} normals    vertex normals (axis aligned), xyz per vertex
 */
export function cubeAO(occupied, x, y, z, positions, normals, out = new Float32Array(positions.length)) {
  const cell = [x, y, z];
  for (let v = 0; v < positions.length; v += 3) {
    const n = [Math.round(normals[v]), Math.round(normals[v + 1]), Math.round(normals[v + 2])];
    const axis = n.findIndex(c => c !== 0);
    const [a, b] = [0, 1, 2].filter(i => i !== axis);
    const out0 = [cell[0] + n[0], cell[1] + n[1], cell[2] + n[2]];   // the cell in front of the face
    const sa = Math.sign(positions[v + a]);
    const sb = Math.sign(positions[v + b]);
    const shifted = (da, db) => {
      const p = [...out0];
      p[a] += da;
      p[b] += db;
      return occupied(p[0], p[1], p[2]);
    };
    const side1 = shifted(sa, 0);
    const side2 = shifted(0, sb);
    const corner = shifted(sa, sb);
    const level = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
    out[v] = out[v + 1] = out[v + 2] = AO_LEVELS[level];
  }
  return out;
}

/**
 * Like cubeAO, for any cube-like shape (rounded cubes): the four corners of each face as above, every vertex
 * blended between them by its position on the face – smooth, and the same as cubeAO for a plain box.
 * @param {ArrayLike<number>} normals  per vertex the face's axis (unit vector along x, y or z)
 */
export function cubeAOSmooth(occupied, x, y, z, positions, normals, out = new Float32Array(positions.length)) {
  const cell = [x, y, z];
  const level = (n, a, b, sa, sb) => {
    const at = (da, db) => {
      const p = [cell[0] + n[0], cell[1] + n[1], cell[2] + n[2]];
      p[a] += da;
      p[b] += db;
      return occupied(p[0], p[1], p[2]);
    };
    const side1 = at(sa, 0);
    const side2 = at(0, sb);
    return AO_LEVELS[side1 && side2 ? 0 : 3 - (side1 + side2 + at(sa, sb))];
  };
  const cache = new Map();   // per face: its four corner values
  for (let v = 0; v < positions.length; v += 3) {
    const n = [Math.round(normals[v]), Math.round(normals[v + 1]), Math.round(normals[v + 2])];
    const axis = n.findIndex(c => c !== 0);
    const [a, b] = [0, 1, 2].filter(i => i !== axis);
    const key = n.join(',');
    if (!cache.has(key)) cache.set(key, [level(n, a, b, -1, -1), level(n, a, b, 1, -1), level(n, a, b, -1, 1), level(n, a, b, 1, 1)]);
    const [c00, c10, c01, c11] = cache.get(key);
    const u = Math.min(1, Math.max(0, positions[v + a] + 0.5));
    const w = Math.min(1, Math.max(0, positions[v + b] + 0.5));
    out[v] = out[v + 1] = out[v + 2] = (c00 * (1 - u) + c10 * u) * (1 - w) + (c01 * (1 - u) + c11 * u) * w;
  }
  return out;
}

function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / span;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / span;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return dst;
}
const blur = (src, w, h, r) => boxBlur(boxBlur(src, w, h, r), w, h, r);   // two passes ≈ gaussian

/**
 * Shadow on the plate as an alpha map.
 * @param {number[][]} heights  heights[z][x] (only cubes that have landed)
 * @param {number} plateSize    plate edge length in cells (grid size + rim)
 * @returns {{ alpha: Float32Array, width: number, height: number }}  row 0 = back edge of the plate, values 0..1
 */
export function plateShadow(heights, plateSize, { px = 16, sun = [-0.4, -0.6], contact = 0.6, cast = 0.35 } = {}) {
  const size = heights.length;
  const margin = 2;   // cells around the grid while blurring (shadows reach past the edge, then get cropped)
  const W = (size + 2 * margin) * px;
  const contactMap = new Float32Array(W * W);
  const castMap = new Float32Array(W * W);
  const fill = (map, cx, cz, value) => {
    const x0 = Math.round((cx + margin) * px);
    const z0 = Math.round((cz + margin) * px);
    for (let z = Math.max(0, z0); z < Math.min(W, z0 + px); z++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + px); x++) map[z * W + x] = Math.max(map[z * W + x], value);
    }
  };
  heights.forEach((row, z) => row.forEach((h, x) => {
    if (!h) return;
    fill(contactMap, x, z, 1);
    // the column's shadow sweeps away from the sun, longer for taller columns, fainter towards its end
    const steps = Math.ceil(h * 4);
    for (let s = 1; s <= steps; s++) {
      const k = (s / steps) * h * 0.75;
      fill(castMap, x + sun[0] * k, z + sun[1] * k, 1 - 0.5 * (s / steps));
    }
  }));
  const c = blur(contactMap, W, W, Math.round(px * 0.3));
  const k = blur(castMap, W, W, Math.round(px * 0.55));

  // crop to the plate
  const start = Math.round((margin - (plateSize - size) / 2) * px);
  const out = Math.round(plateSize * px);
  const alpha = new Float32Array(out * out);
  for (let z = 0; z < out; z++) {
    for (let x = 0; x < out; x++) {
      const i = (z + start) * W + (x + start);
      alpha[z * out + x] = Math.min(0.75, c[i] * contact + k[i] * cast);
    }
  }
  return { alpha, width: out, height: out };
}

/** Soft rectangle for the drop shadow under the plate. */
export function dropShadow(plateSize, spread = 0.8, px = 12) {
  const total = plateSize + 2 * spread;
  const W = Math.round(total * px);
  const map = new Float32Array(W * W);
  const a = Math.round(spread * px);
  const b = W - a;
  for (let z = a; z < b; z++) for (let x = a; x < b; x++) map[z * W + x] = 1;
  return { alpha: blur(map, W, W, Math.round(spread * px * 0.45)), width: W, height: W, total };
}
