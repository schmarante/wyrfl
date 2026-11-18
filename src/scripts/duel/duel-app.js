// Duel mode UI (markup: src/components/DuelGame.astro).
//
// Flow: start → host shows offer QR (link …/duel/#join=<code>) → guest opens it, shows answer QR → host scans it →
// channel open → lobby (host picks level + number of puzzles) → countdown → both solve the same View Guesser puzzles
// (seeded) at their own pace, progress goes live to the other side → results → rematch (when both want one).
//
// Messages: { t: 'hello', avatar } · { t: 'setup', level, rounds } · { t: 'start', seed, level, rounds }
//           { t: 'solved', round, tries, hint, ms } · { t: 'again' }
// Times are measured on each device (puzzle shown → solved), so network delay never matters.

import { rtcSupported, createOffer, answerOffer, messenger } from './rtc.js';
import { compareResults } from './score.js';
import { createGuessPuzzle } from '../game/guess.js';
import { LEVELS } from '../game/progress.js';
import { createGuessBoard } from '../ui/guess-board.js';
import { renderQr, startScanner } from '../ui/qr.js';
import { renderLevelBadge } from '../ui/level-picker.js';
import { AVATARS, avatarImg } from './avatars.js';
import { localePath } from '../../i18n/index.js';

const AVATAR_KEY = 'wyrfl:duel-avatar';
const ROUNDS = [3, 5, 10];
const NEXT_DELAY = 1300;   // ms to look at the revealed answer before the next puzzle

const randomSeed = () => Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('');
const storage = {
  get: key => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } },
};

export function startDuelApp(root, t) {
  const $ = sel => root.querySelector(sel);
  const screens = [...root.querySelectorAll('[data-screen]')];
  const bannerEl = $('[data-banner]');
  const scanner = { el: $('[data-scanner]'), video: $('[data-video]'), status: $('[data-scan-status]'), handle: null };

  let role = null;        // 'host' | 'guest'
  let pairing = null;     // offer/answer from rtc.js
  let link = null;        // messenger on the open channel
  let accepting = false;
  let myAvatar = AVATARS.includes(storage.get(AVATAR_KEY)) ? storage.get(AVATAR_KEY) : AVATARS[crypto.getRandomValues(new Uint8Array(1))[0] % AVATARS.length];
  let theirAvatar = null;
  let settings = { level: LEVELS[0], rounds: 5 };
  let game = null;        // { seed, level, rounds, round, mine: [], theirs: [] }
  let again = { me: false, them: false };
  let current = 'start';

  const board = createGuessBoard($('[data-screen="play"] [data-guess-board]'), t, { onSolved });

  // ---- helpers -------------------------------------------------------------------------------

  function show(name) {
    current = name;
    screens.forEach(s => (s.hidden = s.dataset.screen !== name));
    window.scrollTo({ top: 0 });
  }
  function banner(text) {
    bannerEl.textContent = text;
    bannerEl.hidden = !text;
  }
  const myName = () => t(`avatars.${myAvatar}`);
  const otherName = () => (theirAvatar ? t(`avatars.${theirAvatar}`) : '…');
  const settingsText = s => `${t(`levels.${s.level}`)} · ${s.rounds} ${t('duel.rounds')}`;

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      const label = button.textContent;
      button.textContent = t('duel.copied');
      setTimeout(() => (button.textContent = label), 1500);
    } catch {
      /* clipboard blocked – the QR code still works */
    }
  }

  // ---- camera scanner ------------------------------------------------------------------------

  async function openScanner(onText) {
    scanner.el.hidden = false;
    scanner.status.textContent = '';
    try {
      scanner.handle = await startScanner(scanner.video, onText);
    } catch {
      scanner.status.textContent = t('duel.cameraError');
    }
  }
  function closeScanner() {
    scanner.handle?.stop();
    scanner.handle = null;
    scanner.el.hidden = true;
  }
  $('[data-scan-cancel]').addEventListener('click', closeScanner);
  addEventListener('keydown', e => e.key === 'Escape' && !scanner.el.hidden && closeScanner());

  // ---- pairing -------------------------------------------------------------------------------

  async function host() {
    role = 'host';
    banner('');
    show('host');
    try {
      pairing = await createOffer();
    } catch {
      banner(t('duel.unsupported'));
      return show('start');
    }
    const url = `${location.origin}${localePath(document.documentElement.lang, 'duel/')}#join=${pairing.code}`;
    await renderQr($('[data-offer-qr]'), url);
    $('[data-scan-answer]').disabled = false;
    const copyLink = $('[data-copy-link]');
    copyLink.disabled = false;
    copyLink.onclick = () => copy(url, copyLink);
  }

  async function acceptAnswer(code) {
    if (accepting || !pairing) return;
    const status = $('[data-host-status]');
    accepting = true;
    status.textContent = t('duel.connecting');
    try {
      const channel = await pairing.accept(code);
      closeScanner();
      connected(channel);
    } catch (err) {
      accepting = false;
      if (err.message === 'invalid code') {
        scanner.status.textContent = t('duel.wrongCode');
        status.textContent = t('duel.wrongCode');
      } else {
        // the offer is used up after a failed attempt – start over
        closeScanner();
        status.textContent = '';
        banner(t('duel.failed'));
        reset();
      }
    }
  }

  async function guest(code) {
    role = 'guest';
    banner('');
    show('guest');
    try {
      pairing = await answerOffer(code);
    } catch {
      banner(t('duel.wrongCode'));
      return reset();
    }
    await renderQr($('[data-answer-qr]'), pairing.code);
    const copyCode = $('[data-copy-code]');
    copyCode.disabled = false;
    copyCode.onclick = () => copy(pairing.code, copyCode);
    pairing.channel.then(connected, () => {
      banner(t('duel.failed'));
      reset();
    });
  }

  function reset() {
    link?.close();
    pairing?.close();
    link = pairing = game = null;
    role = null;
    accepting = false;
    theirAvatar = null;
    $('[data-scan-answer]').disabled = true;
    $('[data-offer-qr]').textContent = t('duel.preparing');
    $('[data-answer-qr]').textContent = t('duel.connecting');
    show('start');
  }

  // ---- connected -----------------------------------------------------------------------------

  function connected(channel) {
    link = messenger(channel);
    link.onmessage = onMessage;
    link.onclose = onClose;
    link.send({ t: 'hello', avatar: myAvatar });
    banner('');
    showLobby();
  }

  function showLobby() {
    $('[data-connected]').textContent = t('duel.connected', { name: otherName() });
    $('[data-versus]').innerHTML = `${avatarImg(myAvatar, 72)}<span class="text-lg font-bold text-muted">vs</span>${theirAvatar ? avatarImg(theirAvatar, 72) : '<span class="grid h-[72px] w-[72px] place-items-center text-3xl text-muted">?</span>'}`;
    $('[data-host-only]').hidden = role !== 'host';
    $('[data-guest-only]').hidden = role !== 'guest';
    $('[data-guest-only]').textContent = `${t('duel.hostChooses', { name: otherName() })} (${settingsText(settings)})`;
    if (role === 'host') link.send({ t: 'setup', ...settings });
    show('lobby');
  }

  function onClose() {
    const name = otherName();
    link = null;
    if (current === 'results') {
      $('[data-rematch]').disabled = true;
      $('[data-rematch-status]').textContent = t('duel.disconnected', { name });
      return;
    }
    banner(t('duel.disconnected', { name }));
    reset();
  }

  function onMessage(msg) {
    switch (msg?.t) {
      case 'hello':
        theirAvatar = AVATARS.includes(msg.avatar) ? msg.avatar : AVATARS[0];
        if (current === 'lobby') showLobby();
        break;
      case 'setup':
        if (role === 'guest' && LEVELS.includes(msg.level) && ROUNDS.includes(msg.rounds)) {
          settings = { level: msg.level, rounds: msg.rounds };
          if (current === 'lobby') showLobby();
        }
        break;
      case 'start':
        if (role === 'guest' && LEVELS.includes(msg.level) && ROUNDS.includes(msg.rounds) && typeof msg.seed === 'string') {
          startGame({ seed: msg.seed.slice(0, 32), level: msg.level, rounds: msg.rounds });
        }
        break;
      case 'solved':
        if (game && Number.isInteger(msg.round) && msg.round >= 0 && msg.round < game.rounds) {
          game.theirs[msg.round] = { tries: Math.max(1, +msg.tries || 1), hint: Boolean(msg.hint), ms: Math.max(0, +msg.ms || 0) };
          updateProgress();
          checkDone();
        }
        break;
      case 'again':
        again.them = true;
        $('[data-rematch-status]').textContent = t('duel.rematchAsked', { name: otherName() });
        maybeRematch();
        break;
    }
  }

  // ---- lobby (host) --------------------------------------------------------------------------

  function pick(groupSel, attr, value) {
    root.querySelectorAll(`${groupSel} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))));
  }
  root.querySelectorAll('[data-level]').forEach(b =>
    b.addEventListener('click', () => {
      settings.level = b.dataset.level;
      pick('[data-duel-levels]', 'level', settings.level);
      link?.send({ t: 'setup', ...settings });
    }),
  );
  root.querySelectorAll('[data-rounds]').forEach(b =>
    b.addEventListener('click', () => {
      settings.rounds = +b.dataset.rounds;
      pick('[data-duel-rounds]', 'rounds', settings.rounds);
      link?.send({ t: 'setup', ...settings });
    }),
  );
  $('[data-start]').addEventListener('click', () => hostStart());

  function hostStart() {
    const msg = { t: 'start', seed: randomSeed(), ...settings };
    link?.send(msg);
    startGame(msg);
  }

  // ---- the game ------------------------------------------------------------------------------

  function startGame({ seed, level, rounds }) {
    game = { seed, level, rounds, round: -1, mine: [], theirs: [], finished: false };
    again = { me: false, them: false };
    $('[data-rematch]').disabled = false;
    $('[data-rematch-status]').textContent = '';
    $('[data-wait]').hidden = true;
    show('countdown');
    const count = $('[data-count]');
    let n = 3;
    const tick = () => {
      if (!game) return;
      if (n === 0) {
        show('play');
        nextRound();
        return;
      }
      count.textContent = String(n--);
      count.classList.remove('pop');
      void count.offsetWidth;
      count.classList.add('pop');
      setTimeout(tick, 800);
    };
    tick();
  }

  function nextRound() {
    game.round++;
    $('[data-round]').textContent = t('duel.round', { n: game.round + 1, total: game.rounds });
    renderLevelBadge($('[data-screen="play"] [data-level-picker]'), game.level, t);
    board.show(createGuessPuzzle(`${game.seed}:${game.round}`, game.level));
    updateProgress();
  }

  function onSolved(result) {
    if (!game) return;
    const round = game.round;
    game.mine[round] = result;
    link?.send({ t: 'solved', round, ...result });
    updateProgress();
    setTimeout(() => {
      if (!game || game.round !== round) return;
      if (round + 1 < game.rounds) return nextRound();
      game.finished = true;
      checkDone();
    }, NEXT_DELAY);
  }

  const done = list => list.filter(Boolean).length;

  function updateProgress() {
    if (!game) return;
    $('[data-opponent]').innerHTML = `${theirAvatar ? avatarImg(theirAvatar, 24) : ''}<span>${done(game.theirs)}/${game.rounds}</span>`;
    $('[data-opponent]').title = t('duel.opponentProgress', { name: otherName(), done: done(game.theirs), total: game.rounds });
    $('[data-my-bar] div').style.width = `${(done(game.mine) / game.rounds) * 100}%`;
    $('[data-their-bar] div').style.width = `${(done(game.theirs) / game.rounds) * 100}%`;
  }

  /** Results once both are through – `game.finished` is set after my last answer was on screen for a moment. */
  function checkDone() {
    if (!game?.finished) return;
    if (done(game.theirs) >= game.rounds) return showResults();
    board.lock();
    $('[data-wait]').hidden = false;
    $('[data-wait]').textContent = t('duel.waitFor', { name: otherName() });
  }

  function showResults() {
    const r = compareResults(game.mine, game.theirs, game.rounds);
    const them = otherName();
    $('[data-result-title]').textContent =
      r.winner === 'mine' ? t('duel.won') : r.winner === 'tie' ? t('duel.tie')
        : t(r.total.theirs - r.total.mine <= 3 ? 'duel.lostClose' : 'duel.lost', { name: them });
    $('[data-me-name]').textContent = `${t('duel.you')} (${myName()})`;
    $('[data-me-avatar]').innerHTML = avatarImg(myAvatar, 48);
    $('[data-them-avatar]').innerHTML = theirAvatar ? avatarImg(theirAvatar, 48) : '';
    $('[data-them-name]').textContent = them;
    $('[data-me-points]').textContent = t('duel.points', { points: r.total.mine });
    $('[data-them-points]').textContent = t('duel.points', { points: r.total.theirs });
    $('[data-th-me]').textContent = t('duel.you');
    $('[data-th-them]').textContent = them;
    $('[data-highlights]').replaceChildren(
      ...r.highlights.mine.map(h => {
        const li = document.createElement('li');
        li.textContent = `★ ${t(`duel.hl.${h.key}`, { ...h, seconds: h.seconds?.toLocaleString(document.documentElement.lang) })}`;
        return li;
      }),
    );
    const cell = (points, faster) => `${points}${faster ? ` <span class="text-xs text-front">(+1 ${t('duel.faster')})</span>` : ''}`;
    $('[data-rows]').innerHTML = r.rows
      .map(row => `<tr class="border-t border-line"><td class="p-2">${row.round + 1}</td><td class="p-2">${cell(row.mine, row.faster === 'mine')}</td><td class="p-2">${cell(row.theirs, row.faster === 'theirs')}</td></tr>`)
      .join('');
    show('results');
  }

  // ---- rematch / end -------------------------------------------------------------------------

  function maybeRematch() {
    if (role === 'host' && again.me && again.them) hostStart();
  }
  $('[data-rematch]').addEventListener('click', () => {
    if (!link) return;
    again.me = true;
    link.send({ t: 'again' });
    $('[data-rematch]').disabled = true;
    if (!again.them) $('[data-rematch-status]').textContent = t('duel.rematchWait', { name: otherName() });
    maybeRematch();
  });
  $('[data-end]').addEventListener('click', () => {
    banner('');
    reset();
  });

  // ---- start ---------------------------------------------------------------------------------

  // character picker
  const avatarButtons = [...root.querySelectorAll('[data-avatar]')];
  const syncAvatars = () => avatarButtons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.avatar === myAvatar)));
  avatarButtons.forEach(b =>
    b.addEventListener('click', () => {
      myAvatar = b.dataset.avatar;
      storage.set(AVATAR_KEY, myAvatar);
      syncAvatars();
    }),
  );
  syncAvatars();

  if (!rtcSupported()) {
    $('[data-unsupported]').hidden = false;
    $('[data-host]').disabled = true;
    $('[data-join]').disabled = true;
  }
  $('[data-host]').addEventListener('click', host);
  $('[data-scan-answer]').addEventListener('click', () => openScanner(acceptAnswer));
  $('[data-paste-connect]').addEventListener('click', () => acceptAnswer($('[data-paste]').value));
  $('[data-join]').addEventListener('click', () =>
    openScanner(text => {
      if (!text.includes('#join=')) {
        scanner.status.textContent = t('duel.wrongCode');
        return;
      }
      closeScanner();
      guest(text);
    }),
  );

  // opened via the host's QR code: …/duel/#join=<code> (the hash never reaches a server)
  if (location.hash.startsWith('#join=')) {
    const code = location.hash.slice('#join='.length);
    history.replaceState(null, '', location.pathname + location.search);
    if (rtcSupported()) guest(code);
  }
}
