import { Reader } from "@ritsuwastaken/farchive";
import { className, path, readProperties, type ObjectRef, type Package } from "@ritsuwastaken/upackage";
import { opaque, paletteAlphaVersion } from "./constants.ts";
import { ObjectError } from "./error.ts";

export function readPalette(pkg: Package, ref: ObjectRef): Uint8Array {
  if (ref <= 0 || className(pkg, ref) !== "Palette") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a palette in this package`);
  const data = pkg.exports[ref - 1]!.data;
  const reader = new Reader(data, { offset: readProperties(pkg, data).end });
  const colors = new Uint8Array(reader.take(reader.index() * 4));
  if (pkg.version < paletteAlphaVersion) for (let i = 3; i < colors.length; i += 4) colors[i] = opaque;
  if (!reader.atEnd) throw new ObjectError(`${path(pkg, ref)} has ${reader.remaining} unexpected bytes after its colors`, reader.offset);
  return colors;
}
