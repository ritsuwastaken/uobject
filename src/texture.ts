import { ArchiveError, Reader, Writer } from "@ritsuwastaken/farchive";
import { className, path, readProperties, writeProperties, type ObjectRef, type Package, type Property } from "@ritsuwastaken/upackage";
import { blockFormats, maxTextureHeader, mipTail, pixelFormats, textureCompressionVersion, textureFormats } from "./constants.ts";
import { ObjectError } from "./error.ts";
import type { Mip, Texture, TextureFormat } from "./types.ts";

export const mipSize = (format: TextureFormat, width: number, height: number): number | undefined => {
  const block = blockFormats[format];
  if (block) return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * block;
  const pixel = pixelFormats[format];
  return pixel === undefined ? undefined : width * height * pixel;
};

const property = (properties: Property[], name: string) => properties.find((entry) => entry.name === name)?.value;

const readMips = (reader: Reader, format: TextureFormat, header: number): Mip[] => {
  const mips: Mip[] = [];
  let base: number | undefined;
  const count = reader.index();
  if (header > 0 && count === 0) throw new ObjectError(`No mipmaps after a ${header}-byte header`, reader.offset);
  for (let i = 0; i < count; i++) {
    const saved = reader.i32();
    const length = reader.index();
    const data = reader.take(length);
    if ((base ??= saved - reader.offset) !== saved - reader.offset) throw new ObjectError(`Mipmap ${i} does not end where its offset says`, reader.offset);
    const width = reader.i32();
    const height = reader.i32();
    reader.skip(mipTail - 8);
    const expected = mipSize(format, width, height);
    if (width <= 0 || height <= 0 || (expected !== undefined && expected !== length)) throw new ObjectError(`Mipmap ${i} is ${width}x${height} but holds ${length} bytes`, reader.offset);
    mips.push({ width, height, data });
  }
  return mips;
};

export const locateTexture = (pkg: Package, ref: ObjectRef) => {
  if (ref <= 0 || className(pkg, ref) !== "Texture") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a texture in this package`);
  const data = pkg.exports[ref - 1]!.data;
  const { properties, end } = readProperties(pkg, data);
  const format = textureFormats[(property(properties, "Format") as number | undefined) ?? 0];
  if (!format) throw new ObjectError(`${path(pkg, ref)} has an unknown format ${property(properties, "Format")}`);
  const lists = pkg.version < textureCompressionVersion && property(properties, "bHasComp") === true ? 2 : 1;
  let failure: unknown;
  for (let header = 0; header <= maxTextureHeader && end + header < data.length; header++) {
    try {
      const reader = new Reader(data, { offset: end + header });
      let mips: Mip[] = [];
      for (let list = 0; list < lists; list++) mips = readMips(reader, format, header);
      if (!reader.atEnd) throw new ObjectError(`${reader.remaining} unexpected bytes after the mipmaps`, reader.offset);
      return { properties, end, header: data.subarray(end, end + header), format, mips };
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw error;
      failure ??= error;
    }
  }
  throw new ObjectError(`${path(pkg, ref)}: ${failure instanceof Error ? failure.message : "no mipmaps found"}`);
};

export function readTexture(pkg: Package, ref: ObjectRef): Texture {
  const { properties, format, mips } = locateTexture(pkg, ref);
  return { format, width: (property(properties, "USize") as number | undefined) ?? mips[0]?.width ?? 0, height: (property(properties, "VSize") as number | undefined) ?? mips[0]?.height ?? 0, palette: (property(properties, "Palette") as number | undefined) ?? 0, mips };
}

const setProperty = (properties: Property[], name: string, type: "byte" | "int" | "object" | "bool", value: number | boolean) => {
  const property = { name, arrayIndex: 0, type, value } as Property;
  const at = properties.findIndex((entry) => entry.name === name && entry.arrayIndex === 0);
  if (at >= 0) properties[at] = property;
  else if (value !== 0 && value !== false) properties.push(property);
};

export function writeTexture(pkg: Package, ref: ObjectRef, texture: Texture): Uint8Array {
  const entry = pkg.exports[ref - 1];
  const { properties, header } = locateTexture(pkg, ref);
  if (entry?.offset === undefined) throw new ObjectError(`${path(pkg, ref)} has no file offset; set its offset to 0 for a new export`);
  const format = textureFormats.indexOf(texture.format);
  if (texture.mips.length === 0) throw new ObjectError(`${path(pkg, ref)} needs at least one mipmap`);
  texture.mips.forEach((mip, i) => {
    const expected = mipSize(texture.format, mip.width, mip.height);
    if (expected !== undefined && expected !== mip.data.length) throw new ObjectError(`Mipmap ${i} is ${mip.width}x${mip.height} but holds ${mip.data.length} bytes`);
  });
  const list = properties.slice();
  setProperty(list, "Format", "byte", format);
  setProperty(list, "USize", "int", texture.width);
  setProperty(list, "VSize", "int", texture.height);
  setProperty(list, "UBits", "byte", Math.floor(Math.log2(Math.max(1, texture.width))));
  setProperty(list, "VBits", "byte", Math.floor(Math.log2(Math.max(1, texture.height))));
  setProperty(list, "UClamp", "int", texture.width);
  setProperty(list, "VClamp", "int", texture.height);
  if (texture.palette) setProperty(list, "Palette", "object", texture.palette);
  if (property(list, "bHasComp") === true) setProperty(list, "bHasComp", "bool", false);
  const writer = new Writer();
  const current = readProperties(pkg, entry.data);
  writer.bytes(writeProperties(pkg, list, current.none));
  writer.bytes(header);
  writer.index(texture.mips.length);
  for (const mip of texture.mips) {
    const at = writer.length;
    writer.i32(0);
    writer.index(mip.data.length);
    writer.bytes(mip.data);
    writer.patchI32(at, entry.offset + writer.length);
    writer.i32(mip.width);
    writer.i32(mip.height);
    writer.u8(Math.floor(Math.log2(Math.max(1, mip.width))));
    writer.u8(Math.floor(Math.log2(Math.max(1, mip.height))));
  }
  return writer.result();
}
