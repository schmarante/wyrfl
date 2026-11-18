// Duel connection between two devices in the same network: WebRTC data channel WITHOUT any server.
// No signalling server, no STUN/TURN – the browsers only offer their own local addresses (host candidates, usually
// as mDNS names *.local), so this works in the same WLAN only and nothing leaves the local network.
//
// Pairing (by QR code, see duel UI):
//   1. host: createOffer() → code → shown as QR of the link …/duel/#join=<code>
//   2. guest: opens the link (camera app) → answerOffer(code) → answer code → shown as QR
//   3. host: scans the answer → accept(code) → channel open on both sides
//
// Code format (base64url, ~140 characters): type, DTLS role, ICE user name/password, DTLS fingerprint (SHA-256) and
// the UDP host addresses packed into bytes; the other side writes the session description (SDP) from it.
// A description that does not fit this form goes deflated. Ported from rindr (src/scripts/distributed/rtc.js).

const ICE_TIMEOUT = 4000;        // ms to gather the own addresses
const CONNECT_TIMEOUT = 20000;   // ms from the answer to an open channel
const CONFIG = { iceServers: [] };

// One offer (QR code) pairs exactly one guest. The answer starts with a short tag of the offer it answers
// ("<tag>.<answer>"), so the host can tell an answer to an older / other QR code apart and say so.
const offerCode = code => String(code).trim().replace(/^.*#join=/, '').replace(/\s+/g, '');
function offerTag(code) {
  let h = 0x811c9dc5;
  for (const c of offerCode(code)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}

const toBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const SETUP = ['actpass', 'active', 'passive'];
const COMPACT = 0x10;
const DEFLATED = 0x00;

/** compact bytes of a data-channel description, or null when it does not fit the form */
function compact(type, sdp) {
  const get = re => sdp.match(re)?.[1];
  const ufrag = get(/^a=ice-ufrag:(\S+)/m);
  const pwd = get(/^a=ice-pwd:(\S+)/m);
  const fp = get(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/m);
  const setup = SETUP.indexOf(get(/^a=setup:(\S+)/m));
  if (!ufrag || !pwd || !fp || setup < 0 || get(/^a=mid:(\S+)/m) !== '0' || get(/^a=sctp-port:(\d+)/m) !== '5000'
    || (sdp.match(/^m=/gm) || []).length !== 1) return null;
  const fpBytes = fp.split(':').map(h => parseInt(h, 16));
  const candidates = [...sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gmi)].slice(0, 255);
  if (fpBytes.length !== 32 || !candidates.length) return null;
  const out = [COMPACT | (type === 'offer' ? 0 : 1), setup];
  const text = value => {
    const b = new TextEncoder().encode(value);
    out.push(Math.min(b.length, 255), ...b.subarray(0, 255));
  };
  text(ufrag);
  text(pwd);
  out.push(...fpBytes, candidates.length);
  for (const [, address, port] of candidates) {
    const v4 = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    const mdns = address.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i);
    if (v4) out.push(0, ...v4.slice(1).map(Number));
    else if (mdns) out.push(1, ...mdns.slice(1).join('').match(/../g).map(h => parseInt(h, 16)));
    else {
      out.push(2);
      text(address);   // IPv6, other names
    }
    out.push(+port >> 8, +port & 255);
  }
  return new Uint8Array(out);
}

/** session description from the compact bytes */
function expand(bytes) {
  let o = 0;
  const type = bytes[o++] & 1 ? 'answer' : 'offer';
  const setup = SETUP[bytes[o++]];
  const text = () => {
    const n = bytes[o++];
    const v = new TextDecoder().decode(bytes.subarray(o, o + n));
    o += n;
    return v;
  };
  const ufrag = text();
  const pwd = text();
  const fp = hex(bytes.subarray(o, o + 32)).toUpperCase().match(/../g).join(':');
  o += 32;
  const lines = [];
  for (let i = 0, n = bytes[o++]; i < n; i++) {
    const kind = bytes[o++];
    let address;
    if (kind === 0) {
      address = [...bytes.subarray(o, o + 4)].join('.');
      o += 4;
    } else if (kind === 1) {
      const h = hex(bytes.subarray(o, o + 16));
      o += 16;
      address = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
    } else address = text();
    const port = (bytes[o] << 8) | bytes[o + 1];
    o += 2;
    lines.push(`a=candidate:${i + 1} 1 udp ${2113937151 - i} ${address} ${port} typ host generation 0`);
  }
  if (o > bytes.length || !setup || !ufrag || !pwd || !lines.length) throw new Error('invalid code');
  const sdp = ['v=0', `o=- ${Date.now()} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...lines, `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle', `a=fingerprint:sha-256 ${fp}`, `a=setup:${setup}`, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144'];
  return { type, sdp: `${sdp.join('\r\n')}\r\n` };
}

export async function packDescription({ type, sdp }) {
  const small = compact(type, sdp);
  if (small) return toBase64Url(small);
  const lines = sdp.split(/\r?\n/).filter(l => l && !(l.startsWith('a=candidate:') && / tcp /i.test(l)));
  const deflated = await pipe(new TextEncoder().encode(`${type === 'offer' ? 'o' : 'a'}${lines.join('\n')}`), new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array([DEFLATED, ...deflated]));
}

/** code (or a whole join link) → session description; throws 'invalid code' */
export async function unpackDescription(code) {
  try {
    const bytes = fromBase64Url(String(code).trim().replace(/^.*#join=/, '').replace(/\s+/g, ''));
    if ((bytes[0] & 0xf0) === COMPACT) return expand(bytes);
    if (bytes[0] !== DEFLATED) throw new Error('invalid code');
    const text = new TextDecoder().decode(await pipe(bytes.subarray(1), new DecompressionStream('deflate-raw')));
    const type = { o: 'offer', a: 'answer' }[text[0]];
    if (!type || !text.includes('m=application')) throw new Error('invalid code');
    return { type, sdp: `${text.slice(1).split('\n').join('\r\n')}\r\n` };
  } catch {
    throw new Error('invalid code');
  }
}

async function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise(resolve => {
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve());
    setTimeout(resolve, ICE_TIMEOUT);
  });
}

function opened(pc, channel) {
  // a closed tab ends the connection silently (the other side would notice after ~30 s) – close the channel actively
  addEventListener('pagehide', () => channel.close());
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') channel.close();
  });
  return new Promise((resolve, reject) => {
    if (channel.readyState === 'open') return resolve(channel);
    const timer = setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT);
    channel.addEventListener('open', () => (clearTimeout(timer), resolve(channel)), { once: true });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new Error('timeout'));
      }
    });
  });
}

export const rtcSupported = () => typeof RTCPeerConnection === 'function' && typeof CompressionStream === 'function';

/** Host: offer code; accept(answerCode) resolves with the open channel (rejects 'invalid code' / 'timeout'). */
export async function createOffer() {
  const pc = new RTCPeerConnection(CONFIG);
  const channel = pc.createDataChannel('wyrfl-duel', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await packDescription(pc.localDescription);
  const tag = offerTag(code);
  return {
    code,
    /** rejects 'invalid code', 'other offer' (an answer to another QR code – this one stays usable) or 'timeout' */
    async accept(answerCode) {
      const text = String(answerCode).trim();
      const dot = text.indexOf('.');
      if (dot > 0 && text.slice(0, dot) !== tag) throw new Error('other offer');
      const answer = await unpackDescription(dot > 0 ? text.slice(dot + 1) : text);
      if (answer.type !== 'answer') throw new Error('invalid code');
      await pc.setRemoteDescription(answer);
      return opened(pc, channel);
    },
    close: () => pc.close(),
  };
}

/** Guest: answer to the host's code; `channel` resolves once the host has scanned the answer. */
export async function answerOffer(offerCode) {
  const offer = await unpackDescription(offerCode);
  if (offer.type !== 'offer') throw new Error('invalid code');
  const pc = new RTCPeerConnection(CONFIG);
  const incoming = new Promise(resolve => pc.addEventListener('datachannel', e => resolve(e.channel), { once: true }));
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const code = `${offerTag(offerCode)}.${await packDescription(pc.localDescription)}`;
  const channel = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 10 * 60 * 1000);   // time to bring the code across
    incoming.then(c => opened(pc, c)).then(c => (clearTimeout(timer), resolve(c)), reject);
  });
  return { code, channel, close: () => pc.close() };
}

/** JSON messages over an open channel: send(msg), onmessage(msg), onclose(). */
export function messenger(channel) {
  const m = {
    onmessage: null,
    onclose: null,
    send(msg) {
      if (channel.readyState === 'open') channel.send(JSON.stringify(msg));
    },
    close: () => channel.close(),
  };
  channel.addEventListener('message', e => {
    try {
      m.onmessage?.(JSON.parse(e.data));
    } catch {
      /* ignore broken messages */
    }
  });
  channel.addEventListener('close', () => m.onclose?.());
  return m;
}
