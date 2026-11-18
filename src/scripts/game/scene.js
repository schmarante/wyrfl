// Isometric 3D view of a cube structure (three.js, OrthographicCamera – never perspective).
// Renders on demand only (no idle render loop – saves battery on phones). Drag/swipe turns the structure.

import * as THREE from 'three';

const COLORS = {
  cube: 0x4f8cff,
  edge: 0x0b1530,
  plate: 0x2a3142,
  plateLine: 0x3b4458,
  front: 0xffc53d,   // marks the front edge – same color as the "front" view label in the UI
};

// classic isometric direction: front (+z), right (+x) and top visible
const ISO_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();

export function createCubeScene(canvas) {
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

  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const edgeGeometry = new THREE.EdgesGeometry(cubeGeometry);
  const cubeMaterial = new THREE.MeshLambertMaterial({ color: COLORS.cube });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge });

  let content = null;
  let radius = 1;
  let target = new THREE.Vector3();

  function render() {
    renderer.render(scene, camera);
  }

  function fitCamera() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const half = radius * 1.08 * Math.max(1, 1 / aspect);
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    camera.position.copy(target).addScaledVector(ISO_DIRECTION, 30);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    render();
  }

  function disposeContent() {
    if (!content) return;
    content.traverse(o => {
      if (o.geometry && o.geometry !== cubeGeometry && o.geometry !== edgeGeometry) o.geometry.dispose();
      if (o.material && o.material !== cubeMaterial && o.material !== edgeMaterial) o.material.dispose();
    });
    pivot.remove(content);
    content = null;
  }

  /** Shows a structure ({ size, maxHeight, heights } from structure.js). */
  function setStructure({ size, maxHeight, heights }) {
    disposeContent();
    content = new THREE.Group();
    const offset = (size - 1) / 2;

    // base plate with grid lines and a colored front edge
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.2, 0.1, size + 0.2),
      new THREE.MeshLambertMaterial({ color: COLORS.plate }),
    );
    plate.position.y = -0.05;
    content.add(plate);
    const grid = new THREE.GridHelper(size, size, COLORS.plateLine, COLORS.plateLine);
    grid.position.y = 0.002;
    content.add(grid);
    const frontEdge = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.2, 0.12, 0.14),
      new THREE.MeshLambertMaterial({ color: COLORS.front }),
    );
    frontEdge.position.set(0, -0.04, size / 2 + 0.17);
    content.add(frontEdge);

    heights.forEach((row, z) =>
      row.forEach((h, x) => {
        for (let y = 0; y < h; y++) {
          const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
          cube.position.set(x - offset, y + 0.5, z - offset);
          cube.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
          content.add(cube);
        }
      }),
    );

    pivot.add(content);
    pivot.rotation.y = 0;
    target = new THREE.Vector3(0, maxHeight / 2, 0);
    radius = Math.hypot(size / 2 + 0.3, size / 2 + 0.3, maxHeight / 2);
    fitCamera();
  }

  // drag / swipe to turn around the vertical axis
  let dragX = null;
  canvas.style.touchAction = 'none';
  const onDown = e => {
    dragX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = e => {
    if (dragX === null) return;
    pivot.rotation.y += (e.clientX - dragX) * 0.01;
    dragX = e.clientX;
    render();
  };
  const onUp = () => (dragX = null);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const resize = new ResizeObserver(fitCamera);
  resize.observe(canvas);

  return {
    setStructure,
    /** turns back to the standard isometric view */
    resetView() {
      pivot.rotation.y = 0;
      render();
    },
    dispose() {
      resize.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      disposeContent();
      cubeGeometry.dispose();
      edgeGeometry.dispose();
      cubeMaterial.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
    },
  };
}
