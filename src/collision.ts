import type { Package, Vector } from "@ritsuwastaken/upackage";
import { staticMeshVersions } from "./constants.ts";
import { ObjectError } from "./error.ts";
import type { Box, CollisionNode, CollisionTriangle, StaticMesh } from "./types.ts";

export interface CollisionOptions {
  materials?: boolean[];
  triangles?: CollisionTriangle[];
}

const Side = { Coplanar: 0, Front: 1, Back: 2, Split: 3 } as const;
const epsilon = 0.0001;
const compressedRange = 32766.5;
const axes = ["x", "y", "z"] as const;
type Plane = [number, number, number, number];
type Corners = [Vector, Vector, Vector];

const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vector, b: Vector): Vector => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
const safeNormal = (v: Vector): Vector => {
  const squared = dot(v, v);
  const scale = squared < 1e-8 ? 0 : 1 / Math.sqrt(squared);
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
};
const plane = (point: Vector, normal: Vector): Plane => [normal.x, normal.y, normal.z, dot(point, normal)];

const classify = ([x, y, z, w]: Plane, vertices: Corners) => {
  let side: number = Side.Coplanar;
  for (const v of vertices) {
    const distance = x * v.x + y * v.y + z * v.z - w;
    if (distance < -epsilon) side |= Side.Back;
    else if (distance >= epsilon) side |= Side.Front;
  }
  return side;
};

const emptyBox = (): Box => ({ min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity }, valid: false });
const grow = (box: Box, point: Vector) => {
  for (const axis of axes) {
    box.min[axis] = Math.min(box.min[axis], point[axis]);
    box.max[axis] = Math.max(box.max[axis], point[axis]);
  }
  box.valid = true;
};
const merge = (box: Box, other: Box) => {
  if (!other.valid) return;
  grow(box, other.min);
  grow(box, other.max);
};

const meshTriangles = (mesh: StaticMesh, materials: boolean[] | undefined) => {
  const triangles: CollisionTriangle[] = [];
  mesh.sections.forEach((section, material) => {
    if (materials?.[material] === false) return;
    if (!Number.isInteger(section.firstIndex) || section.firstIndex < 0 || !Number.isInteger(section.primitives) || section.primitives < 0) {
      throw new ObjectError(`Invalid index range in static mesh section ${material}`);
    }
    const count = section.primitives;
    const end = section.firstIndex + (section.strip ? (count ? count + 2 : 0) : count * 3);
    if (end > mesh.indices.length) throw new ObjectError(`Static mesh section ${material} exceeds the index buffer`);
    for (let i = 0; i < count; i++) {
      const at = section.firstIndex + (section.strip ? i : i * 3);
      const vertices: [number, number, number] = [mesh.indices[at], mesh.indices[at + 1], mesh.indices[at + 2]];
      if (section.strip && (i & 1)) [vertices[0], vertices[1]] = [vertices[1], vertices[0]];
      triangles.push({ vertices, material });
    }
  });
  return triangles;
};

export function buildCollision(pkg: Package, mesh: StaticMesh, options: CollisionOptions = {}): StaticMesh["collision"] {
  if (pkg.version < staticMeshVersions.streams) throw new ObjectError(`Static mesh collision before version ${staticMeshVersions.streams} isn't supported`);
  const compressed = !mesh.extra && pkg.version >= staticMeshVersions.compressedCollision;
  const none = compressed ? 0xffff : -1;
  const triangles: CollisionTriangle[] = [];
  const corners: Corners[] = [];
  const planes: Plane[] = [];
  const meshBox = emptyBox();
  const positions = mesh.vertices.map(({ position }, i) => {
    const point = { x: Math.fround(position.x), y: Math.fround(position.y), z: Math.fround(position.z) };
    if (axes.some((axis) => !Number.isFinite(point[axis]))) throw new ObjectError(`Static mesh vertex ${i} has a non-finite position`);
    grow(meshBox, point);
    return point;
  });
  for (const source of options.triangles ?? meshTriangles(mesh, options.materials)) {
    if (source.vertices.length !== 3 || source.vertices.some((index) => !Number.isInteger(index) || index < 0 || index >= positions.length || (compressed && index > 0xffff))) {
      throw new ObjectError("Collision triangle has an invalid vertex index");
    }
    if (!Number.isInteger(source.material) || source.material < 0 || source.material > 0x7fffffff) throw new ObjectError("Collision triangle has an invalid material index");
    const vertices: [number, number, number] = [...source.vertices];
    const points = vertices.map((index) => positions[index]) as Corners;
    const [a, b, c] = points;
    const normal = safeNormal(cross(sub(b, c), sub(a, c)));
    if (dot(normal, normal) === 0) continue;
    const surface = plane(a, normal);
    const triangle: CollisionTriangle = { vertices, material: source.material };
    if (!compressed) {
      const side = (a: Vector, b: Vector) => plane(a, safeNormal(cross(normal, sub(b, a))));
      triangle.planes = [surface, side(a, b), side(b, c), side(c, a)].flat().map(Math.fround);
    }
    triangles.push(triangle);
    corners.push(points);
    planes.push(surface);
  }
  if (compressed && triangles.length > none) throw new ObjectError("Compressed collision supports at most 65535 triangles");

  const nodes: CollisionNode[] = [];
  type Task = { indices: number[]; parent?: CollisionNode; slot?: "coplanar" | 0 | 1 };
  const tasks: Task[] = [{ indices: triangles.map((_, i) => i) }];
  const attach = (task: Task, index: number) => {
    if (!task.parent) return;
    if (task.slot === "coplanar") task.parent.coplanar = index;
    else task.parent.children[task.slot!] = index;
  };
  const addNode = (triangle: number) => {
    if (compressed && nodes.length >= none) throw new ObjectError("Compressed collision BSP exceeds 65535 nodes");
    const node: CollisionNode = { triangle, coplanar: none, children: [none, none] };
    nodes.push(node);
    return node;
  };
  while (tasks.length) {
    const task = tasks.pop()!;
    const { indices } = task;
    if (!indices.length) continue;
    let best = indices[0];
    let bestScore = Infinity;
    let bestBalance = Infinity;
    const step = Math.max(1, Math.floor(indices.length / 60));
    for (let at = 0; at < indices.length; at += step) {
      const splitter = indices[at];
      let front = 0, back = 0, coplanar = 0;
      for (const index of indices) {
        const side = index === splitter ? Side.Coplanar : classify(planes[splitter], corners[index]);
        if (side & Side.Front) front++;
        if (side & Side.Back) back++;
        if (side === Side.Coplanar) coplanar++;
      }
      const score = front + back + coplanar;
      const balance = Math.abs(front - back);
      if (score < bestScore || (score === bestScore && balance < bestBalance)) {
        best = splitter;
        bestScore = score;
        bestBalance = balance;
      }
      if (score === indices.length && balance === 0) break;
    }
    attach(task, nodes.length);
    const node = addNode(best);
    const back: number[] = [], front: number[] = [], coplanar: number[] = [];
    for (const index of indices) {
      if (index === best) continue;
      const side = classify(planes[best], corners[index]);
      if (side & Side.Front) front.push(index);
      if (side & Side.Back) back.push(index);
      if (side === Side.Coplanar) coplanar.push(index);
    }
    const surface = planes[best];
    if (!back.length && !front.length && coplanar.every((i) => planes[i].every((v, k) => v === surface[k]) || planes[i].every((v, k) => v === -surface[k]))) {
      let previous = node;
      for (const index of coplanar) {
        previous.coplanar = nodes.length;
        previous = addNode(index);
      }
    } else {
      tasks.push({ indices: coplanar, parent: node, slot: "coplanar" }, { indices: front, parent: node, slot: 1 }, { indices: back, parent: node, slot: 0 });
    }
  }

  const scale: Vector = { x: 1, y: 1, z: 1 };
  const inverse: Vector = { x: 1, y: 1, z: 1 };
  if (compressed && meshBox.valid) {
    for (const axis of axes) {
      const extent = Math.max(Math.abs(meshBox.min[axis]), Math.abs(meshBox.max[axis]));
      scale[axis] = extent ? Math.fround(extent / compressedRange) : 1;
      inverse[axis] = extent ? compressedRange / extent : 1;
      if (scale[axis] === 0) throw new ObjectError("Static mesh is too small for compressed collision bounds");
    }
  }
  const boxes: Box[] = new Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const box = emptyBox();
    for (const point of corners[node.triangle]) grow(box, point);
    for (const child of [...node.children, node.coplanar]) if (child !== none) merge(box, boxes[child]);
    boxes[i] = box;
    if (compressed) {
      node.bounds = [box.min, box.max].flatMap((point) => axes.map((axis) => Math.max(-32768, Math.min(32767, Math.round(point[axis] * inverse[axis]))) || 0));
    } else node.box = box;
  }
  return compressed ? { triangles, nodes, scale } : { triangles, nodes, ...(mesh.collision.lazy ? { lazy: true } : {}) };
}
