// The riders' flags, drawn in code: for suit patches and bibs (canvas) and for the UI (data URLs).

export type FlagCode = 'de' | 'gb' | 'ch' | 'au' | 'it';

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
  } else if (code === 'it') {
    ['#009246', '#ffffff', '#ce2b37'].forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(x + (w * i) / 3, y, w / 3 + 1, h);
    });
  } else if (code === 'au') {
    // Blue ensign: the Union Jack in the canton, the Commonwealth Star under it, the Southern Cross.
    g.fillStyle = '#012169';
    g.fillRect(x, y, w, h);
    drawFlag(g, 'gb', x, y, w / 2, h / 2);
    const star = (cx: number, cy: number, r: number, points: number) => {
      g.beginPath();
      for (let k = 0; k < points * 2; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / points;
        const rr = k % 2 ? r * 0.45 : r;
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    };
    g.fillStyle = '#ffffff';
    star(x + w * 0.25, y + h * 0.75, h * 0.14, 7);
    star(x + w * 0.75, y + h * 0.84, h * 0.07, 7);
    star(x + w * 0.62, y + h * 0.48, h * 0.07, 7);
    star(x + w * 0.75, y + h * 0.2, h * 0.07, 7);
    star(x + w * 0.87, y + h * 0.42, h * 0.07, 7);
    star(x + w * 0.8, y + h * 0.56, h * 0.035, 5);
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
