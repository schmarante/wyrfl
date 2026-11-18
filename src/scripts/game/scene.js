// Isometric 3D view of a cube structure (three.js, OrthographicCamera – never perspective).
// Renders on demand only (no idle render loop – saves battery on phones); a frame loop runs only while something moves.
// - drag / swipe turns the structure around the vertical axis
// - new cubes drop in from above and fade in (a whole building assembles layer by layer), removed cubes fade out
// - Builder (editable): tap / left click → onTap(column, tool), right click or long press → onTap(column, 'remove')
// - lookFrom('front' | 'side' | 'top' | 'iso') moves the camera straight onto a view (learning aid)
// - setViewMarker(view) shows an arrow from the asked direction (View Guesser) – explains "from the right" without words
// - follows the light/dark theme (window event 'wyrfl-theme')

import * as THREE from 'three';

const PALETTES = {
  dark: { plate: 0x2a3142, plateLine: 0x3b4458, marker: 0xeef1f7 },
  light: { plate: 0xcfd6e3, plateLine: 0xb3bccc, marker: 0x151b27 },
};
const COLORS = {
  cube: 0x4f8cff,
  edge: 0x0b1530,
  front: 0xffc53d,   // marks the front edge – same color as the "front" label in the UI
  ghostAdd: 0xffffff,
  ghostRemove: 0xff6b6b,
};

const DRAG_THRESHOLD = 6;     // px – below this a pointer gesture counts as a tap
const LONG_PRESS = 450;       // ms – touch held this long removes a cube
const CAMERA_DISTANCE = 30;
const DROP = { height: 1.6, duration: 320, layerDelay: 110, cellDelay: 28 };
const FADE_OUT = 200;
const ISO_ELEVATION = Math.asin(1 / Math.sqrt(3));   // 35.26° – camera height angle of the iso view
const ARROW = { shaft: 0.8, head: 0.5, gap: 1.6 };    // arrow base this far outside the plate centre line (+ size/2)

// camera direction (from target to camera) and up vector per view; iso = front (+z), right (+x) and top visible
const CAMERA_VIEWS = {
  iso: { dir: new THREE.Vector3(1, 1, 1).normalize(), up: new THREE.Vector3(0, 1, 0) },
  front: { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  side: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },   // back at the top, front at the bottom
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = t => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;   // tiny settle at the end
const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ editable?: boolean, marker?: boolean, onTap?: (column: { x: number, z: number }, tool: 'add' | 'remove') => void }} [options]
 */
export function createCubeScene(canvas, { editable = false, marker: withMarker = false, onTap } = {}) {
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
  const cubeMaterial = new THREE.MeshLambertMaterial({ color: COLORS.cube });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge });

  const ghostMaterial = new THREE.MeshBasicMaterial({ color: COLORS.ghostAdd, transparent: true, opacity: 0.35, depthWrite: false });
  const ghostEdges = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
  const ghost = new THREE.Mesh(cubeGeometry, ghostMaterial);
  ghost.add(new THREE.LineSegments(edgeGeometry, ghostEdges));
  ghost.visible = false;
  pivot.add(ghost);

  // arrow pointing at the building from the asked direction
  const markerMaterial = new THREE.MeshBasicMaterial({ color: PALETTES[theme()].marker });
  const marker = new THREE.Group();
  // built pointing down (-y) from the group origin = the arrow's base; rotated per view
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, ARROW.shaft, 12), markerMaterial);
  shaft.position.y = -ARROW.shaft / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, ARROW.head, 20), markerMaterial);
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

  const offset = () => (size - 1) / 2;

  function render() {
    renderer.render(scene, camera);
  }

  // ---- frame loop for cube tweens --------------------------------------------------------------

  function loop(now) {
    frame = 0;
    for (const tw of tweens) {
      const t = Math.min(1, Math.max(0, (now - tw.start) / tw.duration));
      tw.step(t);
      if (t >= 1) {
        tweens.delete(tw);
        tw.done?.();
      }
    }
    render();
    if (tweens.size) frame = requestAnimationFrame(loop);
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
        if (o.material && o.material !== cubeMaterial && o.material !== edgeMaterial) o.material.dispose();
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
    const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.12, 0.14), new THREE.MeshLambertMaterial({ color: COLORS.front }));
    frontEdge.position.set(0, -0.04, size / 2 + 0.17);
    base.add(plate, grid, frontEdge);
  }

  /** Grid size and height limit: rebuilds the base plate and fits the camera. */
  function setGrid(newSize, newMaxHeight) {
    size = newSize;
    maxHeight = newMaxHeight;
    buildBase();
    placeMarker();
    frame3d();
  }

  /** Tight camera frame for plate + building (+ arrow): horizontally the circle the plate sweeps when turned,
   *  vertically the iso projection of that cylinder – much less empty space than a bounding sphere. */
  function frame3d() {
    const side = markerView === 'front' || markerView === 'side';
    const reach = Math.max((size / 2 + 0.25) * Math.SQRT2, side ? size / 2 + ARROW.gap + 0.15 : 0);
    const top = maxHeight + (markerView === 'top' ? ARROW.gap + 0.1 : 0.05);
    const bottom = -0.12;
    target.set(0, (top + bottom) / 2, 0);
    halfWidth = reach;
    halfHeight = Math.max(((top - bottom) / 2) * Math.cos(ISO_ELEVATION) + reach * Math.sin(ISO_ELEVATION), size / 2 + 0.4);
    fitCamera();
  }

  /** A cube mesh; `fading` gives it its own transparent materials for a fade (switched back when done). */
  function makeCube(x, y, z, fading) {
    const mesh = new THREE.Mesh(cubeGeometry, fading ? cubeMaterial.clone() : cubeMaterial);
    const lines = new THREE.LineSegments(edgeGeometry, fading ? edgeMaterial.clone() : edgeMaterial);
    if (fading) {
      mesh.material.transparent = lines.material.transparent = true;
      mesh.material.opacity = lines.material.opacity = 0;
    }
    mesh.add(lines);
    mesh.position.set(x - offset(), y + 0.5, z - offset());
    mesh.userData = { x, y, z };
    return mesh;
  }

  function settle(mesh) {
    const lines = mesh.children[0];
    if (mesh.material !== cubeMaterial) {
      mesh.material.dispose();
      mesh.material = cubeMaterial;
    }
    if (lines.material !== edgeMaterial) {
      lines.material.dispose();
      lines.material = edgeMaterial;
    }
  }

  /**
   * Cube heights (heights[z][x]). Only the difference is animated: new cubes drop in, removed ones fade out.
   * @param {{ stagger?: boolean, animate?: boolean }} [opts]  stagger: a whole building assembles layer by layer
   */
  function setHeights(newHeights, { stagger = false, animate = true } = {}) {
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
        continue;
      }
      leaving.add(mesh);
      if (mesh.userData.tween) tweens.delete(mesh.userData.tween);   // removed while still dropping in
      if (mesh.material === cubeMaterial) {
        mesh.material = cubeMaterial.clone();
        mesh.children[0].material = edgeMaterial.clone();
        mesh.material.transparent = mesh.children[0].material.transparent = true;
      }
      const y0 = mesh.position.y;
      addTween({
        start: performance.now(), duration: FADE_OUT,
        step: t => {
          mesh.material.opacity = mesh.children[0].material.opacity = 1 - t;
          mesh.position.y = y0 + 0.35 * t;
          mesh.scale.setScalar(1 - 0.15 * t);
        },
        done: () => {
          leaving.remove(mesh);
          mesh.material.dispose();
          mesh.children[0].material.dispose();
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
      const delay = stagger ? y * DROP.layerDelay + (x + z) * DROP.cellDelay : 0;
      mesh.position.y = yEnd + DROP.height;
      addTween(mesh.userData.tween = {
        start: now + delay, duration: DROP.duration,
        step: t => {
          mesh.position.y = yEnd + DROP.height * (1 - easeOutBack(t));
          mesh.material.opacity = mesh.children[0].material.opacity = Math.min(1, t * 1.6);
        },
        done: () => {
          mesh.position.y = yEnd;
          mesh.userData.tween = null;
          settle(mesh);
        },
      });
    }
    ghost.visible = false;
    render();
  }

  // ---- direction marker ------------------------------------------------------------------------

  function placeMarker() {
    marker.visible = Boolean(markerView) && currentView === 'iso';
    if (!markerView) return;
    const gap = size / 2 + ARROW.gap;   // arrow base; the tip ends just outside the plate
    marker.rotation.set(0, 0, 0);
    if (markerView === 'top') {
      marker.position.set(0, maxHeight + ARROW.gap - 0.2, 0);   // pointing down (as built)
    } else if (markerView === 'front') {
      marker.position.set(0, maxHeight / 2, gap);
      marker.rotation.x = Math.PI / 2;   // -y → -z
    } else {
      marker.position.set(gap, maxHeight / 2, 0);
      marker.rotation.z = -Math.PI / 2;   // -y → -x
    }
  }

  // ---- camera moves --------------------------------------------------------------------------

  /** Moves the camera straight onto a view ('front' | 'side' | 'top') or back to 'iso'. Resolves when done. */
  function lookFrom(view) {
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
    if (reducedMotion()) {
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
      ghostMaterial.color.setHex(action === 'remove' ? COLORS.ghostRemove : COLORS.ghostAdd);
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

  const onTheme = () => {
    markerMaterial.color.setHex(PALETTES[theme()].marker);
    buildBase();
    render();
  };
  window.addEventListener('wyrfl-theme', onTheme);

  const resize = new ResizeObserver(fitCamera);
  resize.observe(canvas);

  return {
    setGrid,
    setHeights,
    /** Shows a structure ({ size, maxHeight, heights }) in the standard view; it assembles layer by layer. */
    setStructure(structure, { animate = true } = {}) {
      if (cameraAnimation) cancelAnimationFrame(cameraAnimation.frame);
      cameraAnimation = null;
      finishTweens();
      for (const mesh of cubeMap.values()) {
        cubes.remove(mesh);
        settle(mesh);
      }
      cubeMap.clear();
      camDir.copy(CAMERA_VIEWS.iso.dir);
      camUp.copy(CAMERA_VIEWS.iso.up);
      currentView = 'iso';
      pivot.rotation.y = 0;
      setGrid(structure.size, structure.maxHeight);
      setHeights(structure.heights, { stagger: true, animate });
    },
    lookFrom,
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
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      [base, cubes, leaving].forEach(disposeGroup);
      [cubeGeometry, edgeGeometry, cubeMaterial, edgeMaterial, ghostMaterial, ghostEdges, markerMaterial, shaft.geometry, head.geometry].forEach(o => o.dispose());
      renderer.dispose();
    },
  };
}
