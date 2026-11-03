import { deflateSync } from "node:zlib";

// Draws the score ring (grey track, coloured arc from 12 o'clock, round caps)
// as a PNG, with the same proportions as the ring in the scan page header.
// Pure JS so the render needs nothing but ffmpeg. The number is drawn by the
// caption pass, so the font matches the captions.

const VIEW = 132; // header ring is a 120 box (r=54, stroke 10); +6 padding each side for the disc
const R = 54;
const STROKE = 10;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const crcTable = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Distance from point to the arc's centreline stroke, handled via angle + radius. */
export function ringPixels(size: number, score: number, color: string): Uint8Array {
  const k = size / VIEW;
  const c = VIEW / 2;
  const frac = Math.min(1, Math.max(0, score / 100));
  const [ar, ag, ab] = hexRgb(color);
  const SS = 3; // 3x3 supersampling for smooth edges
  const out = new Uint8Array(size * size * 4);

  const sweep = frac * 2 * Math.PI;
  // Round-cap centres, on the ring's centreline.
  const capA = { x: c, y: c - R }; // start, at the top
  const capB = { x: c + R * Math.sin(sweep), y: c - R * Math.cos(sweep) };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / k;
          const y = (py + (sy + 0.5) / SS) / k;
          const dx = x - c;
          const dy = y - c;
          const d = Math.hypot(dx, dy);

          // Layers, bottom to top: white disc, grey track, coloured arc.
          let cr = 0, cg = 0, cb = 0, ca = 0;
          const over = (lr: number, lg: number, lb: number, la: number) => {
            const oa = la + ca * (1 - la);
            if (oa > 0) {
              cr = (lr * la + cr * ca * (1 - la)) / oa;
              cg = (lg * la + cg * ca * (1 - la)) / oa;
              cb = (lb * la + cb * ca * (1 - la)) / oa;
            }
            ca = oa;
          };
          if (d <= VIEW / 2 - 0.5) over(255, 255, 255, 0.94);
          if (Math.abs(d - R) <= STROKE / 2) over(229, 229, 229, 1);
          if (frac > 0) {
            let onArc = false;
            if (Math.abs(d - R) <= STROKE / 2) {
              let ang = Math.atan2(dx, -dy); // 0 at the top, clockwise
              if (ang < 0) ang += 2 * Math.PI;
              onArc = ang <= sweep;
            }
            if (
              onArc ||
              Math.hypot(x - capA.x, y - capA.y) <= STROKE / 2 ||
              Math.hypot(x - capB.x, y - capB.y) <= STROKE / 2
            ) {
              over(ar, ag, ab, 1);
            }
          }
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return out;
}

export function ringPng(size: number, score: number, color: string): Buffer {
  return encodePng(size, size, ringPixels(size, score, color));
}
