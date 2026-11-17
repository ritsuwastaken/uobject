import { Reader, Writer } from "@ritsuwastaken/farchive";
import { className, path, readProperties, type ObjectRef, type Package } from "@ritsuwastaken/upackage";
import { readName, writeName } from "./archive.ts";
import { ObjectError } from "./error.ts";
import type { Sound } from "./types.ts";

const sound = (pkg: Package, ref: ObjectRef) => {
  if (ref <= 0 || className(pkg, ref) !== "Sound") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a sound in this package`);
  return pkg.exports[ref - 1]!;
};

export function readSound(pkg: Package, ref: ObjectRef): Sound {
  const { data, offset } = sound(pkg, ref);
  const reader = new Reader(data, { offset: readProperties(pkg, data).end });
  const format = readName(pkg, reader);
  const at = reader.offset;
  const saved = reader.i32();
  const bytes = new Uint8Array(reader.take(reader.index()));
  if (offset !== undefined && saved - offset !== reader.offset) throw new ObjectError(`${path(pkg, ref)} says its data ends at ${saved}, not ${offset + reader.offset}`, at);
  return { format, data: bytes, extra: new Uint8Array(data.subarray(reader.offset)) };
}

export function writeSound(pkg: Package, ref: ObjectRef, value: Sound): Uint8Array {
  const entry = sound(pkg, ref);
  if (entry.offset === undefined) throw new ObjectError(`${path(pkg, ref)} has no file offset; set its offset to 0 for a new export`);
  const writer = new Writer();
  writer.bytes(entry.data.subarray(0, readProperties(pkg, entry.data).end));
  writeName(pkg, writer, value.format);
  const at = writer.length;
  writer.i32(0);
  writer.index(value.data.length);
  writer.bytes(value.data);
  writer.patchI32(at, entry.offset + writer.length);
  writer.bytes(value.extra);
  return writer.result();
}
