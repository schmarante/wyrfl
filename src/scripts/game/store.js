// Scrambled + signed localStorage for everything that counts as progress (levels, duel wins, cube styles, avatar).
// Goal: editing a value in the browser's dev tools must not unlock anything. A changed, copied or hand-written value
// fails the check and is ignored (= empty). Not real security – the code is open source, a determined person can
// read the key; it only takes away the easy way of cheating.
//
// Format: "w1.<nonce>.<mac>.<data>" – data = UTF-8 bytes XOR a keystream from (secret, storage key, nonce), base64;
// mac = 106-bit hash of (secret, storage key, nonce, plain text). The storage key is part of both, so a value can't be
// copied from one key to another. A fresh random nonce per write: the same value never looks the same twice.
// Plain values from before (launch day) are not accepted – otherwise writing plain JSON would be the cheat.
// Theme and language stay plain (`wyrfl:theme`, `wyrfl:lang`): nothing to win there, and the inline script that
// applies them before the first paint must stay tiny.

const SECRET = 'wyrfl·würfel·7f3a9c1e·kein-schummeln';
const PREFIX = 'w1.';

/** cyrb53 – 53-bit string hash */
function cyrb53(text, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const mac = (key, nonce, plain) => {
  const text = `${SECRET}|${key}|${nonce}|${plain}`;
  return cyrb53(text, 1).toString(36) + cyrb53(text, 2).toString(36);
};

/** XOR with a mulberry32 keystream seeded from (secret, key, nonce) – the same call encrypts and decrypts */
function xor(bytes, key, nonce) {
  let a = cyrb53(`${SECRET}|${key}|${nonce}`) >>> 0;
  const out = new Uint8Array(bytes.length);
  let word = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (i % 4 === 0) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      word = (t ^ (t >>> 14)) >>> 0;
    }
    out[i] = bytes[i] ^ ((word >>> ((i % 4) * 8)) & 0xff);
  }
  return out;
}

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function encode(key, plain) {
  const nonce = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(36)).join('');
  const data = toBase64(xor(new TextEncoder().encode(plain), key, nonce));
  return `${PREFIX}${nonce}.${mac(key, nonce, plain)}.${data}`;
}

/** the plain text, or null if the value is missing, plain, changed or belongs to another key */
export function decode(key, stored) {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return null;
  const [nonce, sum, data] = stored.slice(PREFIX.length).split('.');
  if (!nonce || !sum || data === undefined) return null;
  try {
    const plain = new TextDecoder('utf-8', { fatal: true }).decode(xor(fromBase64(data), key, nonce));
    return mac(key, nonce, plain) === sum ? plain : null;
  } catch {
    return null;
  }
}

/** Reads a protected value (null if missing, tampered or storage blocked). */
export function secureGet(key) {
  try {
    return decode(key, localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Writes a protected value (silently not kept if storage is blocked). */
export function secureSet(key, plain) {
  try {
    localStorage.setItem(key, encode(key, String(plain)));
  } catch {
    /* storage unavailable */
  }
}
