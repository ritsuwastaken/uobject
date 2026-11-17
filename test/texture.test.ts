import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Writer } from "@ritsuwastaken/farchive";
import { addName, build, className, parse, path, writeProperties, type Package, type Property } from "@ritsuwastaken/upackage";
import { decodeMip, encodeMip, mipmaps, mipSize, ObjectError, readPalette, readTexture, relocators, writeTexture, type Image } from "../src/index.ts";

const sample = (): Package => {
  const pkg: Package = { version: 123, licensee: 0, flags: 1, guid: new Uint8Array(16), generations: [], names: [], imports: [], exports: [], trailer: new Uint8Array() };
  addName(pkg, "None");
  const core = addName(pkg, "Core");
  const engine = addName(pkg, "Engine");
  const cls = addName(pkg, "Class");
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Package"), outer: 0, name: engine });
  pkg.imports.push({ classPackage: core, className: cls, outer: -1, name: addName(pkg, "Texture") });
  pkg.imports.push({ classPackage: core, className: cls, outer: -1, name: addName(pkg, "Palette") });
  return pkg;
};

const textureData = (pkg: Package, properties: Property[], mips: { width: number; height: number; data: number[] }[], header = 0, base = 1000) => {
  const writer = new Writer();
  writer.bytes(writeProperties(pkg, properties));
  for (let i = 0; i < header; i++) writer.u8(0);
  writer.index(mips.length);
  for (const mip of mips) {
    const at = writer.length;
    writer.i32(0);
    writer.index(mip.data.length);
    mip.data.forEach((byte) => writer.u8(byte));
    writer.patchI32(at, base + writer.length);
    writer.i32(mip.width);
    writer.i32(mip.height);
    writer.u8(Math.log2(mip.width));
    writer.u8(Math.log2(mip.height));
  }
  return writer.result();
};

const addTexture = (pkg: Package, name: string, properties: Property[], mips: { width: number; height: number; data: number[] }[], header = 0) => {
  pkg.exports.push({ class: -2, super: 0, outer: 0, name: addName(pkg, name), flags: 0, data: textureData(pkg, properties, mips, header) });
  return pkg.exports.length;
};

const byte = (name: string, value: number): Property => ({ name, arrayIndex: 0, type: "byte", value });
const object = (name: string, value: number): Property => ({ name, arrayIndex: 0, type: "object", value });

test("sizes mipmaps per format", () => {
  assert.equal(mipSize("P8", 8, 4), 32);
  assert.equal(mipSize("RGBA8", 2, 2), 16);
  assert.equal(mipSize("DXT1", 8, 8), 32);
  assert.equal(mipSize("DXT5", 2, 1), 16);
  assert.equal(mipSize("NODATA", 4, 4), undefined);
});

test("decodes a DXT1 block", () => {
  const image = decodeMip({ width: 4, height: 4, data: new Uint8Array([0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0]) }, "DXT1");
  assert.deepEqual([...image.data.subarray(0, 16)], [255, 0, 0, 255, 0, 0, 255, 255, 170, 0, 85, 255, 85, 0, 170, 255]);
});

test("decodes DXT3 and DXT5 alpha", () => {
  const color = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
  const dxt3 = decodeMip({ width: 4, height: 4, data: new Uint8Array([0x0f, 0, 0, 0, 0, 0, 0, 0, ...color]) }, "DXT3");
  assert.deepEqual([dxt3.data[3], dxt3.data[7]], [255, 0]);
  const dxt5 = decodeMip({ width: 4, height: 4, data: new Uint8Array([200, 100, 1, 0, 0, 0, 0, 0, ...color]) }, "DXT5");
  assert.deepEqual([dxt5.data[3], dxt5.data[7]], [100, 200]);
});

test("decodes palette, RGBA8 and grey formats", () => {
  const palette = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]);
  assert.deepEqual([...decodeMip({ width: 2, height: 1, data: new Uint8Array([1, 0]) }, "P8", palette).data], [40, 50, 60, 128, 10, 20, 30, 255]);
  assert.deepEqual([...decodeMip({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) }, "RGBA8").data], [3, 2, 1, 4]);
  assert.deepEqual([...decodeMip({ width: 1, height: 1, data: new Uint8Array([0, 77]) }, "G16").data], [77, 77, 77, 255]);
  assert.throws(() => decodeMip({ width: 1, height: 1, data: new Uint8Array([0]) }, "P8"), ObjectError);
});

test("reads textures and their palettes", () => {
  const pkg = sample();
  pkg.exports.push({ class: -3, super: 0, outer: 0, name: addName(pkg, "Pal"), flags: 0, data: new Uint8Array([...writeProperties(pkg, []), 2, 1, 2, 3, 255, 4, 5, 6, 255]) });
  const ref = addTexture(pkg, "Tex", [object("Palette", 1)], [{ width: 2, height: 2, data: [0, 1, 1, 0] }, { width: 1, height: 1, data: [1] }]);
  const back = parse(build(pkg));
  const texture = readTexture(back, ref);
  assert.equal(texture.format, "P8");
  assert.deepEqual(texture.mips.map((mip) => [mip.width, mip.height, [...mip.data]]), [[2, 2, [0, 1, 1, 0]], [1, 1, [1]]]);
  assert.deepEqual([...decodeMip(texture.mips[1]!, texture.format, readPalette(back, texture.palette)).data], [4, 5, 6, 255]);
});

for (const header of [4, 42, 98]) {
  test(`reads textures with a ${header}-byte header before the mipmaps`, () => {
    const pkg = sample();
    const ref = addTexture(pkg, "Tex", [byte("Format", 3)], [{ width: 4, height: 4, data: [1, 2, 3, 4, 5, 6, 7, 8] }], header);
    assert.deepEqual([...readTexture(pkg, ref).mips[0]!.data], [1, 2, 3, 4, 5, 6, 7, 8]);
  });
}

test("rejects mipmaps whose size doesn't match their format", () => {
  const pkg = sample();
  const ref = addTexture(pkg, "Tex", [byte("Format", 3)], [{ width: 4, height: 4, data: [1, 2, 3] }]);
  assert.throws(() => readTexture(pkg, ref), ObjectError);
});

const image = (width: number, height: number, pixel: (x: number, y: number) => number[]): Image => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
};

test("encodes uncompressed formats losslessly where they can be", () => {
  const source = image(3, 2, (x, y) => [x * 80, y * 200, 30, 128 + x]);
  for (const format of ["RGBA8", "RGB8"] as const) {
    const back = decodeMip(encodeMip(source, format), format);
    assert.deepEqual([...back.data], format === "RGBA8" ? [...source.data] : [...source.data].map((value, i) => (i % 4 === 3 ? 255 : value)), format);
  }
  const grey = image(2, 2, (x) => [x * 255, x * 255, x * 255, 255]);
  for (const format of ["L8", "G16"] as const) assert.deepEqual([...decodeMip(encodeMip(grey, format), format).data], [...grey.data], format);
  const palette = new Uint8Array([0, 0, 0, 255, 250, 10, 10, 255]);
  const reds = image(2, 1, (x) => (x ? [240, 0, 0, 255] : [5, 5, 5, 255]));
  assert.deepEqual([...encodeMip(reds, "P8", palette).data], [0, 1]);
  assert.throws(() => encodeMip(reds, "P8"), ObjectError);
  assert.throws(() => encodeMip({ width: 2, height: 2, data: new Uint8Array(3) }, "RGBA8"), ObjectError);
});

test("encodes DXT blocks close to the source", () => {
  const source = image(6, 5, (x, y) => [x * 40, 255 - x * 40, 90 + y, x < 3 ? 255 : 0]);
  for (const format of ["DXT1", "DXT3", "DXT5"] as const) {
    const mip = encodeMip(source, format);
    assert.equal(mip.data.length, mipSize(format, 6, 5), format);
    const back = decodeMip(mip, format);
    for (let i = 0; i < source.data.length; i += 4) {
      if (source.data[i + 3] === 0 && format === "DXT1") {
        assert.equal(back.data[i + 3], 0, `${format} keeps transparent pixels`);
        continue;
      }
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(back.data[i + k]! - source.data[i + k]!) <= 24, `${format} pixel ${i / 4} channel ${k}`);
      if (format !== "DXT1") assert.ok(Math.abs(back.data[i + 3]! - source.data[i + 3]!) <= 9, `${format} alpha ${i / 4}`);
    }
  }
});

test("builds a mipmap chain down to one pixel", () => {
  const chain = mipmaps(image(5, 3, () => [10, 20, 30, 40]));
  assert.deepEqual(chain.map((mip) => [mip.width, mip.height]), [[5, 3], [2, 1], [1, 1]]);
  assert.deepEqual([...chain[2]!.data], [10, 20, 30, 40]);
});

test("replaces a texture and keeps it readable after moving", () => {
  const pkg = sample();
  const ref = addTexture(pkg, "Tex", [byte("Format", 3), byte("UBits", 2), byte("VBits", 2), { name: "USize", arrayIndex: 0, type: "int", value: 4 }, { name: "VSize", arrayIndex: 0, type: "int", value: 4 }, { name: "UClamp", arrayIndex: 0, type: "int", value: 4 }, { name: "VClamp", arrayIndex: 0, type: "int", value: 4 }], [{ width: 4, height: 4, data: [1, 2, 3, 4, 5, 6, 7, 8] }], 4);
  const loaded = parse(build(pkg));
  const before = readTexture(loaded, ref);
  loaded.exports[ref - 1]!.data = writeTexture(loaded, ref, before);
  assert.deepEqual(readTexture(loaded, ref), before);
  const mips = mipmaps(image(8, 4, (x, y) => [x * 30, y * 60, 0, 255])).map((mip) => encodeMip(mip, "RGBA8"));
  loaded.exports[ref - 1]!.data = writeTexture(loaded, ref, { format: "RGBA8", width: 8, height: 4, palette: 0, mips });
  addName(loaded, "Moves the texture");
  const moved = parse(build(loaded, { relocators }));
  const after = readTexture(moved, ref);
  assert.equal(after.format, "RGBA8");
  assert.deepEqual([after.width, after.height, after.mips.length], [8, 4, 4]);
  assert.deepEqual(after.mips.map((mip) => [...mip.data]), mips.map((mip) => [...mip.data]));
  assert.throws(() => writeTexture(moved, ref, { ...after, mips: [{ width: 8, height: 4, data: new Uint8Array(3) }] }), ObjectError);
});

const files = (process.env.UOBJECT_FILES ?? "").split(":").filter((dir) => dir && existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((file) => /\.(u|utx|usx|ukx|unr)$/i.test(file)).map((file) => join(dir, file)));

test("reads and decodes every texture in real packages", { skip: files.length === 0 }, () => {
  let decoded = 0;
  for (const file of files) {
    let pkg: Package;
    try {
      pkg = parse(readFileSync(file));
    } catch {
      continue;
    }
    pkg.exports.forEach((_, i) => {
      if (className(pkg, i + 1) !== "Texture") return;
      const texture = readTexture(pkg, i + 1);
      if (!texture.mips.length || (texture.format === "P8" && texture.palette <= 0)) return;
      const palette = texture.format === "P8" ? readPalette(pkg, texture.palette) : undefined;
      const pixels = decodeMip(texture.mips[0]!, texture.format, palette);
      assert.equal(pixels.data.length, texture.mips[0]!.width * texture.mips[0]!.height * 4, `${file}: ${path(pkg, i + 1)}`);
      assert.deepEqual(writeTexture(pkg, i + 1, texture), new Uint8Array(pkg.exports[i]!.data), `${file}: ${path(pkg, i + 1)} rewrites byte for byte`);
      decoded++;
    });
  }
  assert.ok(decoded > 0);
  console.log(`decoded ${decoded} textures`);
});
