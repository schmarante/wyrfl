// Paper confetti fired from both lower corners – a short celebration (duel win). Drawn on a temporary full-screen
// canvas that never takes clicks and removes itself after about 3 seconds. No library, no sound.
// Off with prefers-reduced-motion.

const COLORS = ['#ffc53d', '#4f8cff', '#ff8a65', '#5fd3a8', '#b69cff', '#ffffff'];
const PIECES_PER_SIDE = 70;
const GRAVITY = 1400;     // px/s²
const DRAG = 1.6;         // air resistance (per second)
const LIFETIME = 3200;    // ms until the canvas is removed

export function fireConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:100';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // speed scales with the screen height, so the paper reaches about the upper third on phones and big screens
  const power = Math.sqrt(2 * GRAVITY * height * 0.95);
  const pieces = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < PIECES_PER_SIDE; i++) {
      const angle = (-90 + side * -(18 + Math.random() * 22)) * (Math.PI / 180);   // up and towards the middle
      const speed = power * (0.75 + Math.random() * 0.45);
      pieces.push({
        x: side < 0 ? -10 : width + 10,
        y: height + 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 7 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 12,
        flip: Math.random() * Math.PI,
        flipSpeed: 6 + Math.random() * 8,
        wobble: Math.random() * Math.PI * 2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay: Math.random() * 160,   // ms – a burst, not a single block
      });
    }
  }

  const start = performance.now();
  let last = start;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = now - start;
    ctx.clearRect(0, 0, width, height);
    const fade = Math.min(1, (LIFETIME - age) / 600);   // fades out at the end
    for (const p of pieces) {
      if (age < p.delay) continue;
      const drag = Math.exp(-DRAG * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + GRAVITY * dt * 0.55;
      p.wobble += dt * 5;
      p.x += (p.vx + Math.sin(p.wobble) * 40) * dt;   // paper flutters sideways while falling
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      if (p.y > height + 40) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip));   // turning over: shows its thin side now and then
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < LIFETIME) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
