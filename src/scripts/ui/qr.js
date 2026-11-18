// QR codes for duel pairing: draw (qrcode-generator, MIT) and scan with the camera (qr-scanner, MIT – uses the
// browser's BarcodeDetector where available, otherwise its own jsQR-based worker). Both are loaded only on demand.
// The camera picture never leaves the device.

/** Draws `text` as an SVG QR code into `el` (dark modules on white – scanners need the light quiet zone). */
export async function renderQr(el, text) {
  const { default: qrcode } = await import('qrcode-generator');
  // level L: the code is shown on a clean screen, low error correction keeps it less dense (easier for old cameras)
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const size = n + quiet * 2;
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" class="h-full w-full"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/**
 * Starts the camera in `video` and calls onResult(text) for every QR code it reads.
 * @returns {Promise<{ stop: () => void }>} rejects when there is no camera / permission was denied
 */
export async function startScanner(video, onResult) {
  const { default: QrScanner } = await import('qr-scanner');
  const scanner = new QrScanner(video, result => onResult(result.data), {
    preferredCamera: 'environment',
    highlightScanRegion: false,
    // whole picture (default: centre 2/3 only – a code held close to the camera would be cut off)
    calculateScanRegion: v => {
      const scale = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight));
      return { x: 0, y: 0, width: v.videoWidth, height: v.videoHeight,
               downScaledWidth: Math.round(v.videoWidth * scale), downScaledHeight: Math.round(v.videoHeight * scale) };
    },
    returnDetailedScanResult: true,
  });
  await scanner.start();
  return {
    stop() {
      scanner.stop();
      scanner.destroy();
    },
  };
}
