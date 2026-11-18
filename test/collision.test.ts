import assert from "node:assert/strict";
import { test } from "node:test";
import { addName, build, parse, writeProperties, type Package, type Vector } from "@ritsuwastaken/upackage";
import { buildCollision, ObjectError, readStaticMesh, relocators, writeStaticMesh, type CollisionTriangle, type StaticMesh } from "../src/index.ts";

const fixture = (version = 129, alternate = false) => {
  const pkg: Package = { version, licensee: alternate ? 1 : 0, flags: 1, guid: new Uint8Array(16), generations: [], names: [], imports: [], exports: [], trailer: new Uint8Array() };
  addName(pkg, "None");
  const core = addName(pkg, "Core");
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Package"), outer: 0, name: addName(pkg, "Engine") });
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Class"), outer: -1, name: addName(pkg, "StaticMesh") });
  pkg.exports.push({ class: -2, super: 0, outer: 0, name: addName(pkg, "Collision"), flags: 0, data: writeProperties(pkg, []), offset: 0 });
  const box = { min: { x: -2, y: -2, z: 0 }, max: { x: 2, y: 2, z: 0 }, valid: true };
  const mesh: StaticMesh = {
    bounds: box, meshBounds: box, sphere: { center: { x: 0, y: 0, z: 0 }, radius: 3 },
    sections: [{ strip: 0, firstIndex: 0, minVertex: 0, maxVertex: 3, triangles: 2, primitives: 2 }],
    vertices: [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]].map(([x, y, z]) => ({ position: { x, y, z }, normal: { x: 0, y: 0, z: -1 } })),
    indices: [0, 1, 2, 0, 2, 3], colors: [], alphas: [], uvs: [], wireframe: [],
    revisions: { vertices: 1, colors: 1, alphas: 1, indices: 1, wireframe: 1 },
    collisionModel: 0, collision: { triangles: [], nodes: [] }, triangles: [], internalVersion: 9, physics: 0,
    ...(version >= 120 ? { authenticationKey: 0 } : {}),
    ...(version < 114 ? { simpleCollision: [0, 0, 0] as [number, number, number] } : {}),
    ...(alternate ? { extra: new Uint8Array(42) } : {}),
  };
  return { pkg, mesh };
};

const append = (mesh: StaticMesh, points: number[][]): CollisionTriangle => {
  const first = mesh.vertices.length;
  for (const [x, y, z] of points) mesh.vertices.push({ position: { x, y, z }, normal: { x: 0, y: 0, z: 1 } });
  return { vertices: [first, first + 1, first + 2], material: 3 };
};

for (const [version, alternate] of [[112, false], [125, false], [126, false], [129, false], [129, true]] as const) {
  test(`builds and relocates collision for version ${version}, alternate ${alternate}`, () => {
    const { pkg, mesh } = fixture(version, alternate);
    if (alternate) mesh.collision.lazy = true;
    const before = structuredClone(mesh);
    const collision = buildCollision(pkg, mesh);
    assert.deepEqual(mesh, before, "builder leaves the input unchanged");
    assert.equal(collision.triangles.length, 2);
    assert.equal(collision.nodes.length, 2);
    const compressed = version >= 126 && !alternate;
    const none = compressed ? 65535 : -1;
    assert.deepEqual(collision.nodes.map((node) => [node.triangle, node.coplanar, ...node.children]), [[0, 1, none, none], [1, none, none, none]]);
    if (compressed) {
      assert.ok(collision.nodes[0].bounds!.some((value) => value < 0));
      assert.equal(collision.scale!.z, 1, "flat axes have a finite scale");
    } else {
      assert.equal(collision.triangles[0].planes!.length, 16);
      assert.deepEqual(collision.nodes[0].box, mesh.bounds);
      assert.equal(collision.lazy, alternate ? true : undefined);
    }
    mesh.collision = collision;
    pkg.exports[0].data = writeStaticMesh(pkg, 1, mesh);
    addName(pkg, "Move all native data and lazy arrays");
    const moved = parse(build(pkg, { relocators }));
    assert.deepEqual(readStaticMesh(moved, 1), mesh);
    assert.deepEqual(writeStaticMesh(moved, 1, mesh), moved.exports[0].data);
  });
}

test("uses primitive counts, strip winding and material filters", () => {
  const { pkg, mesh } = fixture();
  mesh.indices = [0, 1, 3, 2, 2, 0, 0, 1, 2];
  mesh.sections = [
    { strip: 1, firstIndex: 0, minVertex: 0, maxVertex: 3, triangles: 2, primitives: 4 },
    { strip: 0, firstIndex: 6, minVertex: 0, maxVertex: 2, triangles: 99, primitives: 1 },
  ];
  assert.deepEqual(buildCollision(pkg, mesh, { materials: [true, false] }).triangles, [
    { vertices: [0, 1, 3], material: 0 }, { vertices: [3, 1, 2], material: 0 },
  ]);
  assert.deepEqual(buildCollision(pkg, mesh, { materials: [false] }).triangles, [{ vertices: [0, 1, 2], material: 1 }]);
});

test("custom triangles override sections; stale planes are regenerated and degenerate faces removed", () => {
  const { pkg, mesh } = fixture(125);
  mesh.sections = [];
  const input: CollisionTriangle[] = [{ vertices: [0, 1, 2], material: 7, planes: [123] }, { vertices: [0, 0, 1], material: 0 }];
  const collision = buildCollision(pkg, mesh, { triangles: input, materials: [false] });
  assert.equal(collision.triangles.length, 1);
  const triangle = collision.triangles[0];
  assert.equal(triangle.material, 7);
  assert.deepEqual(triangle.planes!.slice(0, 4).map((v) => v || 0), [0, 0, -1, 0]);
  const centroid = { x: 2 / 3, y: -2 / 3, z: 0 };
  for (let i = 4; i < 16; i += 4) {
    const p = triangle.planes!;
    assert.ok(p[i] * centroid.x + p[i + 1] * centroid.y + p[i + 2] * centroid.z - p[i + 3] < 0, "edge planes face outward");
  }
  triangle.vertices[0] = 3;
  assert.equal(input[0].vertices[0], 0, "output does not alias triangle indices");
});

test("subtree bounds include distant coplanars and both sides of split triangles", () => {
  const { pkg, mesh } = fixture(125);
  const triangles: CollisionTriangle[] = [
    { vertices: [0, 1, 2], material: 0 },
    append(mesh, [[10, 10, 0], [11, 10, 0], [10, 11, 0]]),
    append(mesh, [[0, 0, -2], [1, 0, -2], [0, 1, -2]]),
    append(mesh, [[0, 0, 2], [1, 0, 2], [0, 1, 2]]),
    append(mesh, [[0, 0, -1], [1, 0, 1], [0, 1, 1]]),
  ];
  const collision = buildCollision(pkg, mesh, { triangles });
  assert.equal(new Set(collision.nodes.map((n) => n.triangle)).size, triangles.length);
  assert.ok(collision.nodes.length > triangles.length, "straddling faces occur in both subtrees");
  assert.deepEqual(collision.nodes[0].box, { min: { x: -2, y: -2, z: -2 }, max: { x: 11, y: 11, z: 2 }, valid: true });
  for (const node of collision.nodes) {
    for (const child of [...node.children, node.coplanar].filter((i) => i !== -1)) {
      for (const axis of ["x", "y", "z"] as const) {
        assert.ok(node.box!.min[axis] <= collision.nodes[child].box!.min[axis]);
        assert.ok(node.box!.max[axis] >= collision.nodes[child].box!.max[axis]);
      }
    }
  }
});

test("handles empty collision, excluded sections and zero-sized meshes", () => {
  const { pkg, mesh } = fixture();
  for (const options of [{ triangles: [] }, { materials: [false] }]) {
    const result = buildCollision(pkg, mesh, options);
    assert.deepEqual(result.triangles, []);
    assert.deepEqual(result.nodes, []);
    assert.ok(Object.values(result.scale!).every(Number.isFinite));
  }
  mesh.vertices = [];
  mesh.sections = [];
  assert.deepEqual(buildCollision(pkg, mesh), { triangles: [], nodes: [], scale: { x: 1, y: 1, z: 1 } });
});

test("rejects invalid geometry with ObjectError", () => {
  const { pkg, mesh } = fixture();
  for (const vertices of [[0, 1, 4], [-1, 1, 2], [0, 0.5, 2], [0, NaN, 2]]) {
    assert.throws(() => buildCollision(pkg, mesh, { triangles: [{ vertices: vertices as [number, number, number], material: 0 }] }), ObjectError);
  }
  assert.throws(() => buildCollision(pkg, mesh, { triangles: [{ vertices: [0, 1, 2], material: -1 }] }), ObjectError);
  mesh.sections[0].firstIndex = 2;
  assert.throws(() => buildCollision(pkg, mesh), ObjectError);
  mesh.vertices[0].position.x = Infinity;
  assert.throws(() => buildCollision(pkg, mesh, { triangles: [] }), ObjectError);
  assert.throws(() => buildCollision({ ...pkg, version: 111 }, mesh), ObjectError);
});

test("builds a deep coplanar chain without recursion and enforces compressed limits", () => {
  const { pkg, mesh } = fixture();
  const triangle: CollisionTriangle = { vertices: [0, 1, 2], material: 0 };
  const triangles = Array.from({ length: 65535 }, () => triangle);
  const collision = buildCollision(pkg, mesh, { triangles });
  assert.equal(collision.nodes.length, 65535);
  assert.equal(collision.nodes[65534].coplanar, 65535);
  assert.throws(() => buildCollision(pkg, mesh, { triangles: [...triangles, triangle] }), ObjectError);
  const split = append(mesh, [[0, 0, -1], [1, 0, 1], [0, 1, 1]]);
  assert.throws(() => buildCollision(pkg, mesh, { triangles: [...triangles.slice(0, -1), split] }), /65535 nodes/);
});

test("BSP segment queries agree with brute-force triangle intersections", () => {
  const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const cross = (a: Vector, b: Vector): Vector => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
  let seed = 42;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000) * 20 - 10;
  for (const version of [125, 129]) {
    const { pkg, mesh } = fixture(version);
    const triangles = Array.from({ length: 30 }, () => append(mesh, Array.from({ length: 3 }, () => [random(), random(), random()])));
    const collision = buildCollision(pkg, mesh, { triangles });
    const points = collision.triangles.map((t) => t.vertices.map((i) => mesh.vertices[i].position));
    for (let ray = 0; ray < 200; ray++) {
      const start = { x: random(), y: random(), z: random() };
      const end = { x: random(), y: random(), z: random() };
      const direction = sub(end, start);
      const intersect = (index: number) => {
        const [a, b, c] = points[index];
        const edge1 = sub(b, a), edge2 = sub(c, a);
        const h = cross(direction, edge2), determinant = dot(edge1, h);
        if (Math.abs(determinant) < 1e-10) return Infinity;
        const s = sub(start, a), u = dot(s, h) / determinant;
        if (u < 0 || u > 1) return Infinity;
        const q = cross(s, edge1), v = dot(direction, q) / determinant;
        if (v < 0 || u + v > 1) return Infinity;
        const time = dot(edge2, q) / determinant;
        return time >= 0 && time <= 1 ? time : Infinity;
      };
      const expected = Math.min(...points.map((_, i) => intersect(i)));
      let actual = Infinity;
      const pending = [0];
      while (pending.length) {
        const index = pending.pop()!;
        if (index === (version >= 126 ? 65535 : -1)) continue;
        const node = collision.nodes[index];
        const min: Vector = node.box?.min ?? {
          x: node.bounds![0] * collision.scale!.x,
          y: node.bounds![1] * collision.scale!.y,
          z: node.bounds![2] * collision.scale!.z,
        };
        const max: Vector = node.box?.max ?? {
          x: node.bounds![3] * collision.scale!.x,
          y: node.bounds![4] * collision.scale!.y,
          z: node.bounds![5] * collision.scale!.z,
        };
        if ((["x", "y", "z"] as const).some((axis) => {
          const tolerance = collision.scale?.[axis] ?? 1e-6;
          return Math.max(start[axis], end[axis]) < min[axis] - tolerance || Math.min(start[axis], end[axis]) > max[axis] + tolerance;
        })) continue;
        const [a, b, c] = points[node.triangle];
        const n = cross(sub(b, c), sub(a, c));
        const length = Math.sqrt(dot(n, n));
        const d0 = dot(n, sub(start, a)) / length, d1 = dot(n, sub(end, a)) / length;
        if (d0 < -0.0001 && d1 < -0.0001) pending.push(node.children[0]);
        else if (d0 > 0.0001 && d1 > 0.0001) pending.push(node.children[1]);
        else {
          actual = Math.min(actual, intersect(node.triangle));
          pending.push(...node.children, node.coplanar);
        }
      }
      assert.equal(actual, expected, `version ${version}, segment ${ray}`);
    }
  }
});
