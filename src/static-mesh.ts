import { ArchiveError, Reader } from "@ritsuwastaken/farchive";
import { className, path, readProperties, type ObjectRef, type Package } from "@ritsuwastaken/upackage";
import { readVector } from "./archive.ts";
import { lineage2StaticMeshExtras, lineage2StaticMeshTails, staticMeshVersions } from "./constants.ts";
import { ObjectError } from "./error.ts";
import type { Box, StaticMesh, StaticMeshTriangle, UV } from "./types.ts";
import { lazyArray, relocateWith, type Offsets } from "./walk.ts";

interface Layout {
  lineage2: boolean;
  lazyCollision: boolean;
  extra: number;
  tail: boolean;
}

const standard: Layout = { lineage2: false, lazyCollision: false, extra: 0, tail: false };
const lineage2Layouts: Layout[] = lineage2StaticMeshTails.flatMap((tail) => [true, false].flatMap((lazyCollision) => lineage2StaticMeshExtras.map((extra) => ({ lineage2: true, lazyCollision, extra, tail }))));

const readBox = (r: Reader): Box => ({ min: readVector(r), max: readVector(r), valid: r.u8() !== 0 });
const readUV = (r: Reader): UV => ({ u: r.f32(), v: r.f32() });
const stream = <T>(r: Reader, read: (reader: Reader) => T) => {
  const items = r.array(read);
  r.i32();
  return items;
};

const readTriangle = (r: Reader): StaticMeshTriangle => {
  const vertices: StaticMeshTriangle["vertices"] = [readVector(r), readVector(r), readVector(r)];
  const uvs = Array.from({ length: r.i32() }, (): [UV, UV, UV] => [readUV(r), readUV(r), readUV(r)]);
  return { vertices, uvs, colors: [r.u32(), r.u32(), r.u32()], material: r.i32(), smoothingGroups: r.u32() };
};

const oldTriangle = (r: Reader) => {
  r.skip(64);
  for (let i = 0; i < 4; i++) r.index();
};

const oldNode = (r: Reader) => {
  for (let i = 0; i < 4; i++) r.index();
  r.skip(25);
};

const walkLayout = (pkg: Package, ref: ObjectRef, layout: Layout): { mesh: StaticMesh; offsets: Offsets } => {
  const data = pkg.exports[ref - 1]!.data;
  const r = new Reader(data, { offset: readProperties(pkg, data).end });
  const offsets: Offsets = { lazy: [] };
  r.skip(25 + 16);
  const sections = r.array((s) => ({ strip: s.i32() !== 0, firstIndex: s.u16(), minVertex: s.u16(), maxVertex: s.u16(), triangles: s.u16(), primitives: s.u16() }));
  const bounds = readBox(r);
  const vertices = stream(r, (v) => ({ position: readVector(v), normal: readVector(v) }));
  const colors = stream(r, (c) => c.u32());
  const alphas = stream(r, (c) => c.u32());
  const uvs = r.array((u) => {
    const coordinates = u.array(readUV);
    const index = u.i32();
    u.i32();
    return { coordinates, index };
  });
  const indices = stream(r, (i) => i.u16());
  const wireframe = stream(r, (i) => i.u16());
  const collisionModel = r.index();
  if (!layout.lineage2 && pkg.version >= staticMeshVersions.compressedCollision) {
    r.array((t) => {
      t.skip(6);
      t.index();
    });
    r.array((n) => n.skip(8 + 12));
    r.skip(12);
  } else if (layout.lazyCollision) {
    lazyArray(r, offsets, oldTriangle);
    lazyArray(r, offsets, oldNode);
  } else {
    r.array(oldTriangle);
    r.array(oldNode);
  }
  if (pkg.version < staticMeshVersions.collisionFlags) r.skip(12);
  r.skip(layout.extra);
  const triangles = lazyArray(r, offsets, readTriangle);
  r.i32();
  const physics = pkg.version >= staticMeshVersions.physics ? r.index() : 0;
  if (pkg.version >= staticMeshVersions.authentication) r.u32();
  if (layout.tail) {
    r.array((t) => t.skip(8));
    r.skip(16);
  }
  if (!r.atEnd) throw new ObjectError(`${path(pkg, ref)} has ${r.remaining} unexpected bytes at ${r.offset}`, r.offset);
  return { mesh: { ...(layout.lineage2 ? { lineage2: true } : {}), bounds, sections, vertices, colors, alphas, uvs, indices, wireframe, collisionModel, triangles, physics }, offsets };
};

const walkStaticMesh = (pkg: Package, ref: ObjectRef) => {
  if (ref <= 0 || className(pkg, ref) !== "StaticMesh") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a static mesh in this package`);
  if (pkg.version < staticMeshVersions.streams) throw new ObjectError(`${path(pkg, ref)} uses the static mesh layout from before version ${staticMeshVersions.streams}, which isn't supported`);
  let failure: unknown;
  for (const layout of pkg.licensee > 0 ? [standard, ...lineage2Layouts] : [standard]) {
    try {
      return walkLayout(pkg, ref, layout);
    } catch (error) {
      if (!(error instanceof ArchiveError)) throw error;
      failure ??= error;
    }
  }
  throw failure;
};

export function readStaticMesh(pkg: Package, ref: ObjectRef): StaticMesh {
  return walkStaticMesh(pkg, ref).mesh;
}

export const relocateStaticMesh = relocateWith((pkg, ref) => walkStaticMesh(pkg, ref).offsets);
