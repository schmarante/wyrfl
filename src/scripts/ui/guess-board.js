// View Guesser playing field (markup: src/components/GuessBoard.astro). Shows a puzzle, handles answers:
// wrong → explanation + marked cells, hint becomes available; right → camera moves onto the asked view.
// onSolved({ tries, hint, ms }) is called once per puzzle.

import { computeView, diffView } from '../game/structure.js';
import { renderViewGrid } from './view-grid.js';

/**
 * @param {HTMLElement} root  element with [data-guess-board]
 * @param {(key: string, params?: object) => string} t
 * @param {{ onSolved?: (result: { tries: number, hint: boolean, ms: number }) => void, revealMs?: number }} [options]
 */
export function createGuessBoard(root, t, { onSolved } = {}) {
  const $ = sel => root.querySelector(sel);
  const canvas = $('[data-canvas]');
  const optionsEl = $('[data-options]');
  const feedback = $('[data-feedback]');
  const hintButton = $('[data-hint]');
  const isoButton = $('[data-iso]');

  let scene = null;
  let puzzle = null;
  let state = null;   // { tries, hint, start, solved }

  const sceneReady = import('../game/scene.js')
    .then(({ createCubeScene }) => {
      scene = createCubeScene(canvas);
      $('[data-loading]').hidden = true;
      if (puzzle) scene.setStructure(puzzle.structure);
      return scene;
    })
    .catch(() => {
      $('[data-loading]').textContent = t('home.noWebgl');
      return null;
    });

  function say(text, tone = 'info') {
    feedback.textContent = text;
    feedback.classList.toggle('text-front', tone === 'good');
    feedback.classList.remove('pop');
    if (tone === 'good') {
      void feedback.offsetWidth;   // restart the animation
      feedback.classList.add('pop');
    }
  }

  function badge(button, ok) {
    const b = button.querySelector('[data-badge]');
    b.textContent = ok ? '✓' : '✗';
    b.className = `absolute -right-1 -top-1 grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${ok ? 'bg-front text-bg' : 'bg-line text-text'}`;
  }

  function show(next) {
    puzzle = next;
    state = { tries: 0, hint: false, start: performance.now(), solved: false };
    const view = t(`views.${puzzle.view}`);
    $('[data-question]').textContent = t('guess.question', { view });
    $('[data-side-note]').hidden = puzzle.view !== 'side';
    hintButton.disabled = true;
    isoButton.hidden = true;
    say('');
    scene?.setStructure(puzzle.structure);

    optionsEl.replaceChildren(
      ...puzzle.options.map((option, i) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'press relative flex w-full flex-col items-center rounded-2xl border-2 border-line bg-bg/60 p-2 sm:p-3 hover:border-cube disabled:cursor-default';
        button.innerHTML = `<span class="sr-only">${t('guess.option', { n: i + 1 })}</span><span data-grid class="grid w-full max-w-28 gap-0.5" aria-hidden="true"></span><span data-badge class="hidden"></span>`;
        renderViewGrid(button.querySelector('[data-grid]'), option.grid);
        button.addEventListener('click', () => choose(i, button));
        li.append(button);
        return li;
      }),
    );
  }

  function choose(index, button) {
    if (!puzzle || state.solved || state.locked) return;
    const option = puzzle.options[index];
    const view = t(`views.${puzzle.view}`);
    state.tries++;

    if (option.correct) {
      state.solved = true;
      badge(button, true);
      button.classList.replace('border-line', 'border-front');
      optionsEl.querySelectorAll('button').forEach(b => {
        b.disabled = true;
        if (b !== button) b.classList.add('opacity-50');
      });
      say(t('guess.correct', { view }), 'good');
      hintButton.disabled = true;
      isoButton.hidden = false;
      scene?.lookFrom(puzzle.view);   // show the answer in 3D
      onSolved?.({ tries: state.tries, hint: state.hint, ms: Math.round(performance.now() - state.start) });
      return;
    }

    button.disabled = true;
    button.classList.add('opacity-60');
    badge(button, false);
    const correct = computeView(puzzle.structure, puzzle.view);
    renderViewGrid(button.querySelector('[data-grid]'), option.grid, { marks: diffView(option.grid, correct) });
    say(`${t('guess.tryAgain')} ${t(`guess.why.${option.kind}`)}`);
    hintButton.disabled = false;
  }

  hintButton.addEventListener('click', () => {
    if (!puzzle) return;
    state.hint = true;
    scene?.lookFrom(puzzle.view);
    isoButton.hidden = false;
    say(t('guess.hintDone', { view: t(`views.${puzzle.view}`) }));
  });
  isoButton.addEventListener('click', () => {
    scene?.lookFrom('iso');
    isoButton.hidden = true;
  });

  return {
    show,
    say,
    sceneReady,
    /** stops answering (e.g. the duel ended) */
    lock() {
      if (state) state.locked = true;
      optionsEl.querySelectorAll('button').forEach(b => (b.disabled = true));
      hintButton.disabled = true;
    },
  };
}
