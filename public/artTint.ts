// The panel's ground takes a trace of the game's art (`--panel-tint`, styles/components.css).

// Dark and greyed whatever the art, so the ground's text contrast holds for any game.
const TINT_L = 0.17;
const TINT_MAX_C = 0.04;

// An sRGB colour (0–255) as the clamped OKLCH tint (Björn Ottosson's OKLab matrices).
export function tintFromRgb(r: number, g: number, b: number): string {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.min(Math.hypot(a, bb), TINT_MAX_C);
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return `oklch(${TINT_L} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

// The art's mean colour as a tint, or null when it can't be read (a failed load, a CDN without
// CORS headers tainting the canvas): the ground then stays neutral.
export function sampleArtTint(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 8;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 8, 8);
        const data = ctx.getImageData(0, 0, 8, 8).data;
        const sum = [0, 0, 0];
        for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += data[i + k];
        const n = data.length / 4;
        resolve(tintFromRgb(sum[0] / n, sum[1] / n, sum[2] / n));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
