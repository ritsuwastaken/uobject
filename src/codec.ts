import type { Reader, Writer } from "@ritsuwastaken/farchive";
import type { Package, Rotator, Vector } from "@ritsuwastaken/upackage";
import { readName, writeName } from "./archive.ts";
import { ObjectError } from "./error.ts";
import type { Box, Quat, Sphere, UV } from "./types.ts";
import type { Offsets } from "./walk.ts";

export interface Context {
  pkg: Package;
  offsets: Offsets;
  base: number;
  alternate: boolean;
}

export interface Codec<T> {
  read(reader: Reader, context: Context): T;
  write(writer: Writer, value: T, context: Context): void;
}

const primitive = <T>(read: (reader: Reader) => T, write: (writer: Writer, value: T) => void): Codec<T> => ({ read: (r) => read(r), write: (w, v) => write(w, v) });

export const u8 = primitive((r) => r.u8(), (w, v: number) => w.u8(v));
export const u16 = primitive((r) => r.u16(), (w, v: number) => w.u16(v));
export const i32 = primitive((r) => r.i32(), (w, v: number) => w.i32(v));
export const u32 = primitive((r) => r.u32(), (w, v: number) => w.u32(v));
export const f32 = primitive((r) => r.f32(), (w, v: number) => w.f32(v));
export const index = primitive((r) => r.index(), (w, v: number) => w.index(v));
export const bool = primitive((r) => r.i32() !== 0, (w, v: boolean) => w.i32(v ? 1 : 0));

export const name: Codec<string> = { read: (r, c) => readName(c.pkg, r), write: (w, v, c) => writeName(c.pkg, w, v) };

export const bytes = (size: number): Codec<Uint8Array> => primitive((r) => new Uint8Array(r.take(size)), (w, v: Uint8Array) => {
  if (v.length !== size) throw new ObjectError(`Expected ${size} bytes, got ${v.length}`);
  w.bytes(v);
});

export const raw = (size: number): Codec<Uint8Array> => primitive((r) => new Uint8Array(r.take(size)), (w, v: Uint8Array) => w.bytes(v));

export const tuple = <T extends unknown[]>(...codecs: { [K in keyof T]: Codec<T[K]> }): Codec<T> => ({
  read: (r, c) => codecs.map((codec) => codec.read(r, c)) as T,
  write: (w, v, c) => codecs.forEach((codec, i) => codec.write(w, v[i], c)),
});

type Field<T, K extends keyof T = keyof T> = readonly [K, Codec<T[K]> | ((value: Partial<T>) => Codec<T[K]>), ((context: Context, value: Partial<T>) => boolean)?];

const pick = <T, K extends keyof T>(codec: Field<T, K>[1], value: Partial<T>): Codec<T[K]> => (typeof codec === "function" ? codec(value) : codec);

export const struct = <T extends object>(fields: { [K in keyof T]-?: Field<T, K> }[keyof T][]): Codec<T> => ({
  read: (r, c) => {
    const value: Partial<T> = {};
    for (const [key, codec, when] of fields) if (!when || when(c, value)) value[key] = pick(codec, value).read(r, c);
    return value as T;
  },
  write: (w, v, c) => {
    for (const [key, codec, when] of fields) {
      if (v[key] === undefined) {
        if (when) continue;
        throw new ObjectError(`Missing ${String(key)}`);
      }
      pick(codec, v).write(w, v[key], c);
    }
  },
});

export const array = <T>(codec: Codec<T>): Codec<T[]> => ({
  read: (r, c) => r.array((item) => codec.read(item, c)),
  write: (w, v, c) => {
    w.index(v.length);
    for (const item of v) codec.write(w, item, c);
  },
});

export const lazy = <T>(codec: Codec<T>): Codec<T[]> => ({
  read: (r, c) => {
    const at = r.offset;
    const saved = r.i32();
    const items = r.array((item) => codec.read(item, c));
    if ((c.offsets.base ??= saved - r.offset) !== saved - r.offset) throw new ObjectError(`Lazy array at ${at} does not end where its offset says`, at);
    c.offsets.lazy.push(at);
    return items;
  },
  write: (w, v, c) => {
    const at = w.length;
    w.i32(0);
    w.index(v.length);
    for (const item of v) codec.write(w, item, c);
    w.patchI32(at, c.base + w.length);
  },
});

export const vector = struct<Vector>([
  ["x", f32],
  ["y", f32],
  ["z", f32],
]);

export const quat = struct<Quat>([
  ["x", f32],
  ["y", f32],
  ["z", f32],
  ["w", f32],
]);

export const rotator = struct<Rotator>([
  ["pitch", i32],
  ["yaw", i32],
  ["roll", i32],
]);

export const box = struct<Box>([
  ["min", vector],
  ["max", vector],
  ["valid", primitive((r) => r.u8() !== 0, (w, v: boolean) => w.u8(v ? 1 : 0))],
]);

export const sphere = struct<Sphere>([
  ["center", vector],
  ["radius", f32],
]);

export const uv = struct<UV>([
  ["u", f32],
  ["v", f32],
]);

export const indexBuffer = struct<{ indices: number[]; revision: number }>([
  ["indices", array(u16)],
  ["revision", i32],
]);
