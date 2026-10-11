import * as T from 'three';

// 脸部 SDF 阴影贴图（原神式），纯程序生成：取前发部件在 472px 画布上的 alpha，
// 逐列找出刘海下缘 yEdge(x)，把「像素到下缘的垂直距离」编码成标量场——
//   F(x,y) = (y - yEdge(x)) / SCALE，clamp 到 [-1, 1]，存进 R 通道（0.5 + F/2）。
// 下缘之上（刘海覆盖区，含透视缝隙）F < 0 恒为影；之下按阈值形成一条跟随刘海
// 弧线的影带，阈值随主光横向扫动偏移，实现「影向背光侧倾斜」。
// 无前发部件返回 null，脸部回落到屏幕空间落影（dropShadow）。
const SIZE = 472;
const ALPHA_THRESHOLD = 40;
const DISTANCE_SCALE = 160;

export function makeFaceSdf(image: HTMLImageElement | HTMLCanvasElement | undefined, offsetY: number): T.CanvasTexture | null {
  if (!image) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, offsetY, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  // 逐列自下而上找刘海下缘（该列最下方的实心发丝像素）。
  const edge = new Float32Array(SIZE).fill(Number.POSITIVE_INFINITY);
  for (let x = 0; x < SIZE; x++) {
    for (let y = SIZE - 1; y >= 0; y--) {
      if (data[(y * SIZE + x) * 4 + 3] > ALPHA_THRESHOLD) { edge[x] = y; break; }
    }
  }
  // 刘海横向跨度内的空洞按最近已知列线性补齐；跨度之外保持 ∞（脸颊不投影）。
  let x0 = -1, x1 = -1;
  for (let x = 0; x < SIZE; x++) if (Number.isFinite(edge[x])) { if (x0 < 0) x0 = x; x1 = x; }
  if (x0 < 0) return null;
  for (let x = x0; x <= x1; x++) {
    if (Number.isFinite(edge[x])) continue;
    let left = x, right = x;
    while (left > x0 && !Number.isFinite(edge[left])) left--;
    while (right < x1 && !Number.isFinite(edge[right])) right++;
    edge[x] = edge[left] + (edge[right] - edge[left]) * (x - left) / (right - left);
  }
  const out = ctx.createImageData(SIZE, SIZE);
  const pixels = out.data;
  for (let x = 0; x < SIZE; x++) {
    const e = edge[x];
    for (let y = 0; y < SIZE; y++) {
      const f = Number.isFinite(e) ? Math.max(-1, Math.min(1, (y - e) / DISTANCE_SCALE)) : 1;
      const i = (y * SIZE + x) * 4;
      const v = Math.round((f * 0.5 + 0.5) * 255);
      pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
