import type { Reader, Writer } from "@ritsuwastaken/farchive";
import { addName, findName, nameOf, type Package, type Vector } from "@ritsuwastaken/upackage";
import type { Quat } from "./types.ts";

export const readVector = (reader: Reader): Vector => ({ x: reader.f32(), y: reader.f32(), z: reader.f32() });

export const readQuat = (reader: Reader): Quat => ({ x: reader.f32(), y: reader.f32(), z: reader.f32(), w: reader.f32() });

export const readName = (pkg: Package, reader: Reader) => nameOf(pkg, reader.index());

export const writeVector = (writer: Writer, value: Vector) => [value.x, value.y, value.z].forEach((part) => writer.f32(part));

export const writeQuat = (writer: Writer, value: Quat) => [value.x, value.y, value.z, value.w].forEach((part) => writer.f32(part));

export const writeName = (pkg: Package, writer: Writer, name: string) => {
  const index = findName(pkg, name);
  writer.index(index >= 0 ? index : addName(pkg, name));
};

export const writeArray = <T>(writer: Writer, items: readonly T[], write: (item: T) => void) => {
  writer.index(items.length);
  items.forEach(write);
};
