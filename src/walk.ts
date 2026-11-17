import type { Reader } from "@ritsuwastaken/farchive";
import { path, type ObjectRef, type Package, type Relocator } from "@ritsuwastaken/upackage";
import { ObjectError } from "./error.ts";

export interface Offsets {
  lazy: number[];
  base?: number;
}

export const lazyArray = <T>(reader: Reader, offsets: Offsets, read: (reader: Reader) => T): T[] => {
  const at = reader.offset;
  const saved = reader.i32();
  const items = reader.array(read);
  if ((offsets.base ??= saved - reader.offset) !== saved - reader.offset) throw new ObjectError(`Lazy array at ${at} does not end where its offset says`, at);
  offsets.lazy.push(at);
  return items;
};

export const relocateWith =
  (walk: (pkg: Package, ref: ObjectRef) => Offsets): Relocator =>
  (pkg, ref, data, from, to) => {
    const original = pkg.exports[ref - 1]!.data;
    pkg.exports[ref - 1]!.data = data;
    try {
      const { lazy, base } = walk(pkg, ref);
      if (base === undefined) return data;
      if (base !== from) throw new ObjectError(`${path(pkg, ref)} stores offsets for position ${base}, not ${from}`);
      const out = new Uint8Array(data);
      const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
      for (const at of lazy) view.setInt32(at, view.getInt32(at, true) + to - from, true);
      return out;
    } finally {
      pkg.exports[ref - 1]!.data = original;
    }
  };
