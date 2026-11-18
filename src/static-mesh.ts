import { ArchiveError, Reader, Writer } from "@ritsuwastaken/farchive";
import { className, path, readProperties, type ObjectRef, type Package } from "@ritsuwastaken/upackage";
import { array, box, bytes, i32, index, lazy, sphere, struct, tuple, u16, u32, uv, vector, type Codec, type Context } from "./codec.ts";
import { lineage2StaticMeshExtras, lineage2StaticMeshTails, staticMeshVersions } from "./constants.ts";
import { ObjectError } from "./error.ts";
import type { CollisionNode, CollisionTriangle, StaticMesh, StaticMeshSection, StaticMeshTriangle, UV, UVStream } from "./types.ts";
import { relocateWith, type Offsets } from "./walk.ts";

interface Layout {
  alternate: boolean;
  lazyCollision: boolean;
  extra: number;
  tail: boolean;
}

const standard: Layout = { alternate: false, lazyCollision: false, extra: 0, tail: false };
const alternates: Layout[] = lineage2StaticMeshTails.flatMap((tail) => [true, false].flatMap((lazyCollision) => lineage2StaticMeshExtras.map((extra) => ({ alternate: true, lazyCollision, extra, tail }))));

const section = struct<StaticMeshSection>([
  ["strip", i32],
  ["firstIndex", u16],
  ["minVertex", u16],
  ["maxVertex", u16],
  ["triangles", u16],
  ["primitives", u16],
]);

const uvStream = struct<UVStream>([
  ["coordinates", array(uv)],
  ["index", i32],
  ["revision", i32],
]);

const triangle: Codec<StaticMeshTriangle> = {
  read: (r, c) => {
    const vertices = tuple(vector, vector, vector).read(r, c);
    const uvs = Array.from({ length: r.i32() }, () => tuple(uv, uv, uv).read(r, c));
    return { vertices, uvs, colors: tuple(u32, u32, u32).read(r, c), material: r.i32(), smoothingGroups: r.u32() };
  },
  write: (w, t, c) => {
    tuple(vector, vector, vector).write(w, t.vertices, c);
    w.i32(t.uvs.length);
    for (const set of t.uvs) tuple<[UV, UV, UV]>(uv, uv, uv).write(w, set, c);
    tuple(u32, u32, u32).write(w, t.colors, c);
    w.i32(t.material);
    w.u32(t.smoothingGroups);
  },
};

const compressedTriangle = struct<CollisionTriangle>([
  ["vertices", tuple(u16, u16, u16)],
  ["material", index],
]);

const fixedBounds: Codec<number[]> = { read: (r) => Array.from({ length: 6 }, () => r.i16()), write: (w, v) => v.forEach((value) => w.i16(value)) };

const compressedNode = struct<CollisionNode>([
  ["triangle", u16],
  ["coplanar", u16],
  ["children", tuple(u16, u16)],
  ["bounds", fixedBounds],
]);

const planes: Codec<number[]> = { read: (r) => Array.from({ length: 16 }, () => r.f32()), write: (w, v) => v.forEach((value) => w.f32(value)) };

const oldTriangle = struct<CollisionTriangle>([
  ["planes", planes],
  ["vertices", tuple(index, index, index)],
  ["material", index],
]);

const oldNode = struct<CollisionNode>([
  ["triangle", index],
  ["coplanar", index],
  ["children", tuple(index, index)],
  ["box", box],
]);

const collision = (layout: Layout): Codec<StaticMesh["collision"]> => {
  const compressed = (c: Context) => !layout.alternate && c.pkg.version >= staticMeshVersions.compressedCollision;
  const list = <T>(codec: Codec<T>) => (layout.lazyCollision ? lazy(codec) : array(codec));
  return {
    read: (r, c) => {
      if (compressed(c)) return { triangles: array(compressedTriangle).read(r, c), nodes: array(compressedNode).read(r, c), scale: vector.read(r, c) };
      const value: StaticMesh["collision"] = { triangles: list(oldTriangle).read(r, c), nodes: list(oldNode).read(r, c) };
      if (layout.lazyCollision) value.lazy = true;
      return value;
    },
    write: (w, v, c) => {
      if (compressed(c)) {
        array(compressedTriangle).write(w, v.triangles, c);
        array(compressedNode).write(w, v.nodes, c);
        vector.write(w, v.scale ?? { x: 1, y: 1, z: 1 }, c);
      } else {
        list(oldTriangle).write(w, v.triangles, c);
        list(oldNode).write(w, v.nodes, c);
      }
    },
  };
};

const streamed = <T>(codec: Codec<T>): Codec<{ items: T[]; revision: number }> => struct<{ items: T[]; revision: number }>([
  ["items", array(codec)],
  ["revision", i32],
]);

const staticMesh = (layout: Layout): Codec<StaticMesh> => ({
  read: (r, c) => {
    const bounds = box.read(r, c);
    const sphere_ = sphere.read(r, c);
    const sections = array(section).read(r, c);
    const meshBounds = box.read(r, c);
    const vertices = streamed(struct<StaticMesh["vertices"][number]>([["position", vector], ["normal", vector]])).read(r, c);
    const colors = streamed(u32).read(r, c);
    const alphas = streamed(u32).read(r, c);
    const uvs = array(uvStream).read(r, c);
    const indices = streamed(u16).read(r, c);
    const wireframe = streamed(u16).read(r, c);
    const mesh: StaticMesh = {
      bounds,
      sphere: sphere_,
      sections,
      meshBounds,
      vertices: vertices.items,
      colors: colors.items,
      alphas: alphas.items,
      uvs,
      indices: indices.items,
      wireframe: wireframe.items,
      revisions: { vertices: vertices.revision, colors: colors.revision, alphas: alphas.revision, indices: indices.revision, wireframe: wireframe.revision },
      collisionModel: r.index(),
      collision: collision(layout).read(r, c),
      triangles: [],
      internalVersion: 0,
    };
    if (c.pkg.version < staticMeshVersions.collisionFlags) mesh.simpleCollision = tuple(i32, i32, i32).read(r, c);
    const extra = bytes(layout.extra).read(r, c);
    mesh.triangles = lazy(triangle).read(r, c);
    mesh.internalVersion = r.i32();
    if (c.pkg.version >= staticMeshVersions.physics) mesh.physics = r.index();
    if (c.pkg.version >= staticMeshVersions.authentication) mesh.authenticationKey = r.u32();
    if (layout.alternate) {
      mesh.extra = extra;
      if (layout.tail) mesh.trailer = { coordinates: array(uv).read(r, c), extra: bytes(16).read(r, c) };
    }
    return mesh;
  },
  write: (w, m, c) => {
    box.write(w, m.bounds, c);
    sphere.write(w, m.sphere, c);
    array(section).write(w, m.sections, c);
    box.write(w, m.meshBounds, c);
    streamed(struct<StaticMesh["vertices"][number]>([["position", vector], ["normal", vector]])).write(w, { items: m.vertices, revision: m.revisions.vertices }, c);
    streamed(u32).write(w, { items: m.colors, revision: m.revisions.colors }, c);
    streamed(u32).write(w, { items: m.alphas, revision: m.revisions.alphas }, c);
    array(uvStream).write(w, m.uvs, c);
    streamed(u16).write(w, { items: m.indices, revision: m.revisions.indices }, c);
    streamed(u16).write(w, { items: m.wireframe, revision: m.revisions.wireframe }, c);
    w.index(m.collisionModel);
    collision(layout).write(w, m.collision, c);
    if (c.pkg.version < staticMeshVersions.collisionFlags) tuple(i32, i32, i32).write(w, m.simpleCollision ?? [0, 0, 0], c);
    w.bytes(m.extra ?? new Uint8Array());
    lazy(triangle).write(w, m.triangles, c);
    w.i32(m.internalVersion);
    if (c.pkg.version >= staticMeshVersions.physics) w.index(m.physics ?? 0);
    if (c.pkg.version >= staticMeshVersions.authentication) w.u32(m.authenticationKey ?? 0);
    if (m.trailer) {
      array(uv).write(w, m.trailer.coordinates, c);
      bytes(16).write(w, m.trailer.extra, c);
    }
  },
});

const check = (pkg: Package, ref: ObjectRef) => {
  if (ref <= 0 || className(pkg, ref) !== "StaticMesh") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a static mesh in this package`);
  if (pkg.version < staticMeshVersions.streams) throw new ObjectError(`${path(pkg, ref)} uses the static mesh layout from before version ${staticMeshVersions.streams}, which isn't supported`);
  return pkg.exports[ref - 1]!;
};

const readLayout = (pkg: Package, ref: ObjectRef, layout: Layout): { mesh: StaticMesh; offsets: Offsets } => {
  const { data, offset } = pkg.exports[ref - 1]!;
  const r = new Reader(data, { offset: readProperties(pkg, data).end });
  const c: Context = { pkg, offsets: { lazy: [] }, base: offset ?? 0, alternate: layout.alternate };
  const mesh = staticMesh(layout).read(r, c);
  if (!r.atEnd) throw new ObjectError(`${path(pkg, ref)} has ${r.remaining} unexpected bytes at ${r.offset}`, r.offset);
  return { mesh, offsets: c.offsets };
};

const walkStaticMesh = (pkg: Package, ref: ObjectRef) => {
  check(pkg, ref);
  let failure: unknown;
  for (const layout of pkg.licensee > 0 ? [standard, ...alternates] : [standard]) {
    try {
      return readLayout(pkg, ref, layout);
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

export function writeStaticMesh(pkg: Package, ref: ObjectRef, mesh: StaticMesh): Uint8Array {
  const entry = check(pkg, ref);
  if (entry.offset === undefined) throw new ObjectError(`${path(pkg, ref)} has no file offset; set its offset to 0 for a new export`);
  const layout: Layout = mesh.extra ? { alternate: true, lazyCollision: mesh.collision.lazy === true, extra: mesh.extra.length, tail: mesh.trailer !== undefined } : standard;
  const w = new Writer();
  w.bytes(entry.data.subarray(0, readProperties(pkg, entry.data).end));
  staticMesh(layout).write(w, mesh, { pkg, offsets: { lazy: [] }, base: entry.offset, alternate: layout.alternate });
  return w.result();
}

export const relocateStaticMesh = relocateWith((pkg, ref) => walkStaticMesh(pkg, ref).offsets);
