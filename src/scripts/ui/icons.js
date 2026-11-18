// Small inline SVG icons (currentColor) – no emoji, so they look the same on every device and need no icon font.
const svg = (body, size = 18, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="inline-block shrink-0"${extra}>${body}</svg>`;

const STAR = 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z';

export const ICONS = {
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 14),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 22),
  minus: svg('<path d="M5 12h14"/>', 22),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', 22),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 22),
  iso: svg('<path d="M12 3 4 7.5v9L12 21l8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>', 20),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01" stroke-width="3.2"/>', 22),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', 22),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>', 22),
  star: svg(`<path d="${STAR}" fill="currentColor"/>`, 16),
  heart: svg('<path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.5 1.1 4.6 2.7C13.1 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4Z" fill="#ef4444" stroke="none"/>', 16, ' style="vertical-align:-2px"'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', 14),
  starEmpty: svg(`<path d="${STAR}"/>`, 16, ' stroke-width="2"'),
  // game modes (home cards)
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 30),
  build: svg('<path d="M3 15.5 8 13l5 2.5-5 2.5Z"/><path d="M3 15.5V19l5 2.5V18M13 15.5V19l-5 2.5"/><path d="M11 8.5 16 6l5 2.5-5 2.5Z"/><path d="M11 8.5V12l5 2.5V11M21 8.5V12l-5 2.5"/>', 30),
  duel: svg('<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20c0-3 2.2-5 5-5s5 2 5 5M12 20c0-3 2.2-5 5-5s5 2 5 5"/>', 30),
};

// language flags (public-domain designs, simplified), shown in the language menu
const flag = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" width="27" height="18" aria-hidden="true" class="block shrink-0 rounded-[3px] ring-1 ring-black/10">${body}</svg>`;
const stripesH = (...colors) => colors.map((c, i) => `<rect y="${(20 / colors.length) * i}" width="30" height="${20 / colors.length + 0.05}" fill="${c}"/>`).join('');
const stripesV = (...colors) => colors.map((c, i) => `<rect x="${(30 / colors.length) * i}" width="${30 / colors.length + 0.05}" height="20" fill="${c}"/>`).join('');
// Croatian chequy shield (5 × 5), red top left
const hrShield = (() => {
  let cells = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if ((r + c) % 2 === 0) cells += `<rect x="${12.5 + c}" y="${5.5 + r}" width="1" height="1" fill="#FF0000"/>`;
  return `<path d="M12.5 5.5h5v5a2.5 2.5 0 0 1-5 0Z" fill="#fff"/>${cells}<path d="M12.5 5.5h5v5a2.5 2.5 0 0 1-5 0Z" fill="none" stroke="#FF0000" stroke-width="0.3"/>`;
})();

export const FLAGS = {
  de: flag(stripesH('#000', '#DD0000', '#FFCE00')),
  en: flag('<clipPath id="flag-uk-t"><path d="M15,10h15v10zv10h-15zh-15v-10zv-10h15z"/></clipPath><path d="M0,0v20h30v-20z" fill="#012169"/><path d="M0,0 30,20M30,0 0,20" stroke="#fff" stroke-width="4"/><path d="M0,0 30,20M30,0 0,20" clip-path="url(#flag-uk-t)" stroke="#C8102E" stroke-width="2.6"/><path d="M15,0v20M0,10h30" stroke="#fff" stroke-width="6.6"/><path d="M15,0v20M0,10h30" stroke="#C8102E" stroke-width="4"/>'),
  fr: flag(stripesV('#002395', '#fff', '#ED2939')),
  es: flag('<rect width="30" height="20" fill="#AA151B"/><rect y="5" width="30" height="10" fill="#F1BF00"/>'),
  hr: flag(stripesH('#FF0000', '#fff', '#171796') + hrShield),
  pl: flag(stripesH('#fff', '#DC143C')),
  cs: flag('<rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#D7141A"/><path d="M0 0 15 10 0 20Z" fill="#11457E"/>'),
};
