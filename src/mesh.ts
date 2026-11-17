import { ArchiveError, Reader } from "@ritsuwastaken/farchive";
import { className, path, readProperties, type ObjectRef, type Package, type Vector } from "@ritsuwastaken/upackage";
import { readName, readQuat, readVector } from "./archive.ts";
import { lineage2, lodMeshVersions, meshVersions } from "./constants.ts";
import { ObjectError } from "./error.ts";
import { lazyArray, relocateWith, type Offsets } from "./walk.ts";
import type { Influence, LodModel, MeshFace, MeshSection, MeshWedge, RawFace, SkeletalMesh } from "./types.ts";

interface Walk extends Offsets {
  reader: Reader;
  l2: boolean;
  licensee: number;
}

const lazy = <T>(walk: Walk, read: (reader: Reader) => T) => lazyArray(walk.reader, walk, read);

const words = (reader: Reader) => reader.array((r) => r.u16());
const skip = (reader: Reader, size: number) => reader.array((r) => r.skip(size));
const wedge = (r: Reader): MeshWedge => ({ vertex: r.u16(), u: r.f32(), v: r.f32() });
const face = (r: Reader): MeshFace => ({ wedges: [r.u16(), r.u16(), r.u16()], material: r.u16() });
const influence = (r: Reader): Influence => ({ weight: r.f32(), vertex: r.u16(), bone: r.u16() });
const rawFace = (r: Reader): RawFace => ({ wedges: [r.u16(), r.u16(), r.u16()], material: r.u8(), auxMaterial: r.u8(), smoothingGroups: r.u32() });
const section = (walk: Walk) => (r: Reader): MeshSection => {
  const result = { material: r.u16(), firstIndex: r.u16(), minIndex: r.u16(), maxIndex: r.u16(), vertices: r.u16(), maxInfluences: r.u16(), shader: r.u16(), firstFace: r.u16(), faces: r.u16() };
  if (walk.l2 && walk.licensee >= lineage2.newWedges) skip(r, 4);
  return result;
};
const indexBuffer = (r: Reader) => {
  const indices = words(r);
  r.i32();
  return indices;
};

const lodModel = (walk: Walk): LodModel => {
  const r = walk.reader;
  skip(r, 4);
  skip(r, 16);
  r.i32();
  const smoothSections = r.array(section(walk));
  const rigidSections = r.array(section(walk));
  const smoothIndices = indexBuffer(r);
  const rigidIndices = indexBuffer(r);
  r.i32();
  r.i32();
  r.i32();
  skip(r, 32);
  const influences = lazy(walk, influence);
  const wedges = lazy(walk, wedge);
  const faces = lazy(walk, face);
  const points = lazy(walk, readVector);
  const displayFactor = r.f32();
  const hysteresis = r.f32();
  r.i32();
  const maxInfluences = r.i32();
  r.i32();
  r.i32();
  if (walk.l2 && walk.licensee >= lineage2.newWedges) {
    r.i32();
    skip(r, 12 + 12 + 8 + 4 + 16);
  }
  return { smoothSections, rigidSections, smoothIndices, rigidIndices, influences, wedges, faces, points, displayFactor, hysteresis, maxInfluences };
};

const walkLayout = (pkg: Package, ref: ObjectRef, l2: boolean): { mesh: SkeletalMesh; walk: Walk } => {
  const data = pkg.exports[ref - 1]!.data;
  const r = new Reader(data, { offset: readProperties(pkg, data).end });
  const walk: Walk = { reader: r, l2, licensee: pkg.licensee, lazy: [] };
  r.skip(25 + 16);
  const version = r.i32();
  r.i32();
  skip(r, l2 && pkg.version >= lineage2.vectorVerts ? 12 : 4);
  if (version < lodMeshVersions.legacy) skip(r, 3 * 2 + 3 * 8 + 4 + 4);
  const materials = r.array((m) => m.index());
  const scale = readVector(r);
  const origin = readVector(r);
  const rotation = { pitch: r.i32(), yaw: r.i32(), roll: r.i32() };
  if (version < lodMeshVersions.legacy) words(r);
  words(r);
  r.array(face);
  words(r);
  r.array(wedge);
  skip(r, 8);
  r.skip(4 * 6);
  if (version >= lodMeshVersions.impostor) {
    r.i32();
    r.index();
    r.skip(12 + 12 + 12 + 4 + 4 * 3);
  }
  if (version >= lodMeshVersions.tesselation) r.f32();
  if (l2 && version >= lineage2.lodExtra) r.skip(version >= lineage2.lodExtraByte ? 5 : 4);
  const points: Vector[] = r.array(readVector);
  const bones = r.array((b) => ({ name: readName(pkg, b), flags: b.u32(), orientation: readQuat(b), position: readVector(b), length: b.f32(), size: readVector(b), children: b.i32(), parent: b.i32() }));
  const defaultAnimation = r.index();
  r.i32();
  r.array((w) => {
    words(w);
    w.i32();
  });
  skip(r, 4);
  const aliases = r.array((n) => readName(pkg, n));
  const names = r.array((n) => readName(pkg, n));
  skip(r, 48);
  if (version < lodMeshVersions.legacy) {
    skip(r, 0);
    skip(r, 0);
    words(r);
  }
  const lods: LodModel[] = [];
  const raw: SkeletalMesh["raw"] = { points: [], wedges: [], faces: [], influences: [] };
  if (version >= lodMeshVersions.legacy) {
    lods.push(...r.array(() => lodModel(walk)));
    r.index();
    raw.points = lazy(walk, readVector);
    raw.wedges = lazy(walk, wedge);
    raw.faces = lazy(walk, rawFace);
    raw.influences = lazy(walk, influence);
    lazy(walk, (w) => w.u16());
    lazy(walk, (w) => w.u16());
  }
  if (l2) {
    if (pkg.version >= 118 && pkg.licensee >= lineage2.meshExtra) r.i32();
    if (pkg.version >= 123 && pkg.licensee >= lineage2.meshWeights) skip(r, 4);
    if (pkg.version >= meshVersions.authentication) r.u32();
    if (pkg.licensee >= lineage2.meshTail) r.i32();
  } else if (pkg.version >= meshVersions.authentication) r.u32();
  if (!l2 && pkg.version >= meshVersions.collision) {
    r.index();
    r.array((s) => {
      readName(pkg, s);
      s.skip(12 + 4);
    });
    r.array((b) => {
      readName(pkg, b);
      b.skip(12 + 12);
    });
  }
  if (!l2 && pkg.version >= meshVersions.collisionModels) r.array((m) => m.index());
  if (!r.atEnd) throw new ObjectError(`${path(pkg, ref)} has ${r.remaining} unexpected bytes at ${r.offset}`, r.offset);
  const attachments = aliases.map((alias, i) => ({ alias, bone: names[i] ?? "" }));
  return { mesh: { ...(l2 ? { lineage2: true } : {}), version, materials, scale, origin, rotation, points, bones, defaultAnimation, attachments, lods, raw }, walk };
};

const walkMesh = (pkg: Package, ref: ObjectRef) => {
  if (ref <= 0 || className(pkg, ref) !== "SkeletalMesh") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a skeletal mesh in this package`);
  try {
    return walkLayout(pkg, ref, false);
  } catch (error) {
    if (pkg.licensee === 0 || !(error instanceof ArchiveError)) throw error;
    return walkLayout(pkg, ref, true);
  }
};

export function readSkeletalMesh(pkg: Package, ref: ObjectRef): SkeletalMesh {
  return walkMesh(pkg, ref).mesh;
}

export const relocateSkeletalMesh = relocateWith((pkg, ref) => walkMesh(pkg, ref).walk);
