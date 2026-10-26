// The riders' flags, drawn in code: for suit patches and bibs (canvas) and for the UI (data URLs).

export type FlagCode = 'de' | 'gb' | 'ch';

/** Draw a flag into a rectangle of a 2D canvas. */
export function drawFlag(g: CanvasRenderingContext2D, code: FlagCode, x: number, y: number, w: number, h: number) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  if (code === 'de') {
    ['#000000', '#dd0000', '#ffce00'].forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(x, y + (h * i) / 3, w, h / 3 + 1);
    });
  } else if (code === 'ch') {
    g.fillStyle = '#da291c';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#ffffff';
    const s = Math.min(w, h);
    const cx = x + w / 2;
    const cy = y + h / 2;
    g.fillRect(cx - s * 0.1, cy - s * 0.31, s * 0.2, s * 0.62);
    g.fillRect(cx - s * 0.31, cy - s * 0.1, s * 0.62, s * 0.2);
  } else {
    // Union Jack: blue field, white and red saltires, white and red crosses.
    g.fillStyle = '#012169';
    g.fillRect(x, y, w, h);
    const diag = (width: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w, y + h);
      g.moveTo(x + w, y);
      g.lineTo(x, y + h);
      g.stroke();
    };
    diag(h * 0.2, '#ffffff');
    diag(h * 0.07, '#c8102e');
    g.fillStyle = '#ffffff';
    g.fillRect(x + w / 2 - h * 0.17, y, h * 0.34, h);
    g.fillRect(x, y + h / 2 - h * 0.17, w, h * 0.34);
    g.fillStyle = '#c8102e';
    g.fillRect(x + w / 2 - h * 0.1, y, h * 0.2, h);
    g.fillRect(x, y + h / 2 - h * 0.1, w, h * 0.2);
  }
  g.restore();
}

const cache = new Map<FlagCode, string>();

/** A small flag image for the UI. */
export function flagUrl(code: FlagCode): string {
  const hit = cache.get(code);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = code === 'ch' ? 40 : 60;
  canvas.height = 40;
  drawFlag(canvas.getContext('2d')!, code, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL();
  cache.set(code, url);
  return url;
}
