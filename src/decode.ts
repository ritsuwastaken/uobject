import { ObjectError } from "./error.ts";
import type { Image, Mip, TextureFormat } from "./types.ts";

const color565 = (value: number, out: number[], at: number) => {
  out[at] = (((value >> 11) & 0x1f) * 255 + 15) / 31 | 0;
  out[at + 1] = (((value >> 5) & 0x3f) * 255 + 31) / 63 | 0;
  out[at + 2] = ((value & 0x1f) * 255 + 15) / 31 | 0;
  out[at + 3] = 255;
};

const colorBlock = (data: Uint8Array, at: number, opaqueOnly: boolean) => {
  const c0 = data[at]! | (data[at + 1]! << 8);
  const c1 = data[at + 2]! | (data[at + 3]! << 8);
  const palette: number[] = new Array(16).fill(0);
  color565(c0, palette, 0);
  color565(c1, palette, 4);
  for (let k = 0; k < 3; k++) {
    if (c0 > c1 || opaqueOnly) {
      palette[8 + k] = (2 * palette[k]! + palette[4 + k]!) / 3 | 0;
      palette[12 + k] = (palette[k]! + 2 * palette[4 + k]!) / 3 | 0;
    } else {
      palette[8 + k] = (palette[k]! + palette[4 + k]!) / 2 | 0;
      palette[12 + k] = 0;
    }
  }
  palette[11] = 255;
  palette[15] = c0 > c1 || opaqueOnly ? 255 : 0;
  return palette;
};

const alphaDxt3 = (data: Uint8Array, at: number, pixel: number) => ((data[at + (pixel >> 1)]! >> ((pixel & 1) * 4)) & 0xf) * 17;

const alphaDxt5 = (data: Uint8Array, at: number) => {
  const a0 = data[at]!, a1 = data[at + 1]!;
  const table = [a0, a1];
  for (let k = 1; k < (a0 > a1 ? 7 : 5); k++) table.push(a0 > a1 ? ((7 - k) * a0 + k * a1) / 7 | 0 : ((5 - k) * a0 + k * a1) / 5 | 0);
  if (a0 <= a1) table.push(0, 255);
  let bits = 0n;
  for (let k = 5; k >= 0; k--) bits = (bits << 8n) | BigInt(data[at + 2 + k]!);
  return (pixel: number) => table[Number((bits >> BigInt(pixel * 3)) & 7n)]!;
};

const decodeBlocks = (mip: Mip, format: "DXT1" | "DXT3" | "DXT5", out: Uint8Array) => {
  const size = format === "DXT1" ? 8 : 16;
  const columns = Math.max(1, Math.ceil(mip.width / 4));
  const rows = Math.max(1, Math.ceil(mip.height / 4));
  for (let by = 0; by < rows; by++)
    for (let bx = 0; bx < columns; bx++) {
      const at = (by * columns + bx) * size;
      const colorAt = format === "DXT1" ? at : at + 8;
      const palette = colorBlock(mip.data, colorAt, format !== "DXT1");
      const alpha = format === "DXT5" ? alphaDxt5(mip.data, at) : undefined;
      const indices = mip.data[colorAt + 4]! | (mip.data[colorAt + 5]! << 8) | (mip.data[colorAt + 6]! << 16) | (mip.data[colorAt + 7]! << 24);
      for (let pixel = 0; pixel < 16; pixel++) {
        const x = bx * 4 + (pixel & 3), y = by * 4 + (pixel >> 2);
        if (x >= mip.width || y >= mip.height) continue;
        const index = (indices >>> (pixel * 2)) & 3;
        const o = (y * mip.width + x) * 4;
        out.set(palette.slice(index * 4, index * 4 + 4), o);
        if (format === "DXT3") out[o + 3] = alphaDxt3(mip.data, at, pixel);
        if (alpha) out[o + 3] = alpha(pixel);
      }
    }
};

export function decodeMip(mip: Mip, format: TextureFormat, palette?: Uint8Array): Image {
  const pixels = mip.width * mip.height;
  const out = new Uint8Array(pixels * 4);
  const { data } = mip;
  switch (format) {
    case "P8":
      if (!palette) throw new ObjectError("A P8 texture needs its palette");
      for (let i = 0; i < pixels; i++) out.set(palette.subarray(data[i]! * 4, data[i]! * 4 + 4), i * 4);
      break;
    case "L8":
      for (let i = 0; i < pixels; i++) out.set([data[i]!, data[i]!, data[i]!, 255], i * 4);
      break;
    case "G16":
      for (let i = 0; i < pixels; i++) out.set([data[i * 2 + 1]!, data[i * 2 + 1]!, data[i * 2 + 1]!, 255], i * 4);
      break;
    case "RGB16":
      for (let i = 0; i < pixels; i++) color565(data[i * 2]! | (data[i * 2 + 1]! << 8), out as unknown as number[], i * 4);
      break;
    case "RGB8":
      for (let i = 0; i < pixels; i++) out.set([data[i * 3 + 2]!, data[i * 3 + 1]!, data[i * 3]!, 255], i * 4);
      break;
    case "RGBA8":
      for (let i = 0; i < pixels; i++) out.set([data[i * 4 + 2]!, data[i * 4 + 1]!, data[i * 4]!, data[i * 4 + 3]!], i * 4);
      break;
    case "DXT1":
    case "DXT3":
    case "DXT5":
      decodeBlocks(mip, format, out);
      break;
    default:
      throw new ObjectError(`Decoding ${format} textures isn't supported`);
  }
  return { width: mip.width, height: mip.height, data: out };
}
