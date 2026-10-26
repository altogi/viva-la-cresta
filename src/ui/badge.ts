// The club's badge comes on a white square: clear the white that touches the edges, so the badge
// sits on the scene. Done once, in a canvas, when the image has loaded.

export function clearBadgeBackground(img: HTMLImageElement) {
  const run = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || img.dataset.cleared) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, w, h);
    const px = data.data;
    const light = (i: number) => px[i * 4] > 225 && px[i * 4 + 1] > 225 && px[i * 4 + 2] > 225;
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i] || !light(i)) continue;
      seen[i] = 1;
      px[i * 4 + 3] = 0;
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
    g.putImageData(data, 0, 0);
    img.dataset.cleared = '1';
    img.src = canvas.toDataURL();
  };
  if (img.complete) run();
  else img.addEventListener('load', run, { once: true });
}
