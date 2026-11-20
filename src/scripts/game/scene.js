// Isometric 3D view of a cube structure (three.js, OrthographicCamera – never perspective).
// Renders on demand only (no idle render loop – saves battery on phones); a frame loop runs only while something moves.
// - drag / swipe turns the structure around the vertical axis
// - new cubes drop in from above and fade in (a whole building assembles layer by layer), removed cubes fade out
// - Builder (editable): tap / left click → onTap(column, tool), right click or long press → onTap(column, 'remove')
// - lookFrom('front' | 'side' | 'top' | 'iso') moves the camera straight onto a view (learning aid)
// - setViewMarker(view) shows an arrow from the asked direction (View Guesser) – explains "from the right" without words
// - follows the light/dark theme (window event 'wyrfl-theme') and the cube style (skins.js, window event 'wyrfl-skin')
// - fake global illumination (lighting.js): voxel AO as vertex colors, soft shadows on and under the plate

import * as THREE from 'three';
import { cubeAO, plateShadow, dropShadow } from './lighting.js';
import { createSkin } from './skins.js';
import { currentSkin } from './skin-pref.js';

const PALETTES = {
  // ghost: preview cube when building; front + arrow: the accent of the UI – yellow in the dark theme, blue in the light one
  dark: { plate: 0x2a3142, plateLine: 0x3b4458, ghost: 0xffffff, front: 0xffc53d, arrow: 0xffbf1f, arrowGlow: 0x3a2400 },
  light: { plate: 0xcfd6e3, plateLine: 0xb3bccc, ghost: 0x3a4150, front: 0x4f8cff, arrow: 0x3d7bf0, arrowGlow: 0x0a1c44 },
};
const COLORS = {
  cube: 0x4f8cff,
  edge: 0x0b1530,
  ghostRemove: 0xff6b6b,
};

const DRAG_THRESHOLD = 6;     // px – below this a pointer gesture counts as a tap
const LONG_PRESS = 450;       // ms – touch held this long removes a cube
const CAMERA_DISTANCE = 30;
const DROP = { height: 1.6, duration: 320, layerDelay: 110, cellDelay: 28 };
// another grid size: the plate springs to its new size first (elastic), then the new cubes drop in
const GROW = { duration: 700, cubesAfter: 430 };
// shadow mode, faces in the light beam: turned to the light brighter, turned away darker, the other sides a bit darker
const BEAM = { lit: 0.85, away: 0.62, side: 0.18 };
const FADE_OUT = 200;
const ISO_ELEVATION = Math.asin(1 / Math.sqrt(3));   // 35.26° – camera height angle of the iso view
// direction arrow: base this far outside the plate edge (front/side, level, just above the ground – a tilted arrow
// points into the screen in the iso view and looks stubby) or above the building (top)
const ARROW = { shaft: 0.8, head: 0.5, gap: 1.9, top: 1.6, height: 0.45 };

// camera direction (from target to camera) and up vector per view; iso = front (+z), right (+x) and top visible
const CAMERA_VIEWS = {
  iso: { dir: new THREE.Vector3(1, 1, 1).normalize(), up: new THREE.Vector3(0, 1, 0) },
  front: { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  side: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },   // back at the top, front at the bottom
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeOutElastic = t => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-9 * t) * Math.sin((t * 8 - 0.75) * ((2 * Math.PI) / 3)) + 1);   // no overshoot: a cube never dips below its place (into the one below)
const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ editable?: boolean, marker?: boolean, frameFor?: { size: number, maxHeight: number },
 *           onTap?: (column: { x: number, z: number }, tool: 'add' | 'remove') => void }} [options]
 *   frameFor: keep the camera frame for this grid (home page hero – buildings of different sizes look different in size)
 *   fitContent: frame the building that is shown, not the tallest one possible (View Guesser – the building is fixed)
 */
export function createCubeScene(canvas, { editable = false, marker: withMarker = false, frameFor = null, fitContent = false, onTap } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, 5, 3);   // top brightest, front a bit brighter than the right side → faces are easy to tell apart
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const pivot = new THREE.Group();   // turned by dragging
  scene.add(pivot);
  const base = new THREE.Group();
  const cubes = new THREE.Group();
  const leaving = new THREE.Group();   // fading out, not pickable
  pivot.add(base, cubes, leaving);

  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeometry = new THREE.EdgesGeometry(cubeGeometry);
  const BOX_POS = cubeGeometry.attributes.position.array;
  const BOX_NRM = cubeGeometry.attributes.normal.array;
  // cube style: shared materials per cube position (vertex colors = AO); a style without edges hides the lines
  let skin = createSkin(currentSkin());
  const noEdge = new THREE.LineBasicMaterial({ color: COLORS.edge });
  noEdge.userData.shared = true;

  // preview cube when building: white in the dark theme, dark grey in the light one (white vanishes on a light board)
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: PALETTES[theme()].ghost, transparent: true, opacity: 0.35, depthWrite: false });
  const ghostEdges = new THREE.LineBasicMaterial({ color: PALETTES[theme()].ghost, transparent: true, opacity: 0.8 });
  const ghost = new THREE.Mesh(cubeGeometry, ghostMaterial);
  ghost.add(new THREE.LineSegments(edgeGeometry, ghostEdges));
  ghost.visible = false;
  pivot.add(ghost);

  // arrow pointing at the building from the asked direction
  // direction arrow: lit → shaded like the cubes, a slight glow keeps it readable in shadow; color follows the theme
  const markerMaterial = new THREE.MeshLambertMaterial({ color: PALETTES[theme()].arrow, emissive: PALETTES[theme()].arrowGlow });
  const marker = new THREE.Group();
  // built pointing down (-y) from the group origin = the arrow's base; rotated per view
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, ARROW.shaft, 24), markerMaterial);
  shaft.position.y = -ARROW.shaft / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.34, ARROW.head, 32), markerMaterial);
  head.rotation.x = Math.PI;
  head.position.y = -ARROW.shaft - ARROW.head / 2;
  marker.add(shaft, head);
  marker.visible = false;
  pivot.add(marker);

  let size = 3;
  let maxHeight = 3;
  let heights = [];
  const cubeMap = new Map();   // "x,y,z" → mesh
  let plate = null;
  let shadowTexture = null;   // plate shadow (alpha), rebuilt when the building changes
  let dropTexture = null;
  let lightingDirty = false;
  let contentHeights = null;   // fitContent: the building to frame
  let beamLight = null;        // shadow mode: { axis: 'x' | 'z', top } – faces turned to the light get brighter
  let extraPoints = [];        // [y, d] – more things to keep in the frame (shadow mode: wall, sun) – see setExtent
  let tool = 'add';
  let markerView = null;
  let halfWidth = 1;    // half extents the camera has to show (rotation-safe around the vertical axis)
  let halfHeight = 1;
  const target = new THREE.Vector3();
  const camDir = CAMERA_VIEWS.iso.dir.clone();
  const camUp = CAMERA_VIEWS.iso.up.clone();
  let currentView = 'iso';
  let cameraAnimation = null;
  const tweens = new Set();
  let frame = 0;
  let autoRotate = 0;   // rad/s – home page hero
  let lastFrame = 0;

  const offset = () => (size - 1) / 2;

  function render() {
    renderer.render(scene, camera);
  }

  // ---- frame loop for cube tweens --------------------------------------------------------------

  function loop(now) {
    frame = 0;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (autoRotate && !gesture?.dragging) pivot.rotation.y += autoRotate * dt;
    for (const tw of tweens) {
      const t = Math.min(1, Math.max(0, (now - tw.start) / tw.duration));
      tw.step(t);
      if (t >= 1) {
        tweens.delete(tw);
        tw.done?.();
      }
    }
    if (lightingDirty) refreshLighting();
    render();
    if (tweens.size || autoRotate) frame = requestAnimationFrame(loop);
    else lastFrame = 0;
  }
  function addTween(tw) {
    tweens.add(tw);
    if (!frame) frame = requestAnimationFrame(loop);
  }
  function finishTweens() {
    for (const tw of tweens) {
      tw.step(1);
      tw.done?.();
    }
    tweens.clear();
  }

  // ---- camera ----------------------------------------------------------------------------------

  function applyCamera() {
    camera.position.copy(target).addScaledVector(camDir, CAMERA_DISTANCE);
    camera.up.copy(camUp);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  function fitCamera() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const half = Math.max(halfHeight, halfWidth / aspect) * 1.04;
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    camera.updateProjectionMatrix();
    applyCamera();
    render();
  }

  // ---- building blocks ---------------------------------------------------------------------------

  function disposeGroup(group) {
    for (const child of [...group.children]) {
      child.traverse(o => {
        if (o.geometry && o.geometry !== cubeGeometry && o.geometry !== edgeGeometry) o.geometry.dispose();
        if (o.material) mats(o.material).forEach(m => !m.userData.shared && m.dispose());
      });
      group.remove(child);
    }
  }

  function buildBase() {
    disposeGroup(base);
    const palette = PALETTES[theme()];
    plate = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.1, size + 0.2), new THREE.MeshLambertMaterial({ color: palette.plate }));
    plate.position.y = -0.05;
    const grid = new THREE.GridHelper(size, size, palette.plateLine, palette.plateLine);
    grid.position.y = 0.002;
    const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.12, 0.14), new THREE.MeshLambertMaterial({ color: palette.front }));
    frontEdge.position.set(0, -0.04, size / 2 + 0.17);
    base.add(plate, grid, frontEdge);

    // soft shadows (fake GI): on the plate (updated with the building) and under the whole plate
    const plateSize = size + 0.2;
    shadowTexture?.dispose();
    shadowTexture = alphaTexture(plateShadow(settledHeights(), plateSize));
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(plateSize, plateSize),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture, transparent: true, depthWrite: false }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.004;
    shadowPlane.name = 'plate-shadow';
    dropTexture?.dispose();
    const drop = dropShadow(plateSize);
    dropTexture = alphaTexture(drop);
    const dropPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(drop.total, drop.total),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: dropTexture, transparent: true, depthWrite: false, opacity: theme() === 'light' ? 0.22 : 0.5 }),
    );
    dropPlane.rotation.x = -Math.PI / 2;
    dropPlane.position.set(0.12, -0.13, 0.12);
    base.add(shadowPlane, dropPlane);
  }

  /** alpha values (0..1, row 0 = back) → texture for alphaMap (green channel) */
  function alphaTexture({ alpha, width, height }) {
    const data = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) {
      const src = (height - 1 - row) * width;   // texture row 0 = front (+z) after the plane is laid down
      for (let x = 0; x < width; x++) {
        const v = Math.round(alpha[src + x] * 255);
        const i = (row * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /** heights of the cubes that have landed (dropping ones don't cast shadows yet) */
  function settledHeights() {
    const h = Array.from({ length: size }, () => Array(size).fill(0));
    for (const mesh of cubeMap.values()) {
      if (mesh.userData.tween) continue;
      const { x, y, z } = mesh.userData;
      h[z][x] = Math.max(h[z][x], y + 1);
    }
    return h;
  }

  /** Recomputes AO of all cubes and the plate shadow from the landed cubes. */
  function refreshLighting() {
    lightingDirty = false;
    const landed = new Set();
    for (const [key, mesh] of cubeMap) if (!mesh.userData.tween) landed.add(key);
    const occupied = (x, y, z) => y < 0 || landed.has(`${x},${y},${z}`);
    for (const mesh of cubeMap.values()) {
      const { x, y, z } = mesh.userData;
      if (skin.dependsOnNeighbours) {
        mesh.userData.base = skin.material(x, y, z, { topFree: !landed.has(`${x},${y + 1},${z}`) });
        if (!mesh.userData.fading) applyStyle(mesh);
      }
      const colors = mesh.geometry.attributes.color;
      cubeAO(occupied, x, y, z, BOX_POS, BOX_NRM, colors.array);
      mesh.userData.ao = colors.array.slice();
      // in the light beam, a face turned to the light is lit – unless another cube stands in front of it (its shadow)
      mesh.userData.blocked = Boolean(beamLight) && Array.from({ length: size }, (_, i) => i).some(i =>
        beamLight.axis === 'z' ? i > z && landed.has(`${x},${y},${i}`) : i > x && landed.has(`${i},${y},${z}`));
      applyBeam(mesh);
    }
    const plane = base.getObjectByName('plate-shadow');
    if (plane) {
      shadowTexture.dispose();
      shadowTexture = alphaTexture(plateShadow(settledHeights(), size + 0.2));
      plane.material.alphaMap = shadowTexture;
      plane.material.needsUpdate = true;
    }
  }

  /** Light beam on the cube faces (vertex colours on top of the AO, may go above 1): the face turned to the light gets
   *  brighter (unless another cube stands in front of it), the one turned away darker, the other side faces a little
   *  darker – only as far as the cube is inside the beam, so a falling cube lights up while it drops into it. */
  function applyBeam(mesh) {
    const ao = mesh.userData.ao;
    if (!ao) return;
    const colors = mesh.geometry.attributes.color;
    let inside = 0;
    if (beamLight) {
      const c = mesh.position.y;   // centre of the cube
      inside = Math.max(0, Math.min(1, Math.min(c + 0.5, beamLight.top) - Math.max(c - 0.5, 0)));
    }
    const axis = beamLight?.axis === 'x' ? 0 : 2;
    const lit = 1 + (mesh.userData.blocked ? 0 : BEAM.lit) * inside;
    const away = 1 - BEAM.away * inside;
    const side = 1 - BEAM.side * inside;
    for (let v = 0; v < ao.length; v += 3) {
      const facing = BOX_NRM[v + axis];
      const k = !inside ? 1 : facing > 0.5 ? lit : facing < -0.5 ? away : Math.abs(BOX_NRM[v + 1]) > 0.5 ? 1 : side;
      colors.array[v] = ao[v] * k;
      colors.array[v + 1] = ao[v + 1] * k;
      colors.array[v + 2] = ao[v + 2] * k;
    }
    colors.needsUpdate = true;
  }

  /** Grid size and height limit: rebuilds the base plate and fits the camera. */
  function setGrid(newSize, newMaxHeight) {
    size = newSize;
    maxHeight = newMaxHeight;
    buildBase();
    placeMarker();
    frame3d();
    eyesLookAtViewer();
  }

  /** The plate springs from the old grid size to the new one (elastic), the camera frame follows smoothly – no jump
   *  when the next building is bigger or smaller. */
  function growPlate(from) {
    const ratio = (from.size + 0.2) / (size + 0.2);
    const to = { halfWidth, halfHeight, y: target.y };
    const lerp = (a, b, k) => a + (b - a) * k;
    base.scale.set(ratio, 1, ratio);
    addTween({
      start: performance.now(), duration: GROW.duration,
      step: t => {
        const s = lerp(ratio, 1, easeOutElastic(t));
        base.scale.set(s, 1, s);
        const k = easeOutCubic(Math.min(1, t * 1.6));
        halfWidth = lerp(from.halfWidth, to.halfWidth, k);
        halfHeight = lerp(from.halfHeight, to.halfHeight, k);
        target.y = lerp(from.y, to.y, k);
        fitCamera();
      },
      done: () => {
        base.scale.set(1, 1, 1);
        halfWidth = to.halfWidth;
        halfHeight = to.halfHeight;
        target.y = to.y;
        fitCamera();
      },
    });
  }

  /** Tight camera frame for plate + building (+ arrow): horizontally the circle the plate sweeps when turned,
   *  vertically the iso projection of that cylinder – much less empty space than a bounding sphere. */
  function frame3d() {
    const side = markerView === 'front' || markerView === 'side';
    const fs = frameFor?.size ?? size;
    const fh = frameFor?.maxHeight ?? maxHeight;
    const reach = Math.max((fs / 2 + 0.25) * Math.SQRT2, side ? fs / 2 + ARROW.gap + 0.15 : 0, ...extraPoints.map(([, d]) => d));
    halfWidth = reach;

    // vertical: every relevant point at height y and horizontal distance d from the centre can appear anywhere between
    // y·cos ± d·sin on screen while the building turns – so the frame is tight but never cuts anything off when dragged
    const cos = Math.cos(ISO_ELEVATION);
    const sin = Math.sin(ISO_ELEVATION);
    let up = -Infinity;
    let down = Infinity;
    const point = (y, d) => {
      up = Math.max(up, y * cos + d * sin);
      down = Math.min(down, y * cos - d * sin);
    };
    const plate = (fs / 2 + 0.1) * Math.SQRT2 + 0.2;   // incl. the yellow front edge
    point(0, plate);
    point(-0.12, plate);
    // columns: the building that is shown (fitContent) or the tallest one possible everywhere
    const columns = fitContent && contentHeights ? contentHeights : Array.from({ length: fs }, () => Array(fs).fill(fh));
    const off = (columns.length - 1) / 2;
    let tallest = 0;
    columns.forEach((row, z) => row.forEach((h, x) => {
      if (!h) return;
      tallest = Math.max(tallest, h);
      if (fitContent) {
        // the shown building: where its columns really are in the tilted view (back columns sit higher on screen),
        // plus a little room for turning it by hand
        const behind = (x - off + (z - off) - 1) / Math.SQRT2;
        up = Math.max(up, h * cos - behind * sin + 0.25);
      } else {
        point(h, Math.hypot(Math.abs(x - off) + 0.5, Math.abs(z - off) + 0.5));
      }
    }));
    if (side) point(ARROW.height + 0.35, fs / 2 + ARROW.gap + 0.1);
    if (markerView === 'top') point(markerTop() + 0.1, 0.4);
    for (const [y, d] of extraPoints) point(y, d);
    const centre = (up + down) / 2 / cos;
    target.set(0, centre, 0);
    // also enough for the straight views: front/side (heights around the centre), top (the whole plate)
    halfHeight = Math.max((up - down) / 2, tallest + 0.15 - centre, centre + 0.2, fs / 2 + 0.4);
    fitCamera();
  }

  /** height of the arrow's base above the building when the top view is asked */
  function markerTop() {
    const h = fitContent && contentHeights ? Math.max(1, ...contentHeights.flat()) : maxHeight;
    return h + ARROW.top - 0.2;
  }

  // ---- materials: shared per style; a fading cube gets transparent copies until it has settled -------------

  const mats = m => (Array.isArray(m) ? m : [m]);
  const transparentCopy = m => {
    if (Array.isArray(m)) return m.map(transparentCopy);
    const copy = m.clone();
    copy.userData = {};   // a copy is never shared
    copy.transparent = true;
    // clone() does not carry a style's own shader parts (galaxy sky, googly eyes …) – without them a fading cube would
    // be plain white and the real look would pop in when it lands
    if (Object.hasOwn(m, 'onBeforeCompile')) copy.onBeforeCompile = m.onBeforeCompile;
    if (Object.hasOwn(m, 'customProgramCacheKey')) copy.customProgramCacheKey = m.customProgramCacheKey;
    if (m.defines) copy.defines = { ...m.defines };
    return copy;
  };
  const edgeOf = () => skin.edge ?? noEdge;

  // Faces are pushed back a little in the depth buffer, so the edge lines (which lie exactly on the faces, also on the
  // touching faces of neighbouring cubes) always win – otherwise they flicker, look thinner or vanish in places.
  const pushBack = m => {
    if (m.polygonOffset) return;
    m.polygonOffset = true;
    m.polygonOffsetFactor = 1;
    m.polygonOffsetUnits = 1;
    m.needsUpdate = true;
  };

  function applyStyle(mesh) {
    const lines = mesh.children[0];
    mats(mesh.userData.base).forEach(pushBack);
    mesh.material = mesh.userData.base;
    lines.material = edgeOf();
    lines.visible = Boolean(skin.edge);
  }
  function startFade(mesh) {
    if (mesh.userData.fading) return;
    mesh.userData.fading = true;
    mesh.material = transparentCopy(mesh.userData.base);
    mesh.children[0].material = transparentCopy(edgeOf());
  }
  function setOpacity(mesh, opacity) {
    mats(mesh.material).forEach(m => (m.opacity = opacity));
    const lines = mesh.children[0].material;
    lines.opacity = opacity * (edgeOf().opacity ?? 1);
  }
  /** back to the shared style materials (or just drop the copies of a cube that is gone) */
  function settle(mesh) {
    if (!mesh.userData.fading) return;
    mats(mesh.material).forEach(m => m.dispose());
    mesh.children[0].material.dispose();
    mesh.userData.fading = false;
    applyStyle(mesh);
  }

  /** A cube mesh; `fading` starts it invisible with transparent copies (for the drop-in). */
  function makeCube(x, y, z, fading) {
    const geometry = cubeGeometry.clone();   // own vertex colors for AO
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(BOX_POS.length).fill(1), 3));
    const mesh = new THREE.Mesh(geometry);
    mesh.add(new THREE.LineSegments(edgeGeometry, edgeOf()));
    mesh.userData = { x, y, z, base: skin.material(x, y, z, { topFree: true }), fading: false };
    applyStyle(mesh);
    if (fading) {
      startFade(mesh);
      setOpacity(mesh, 0);
    }
    mesh.position.set(x - offset(), y + 0.5, z - offset());
    return mesh;
  }

  /**
   * Cube heights (heights[z][x]). Only the difference is animated: new cubes drop in, removed ones fade out.
   * @param {{ stagger?: boolean, animate?: boolean }} [opts]  stagger: a whole building assembles layer by layer
   */
  function setHeights(newHeights, { stagger = false, animate = true, delay: after = 0 } = {}) {
    heights = newHeights.map(row => [...row]);
    const motion = animate && !reducedMotion();
    const wanted = new Set();
    heights.forEach((row, z) => row.forEach((h, x) => { for (let y = 0; y < h; y++) wanted.add(`${x},${y},${z}`); }));

    // removed cubes fade out (and rise a little)
    for (const [key, mesh] of cubeMap) {
      if (wanted.has(key)) continue;
      cubeMap.delete(key);
      cubes.remove(mesh);
      if (!motion) {
        if (mesh.userData.tween) tweens.delete(mesh.userData.tween);
        settle(mesh);
        mesh.geometry.dispose();
        continue;
      }
      leaving.add(mesh);
      if (mesh.userData.tween) tweens.delete(mesh.userData.tween);   // removed while still dropping in
      startFade(mesh);
      const y0 = mesh.position.y;
      addTween({
        start: performance.now(), duration: FADE_OUT,
        step: t => {
          setOpacity(mesh, 1 - t);
          mesh.position.y = y0 + 0.35 * t;
          mesh.scale.setScalar(1 - 0.15 * t);
        },
        done: () => {
          leaving.remove(mesh);
          settle(mesh);
          mesh.geometry.dispose();
        },
      });
    }

    // new cubes drop in from above and fade in
    const now = performance.now();
    for (const key of wanted) {
      if (cubeMap.has(key)) continue;
      const [x, y, z] = key.split(',').map(Number);
      const mesh = makeCube(x, y, z, motion);
      cubeMap.set(key, mesh);
      cubes.add(mesh);
      if (!motion) continue;
      const yEnd = mesh.position.y;
      const delay = after + (stagger ? y * DROP.layerDelay + (x + z) * DROP.cellDelay : 0);
      mesh.position.y = yEnd + DROP.height;
      addTween(mesh.userData.tween = {
        start: now + delay, duration: DROP.duration,
        step: t => {
          // stacked: never lower than on top of the cube below, even while that one is still falling – no overlap
          const below = cubeMap.get(`${x},${y - 1},${z}`);
          const floor = below ? below.position.y + 1 : yEnd;
          mesh.position.y = Math.max(floor, yEnd + DROP.height * (1 - easeOutCubic(t)));
          if (beamLight) applyBeam(mesh);   // lights up while it drops into the beam
          setOpacity(mesh, Math.min(1, t * 1.6));
        },
        done: () => {
          mesh.position.y = yEnd;
          mesh.userData.tween = null;
          settle(mesh);
          lightingDirty = true;   // landed: now it occludes and casts a shadow
        },
      });
    }
    ghost.visible = false;
    refreshLighting();
    render();
  }

  // ---- direction marker ------------------------------------------------------------------------

  function placeMarker() {
    marker.visible = Boolean(markerView) && currentView === 'iso';
    if (!markerView) return;
    const gap = size / 2 + ARROW.gap;   // arrow base; the tip ends just outside the plate
    marker.rotation.set(0, 0, 0);
    if (markerView === 'top') {
      marker.position.set(0, markerTop(), 0);   // pointing down (as built)
    } else if (markerView === 'front') {
      marker.position.set(0, ARROW.height, gap);
      marker.rotation.x = Math.PI / 2;   // -y → -z
    } else {
      marker.position.set(gap, ARROW.height, 0);
      marker.rotation.z = -Math.PI / 2;   // -y → -x
    }
  }

  // ---- camera moves --------------------------------------------------------------------------

  /** Moves the camera straight onto a view ('front' | 'side' | 'top') or back to 'iso'. Resolves when done.
   *  instant: no animation (still pictures). */
  function lookFrom(view, { instant = false } = {}) {
    const to = CAMERA_VIEWS[view] ?? CAMERA_VIEWS.iso;
    currentView = view in CAMERA_VIEWS ? view : 'iso';
    if (cameraAnimation) cancelAnimationFrame(cameraAnimation.frame);
    const from = { dir: camDir.clone(), up: camUp.clone(), rot: pivot.rotation.y };
    const rotTarget = Math.round(from.rot / (2 * Math.PI)) * 2 * Math.PI;   // the short way back home
    marker.visible = false;   // it would stand in front of the building
    const finish = () => {
      camDir.copy(to.dir);
      camUp.copy(to.up);
      pivot.rotation.y = rotTarget;
      cameraAnimation = null;
      placeMarker();
      applyCamera();
      render();
    };
    if (instant || reducedMotion()) {
      finish();
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const start = performance.now();
      const duration = 550;
      const step = now => {
        const t = Math.min(1, (now - start) / duration);
        if (t >= 1) {
          finish();
          resolve();
          return;
        }
        const k = easeInOut(t);
        camDir.lerpVectors(from.dir, to.dir, k).normalize();
        camUp.lerpVectors(from.up, to.up, k).normalize();
        pivot.rotation.y = from.rot + (rotTarget - from.rot) * k;
        applyCamera();
        render();
        cameraAnimation.frame = requestAnimationFrame(step);
      };
      cameraAnimation = { frame: requestAnimationFrame(step) };
    });
  }

  // ---- picking (Builder) -----------------------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const inGrid = (x, z) => x >= 0 && z >= 0 && x < size && z < size;

  /** The column a tap at (clientX, clientY) would change with `action`, or null. */
  function columnAt(clientX, clientY, action = tool) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects([...cubes.children, plate].filter(Boolean), false);
    if (!hit) return null;

    if (hit.object === plate) {
      const p = pivot.worldToLocal(hit.point.clone());
      const x = Math.floor(p.x + size / 2);
      const z = Math.floor(p.z + size / 2);
      if (!inGrid(x, z)) return null;
      if (action === 'remove' && heights[z][x] === 0) return null;
      return { x, z };
    }
    const { x, z } = hit.object.userData;
    if (action === 'remove') return { x, z };
    // add: top face → same column, side face → the neighbouring column (the new cube "drops" there)
    const n = hit.face.normal;
    if (n.y > 0.5) return { x, z };
    const nx = x + Math.round(n.x);
    const nz = z + Math.round(n.z);
    return inGrid(nx, nz) ? { x: nx, z: nz } : null;
  }

  function updateGhost(column, action = tool) {
    const show = column && (action === 'remove' ? heights[column.z][column.x] > 0 : heights[column.z][column.x] < maxHeight);
    if (show) {
      const h = heights[column.z][column.x];
      ghost.position.set(column.x - offset(), (action === 'remove' ? h - 1 : h) + 0.5, column.z - offset());
      ghost.scale.setScalar(action === 'remove' ? 1.04 : 1);
      ghostMaterial.color.setHex(action === 'remove' ? COLORS.ghostRemove : PALETTES[theme()].ghost);
      ghostEdges.color.setHex(action === 'remove' ? COLORS.ghostRemove : PALETTES[theme()].ghost);
      ghostMaterial.opacity = action === 'remove' ? 0.55 : 0.35;
    }
    if (ghost.visible !== Boolean(show) || show) {
      ghost.visible = Boolean(show);
      render();
    }
  }

  // ---- pointer input -------------------------------------------------------------------------

  let gesture = null;   // { id, startX, startY, lastX, dragging, action, timer, handled }
  canvas.style.touchAction = 'none';

  const onDown = e => {
    if (gesture) return;   // ignore a second finger
    gesture = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, dragging: false, handled: false,
      action: e.button === 2 ? 'remove' : tool,
    };
    canvas.setPointerCapture(e.pointerId);
    if (editable && e.pointerType !== 'mouse') {
      // long press = remove
      gesture.timer = setTimeout(() => {
        if (!gesture || gesture.dragging) return;
        gesture.handled = true;
        const column = columnAt(gesture.startX, gesture.startY, 'remove');
        if (column) {
          navigator.vibrate?.(15);
          onTap?.(column, 'remove');
        }
      }, LONG_PRESS);
    }
  };
  const onMove = e => {
    if (!gesture) {
      if (editable && e.pointerType === 'mouse') updateGhost(columnAt(e.clientX, e.clientY));
      return;
    }
    if (e.pointerId !== gesture.id) return;
    if (!gesture.dragging && Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > DRAG_THRESHOLD) {
      gesture.dragging = true;
      clearTimeout(gesture.timer);
      ghost.visible = false;
    }
    if (gesture.dragging) {
      pivot.rotation.y += (e.clientX - gesture.lastX) * 0.01;
      gesture.lastX = e.clientX;
      render();
    }
  };
  const onUp = e => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    clearTimeout(g.timer);
    if (!g.dragging && !g.handled && editable && onTap) {
      const column = columnAt(e.clientX, e.clientY, g.action);
      if (column) onTap(column, g.action);
    }
    if (editable && e.pointerType === 'mouse') updateGhost(columnAt(e.clientX, e.clientY));
  };
  const onCancel = () => {
    if (gesture) clearTimeout(gesture.timer);
    gesture = null;
  };
  const onLeave = () => updateGhost(null);
  const onContextMenu = e => e.preventDefault();   // right click removes, no browser menu

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', onContextMenu);

  // eyes follow the pointer (styles with lookAt): pointer anywhere on the page → a point on its ray (only the screen
  // position counts) → every pupil turns towards it on screen; at most one render per frame. Idle: at the viewer.
  const eyePoint = new THREE.Vector3();
  let eyeFrame = 0;
  function eyesFollow(clientX, clientY) {
    if (!skin.lookAt) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    skin.lookAt(eyePoint.copy(raycaster.ray.origin));
    if (!eyeFrame && !frame) {
      eyeFrame = requestAnimationFrame(() => {
        eyeFrame = 0;
        render();
      });
    }
  }
  function eyesLookAtViewer() {
    if (!skin.lookAt) return;
    skin.lookAt(null);
  }
  const onPagePointer = e => eyesFollow(e.clientX, e.clientY);
  window.addEventListener('pointermove', onPagePointer, { passive: true });
  window.addEventListener('pointerdown', onPagePointer, { passive: true });
  eyesLookAtViewer();

  const onTheme = () => {
    markerMaterial.color.setHex(PALETTES[theme()].arrow);
    markerMaterial.emissive.setHex(PALETTES[theme()].arrowGlow);
    buildBase();
    ghostEdges.color.setHex(PALETTES[theme()].ghost);
    ghostMaterial.color.setHex(PALETTES[theme()].ghost);
    skin.onTheme?.();   // e.g. skyscraper windows glow only in the dark theme
    render();
  };
  window.addEventListener('wyrfl-theme', onTheme);

  // styles with eyes blink: now and then one or two cubes close their eyes for a moment (one extra frame each,
  // no frame loop; nothing happens while the page is hidden)
  let blinkTimer = 0;
  function startBlinking() {
    clearInterval(blinkTimer);
    if (!skin.blink || reducedMotion()) return;
    blinkTimer = setInterval(() => {
      if (document.hidden || !cubeMap.size) return;
      const all = [...cubeMap.values()].filter(m => !m.userData.fading);
      for (let i = 0; i < Math.min(all.length, 1 + Math.floor(Math.random() * 2)); i++) {
        const mesh = all[Math.floor(Math.random() * all.length)];
        const base = mesh.userData.base;
        const shut = skin.blink?.(base);
        if (!shut) continue;
        mesh.material = shut;
        setTimeout(() => {
          if (!mesh.userData.fading && mesh.userData.base === base) mesh.material = base;
          render();
        }, 160);
      }
      render();
    }, 900);
  }
  startBlinking();

  // another cube style: swap the materials of all cubes (running animations finish first)
  const onSkin = e => {
    finishTweens();
    const old = skin;
    skin = createSkin(e.detail);
    for (const mesh of cubeMap.values()) {
      const { x, y, z } = mesh.userData;
      mesh.userData.base = skin.material(x, y, z, { topFree: true });
      applyStyle(mesh);
    }
    old.dispose();
    eyesLookAtViewer();
    refreshLighting();
    render();
    startBlinking();
  };
  window.addEventListener('wyrfl-skin', onSkin);

  const resize = new ResizeObserver(fitCamera);
  resize.observe(canvas);

  return {
    setGrid,
    setHeights,
    /** Shows a structure ({ size, maxHeight, heights }) in the standard view; it assembles layer by layer.
     *  keepView: don't turn back to the standard view (hero: the turntable keeps turning). */
    setStructure(structure, { animate = true, keepView = false } = {}) {
      if (cameraAnimation) cancelAnimationFrame(cameraAnimation.frame);
      cameraAnimation = null;
      finishTweens();
      for (const mesh of cubeMap.values()) {
        cubes.remove(mesh);
        settle(mesh);
        mesh.geometry.dispose();
      }
      cubeMap.clear();
      if (!keepView) {
        camDir.copy(CAMERA_VIEWS.iso.dir);
        camUp.copy(CAMERA_VIEWS.iso.up);
        currentView = 'iso';
        pivot.rotation.y = 0;
      }
      contentHeights = structure.heights.map(row => [...row]);
      const grow = animate && !reducedMotion() && plate && size !== structure.size;
      const from = { size, halfWidth, halfHeight, y: target.y };
      setGrid(structure.size, structure.maxHeight);
      if (grow) growPlate(from);
      setHeights(structure.heights, { stagger: true, animate, delay: grow ? GROW.cubesAfter : 0 });
    },
    /** Fades all cubes out (they rise a little); resolves when they are gone. */
    clear() {
      setHeights(heights.map(row => row.map(() => 0)));
      return new Promise(resolve => setTimeout(resolve, reducedMotion() ? 0 : FADE_OUT + 50));
    },
    /** Turntable: turns the building by `speed` rad/s (0 stops). Runs a frame loop – stop it when not visible. */
    setAutoRotate(speed) {
      autoRotate = speed;
      if (speed && !frame) frame = requestAnimationFrame(loop);
    },
    lookFrom,
    /** Adds an object that turns with the building (shadow mode: wall, sun); the caller owns and disposes it. */
    attach(object) {
      pivot.add(object);
      render();
    },
    detach(object) {
      pivot.remove(object);
      render();
    },
    /** More points to keep in the frame while turning: [height, horizontal distance from the centre][].
     *  refit: false – only remember them (the next setStructure eases the frame over, e.g. when the grid grows). */
    setExtent(points, { refit = true } = {}) {
      extraPoints = points;
      if (refit) frame3d();
    },
    /** Shadow mode: light beam along +z ('z', from the front) or +x ('x', from the right) up to `top`; null: none. */
    setBeamLight(light) {
      beamLight = light;
      refreshLighting();
      render();
    },
    /** Turns the building to an angle (rad) at once – still pictures of the options in the shadow mode. */
    setTurn(angle) {
      pivot.rotation.y = angle;
      render();
    },
    /** Draws the current state again (animated extras like the dust in the shadow mode's light beam). */
    redraw() {
      render();
    },
    /** Draws now (the canvas can be copied right after, e.g. into a still picture). */
    renderNow() {
      fitCamera();
      render();
    },
    get canvas() {
      return canvas;
    },
    get view() {
      return currentView;
    },
    /** Arrow from the asked direction ('front' | 'side' | 'top'), null hides it. */
    setViewMarker(view) {
      markerView = view;
      placeMarker();
      frame3d();
    },
    /** Shows the preview cube for a column (keyboard cursor in the Builder); null hides it. */
    highlight(column) {
      updateGhost(column);
    },
    /** 'add' | 'remove' – what a tap / left click does (Builder) */
    setTool(next) {
      tool = next;
      ghost.visible = false;
      render();
    },
    dispose() {
      if (cameraAnimation) cancelAnimationFrame(cameraAnimation.frame);
      if (frame) cancelAnimationFrame(frame);
      tweens.clear();
      resize.disconnect();
      window.removeEventListener('wyrfl-theme', onTheme);
      window.removeEventListener('wyrfl-skin', onSkin);
      clearInterval(blinkTimer);
      cancelAnimationFrame(eyeFrame);
      window.removeEventListener('pointermove', onPagePointer);
      window.removeEventListener('pointerdown', onPagePointer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      [base, cubes, leaving].forEach(disposeGroup);
      shadowTexture?.dispose();
      dropTexture?.dispose();
      skin.dispose();
      [cubeGeometry, edgeGeometry, noEdge, ghostMaterial, ghostEdges, markerMaterial, shaft.geometry, head.geometry].forEach(o => o.dispose());
      renderer.dispose();
    },
  };
}
