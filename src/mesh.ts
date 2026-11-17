import { ArchiveError, Reader, Writer } from "@ritsuwastaken/farchive";
import { className, path, readProperties, type ObjectRef, type Package, type Vector } from "@ritsuwastaken/upackage";
import { array, box, f32, i32, index, indexBuffer, lazy, name, quat, rotator, sphere, struct, tuple, u16, u32, u8, vector, type Codec, type Context, raw } from "./codec.ts";
import { lineage2, lodMeshVersions, meshVersions } from "./constants.ts";
import { ObjectError } from "./error.ts";
import type { Coords, Impostor, Influence, LodModel, MeshBone, MeshFace, MeshSection, MeshWedge, RawFace, SkeletalMesh, SkinnedWedge, SkinVertex } from "./types.ts";
import { relocateWith, type Offsets } from "./walk.ts";

const licensee = (c: Context) => c.pkg.licensee;
const newWedges = (c: Context) => c.alternate && licensee(c) >= lineage2.newWedges;

const wedge = struct<MeshWedge>([
  ["vertex", u16],
  ["u", f32],
  ["v", f32],
]);

const face = struct<MeshFace>([
  ["wedges", tuple(u16, u16, u16)],
  ["material", u16],
]);

const influence = struct<Influence>([
  ["weight", f32],
  ["vertex", u16],
  ["bone", u16],
]);

const rawFace = struct<RawFace>([
  ["wedges", tuple(u16, u16, u16)],
  ["material", u8],
  ["auxMaterial", u8],
  ["smoothingGroups", u32],
]);

const section = struct<MeshSection>([
  ["material", u16],
  ["firstIndex", u16],
  ["minIndex", u16],
  ["maxIndex", u16],
  ["vertices", u16],
  ["maxInfluences", u16],
  ["shader", u16],
  ["firstFace", u16],
  ["faces", u16],
  ["bones", array(i32), newWedges],
]);

const skinVertex = struct<SkinVertex>([
  ["position", vector],
  ["normal", vector],
  ["u", f32],
  ["v", f32],
]);

const skinnedWedge = struct<SkinnedWedge>([
  ["point", vector],
  ["normal", vector],
  ["u", f32],
  ["v", f32],
  ["bones", tuple(u8, u8, u8, u8)],
  ["weights", tuple(f32, f32, f32, f32)],
]);

const lodModel: Codec<LodModel> = {
  read: (r, c) => {
    const skinningStream = array(u32).read(r, c);
    const smoothVertices = array(struct<LodModel["smoothVertices"][number]>([["point", vector], ["normal", u32]])).read(r, c);
    const smoothStreamWedges = r.i32();
    const smoothSections = array(section).read(r, c);
    const rigidSections = array(section).read(r, c);
    const smooth = indexBuffer.read(r, c);
    const rigid = indexBuffer.read(r, c);
    const stream = r.i32();
    const partial = r.i32();
    const streamCallback = r.i32();
    const rigidVertices = array(skinVertex).read(r, c);
    const model: LodModel = {
      skinningStream,
      smoothVertices,
      smoothStreamWedges,
      smoothSections,
      rigidSections,
      smoothIndices: smooth.indices,
      rigidIndices: rigid.indices,
      rigidVertices,
      revisions: { smooth: smooth.revision, rigid: rigid.revision, stream },
      partial,
      streamCallback,
      influences: lazy(influence).read(r, c),
      wedges: lazy(wedge).read(r, c),
      faces: lazy(face).read(r, c),
      points: lazy(vector).read(r, c),
      displayFactor: r.f32(),
      hysteresis: r.f32(),
      duplicateVertices: r.i32(),
      maxInfluences: r.i32(),
      uniqueSubset: r.i32(),
      smoothing: r.i32(),
    };
    if (newWedges(c)) model.skinnedWedges = { enabled: r.i32(), wedges: array(skinnedWedge).read(r, c) };
    return model;
  },
  write: (w, m, c) => {
    array(u32).write(w, m.skinningStream, c);
    array(struct<LodModel["smoothVertices"][number]>([["point", vector], ["normal", u32]])).write(w, m.smoothVertices, c);
    w.i32(m.smoothStreamWedges);
    array(section).write(w, m.smoothSections, c);
    array(section).write(w, m.rigidSections, c);
    indexBuffer.write(w, { indices: m.smoothIndices, revision: m.revisions.smooth }, c);
    indexBuffer.write(w, { indices: m.rigidIndices, revision: m.revisions.rigid }, c);
    w.i32(m.revisions.stream);
    w.i32(m.partial);
    w.i32(m.streamCallback);
    array(skinVertex).write(w, m.rigidVertices, c);
    lazy(influence).write(w, m.influences, c);
    lazy(wedge).write(w, m.wedges, c);
    lazy(face).write(w, m.faces, c);
    lazy(vector).write(w, m.points, c);
    w.f32(m.displayFactor);
    w.f32(m.hysteresis);
    w.i32(m.duplicateVertices);
    w.i32(m.maxInfluences);
    w.i32(m.uniqueSubset);
    w.i32(m.smoothing);
    if (m.skinnedWedges) {
      w.i32(m.skinnedWedges.enabled);
      array(skinnedWedge).write(w, m.skinnedWedges.wedges, c);
    }
  },
};

const bone = struct<MeshBone>([
  ["name", name],
  ["flags", u32],
  ["orientation", quat],
  ["position", vector],
  ["length", f32],
  ["size", vector],
  ["children", i32],
  ["parent", i32],
]);

const impostor = struct<Impostor>([
  ["present", i32],
  ["material", index],
  ["location", vector],
  ["rotation", rotator],
  ["scale", vector],
  ["color", u32],
  ["spaceMode", i32],
  ["drawMode", i32],
  ["lightMode", i32],
]);

const coords = struct<Coords>([
  ["origin", vector],
  ["x", vector],
  ["y", vector],
  ["z", vector],
]);

const vectorVertices = (c: Context) => c.alternate && c.pkg.version >= lineage2.vectorVerts;
const standardTail = (c: Context) => !c.alternate;

const meshVertices: Codec<SkeletalMesh["vertices"]> = {
  read: (r, c) => (vectorVertices(c) ? array(vector).read(r, c) : array(u32).read(r, c)),
  write: (w, v, c) => (typeof v[0] === "object" ? array(vector).write(w, v as Vector[], c) : array(u32).write(w, v as number[], c)),
};

const skeletalMesh = struct<SkeletalMesh>([
  ["bounds", box],
  ["sphere", sphere],
  ["version", i32],
  ["modelVertices", i32],
  ["vertices", meshVertices],
  ["materials", array(index)],
  ["scale", vector],
  ["origin", vector],
  ["rotation", rotator],
  ["faceLevels", array(u16)],
  ["lodFaces", array(face)],
  ["collapseWedges", array(u16)],
  ["lodWedges", array(wedge)],
  ["meshMaterials", array(struct<{ flags: number; material: number }>([["flags", u32], ["material", i32]]))],
  ["lod", struct<SkeletalMesh["lod"]>([["scaleMax", f32], ["hysteresis", f32], ["strength", f32], ["minVertices", i32], ["morph", f32], ["zDisplace", f32]])],
  ["impostor", impostor, (_, m) => m.version! >= lodMeshVersions.impostor],
  ["tesselation", f32, (_, m) => m.version! >= lodMeshVersions.tesselation],
  ["lodExtra", (m) => raw(m.version! >= lineage2.lodExtraByte ? 5 : 4), (c, m) => c.alternate && m.version! >= lineage2.lodExtra],
  ["points", array(vector)],
  ["bones", array(bone)],
  ["defaultAnimation", index],
  ["skeletalDepth", i32],
  ["multiBlends", array(struct<SkeletalMesh["multiBlends"][number]>([["points", array(u16)], ["weightBase", i32]]))],
  ["weights", array(struct<SkeletalMesh["weights"][number]>([["weight", u16], ["bone", u16]]))],
  ["tagAliases", array(name)],
  ["tagNames", array(name)],
  ["tagCoords", array(coords)],
  ["lods", array(lodModel)],
  ["defaultRefMesh", index],
  ["raw", struct<SkeletalMesh["raw"]>([["points", lazy(vector)], ["wedges", lazy(wedge)], ["faces", lazy(rawFace)], ["influences", lazy(influence)], ["collapseWedges", lazy(u16)], ["faceLevels", lazy(u16)]])],
  ["authenticationKey", u32, (c) => standardTail(c) && c.pkg.version >= meshVersions.authentication],
  ["physics", index, (c) => standardTail(c) && c.pkg.version >= meshVersions.collision],
  ["collisionSpheres", array(struct<NonNullable<SkeletalMesh["collisionSpheres"]>[number]>([["bone", name], ["offset", vector], ["radius", f32]])), (c) => standardTail(c) && c.pkg.version >= meshVersions.collision],
  ["collisionBoxes", array(struct<NonNullable<SkeletalMesh["collisionBoxes"]>[number]>([["bone", name], ["offset", vector], ["radii", vector]])), (c) => standardTail(c) && c.pkg.version >= meshVersions.collision],
  ["collisionModels", array(index), (c) => standardTail(c) && c.pkg.version >= meshVersions.collisionModels],
]);

const trailer: Codec<NonNullable<SkeletalMesh["trailer"]> & { key?: number }> = {
  read: (r, c) => {
    const out: NonNullable<SkeletalMesh["trailer"]> & { key?: number } = {};
    if (c.pkg.version >= 118 && licensee(c) >= lineage2.meshExtra) out.first = r.i32();
    if (c.pkg.version >= 123 && licensee(c) >= lineage2.meshWeights) out.floats = array(f32).read(r, c);
    if (c.pkg.version >= meshVersions.authentication) out.key = r.u32();
    if (licensee(c) >= lineage2.meshTail) out.last = r.i32();
    return out;
  },
  write: (w, v, c) => {
    if (v.first !== undefined) w.i32(v.first);
    if (v.floats) array(f32).write(w, v.floats, c);
    if (c.pkg.version >= meshVersions.authentication) w.u32(v.key ?? 0);
    if (v.last !== undefined) w.i32(v.last);
  },
};

const check = (pkg: Package, ref: ObjectRef) => {
  if (ref <= 0 || className(pkg, ref) !== "SkeletalMesh") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a skeletal mesh in this package`);
  return pkg.exports[ref - 1]!;
};

const readLayout = (pkg: Package, ref: ObjectRef, l2: boolean): { mesh: SkeletalMesh; offsets: Offsets } => {
  const { data, offset } = pkg.exports[ref - 1]!;
  const r = new Reader(data, { offset: readProperties(pkg, data).end });
  const c: Context = { pkg, offsets: { lazy: [] }, base: offset ?? 0, alternate: l2 };
  const peek = new Reader(data, { offset: r.offset + 41 });
  if (peek.i32() < lodMeshVersions.legacy) throw new ObjectError(`${path(pkg, ref)} uses the mesh layout from before version ${lodMeshVersions.legacy}, which isn't supported`);
  const mesh = skeletalMesh.read(r, c);
  if (l2) {
    const { key, ...rest } = trailer.read(r, c);
    mesh.trailer = rest;
    if (key !== undefined) mesh.authenticationKey = key;
  }
  if (!r.atEnd) throw new ObjectError(`${path(pkg, ref)} has ${r.remaining} unexpected bytes at ${r.offset}`, r.offset);
  return { mesh, offsets: c.offsets };
};

const walkMesh = (pkg: Package, ref: ObjectRef) => {
  check(pkg, ref);
  try {
    return readLayout(pkg, ref, false);
  } catch (error) {
    if (pkg.licensee === 0 || !(error instanceof ArchiveError)) throw error;
    return readLayout(pkg, ref, true);
  }
};

export function readSkeletalMesh(pkg: Package, ref: ObjectRef): SkeletalMesh {
  return walkMesh(pkg, ref).mesh;
}

export function writeSkeletalMesh(pkg: Package, ref: ObjectRef, mesh: SkeletalMesh): Uint8Array {
  const entry = check(pkg, ref);
  if (entry.offset === undefined) throw new ObjectError(`${path(pkg, ref)} has no file offset; set its offset to 0 for a new export`);
  if (mesh.version < lodMeshVersions.legacy) throw new ObjectError(`Writing meshes from before version ${lodMeshVersions.legacy} isn't supported`);
  const w = new Writer();
  w.bytes(entry.data.subarray(0, readProperties(pkg, entry.data).end));
  const c: Context = { pkg, offsets: { lazy: [] }, base: entry.offset, alternate: mesh.trailer !== undefined };
  skeletalMesh.write(w, c.alternate ? { ...mesh, authenticationKey: undefined } : mesh, c);
  if (mesh.trailer) trailer.write(w, { ...mesh.trailer, key: mesh.authenticationKey }, c);
  return w.result();
}

export const relocateSkeletalMesh = relocateWith((pkg, ref) => walkMesh(pkg, ref).offsets);
