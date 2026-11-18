// Isometric 3D view of a cube structure (three.js, OrthographicCamera – never perspective).
// Renders on demand only (no idle render loop – saves battery on phones).
// - drag / swipe turns the structure around the vertical axis
// - a short tap (no drag) calls onTap(column) when the scene is editable (Builder)
// - lookFrom('front' | 'side' | 'top' | 'iso') moves the camera straight onto a view (learning aid)

import * as THREE from 'three';

const COLORS = {
  cube: 0x4f8cff,
  edge: 0x0b1530,
  plate: 0x2a3142,
  plateLine: 0x3b4458,
  front: 0xffc53d,   // marks the front edge – same color as the "front" label in the UI
  ghostAdd: 0xffffff,
  ghostRemove: 0xff6b6b,
};

const DRAG_THRESHOLD = 6;   // px – below this a pointer gesture counts as a tap
const CAMERA_DISTANCE = 30;

// camera direction (from target to camera) and up vector per view; iso = front (+z), right (+x) and top visible
const CAMERA_VIEWS = {
  iso: { dir: new THREE.Vector3(1, 1, 1).normalize(), up: new THREE.Vector3(0, 1, 0) },
  front: { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  side: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },   // back at the top, front at the bottom
};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ editable?: boolean, onTap?: (column: { x: number, z: number }) => void }} [options]
 */
export function createCubeScene(canvas, { editable = false, onTap } = {}) {
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
  pivot.add(base, cubes);

  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeometry = new THREE.EdgesGeometry(cubeGeometry);
  const cubeMaterial = new THREE.MeshLambertMaterial({ color: COLORS.cube });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge });

  const ghostMaterial = new THREE.MeshBasicMaterial({ color: COLORS.ghostAdd, transparent: true, opacity: 0.35, depthWrite: false });
  const ghost = new THREE.Mesh(cubeGeometry, ghostMaterial);
  ghost.add(new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })));
  ghost.visible = false;
  pivot.add(ghost);

  let size = 3;
  let maxHeight = 3;
  let heights = [];
  let plate = null;
  let tool = 'add';
  let radius = 1;
  const target = new THREE.Vector3();
  const camDir = CAMERA_VIEWS.iso.dir.clone();
  const camUp = CAMERA_VIEWS.iso.up.clone();
  let currentView = 'iso';
  let animation = null;

  const offset = () => (size - 1) / 2;

  function render() {
    renderer.render(scene, camera);
  }

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
    const half = radius * 1.08 * Math.max(1, 1 / aspect);
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    camera.updateProjectionMatrix();
    applyCamera();
    render();
  }

  function disposeGroup(group) {
    for (const child of [...group.children]) {
      child.traverse(o => {
        if (o.geometry && o.geometry !== cubeGeometry && o.geometry !== edgeGeometry) o.geometry.dispose();
        if (o.material && o.material !== cubeMaterial && o.material !== edgeMaterial) o.material.dispose();
      });
      group.remove(child);
    }
  }

  /** Grid size and height limit: rebuilds the base plate and fits the camera. */
  function setGrid(newSize, newMaxHeight) {
    size = newSize;
    maxHeight = newMaxHeight;
    disposeGroup(base);

    plate = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.1, size + 0.2), new THREE.MeshLambertMaterial({ color: COLORS.plate }));
    plate.position.y = -0.05;
    const grid = new THREE.GridHelper(size, size, COLORS.plateLine, COLORS.plateLine);
    grid.position.y = 0.002;
    const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(size + 0.2, 0.12, 0.14), new THREE.MeshLambertMaterial({ color: COLORS.front }));
    frontEdge.position.set(0, -0.04, size / 2 + 0.17);
    base.add(plate, grid, frontEdge);

    target.set(0, maxHeight / 2, 0);
    radius = Math.hypot(size / 2 + 0.3, size / 2 + 0.3, maxHeight / 2);
    fitCamera();
  }

  /** Cube heights (heights[z][x]) – rebuilds the cubes only, camera and rotation stay. */
  function setHeights(newHeights) {
    heights = newHeights.map(row => [...row]);
    disposeGroup(cubes);
    heights.forEach((row, z) =>
      row.forEach((h, x) => {
        for (let y = 0; y < h; y++) {
          const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
          cube.position.set(x - offset(), y + 0.5, z - offset());
          cube.userData = { x, y, z };
          cube.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
          cubes.add(cube);
        }
      }),
    );
    ghost.visible = false;
    render();
  }

  // ---- camera moves --------------------------------------------------------------------------

  /** Moves the camera straight onto a view ('front' | 'side' | 'top') or back to 'iso'. Resolves when done. */
  function lookFrom(view) {
    const to = CAMERA_VIEWS[view] ?? CAMERA_VIEWS.iso;
    currentView = view in CAMERA_VIEWS ? view : 'iso';
    if (animation) cancelAnimationFrame(animation.frame);
    const from = { dir: camDir.clone(), up: camUp.clone(), rot: pivot.rotation.y };
    // turn the structure back to its home rotation the short way
    const rotTarget = Math.round(from.rot / (2 * Math.PI)) * 2 * Math.PI;
    const finish = () => {
      camDir.copy(to.dir);
      camUp.copy(to.up);
      pivot.rotation.y = rotTarget;
      animation = null;
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
        animation.frame = requestAnimationFrame(step);
      };
      animation = { frame: requestAnimationFrame(step) };
    });
  }

  // ---- picking (Builder) -----------------------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const inGrid = (x, z) => x >= 0 && z >= 0 && x < size && z < size;

  /** The column a tap at (clientX, clientY) would change with the current tool, or null. */
  function columnAt(clientX, clientY) {
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
      if (tool === 'remove' && heights[z][x] === 0) return null;
      return { x, z };
    }
    const { x, z } = hit.object.userData;
    if (tool === 'remove') return { x, z };
    // add: top face → same column, side face → the neighbouring column (the new cube "drops" there)
    const n = hit.face.normal;
    if (n.y > 0.5) return { x, z };
    const nx = x + Math.round(n.x);
    const nz = z + Math.round(n.z);
    return inGrid(nx, nz) ? { x: nx, z: nz } : null;
  }

  function updateGhost(column) {
    const show = column && (tool === 'remove' ? heights[column.z][column.x] > 0 : heights[column.z][column.x] < maxHeight);
    if (show) {
      const h = heights[column.z][column.x];
      const y = tool === 'remove' ? h - 1 : h;
      ghost.position.set(column.x - offset(), y + 0.5, column.z - offset());
      ghost.scale.setScalar(tool === 'remove' ? 1.04 : 1);
      ghostMaterial.color.setHex(tool === 'remove' ? COLORS.ghostRemove : COLORS.ghostAdd);
      ghostMaterial.opacity = tool === 'remove' ? 0.55 : 0.35;
    }
    if (ghost.visible !== Boolean(show) || show) {
      ghost.visible = Boolean(show);
      render();
    }
  }

  // ---- pointer input -------------------------------------------------------------------------

  let gesture = null;   // { id, startX, lastX, dragging }
  canvas.style.touchAction = 'none';

  const onDown = e => {
    if (gesture) return;   // ignore a second finger
    gesture = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, dragging: false };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = e => {
    if (!gesture) {
      if (editable && e.pointerType === 'mouse') updateGhost(columnAt(e.clientX, e.clientY));
      return;
    }
    if (e.pointerId !== gesture.id) return;
    if (!gesture.dragging && Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > DRAG_THRESHOLD) {
      gesture.dragging = true;
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
    const wasTap = !gesture.dragging;
    gesture = null;
    if (wasTap && editable && onTap) {
      const column = columnAt(e.clientX, e.clientY);
      if (column) onTap(column);
      if (e.pointerType === 'mouse') updateGhost(columnAt(e.clientX, e.clientY));
    }
  };
  const onCancel = () => (gesture = null);
  const onLeave = () => updateGhost(null);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);

  const resize = new ResizeObserver(fitCamera);
  resize.observe(canvas);

  return {
    setGrid,
    setHeights,
    /** Shows a structure ({ size, maxHeight, heights } from structure.js) in the standard view. */
    setStructure(structure) {
      if (animation) cancelAnimationFrame(animation.frame);
      animation = null;
      camDir.copy(CAMERA_VIEWS.iso.dir);
      camUp.copy(CAMERA_VIEWS.iso.up);
      currentView = 'iso';
      pivot.rotation.y = 0;
      setGrid(structure.size, structure.maxHeight);
      setHeights(structure.heights);
    },
    lookFrom,
    get view() {
      return currentView;
    },
    /** Shows the preview cube for a column (keyboard cursor in the Builder); null hides it. */
    highlight(column) {
      updateGhost(column);
    },
    /** 'add' | 'remove' (Builder) */
    setTool(next) {
      tool = next;
      ghost.visible = false;
      render();
    },
    dispose() {
      if (animation) cancelAnimationFrame(animation.frame);
      resize.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      disposeGroup(base);
      disposeGroup(cubes);
      ghost.children[0].material.dispose();
      [cubeGeometry, edgeGeometry, cubeMaterial, edgeMaterial, ghostMaterial].forEach(o => o.dispose());
      renderer.dispose();
    },
  };
}
