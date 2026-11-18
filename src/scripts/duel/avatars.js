// Duel characters instead of names (kid-safe: nothing personal is typed or sent).
// Pictures: Microsoft Fluent Emoji, flat style (MIT) – self-hosted in public/avatars/.
export const AVATARS = [
  'fox', 'cat', 'dog', 'panda', 'frog', 'owl', 'unicorn', 'turtle',
  'strawberry', 'banana', 'carrot', 'broccoli', 'avocado', 'pineapple', 'watermelon', 'grapes',
];

export const avatarUrl = id => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/avatars/${id}.svg`;

export function avatarImg(id, size = 32, extraClass = '') {
  return `<img src="${avatarUrl(id)}" alt="" width="${size}" height="${size}" class="inline-block shrink-0 ${extraClass}" draggable="false" />`;
}
