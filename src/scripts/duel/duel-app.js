// Duel mode UI (markup: src/components/DuelGame.astro) – 2 to 4 players.
//
// Flow: start → host shows offer QR (link …/duel/#join=<code>) → guest opens it, shows answer QR → host scans it →
// channel open → lobby (host picks level + number of puzzles, can add another player: a new offer QR, up to 4) →
// countdown → everybody solves the same View Guesser puzzles (seeded) at their own pace, progress goes live to the
// others → results → rematch (when everybody still there wants one).
//
// Star network: every guest is connected to the host only; the host relays. Player ids: host 'h', guests 'g1' …
// Messages guest → host: { t: 'hello', avatar } · { t: 'solved', round, tries, hint, ms } · { t: 'again' }
// Messages host → guest: { t: 'roster', you, players: [{ id, avatar, left }] } · { t: 'setup', level, rounds }
//                        { t: 'start', seed, level, rounds, ids } · { t: 'solved', id, round, tries, hint, ms }
//                        { t: 'again', id }
// Times are measured on each device (puzzle shown → solved), so network delay never matters.

import { rtcSupported, createOffer, answerOffer, messenger } from './rtc.js';
import { scoreGame, POINTS } from './score.js';
import { createGuessPuzzle } from '../game/guess.js';
import { LEVELS, recordDuelWin } from '../game/progress.js';
import { celebrateNewSkins } from '../ui/celebrate.js';
import { createGuessBoard } from '../ui/guess-board.js';
import { renderQr, startScanner } from '../ui/qr.js';
import { renderLevelBadge } from '../ui/level-picker.js';
import { ICONS } from '../ui/icons.js';
import { AVATARS, avatarImg } from './avatars.js';
import { localePath, DEFAULT_LOCALE } from '../../i18n/index.js';
import { setLiveLocale } from '../ui/live-locale.js';
import { guardLeaving } from '../ui/leave-guard.js';
import { fireConfetti } from '../ui/confetti.js';
import { secureGet, secureSet } from '../game/store.js';

const AVATAR_KEY = 'wyrfl:duel-avatar';
const ROUNDS = [3, 5, 10];
const MAX_PLAYERS = 4;
const HOST_ID = 'h';
const RUNNER = 28;        // px – a character on the race track
const RUNNER_GAP = 30;    // px between two characters on the same spot
const NEXT_DELAY = 1300;   // ms to look at the revealed answer before the next puzzle

const randomSeed = () => Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('');
const storage = { get: key => secureGet(key) ?? '', set: secureSet };   // scrambled + signed like the progress
const validId = id => typeof id === 'string' && /^(h|g\d{1,2})$/.test(id);

export function startDuelApp(root, t) {
  const $ = sel => root.querySelector(sel);
  const screens = [...root.querySelectorAll('[data-screen]')];
  const bannerEl = $('[data-banner]');
  const scanner = { el: $('[data-scanner]'), video: $('[data-video]'), status: $('[data-scan-status]'), handle: null };

  let role = null;          // 'host' | 'guest'
  let pairing = null;       // host: the open offer for the next guest · guest: own answer
  let accepting = false;
  let hostLink = null;      // guest: messenger to the host
  const peers = new Map();  // host: guest id → messenger
  const connections = new Map();   // host: guest id → its peer connection (closed when the guest goes)
  let nextGuest = 1;
  let myId = null;
  let players = [];         // [{ id, avatar, left }] – host first; `left`: dropped out of a running game
  let myAvatar = AVATARS.includes(storage.get(AVATAR_KEY)) ? storage.get(AVATAR_KEY) : AVATARS[crypto.getRandomValues(new Uint8Array(1))[0] % AVATARS.length];
  let settings = { level: LEVELS[0], rounds: 5 };
  let game = null;          // { seed, level, rounds, round, ids, results: { id: [] }, finished }
  let again = new Set();    // ids that want a rematch
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
  const isHost = () => role === 'host';
  const isConnected = () => (isHost() ? peers.size > 0 : Boolean(hostLink));
  const playerOf = id => players.find(p => p.id === id);
  const avatarOf = id => (id === myId ? myAvatar : playerOf(id)?.avatar);
  const nameOf = id => (avatarOf(id) ? t(`avatars.${avatarOf(id)}`) : '…');
  const namesOf = ids => ids.map(nameOf).join(', ');
  /** the others that are still here */
  const others = () => players.filter(p => p.id !== myId && !p.left).map(p => p.id);
  const otherNames = () => namesOf(others()) || '…';
  const myName = () => t(`avatars.${myAvatar}`);
  const face = (id, size) =>
    avatarOf(id) ? avatarImg(avatarOf(id), size) : `<span class="grid shrink-0 place-items-center text-muted" style="width:${size}px;height:${size}px">?</span>`;
  // "Puzzles: 5" instead of "5 Puzzles" – Slavic languages need another plural form after 5 than after 2–4
  const settingsText = s => `${t(`levels.${s.level}`)} · ${t('duel.rounds')}: ${s.rounds}`;

  function broadcast(msg, except = null) {
    for (const [id, link] of peers) if (id !== except) link.send(msg);
  }
  function sendRoster() {
    for (const [id, link] of peers) link.send({ t: 'roster', you: id, players });
  }

  /** test aid (PUBLIC_DEBUG=true): copy button for the join link / answer code – the elements exist only then */
  function debugCopy(selector, text) {
    const button = root.querySelector(selector);
    if (!button) return;
    button.disabled = false;
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        const label = button.textContent;
        button.textContent = 'Kopiert!';
        setTimeout(() => (button.textContent = label), 1500);
      } catch {
        window.prompt('Kopieren:', text);   // clipboard blocked: show it to copy by hand
      }
    };
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

  /** Host: start a duel – the first guest is paired next. */
  function host() {
    role = 'host';
    myId = HOST_ID;
    players = [{ id: HOST_ID, avatar: myAvatar, left: false }];
    setLiveLocale(true);
    banner('');
    openPairing();
  }

  /** Host: show a fresh offer QR for the next guest (first one, or a 3rd / 4th player from the lobby). */
  async function openPairing() {
    pairing?.close();
    pairing = null;
    accepting = false;
    show('host');
    $('[data-host-title]').textContent = t(peers.size ? 'duel.addPlayer' : 'duel.host');
    $('[data-back-lobby]').hidden = !peers.size;
    $('[data-host-status]').textContent = '';
    $('[data-offer-qr]').textContent = t('duel.preparing');
    $('[data-scan-answer]').disabled = true;
    const copyLink = root.querySelector('[data-copy-link]');   // test aid: not the previous guest's link
    if (copyLink) copyLink.disabled = true;
    const paste = root.querySelector('[data-paste]');
    if (paste) paste.value = '';
    let offer;
    try {
      offer = await createOffer();
    } catch {
      banner(t('duel.unsupported'));
      return peers.size ? showLobby() : reset();
    }
    if (!isHost() || current !== 'host' || pairing) return offer.close();   // left this screen meanwhile
    pairing = offer;
    // language-neutral link (no /en/ …): every guest opens it in their own language
    const url = `${location.origin}${localePath(DEFAULT_LOCALE, 'duel')}#join=${offer.code}`;
    await renderQr($('[data-offer-qr]'), url);
    $('[data-scan-answer]').disabled = false;
    debugCopy('[data-copy-link]', url);
  }

  async function acceptAnswer(code) {
    if (accepting || !pairing) return;
    const offer = pairing;
    const status = $('[data-host-status]');
    accepting = true;
    status.textContent = t('duel.connecting');
    try {
      const channel = await offer.accept(code);
      pairing = null;   // in use now – must not be closed
      accepting = false;
      closeScanner();
      addGuest(channel, offer);
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
        if (peers.size) {
          pairing?.close();
          pairing = null;
          showLobby();
        } else reset();
      }
    }
  }

  async function guest(code) {
    role = 'guest';
    setLiveLocale(true);
    banner('');
    show('guest');
    try {
      pairing = await answerOffer(code);
    } catch {
      banner(t('duel.wrongCode'));
      return reset();
    }
    await renderQr($('[data-answer-qr]'), pairing.code);
    debugCopy('[data-copy-code]', pairing.code);
    const mine = pairing;
    mine.channel.then(
      channel => pairing === mine && hostConnected(channel),
      () => {
        if (pairing !== mine) return;
        banner(t('duel.failed'));
        reset();
      },
    );
  }

  function reset() {
    setLiveLocale(false);
    for (const link of peers.values()) link.close();
    for (const offer of connections.values()) offer.close();
    peers.clear();
    connections.clear();
    hostLink?.close();
    pairing?.close();
    hostLink = pairing = game = null;
    role = myId = null;
    players = [];
    nextGuest = 1;
    accepting = false;
    again = new Set();
    $('[data-scan-answer]').disabled = true;
    $('[data-offer-qr]').textContent = t('duel.preparing');
    $('[data-answer-qr]').textContent = t('duel.connecting');
    show('start');
  }

  // while connected, leaving the page (logo, info …) asks first – it would drop the connection
  guardLeaving({
    active: isConnected,
    texts: () => ({ title: t('duel.leaveTitle'), text: t('duel.leaveText', { name: otherNames() }), stay: t('duel.stay'), leave: t('duel.leave') }),
  });

  // ---- host: guests --------------------------------------------------------------------------

  function addGuest(channel, offer) {
    const id = `g${nextGuest++}`;
    const link = messenger(channel);
    peers.set(id, link);
    connections.set(id, offer);
    players.push({ id, avatar: null, left: false });   // the avatar comes with 'hello'
    link.onmessage = msg => onGuestMessage(id, msg);
    link.onclose = () => onGuestClose(id);
    link.send({ t: 'setup', ...settings });
    sendRoster();
    banner('');
    showLobby();
  }

  /** a character nobody else has (two players with the same fox would be confusing) */
  function freeAvatar(wanted, id) {
    const taken = new Set(players.filter(p => p.id !== id && p.avatar).map(p => p.avatar));
    if (AVATARS.includes(wanted) && !taken.has(wanted)) return wanted;
    return AVATARS.find(a => !taken.has(a));
  }

  function onGuestMessage(id, msg) {
    const player = playerOf(id);
    if (!player) return;
    switch (msg?.t) {
      case 'hello':
        player.avatar = freeAvatar(msg.avatar, id);
        sendRoster();
        if (current === 'lobby') showLobby();
        if (game) updateProgress();
        break;
      case 'solved': {
        const result = solvedResult(msg);
        if (!game || !game.ids.includes(id) || !result) return;
        game.results[id][msg.round] = result;
        broadcast({ t: 'solved', id, round: msg.round, ...result }, id);
        updateProgress();
        checkDone();
        break;
      }
      case 'again':
        again.add(id);
        broadcast({ t: 'again', id }, id);
        rematchStatus();
        maybeRematch();
        break;
    }
  }

  function onGuestClose(id) {
    if (!peers.has(id)) return;
    const name = nameOf(id);
    peers.delete(id);
    connections.get(id)?.close();
    connections.delete(id);
    const player = playerOf(id);
    if (game && game.ids.includes(id)) player.left = true;   // keeps their points in this game
    else players = players.filter(p => p.id !== id);
    again.delete(id);
    sendRoster();
    if (!peers.size && current !== 'host') {
      if (current === 'results') {
        $('[data-rematch]').disabled = true;
        $('[data-rematch-status]').textContent = t('duel.disconnected', { name });
        return;
      }
      banner(t('duel.disconnected', { name }));
      return reset();
    }
    banner(t('duel.disconnected', { name }));
    afterRosterChange();
    maybeRematch();
  }

  // ---- guest: the host -----------------------------------------------------------------------

  function hostConnected(channel) {
    hostLink = messenger(channel);
    hostLink.onmessage = onHostMessage;
    hostLink.onclose = onHostClose;
    hostLink.send({ t: 'hello', avatar: myAvatar });
    banner('');
    showLobby();
  }

  function onHostClose() {
    const name = nameOf(HOST_ID);
    hostLink = null;
    if (current === 'results') {
      $('[data-rematch]').disabled = true;
      $('[data-rematch-status]').textContent = t('duel.disconnected', { name });
      return;
    }
    banner(t('duel.disconnected', { name }));
    reset();
  }

  function onHostMessage(msg) {
    switch (msg?.t) {
      case 'roster': {
        if (!validId(msg.you) || !Array.isArray(msg.players) || msg.players.length > MAX_PLAYERS) return;
        players = msg.players
          .filter(p => validId(p?.id))
          .map(p => ({ id: p.id, avatar: AVATARS.includes(p.avatar) ? p.avatar : null, left: Boolean(p.left) }));
        myId = msg.you;
        const assigned = playerOf(myId)?.avatar;
        if (assigned) myAvatar = assigned;   // the host may have given another character (mine was taken)
        afterRosterChange();
        break;
      }
      case 'setup':
        if (LEVELS.includes(msg.level) && ROUNDS.includes(msg.rounds)) {
          settings = { level: msg.level, rounds: msg.rounds };
          if (current === 'lobby') showLobby();
        }
        break;
      case 'start':
        if (LEVELS.includes(msg.level) && ROUNDS.includes(msg.rounds) && typeof msg.seed === 'string'
            && Array.isArray(msg.ids) && msg.ids.length <= MAX_PLAYERS && msg.ids.every(validId) && msg.ids.includes(myId)) {
          startGame({ seed: msg.seed.slice(0, 32), level: msg.level, rounds: msg.rounds, ids: msg.ids });
        }
        break;
      case 'solved': {
        const result = solvedResult(msg);
        if (!game || !game.ids.includes(msg.id) || msg.id === myId || !result) return;
        game.results[msg.id][msg.round] = result;
        updateProgress();
        checkDone();
        break;
      }
      case 'again':
        if (validId(msg.id)) {
          again.add(msg.id);
          rematchStatus();
        }
        break;
    }
  }

  /** a checked result from a message, or null */
  function solvedResult(msg) {
    if (!game || !Number.isInteger(msg.round) || msg.round < 0 || msg.round >= game.rounds) return null;
    return { tries: Math.max(1, Math.floor(+msg.tries) || 1), hint: Boolean(msg.hint), ms: Math.max(0, +msg.ms || 0) };
  }

  /** somebody joined, left or got a character: refresh what is on screen */
  function afterRosterChange() {
    if (current === 'lobby') showLobby();
    if (game) {
      updateProgress();
      checkDone();
      if (current === 'results') {
        renderResults();
        rematchStatus();
      }
    }
  }

  // ---- lobby ---------------------------------------------------------------------------------

  function showLobby() {
    const present = players.filter(p => !p.left).map(p => p.id);
    const size = present.length > 2 ? 52 : 72;
    $('[data-versus]').innerHTML = present.length === 2
      ? `${face(myId, size)}<span class="text-lg font-bold text-muted">vs</span>${face(others()[0], size)}`
      : [myId, ...present.filter(id => id !== myId)].map(id => face(id, size)).join('');
    $('[data-connected]').textContent = t('duel.connected', { name: otherNames() });
    $('[data-host-only]').hidden = !isHost();
    $('[data-guest-only]').hidden = isHost();
    $('[data-guest-only]').textContent = `${t('duel.hostChooses', { name: nameOf(HOST_ID) })} (${settingsText(settings)})`;
    const add = $('[data-add-player]');
    add.hidden = !isHost() || present.length >= MAX_PLAYERS;
    add.textContent = `${t('duel.addPlayer')} (${present.length}/${MAX_PLAYERS})`;
    if (isHost()) broadcast({ t: 'setup', ...settings });
    show('lobby');
  }

  function pick(groupSel, attr, value) {
    root.querySelectorAll(`${groupSel} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))));
  }
  root.querySelectorAll('[data-level]').forEach(b =>
    b.addEventListener('click', () => {
      settings.level = b.dataset.level;
      pick('[data-duel-levels]', 'level', settings.level);
      broadcast({ t: 'setup', ...settings });
    }),
  );
  root.querySelectorAll('[data-rounds]').forEach(b =>
    b.addEventListener('click', () => {
      settings.rounds = +b.dataset.rounds;
      pick('[data-duel-rounds]', 'rounds', settings.rounds);
      broadcast({ t: 'setup', ...settings });
    }),
  );
  $('[data-start]').addEventListener('click', () => hostStart());
  $('[data-add-player]').addEventListener('click', () => isHost() && openPairing());
  $('[data-back-lobby]').addEventListener('click', () => {
    closeScanner();
    pairing?.close();
    pairing = null;
    if (peers.size) showLobby();
    else reset();
  });

  function hostStart() {
    players = players.filter(p => !p.left && (p.id === HOST_ID || peers.has(p.id)));   // who dropped out stays out
    if (players.length < 2) return;
    sendRoster();
    const msg = { t: 'start', seed: randomSeed(), ...settings, ids: players.map(p => p.id) };
    broadcast(msg);
    startGame(msg);
  }

  // ---- the game ------------------------------------------------------------------------------

  function startGame({ seed, level, rounds, ids }) {
    game = { seed, level, rounds, ids, round: -1, results: Object.fromEntries(ids.map(id => [id, []])), finished: false };
    again = new Set();
    $('[data-rematch]').disabled = false;
    $('[data-rematch-status]').textContent = '';
    $('[data-wait]').hidden = true;
    // race track: one runner per player (mine on top, with a ring)
    root.querySelectorAll('[data-runner]').forEach(el => el.remove());
    $('[data-track]').insertAdjacentHTML('beforeend', ids
      .map(id => `<span data-runner="${id}" class="absolute top-1/2 -translate-y-1/2 rounded-full transition-[left,opacity] duration-500 ease-out motion-reduce:transition-none ${id === myId ? 'z-10 bg-surface ring-2 ring-cube' : ''}" style="left:0">${face(id, RUNNER)}</span>`)
      .join(''));
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
    game.results[myId][round] = result;
    if (isHost()) broadcast({ t: 'solved', id: myId, round, ...result });
    else hostLink?.send({ t: 'solved', round, ...result });
    updateProgress();
    setTimeout(() => {
      if (!game || game.round !== round) return;
      if (round + 1 < game.rounds) return nextRound();
      game.finished = true;
      checkDone();
    }, NEXT_DELAY);
  }

  const done = id => game.results[id].filter(Boolean).length;

  /**
   * Race track: each runner at (solved / rounds) of the track. Runners on the same spot stand close together, centred
   * on it; neighbours never overlap (pushed apart), and nobody leaves the track at either end.
   */
  function updateProgress() {
    if (!game) return;
    const track = $('[data-track]');
    const free = track.clientWidth - RUNNER;
    if (free <= 0) return;
    const order = [...game.ids].sort((a, b) => done(a) - done(b) || (a === myId) - (b === myId));
    const groups = new Map();
    for (const id of order) groups.set(done(id), [...(groups.get(done(id)) ?? []), id]);
    const left = new Map();
    for (const [count, ids] of groups) {
      const centre = (count / game.rounds) * free;
      ids.forEach((id, i) => left.set(id, centre + (i - (ids.length - 1) / 2) * RUNNER_GAP));
    }
    let prev = -Infinity;
    for (const id of order) prev = left.set(id, Math.max(left.get(id), prev + RUNNER_GAP, 0)).get(id);
    let next = Infinity;
    for (const id of [...order].reverse()) next = left.set(id, Math.min(left.get(id), next - RUNNER_GAP, free)).get(id);
    for (const id of game.ids) {
      const el = track.querySelector(`[data-runner="${id}"]`);
      if (!el) continue;
      el.style.left = `${Math.max(0, left.get(id))}px`;
      el.style.opacity = playerOf(id)?.left ? '0.35' : '1';
      el.title = t('duel.opponentProgress', { name: id === myId ? t('duel.you') : nameOf(id), done: done(id), total: game.rounds });
    }
    $('[data-progress-sr]').textContent = game.ids
      .map(id => t('duel.opponentProgress', { name: id === myId ? t('duel.you') : nameOf(id), done: done(id), total: game.rounds }))
      .join(', ');
  }
  new ResizeObserver(() => updateProgress()).observe($('[data-track]'));

  /** Results once everybody still here is through – `game.finished` is set after my last answer was on screen. */
  function checkDone() {
    if (!game?.finished || current === 'results') return;
    const pending = game.ids.filter(id => id !== myId && !playerOf(id)?.left && done(id) < game.rounds);
    if (!pending.length) return showResults();
    board.lock();
    $('[data-wait]').hidden = false;
    $('[data-wait]').textContent = t('duel.waitFor', { name: namesOf(pending) });
  }

  let lastResult = null;
  function showResults() {
    renderResults();
    show('results');
    const { winners } = lastResult;
    if (winners.includes(myId) && winners.length < game.ids.length) {
      setTimeout(fireConfetti, 200);   // the winners' devices: a short paper confetti burst
      recordDuelWin();
      setTimeout(() => celebrateNewSkins(t), 900);   // first win: new cube style
    }
  }

  function renderResults() {
    const r = (lastResult = scoreGame(game.results, game.rounds));
    const everybody = r.winners.length === game.ids.length;
    const top = r.winners[0];
    $('[data-result-title]').textContent = everybody ? t('duel.tie')
      : r.winners.includes(myId) ? t(r.winners.length > 1 ? 'duel.sharedWin' : 'duel.won')
        : r.winners.length > 1 ? t('duel.lostMany', { names: namesOf(r.winners) })
          : t(r.total[top] - r.total[myId] <= 3 ? 'duel.lostClose' : 'duel.lost', { name: nameOf(top) });

    // one card per player, best first – mine tinted like my progress bar
    const n = game.ids.length;
    $('[data-scores]').className = `mt-4 grid gap-3 text-center ${n === 2 ? 'grid-cols-2' : n === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`;
    $('[data-scores]').innerHTML = r.ranking
      .map(id => {
        const mine = id === myId;
        const crown = r.winners.includes(id) && !everybody ? `<span class="absolute right-2 top-2 text-star">${ICONS.star}</span>` : '';
        return `<div class="relative flex flex-col items-center gap-1 rounded-2xl ${mine ? 'bg-cube/15' : 'bg-front/15'} p-3${playerOf(id)?.left ? ' opacity-60' : ''}">${crown}${face(id, n > 2 ? 40 : 48)}`
          + `<p class="text-sm text-muted">${mine ? `${t('duel.you')} (${myName()})` : nameOf(id)}</p>`
          + `<p class="${n > 2 ? 'text-xl' : 'text-2xl'} font-bold">${t('duel.points', { points: r.total[id], count: r.total[id] })}</p></div>`;
      })
      .join('');

    $('[data-highlights]').replaceChildren(
      ...r.highlights[myId].map(h => {
        const li = document.createElement('li');
        li.textContent = `★ ${t(`duel.hl.${h.key}`, { ...h, seconds: h.seconds?.toLocaleString(document.documentElement.lang) })}`;
        return li;
      }),
    );

    // table: one column per player (same order as the cards); every cell shows where the points come from
    // from 3 players on the table must fit a phone: names under the avatars, compact cells (details in the tooltip)
    const compact = n > 2;
    $('[data-thead]').innerHTML = `<th class="p-2">${t('duel.roundCol')}</th>`
      + r.ranking.map(id => {
        const label = id === myId ? t('duel.you') : nameOf(id);
        return compact
          ? `<th class="p-2 text-center" title="${label}"><span class="inline-flex flex-col items-center gap-0.5">${face(id, 24)}<span class="max-w-16 truncate text-xs">${label}</span></span></th>`
          : `<th class="p-2"><span class="inline-flex items-center gap-1.5">${face(id, 20)}<span>${label}</span></span></th>`;
      }).join('');
    const tryKey = tries => (tries === 1 ? 'duel.firstTry' : tries === 2 ? 'duel.secondTry' : 'duel.laterTry');
    const part = (label, value, cls = '') => `<span class="whitespace-nowrap ${cls}">${label} ${value}</span>`;
    const cell = (result, points, fastest) => {
      const words = result
        ? [`${t(tryKey(result.tries))} +${POINTS[Math.min(result.tries, POINTS.length) - 1]}`]
        : [`${t('duel.notSolved')} 0`];
      if (result?.hint) words.push(`${t('duel.hintUsed')} −1`);
      if (fastest) words.push(`${t('duel.faster')} +1`);
      if (compact) {
        const icons = `${fastest ? `<span class="text-front">${ICONS.bolt}</span>` : ''}${result?.hint ? `<span class="text-muted">${ICONS.bulb.replace('width="18" height="18"', 'width="13" height="13"')}</span>` : ''}`;
        return `<span class="inline-flex items-center gap-1 font-bold" title="${words.join(' · ')}">${points}${icons}</span><span class="sr-only">${words.join(', ')}</span>`;
      }
      const parts = words.map((w, i) => part(i === words.length - 1 && fastest ? `${ICONS.bolt} ${w}` : w, '', fastest && i === words.length - 1 ? 'text-front' : ''));
      return `<span class="block font-bold">${points}</span><span class="block text-xs leading-snug text-muted">${parts.join(' · ')}</span>`;
    };
    $('[data-rows]').innerHTML = r.rows
      .map(row => `<tr class="border-t border-line align-top"><td class="p-2">${row.round + 1}</td>`
        + r.ranking.map(id => `<td class="p-2${compact ? ' text-center' : ''}">${cell(game.results[id][row.round], row.points[id], row.fastest === id)}</td>`).join('')
        + '</tr>')
      .join('');

    // footer: how points work
    const rules = [
      [t('duel.firstTry'), `+${POINTS[0]}`], [t('duel.secondTry'), `+${POINTS[1]}`], [t('duel.laterTry'), `+${POINTS[2]}`],
      [t('duel.hintUsed'), '−1'], [`${ICONS.bolt} ${t('duel.faster')}`, '+1'],
    ];
    $('[data-scoring]').innerHTML = `<p class="mb-1.5 font-semibold text-text">${t('duel.scoringTitle')}</p>`
      + `<ul class="flex flex-wrap gap-x-4 gap-y-1">${rules.map(([label, value]) => `<li class="whitespace-nowrap">${label} <b class="text-text">${value}</b></li>`).join('')}</ul>`;
  }

  // ---- rematch / end -------------------------------------------------------------------------

  /** everybody who is still connected */
  const present = () => (isHost() ? [HOST_ID, ...peers.keys()] : players.filter(p => !p.left).map(p => p.id));

  function rematchStatus() {
    if (current !== 'results' || !isConnected()) return;
    const waiting = present().filter(id => !again.has(id));
    const asked = present().filter(id => id !== myId && again.has(id));
    $('[data-rematch-status]').textContent = again.has(myId)
      ? (waiting.length ? t('duel.rematchWait', { name: namesOf(waiting) }) : '')
      : (asked.length ? t('duel.rematchAsked', { name: namesOf(asked) }) : '');
  }
  function maybeRematch() {
    if (!isHost() || current !== 'results') return;
    const ids = present();
    if (ids.length >= 2 && ids.every(id => again.has(id))) hostStart();
  }
  $('[data-rematch]').addEventListener('click', () => {
    if (!isConnected()) return;
    again.add(myId);
    if (isHost()) broadcast({ t: 'again', id: myId });
    else hostLink.send({ t: 'again' });
    $('[data-rematch]').disabled = true;
    rematchStatus();
    maybeRematch();
  });
  $('[data-end]').addEventListener('click', () => {
    banner('');
    reset();
  });

  // ---- language switched in place (during pairing / duel): re-render the dynamic texts ------------

  window.addEventListener('wyrfl-locale', () => {
    document.title = `${t('modes.duel.title')} · Wyrfl`;
    if (current === 'host') $('[data-host-title]').textContent = t(peers.size ? 'duel.addPlayer' : 'duel.host');
    if (current === 'lobby') showLobby();
    if (game) {
      if (game.round >= 0) {
        $('[data-round]').textContent = t('duel.round', { n: game.round + 1, total: game.rounds });
        renderLevelBadge($('[data-screen="play"] [data-level-picker]'), game.level, t);
        board.relabel();
      }
      updateProgress();
      if (!$('[data-wait]').hidden) checkDone();
      if (current === 'results') {
        renderResults();
        rematchStatus();
      }
    }
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
  // test aid (only rendered with PUBLIC_DEBUG=true): paste the answer code instead of scanning it
  root.querySelector('[data-paste-connect]')?.addEventListener('click', () => acceptAnswer($('[data-paste]').value));
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

  // join link …/duel/#join=<code> (the hash never reaches a server): on page load, and also when the link is opened
  // while this page is already open – then only the hash changes and the browser does not reload ('hashchange').
  // Opening a join link means "join this one": a running pairing or duel here is ended first.
  function joinFromLink() {
    if (!location.hash.startsWith('#join=')) return;
    const code = location.hash.slice('#join='.length);
    history.replaceState(null, '', location.pathname + location.search);
    if (!rtcSupported()) return;
    closeScanner();
    if (pairing || isConnected() || game) reset();
    guest(code);
  }
  addEventListener('hashchange', joinFromLink);
  joinFromLink();
}
