// Shadow mode playing field – the View Guesser's markup (GuessBoard.astro) with buildings as answers:
// the stage shows the wall with the wanted shadow and the sun/moon (shadow-stage.js); the four answers are pictures
// of buildings, all drawn by one extra hidden cube scene (one more WebGL context, not four). Drag an answer sideways
// to turn it (drawn again every frame while dragging), a tap picks it.
// Wrong pick → that building stands on the plate, its shadow is laid over the wanted one (differences marked),
// explanation; right → it stands there and casts exactly the shadow.
// Hint = the buildings seen from the light (the iso button turns them back).

import { computeView } from '../game/structure.js';
import { onSolveShortcut } from './debug-solve.js';

const THUMB = 300;   // css px of the hidden scene that draws the answer pictures
const DRAG = 6;      // px – more is a turn, less a tap

/**
 * @param {HTMLElement} root  element with [data-guess-board]
 * @param {(key: string, params?: object) => string} t
 * @param {{ onSolved?: (result: { tries: number, hint: boolean, ms: number }) => void }} [options]
 */
export function createShadowBoard(root, t, { onSolved } = {}) {
  const $ = sel => root.querySelector(sel);
  const optionsEl = $('[data-options]');
  const feedback = $('[data-feedback]');
  const hintButton = $('[data-hint]');
  const isoButton = $('[data-iso]');

  let scene = null;
  let stage = null;
  let thumbs = null;
  let puzzle = null;
  let state = null;     // { tries, hint, start, solved }
  let angles = [];       // turn of each answer picture (rad)
  let straight = false; // hint: answers seen from the light

  const ready = Promise.all([import('../game/scene.js'), import('../game/shadow-stage.js')])
    .then(([{ createCubeScene }, { createShadowStage }]) => {
      scene = createCubeScene($('[data-canvas]'));
      stage = createShadowStage(scene);
      const hidden = document.createElement('canvas');
      hidden.setAttribute('aria-hidden', 'true');
      hidden.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB}px;height:${THUMB}px;pointer-events:none`;
      document.body.append(hidden);
      thumbs = createCubeScene(hidden);
      $('[data-loading]').hidden = true;
      if (puzzle) present();
    })
    .catch(() => {
      $('[data-loading]').textContent = t('home.noWebgl');
    });

  function say(text, tone = 'info') {
    feedback.textContent = text;
    feedback.classList.toggle('text-front', tone === 'good');
    feedback.classList.remove('pop');
    if (tone === 'good') {
      void feedback.offsetWidth;
      feedback.classList.add('pop');
    }
  }

  function badge(button, ok) {
    const b = button.querySelector('[data-badge]');
    b.textContent = ok ? '✓' : '✗';
    b.className = `absolute -right-2.5 -top-2.5 grid h-6 w-6 place-items-center rounded-full text-xs font-bold shadow-sm ring-2 ring-surface ${ok ? 'bg-front text-bg' : 'bg-line text-text'}`;
  }

  /** draws one answer picture (its own turn, or straight from the light for the hint) */
  function drawThumb(i) {
    const canvas = optionsEl.querySelectorAll('canvas[data-thumb]')[i];
    if (!thumbs || !puzzle || !canvas) return;
    thumbs.setStructure(puzzle.options[i].structure, { animate: false });
    if (straight) thumbs.lookFrom(puzzle.view, { instant: true });
    else thumbs.setTurn(angles[i]);
    thumbs.renderNow();
    const px = Math.round(THUMB * Math.min(window.devicePixelRatio || 1, 2));
    if (canvas.width !== px) canvas.width = canvas.height = px;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, px, px);
    g.drawImage(thumbs.canvas, 0, 0, px, px);
  }
  const drawThumbs = () => puzzle?.options.forEach((_, i) => drawThumb(i));

  /** puzzle on screen: empty plate, wall with the wanted shadow, sun/moon, answers */
  function present() {
    const { size, maxHeight } = puzzle.structure;
    scene.setStructure({ size, maxHeight, heights: Array.from({ length: size }, () => Array(size).fill(0)) }, { animate: false });
    stage.set(puzzle);
    drawThumbs();
  }

  function show(next) {
    puzzle = next;
    state = { tries: 0, hint: false, start: performance.now(), solved: false };
    angles = next.options.map(() => 0);
    straight = false;
    $('[data-question]').textContent = t('shadow.question');
    hintButton.disabled = true;
    isoButton.hidden = true;
    say('');
    optionsEl.replaceChildren(
      ...puzzle.options.map((option, i) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'press relative flex w-full cursor-grab touch-pan-y items-center justify-center rounded-2xl border-2 border-line bg-bg/60 p-1 hover:border-cube active:cursor-grabbing aria-disabled:hover:border-line';
        button.title = t('shadow.turn');
        button.innerHTML = `<span class="sr-only">${t('shadow.option', { n: i + 1 })}</span><canvas data-thumb class="aspect-square w-full" aria-hidden="true"></canvas><span data-badge class="hidden"></span>`;
        // drag sideways = turn this building (also after answering – to look at it), tap = pick it
        let drag = null;
        let frame = 0;
        button.addEventListener('pointerdown', e => {
          drag = { id: e.pointerId, x: e.clientX, last: e.clientX, turned: false };
        });
        button.addEventListener('pointermove', e => {
          if (!drag || e.pointerId !== drag.id) return;
          if (!drag.turned && Math.abs(e.clientX - drag.x) > DRAG) {
            drag.turned = true;
            button.setPointerCapture?.(e.pointerId);
            if (straight) {
              straight = false;
              isoButton.hidden = true;
              drawThumbs();
            }
          }
          if (!drag.turned) return;
          angles[i] += (e.clientX - drag.last) * 0.012;
          drag.last = e.clientX;
          frame ||= requestAnimationFrame(() => {
            frame = 0;
            drawThumb(i);
          });
        });
        const end = () => setTimeout(() => (drag = null));   // after the click event, which checks `turned`
        button.addEventListener('pointerup', end);
        button.addEventListener('pointercancel', end);
        button.addEventListener('click', () => {
          if (drag?.turned || button.getAttribute('aria-disabled') === 'true') return;
          choose(i, button);
        });
        li.append(button);
        return li;
      }),
    );
    if (scene) present();
  }

  /** the picked building stands on the plate (drops in), then its shadow is compared with the wanted one */
  function place(option) {
    if (!scene) return;
    scene.setHeights(option.structure.heights, { stagger: true });
    const grid = computeView(option.structure, puzzle.view);
    const landed = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
    setTimeout(() => puzzle && stage.compare(grid), landed);
  }

  function choose(index, button) {
    if (!puzzle || state.solved) return;
    const option = puzzle.options[index];
    state.tries++;
    place(option);
    if (option.correct) {
      state.solved = true;
      badge(button, true);
      button.classList.replace('border-line', 'border-front');
      optionsEl.querySelectorAll('button').forEach(b => {
        b.setAttribute('aria-disabled', 'true');   // not `disabled`: the buildings can still be turned
        if (b !== button) b.classList.add('opacity-50');
      });
      say(t('shadow.correct'), 'good');
      hintButton.disabled = true;
      onSolved?.({ tries: state.tries, hint: state.hint, ms: Math.round(performance.now() - state.start) });
      return;
    }
    button.setAttribute('aria-disabled', 'true');
    button.classList.add('opacity-60');
    badge(button, false);
    say(`${t('guess.tryAgain')} ${t(`shadow.why.${option.kind}`)}`);
    hintButton.disabled = false;
  }

  hintButton.addEventListener('click', () => {
    if (!puzzle) return;
    state.hint = true;
    straight = true;
    isoButton.hidden = false;
    drawThumbs();
    say(t('shadow.hintDone'));
  });
  isoButton.addEventListener('click', () => {
    straight = false;
    isoButton.hidden = true;
    drawThumbs();
  });
  // another cube style or theme: the still pictures again (the hidden scene has switched already)
  const redraw = () => requestAnimationFrame(drawThumbs);
  window.addEventListener('wyrfl-skin', redraw);
  window.addEventListener('wyrfl-theme', redraw);

  onSolveShortcut(() => {
    if (!puzzle || state.solved) return;
    choose(puzzle.answer, optionsEl.querySelectorAll('button')[puzzle.answer]);
  });

  return { show, say, ready };
}
