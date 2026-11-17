import { blockFormats } from "./constants.ts";
import { ObjectError } from "./error.ts";
import type { Image, Mip, TextureFormat } from "./types.ts";

const to565 = (r: number, g: number, b: number) => ((Math.round((r * 31) / 255) << 11) | (Math.round((g * 63) / 255) << 5) | Math.round((b * 31) / 255)) & 0xffff;

const from565 = (value: number): [number, number, number] => [(((value >> 11) & 0x1f) * 255 + 15) / 31 | 0, (((value >> 5) & 0x3f) * 255 + 31) / 63 | 0, ((value & 0x1f) * 255 + 15) / 31 | 0];

const block = (image: Image, bx: number, by: number) => {
  const pixels = new Uint8Array(64);
  for (let pixel = 0; pixel < 16; pixel++) {
    const x = Math.min(bx * 4 + (pixel & 3), image.width - 1);
    const y = Math.min(by * 4 + (pixel >> 2), image.height - 1);
    pixels.set(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4), pixel * 4);
  }
  return pixels;
};

const distance = (pixels: Uint8Array, i: number, color: readonly number[]) => {
  const r = pixels[i * 4]! - color[0]!, g = pixels[i * 4 + 1]! - color[1]!, b = pixels[i * 4 + 2]! - color[2]!;
  return r * r + g * g + b * b;
};

const endpoints = (pixels: Uint8Array, used: boolean[]) => {
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < 16; i++) {
    if (!used[i]) continue;
    for (let k = 0; k < 3; k++) mean[k]! += pixels[i * 4 + k]!;
    count++;
  }
  if (count === 0) return [[0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < 3; k++) mean[k]! /= count;
  const cov = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 16; i++) {
    if (!used[i]) continue;
    const r = pixels[i * 4]! - mean[0]!, g = pixels[i * 4 + 1]! - mean[1]!, b = pixels[i * 4 + 2]! - mean[2]!;
    cov[0]! += r * r;
    cov[1]! += r * g;
    cov[2]! += r * b;
    cov[3]! += g * g;
    cov[4]! += g * b;
    cov[5]! += b * b;
  }
  const rows = [[cov[0]!, cov[1]!, cov[2]!], [cov[1]!, cov[3]!, cov[4]!], [cov[2]!, cov[4]!, cov[5]!]];
  let axis = rows[[cov[0]!, cov[3]!, cov[5]!].reduce((best, value, k, all) => (value > all[best]! ? k : best), 0)]!;
  for (let step = 0; step < 8; step++) {
    const next = [cov[0]! * axis[0]! + cov[1]! * axis[1]! + cov[2]! * axis[2]!, cov[1]! * axis[0]! + cov[3]! * axis[1]! + cov[4]! * axis[2]!, cov[2]! * axis[0]! + cov[4]! * axis[1]! + cov[5]! * axis[2]!];
    const length = Math.hypot(...next);
    if (length < 1e-9) break;
    axis = next.map((value) => value / length);
  }
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < 16; i++) {
    if (!used[i]) continue;
    const t = (pixels[i * 4]! - mean[0]!) * axis[0]! + (pixels[i * 4 + 1]! - mean[1]!) * axis[1]! + (pixels[i * 4 + 2]! - mean[2]!) * axis[2]!;
    low = Math.min(low, t);
    high = Math.max(high, t);
  }
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  return [low, high].map((t) => mean.map((m, k) => clamp(m + axis[k]! * t)));
};

const colorBlock = (pixels: Uint8Array, out: Uint8Array, at: number, transparency: boolean) => {
  const transparent = Array.from({ length: 16 }, (_, i) => transparency && pixels[i * 4 + 3]! < 128);
  const [low, high] = endpoints(pixels, transparent.map((t) => !t));
  let c0 = to565(high![0]!, high![1]!, high![2]!);
  let c1 = to565(low![0]!, low![1]!, low![2]!);
  const threeColor = transparent.some(Boolean);
  if (threeColor ? c0 > c1 : c0 < c1) [c0, c1] = [c1, c0];
  const a = from565(c0), b = from565(c1);
  const palette = threeColor || c0 === c1 ? [a, b, a.map((v, k) => (v + b[k]!) / 2 | 0)] : [a, b, a.map((v, k) => (2 * v + b[k]!) / 3 | 0), a.map((v, k) => (v + 2 * b[k]!) / 3 | 0)];
  let indices = 0;
  for (let i = 0; i < 16; i++) {
    let best = 0;
    if (transparent[i]) best = 3;
    else if (c0 !== c1 || threeColor) {
      let score = Infinity;
      palette.forEach((color, index) => {
        const d = distance(pixels, i, color);
        if (d < score) [score, best] = [d, index];
      });
    }
    indices |= best << (i * 2);
  }
  out[at] = c0 & 0xff;
  out[at + 1] = c0 >> 8;
  out[at + 2] = c1 & 0xff;
  out[at + 3] = c1 >> 8;
  new DataView(out.buffer, out.byteOffset).setUint32(at + 4, indices >>> 0, true);
};

const alphaDxt3 = (pixels: Uint8Array, out: Uint8Array, at: number) => {
  for (let i = 0; i < 16; i += 2) out[at + (i >> 1)] = Math.round(pixels[i * 4 + 3]! / 17) | (Math.round(pixels[(i + 1) * 4 + 3]! / 17) << 4);
};

const alphaDxt5 = (pixels: Uint8Array, out: Uint8Array, at: number) => {
  let a0 = 0, a1 = 255;
  for (let i = 0; i < 16; i++) {
    a0 = Math.max(a0, pixels[i * 4 + 3]!);
    a1 = Math.min(a1, pixels[i * 4 + 3]!);
  }
  out[at] = a0;
  out[at + 1] = a1;
  if (a0 === a1) return;
  const table = [a0, a1];
  for (let k = 1; k < 7; k++) table.push(((7 - k) * a0 + k * a1) / 7 | 0);
  let bits = 0n;
  for (let i = 15; i >= 0; i--) {
    const alpha = pixels[i * 4 + 3]!;
    let best = 0;
    table.forEach((value, index) => {
      if (Math.abs(value - alpha) < Math.abs(table[best]! - alpha)) best = index;
    });
    bits = (bits << 3n) | BigInt(best);
  }
  for (let k = 0; k < 6; k++) out[at + 2 + k] = Number((bits >> BigInt(k * 8)) & 0xffn);
};

const encodeBlocks = (image: Image, format: "DXT1" | "DXT3" | "DXT5") => {
  const size = blockFormats[format]!;
  const columns = Math.max(1, Math.ceil(image.width / 4));
  const rows = Math.max(1, Math.ceil(image.height / 4));
  const out = new Uint8Array(columns * rows * size);
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < columns; bx++) {
      const pixels = block(image, bx, by);
      const at = (by * columns + bx) * size;
      if (format === "DXT1") colorBlock(pixels, out, at, true);
      else {
        if (format === "DXT3") alphaDxt3(pixels, out, at);
        else alphaDxt5(pixels, out, at);
        colorBlock(pixels, out, at + 8, false);
      }
    }
  return out;
};

const nearest = (palette: Uint8Array, r: number, g: number, b: number, a: number) => {
  let best = 0, score = Infinity;
  for (let i = 0; i < palette.length / 4; i++) {
    const dr = palette[i * 4]! - r, dg = palette[i * 4 + 1]! - g, db = palette[i * 4 + 2]! - b, da = palette[i * 4 + 3]! - a;
    const d = dr * dr + dg * dg + db * db + da * da;
    if (d < score) [score, best] = [d, i];
  }
  return best;
};

export function encodeMip(image: Image, format: TextureFormat, palette?: Uint8Array): Mip {
  const pixels = image.width * image.height;
  if (image.data.length !== pixels * 4) throw new ObjectError(`A ${image.width}x${image.height} image needs ${pixels * 4} bytes of RGBA, not ${image.data.length}`);
  const src = image.data;
  let data: Uint8Array;
  switch (format) {
    case "P8": {
      if (!palette) throw new ObjectError("A P8 texture needs a palette to pick colors from");
      const cache = new Map<number, number>();
      data = new Uint8Array(pixels);
      for (let i = 0; i < pixels; i++) {
        const key = new DataView(src.buffer, src.byteOffset).getUint32(i * 4);
        let index = cache.get(key);
        if (index === undefined) cache.set(key, (index = nearest(palette, src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!, src[i * 4 + 3]!)));
        data[i] = index;
      }
      break;
    }
    case "L8":
      data = new Uint8Array(pixels);
      for (let i = 0; i < pixels; i++) data[i] = Math.round(0.299 * src[i * 4]! + 0.587 * src[i * 4 + 1]! + 0.114 * src[i * 4 + 2]!);
      break;
    case "G16":
      data = new Uint8Array(pixels * 2);
      for (let i = 0; i < pixels; i++) data[i * 2] = data[i * 2 + 1] = src[i * 4]!;
      break;
    case "RGB16":
      data = new Uint8Array(pixels * 2);
      for (let i = 0; i < pixels; i++) {
        const value = to565(src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!);
        data[i * 2] = value & 0xff;
        data[i * 2 + 1] = value >> 8;
      }
      break;
    case "RGB8":
      data = new Uint8Array(pixels * 3);
      for (let i = 0; i < pixels; i++) data.set([src[i * 4 + 2]!, src[i * 4 + 1]!, src[i * 4]!], i * 3);
      break;
    case "RGBA8":
      data = new Uint8Array(pixels * 4);
      for (let i = 0; i < pixels; i++) data.set([src[i * 4 + 2]!, src[i * 4 + 1]!, src[i * 4]!, src[i * 4 + 3]!], i * 4);
      break;
    case "DXT1":
    case "DXT3":
    case "DXT5":
      data = encodeBlocks(image, format);
      break;
    default:
      throw new ObjectError(`Encoding ${format} textures isn't supported`);
  }
  return { width: image.width, height: image.height, data };
}

export function mipmaps(image: Image): Image[] {
  const chain = [image];
  let current = image;
  while (current.width > 1 || current.height > 1) {
    const width = Math.max(1, current.width >> 1);
    const height = Math.max(1, current.height >> 1);
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const y0 = Math.floor((y * current.height) / height), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * current.height) / height));
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor((x * current.width) / width), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * current.width) / width));
        for (let k = 0; k < 4; k++) {
          let sum = 0;
          for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += current.data[(sy * current.width + sx) * 4 + k]!;
          data[(y * width + x) * 4 + k] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
        }
      }
    }
    current = { width, height, data };
    chain.push(current);
  }
  return chain;
}
