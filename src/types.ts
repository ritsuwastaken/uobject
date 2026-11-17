import type { ObjectRef, Rotator, Vector } from "@ritsuwastaken/upackage";
import type { textureFormats } from "./constants.ts";

export type TextureFormat = (typeof textureFormats)[number];

export interface Mip {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Texture {
  format: TextureFormat;
  width: number;
  height: number;
  palette: ObjectRef;
  mips: Mip[];
}

export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface AnimBone {
  name: string;
  flags: number;
  parent: number;
}

export interface AnimTrack {
  flags: number;
  rotations: Quat[];
  positions: Vector[];
  times: number[];
}

export interface Motion {
  rootSpeed: Vector;
  trackTime: number;
  startBone: number;
  version: number;
  boneIndices: number[];
  tracks: AnimTrack[];
  root: AnimTrack;
}

export interface AnimNotify {
  time: number;
  function: string;
  object: ObjectRef;
  text?: string;
}

export interface AnimSequence {
  bookmark: number;
  name: string;
  groups: string[];
  startFrame: number;
  frames: number;
  notifies: AnimNotify[];
  rate: number;
  extra?: Uint8Array;
}

export interface MeshAnimation {
  version: number;
  bones: AnimBone[];
  motions: Motion[];
  sequences: AnimSequence[];
}


export interface Box {
  min: Vector;
  max: Vector;
  valid: boolean;
}

export interface Sphere {
  center: Vector;
  radius: number;
}

export interface UV {
  u: number;
  v: number;
}

export interface MeshBone {
  name: string;
  flags: number;
  orientation: Quat;
  position: Vector;
  length: number;
  size: Vector;
  children: number;
  parent: number;
}

export interface MeshWedge {
  vertex: number;
  u: number;
  v: number;
}

export interface MeshFace {
  wedges: [number, number, number];
  material: number;
}

export interface Influence {
  weight: number;
  vertex: number;
  bone: number;
}

export interface RawFace {
  wedges: [number, number, number];
  material: number;
  auxMaterial: number;
  smoothingGroups: number;
}

export interface MeshSection {
  material: number;
  firstIndex: number;
  minIndex: number;
  maxIndex: number;
  vertices: number;
  maxInfluences: number;
  shader: number;
  firstFace: number;
  faces: number;
  bones?: number[];
}

export interface SkinPoint {
  point: Vector;
  normal: number;
}

export interface SkinVertex {
  position: Vector;
  normal: Vector;
  u: number;
  v: number;
}

export interface SkinnedWedge {
  point: Vector;
  normal: Vector;
  u: number;
  v: number;
  bones: [number, number, number, number];
  weights: [number, number, number, number];
}

export interface LodModel {
  skinningStream: number[];
  smoothVertices: SkinPoint[];
  smoothStreamWedges: number;
  smoothSections: MeshSection[];
  rigidSections: MeshSection[];
  smoothIndices: number[];
  rigidIndices: number[];
  rigidVertices: SkinVertex[];
  revisions: { smooth: number; rigid: number; stream: number };
  partial: number;
  streamCallback: number;
  influences: Influence[];
  wedges: MeshWedge[];
  faces: MeshFace[];
  points: Vector[];
  displayFactor: number;
  hysteresis: number;
  duplicateVertices: number;
  maxInfluences: number;
  uniqueSubset: number;
  smoothing: number;
  skinnedWedges?: { enabled: number; wedges: SkinnedWedge[] };
}

export interface Impostor {
  present: number;
  material: ObjectRef;
  location: Vector;
  rotation: Rotator;
  scale: Vector;
  color: number;
  spaceMode: number;
  drawMode: number;
  lightMode: number;
}

export interface Coords {
  origin: Vector;
  x: Vector;
  y: Vector;
  z: Vector;
}

export interface SkeletalMesh {
  bounds: Box;
  sphere: Sphere;
  version: number;
  modelVertices: number;
  vertices: number[] | Vector[];
  materials: ObjectRef[];
  scale: Vector;
  origin: Vector;
  rotation: Rotator;
  faceLevels: number[];
  lodFaces: MeshFace[];
  collapseWedges: number[];
  lodWedges: MeshWedge[];
  meshMaterials: { flags: number; material: number }[];
  lod: { scaleMax: number; hysteresis: number; strength: number; minVertices: number; morph: number; zDisplace: number };
  impostor?: Impostor;
  tesselation?: number;
  lodExtra?: Uint8Array;
  points: Vector[];
  bones: MeshBone[];
  defaultAnimation: ObjectRef;
  skeletalDepth: number;
  multiBlends: { points: number[]; weightBase: number }[];
  weights: { weight: number; bone: number }[];
  tagAliases: string[];
  tagNames: string[];
  tagCoords: Coords[];
  lods: LodModel[];
  defaultRefMesh: ObjectRef;
  raw: { points: Vector[]; wedges: MeshWedge[]; faces: RawFace[]; influences: Influence[]; collapseWedges: number[]; faceLevels: number[] };
  authenticationKey?: number;
  physics?: ObjectRef;
  collisionSpheres?: { bone: string; offset: Vector; radius: number }[];
  collisionBoxes?: { bone: string; offset: Vector; radii: Vector }[];
  collisionModels?: ObjectRef[];
  trailer?: { first?: number; floats?: number[]; last?: number };
}

export interface Sound {
  format: string;
  data: Uint8Array;
  extra: Uint8Array;
}

export interface StaticMeshSection {
  strip: number;
  firstIndex: number;
  minVertex: number;
  maxVertex: number;
  triangles: number;
  primitives: number;
}

export interface StaticMeshVertex {
  position: Vector;
  normal: Vector;
}

export interface UVStream {
  coordinates: UV[];
  index: number;
  revision: number;
}

export interface StaticMeshTriangle {
  vertices: [Vector, Vector, Vector];
  uvs: [UV, UV, UV][];
  colors: [number, number, number];
  material: number;
  smoothingGroups: number;
}

export interface CollisionTriangle {
  planes?: number[];
  vertices: [number, number, number];
  material: number;
}

export interface CollisionNode {
  triangle: number;
  coplanar: number;
  children: [number, number];
  box?: Box;
  bounds?: number[];
}

export interface StaticMesh {
  bounds: Box;
  sphere: Sphere;
  sections: StaticMeshSection[];
  meshBounds: Box;
  vertices: StaticMeshVertex[];
  colors: number[];
  alphas: number[];
  uvs: UVStream[];
  indices: number[];
  wireframe: number[];
  revisions: { vertices: number; colors: number; alphas: number; indices: number; wireframe: number };
  collisionModel: ObjectRef;
  collision: { triangles: CollisionTriangle[]; nodes: CollisionNode[]; scale?: Vector; lazy?: boolean };
  simpleCollision?: [number, number, number];
  extra?: Uint8Array;
  triangles: StaticMeshTriangle[];
  internalVersion: number;
  physics?: ObjectRef;
  authenticationKey?: number;
  trailer?: { coordinates: UV[]; extra: Uint8Array };
}
