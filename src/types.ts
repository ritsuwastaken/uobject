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
  lineage2?: boolean;
  version: number;
  bones: AnimBone[];
  motions: Motion[];
  sequences: AnimSequence[];
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
}

export interface LodModel {
  smoothSections: MeshSection[];
  rigidSections: MeshSection[];
  smoothIndices: number[];
  rigidIndices: number[];
  influences: Influence[];
  wedges: MeshWedge[];
  faces: MeshFace[];
  points: Vector[];
  displayFactor: number;
  hysteresis: number;
  maxInfluences: number;
}

export interface SkeletalMesh {
  lineage2?: boolean;
  version: number;
  materials: ObjectRef[];
  scale: Vector;
  origin: Vector;
  rotation: Rotator;
  points: Vector[];
  bones: MeshBone[];
  defaultAnimation: ObjectRef;
  attachments: { alias: string; bone: string }[];
  lods: LodModel[];
  raw: { points: Vector[]; wedges: MeshWedge[]; faces: RawFace[]; influences: Influence[] };
}

export interface Sound {
  format: string;
  data: Uint8Array;
  extra: Uint8Array;
}

export interface Box {
  min: Vector;
  max: Vector;
  valid: boolean;
}

export interface StaticMeshSection {
  strip: boolean;
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

export interface UV {
  u: number;
  v: number;
}

export interface UVStream {
  coordinates: UV[];
  index: number;
}

export interface StaticMeshTriangle {
  vertices: [Vector, Vector, Vector];
  uvs: [UV, UV, UV][];
  colors: [number, number, number];
  material: number;
  smoothingGroups: number;
}

export interface StaticMesh {
  lineage2?: boolean;
  bounds: Box;
  sections: StaticMeshSection[];
  vertices: StaticMeshVertex[];
  colors: number[];
  alphas: number[];
  uvs: UVStream[];
  indices: number[];
  wireframe: number[];
  collisionModel: ObjectRef;
  triangles: StaticMeshTriangle[];
  physics: ObjectRef;
}
