import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addName, build, className, parse, PackageError, path, writeProperties, type Package } from "@ritsuwastaken/upackage";
import { ObjectError, readStaticMesh, relocators, writeStaticMesh, type StaticMesh } from "../src/index.ts";

test("refuses objects that aren't static meshes", () => {
  const pkg: Package = { version: 129, licensee: 0, flags: 1, guid: new Uint8Array(16), generations: [], names: [], imports: [], exports: [], trailer: new Uint8Array() };
  addName(pkg, "None");
  assert.throws(() => readStaticMesh(pkg, 0), ObjectError);
});

test("writes a new static mesh and reads it back", () => {
  const pkg: Package = { version: 129, licensee: 0, flags: 1, guid: new Uint8Array(16), generations: [], names: [], imports: [], exports: [], trailer: new Uint8Array() };
  addName(pkg, "None");
  const core = addName(pkg, "Core");
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Package"), outer: 0, name: addName(pkg, "Engine") });
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Class"), outer: -1, name: addName(pkg, "StaticMesh") });
  pkg.exports.push({ class: -2, super: 0, outer: 0, name: addName(pkg, "Quad"), flags: 0, data: writeProperties(pkg, []), offset: 0 });
  const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 }, valid: true };
  const corner = (x: number, y: number) => ({ position: { x, y, z: 0 }, normal: { x: 0, y: 0, z: 1 } });
  const mesh: StaticMesh = {
    bounds: box,
    sphere: { center: { x: 0.5, y: 0.5, z: 0 }, radius: 0.75 },
    sections: [{ strip: 0, firstIndex: 0, minVertex: 0, maxVertex: 3, triangles: 2, primitives: 2 }],
    meshBounds: box,
    vertices: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)],
    colors: [],
    alphas: [],
    uvs: [{ coordinates: [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }], index: 0, revision: 1 }],
    indices: [0, 1, 2, 0, 2, 3],
    wireframe: [0, 1, 1, 2, 2, 3, 3, 0],
    revisions: { vertices: 1, colors: 1, alphas: 1, indices: 1, wireframe: 1 },
    collisionModel: 0,
    collision: { triangles: [{ vertices: [0, 1, 2], material: 0 }], nodes: [{ triangle: 0, coplanar: 65535, children: [65535, 65535], bounds: [0, 0, 0, 1, 1, 0] }], scale: { x: 1, y: 1, z: 1 } },
    triangles: [{ vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }], uvs: [[{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }]], colors: [0xffffffff, 0xffffffff, 0xffffffff], material: 0, smoothingGroups: 1 }],
    internalVersion: 9,
    physics: 0,
    authenticationKey: 0,
  };
  pkg.exports[0]!.data = writeStaticMesh(pkg, 1, mesh);
  assert.deepEqual(readStaticMesh(parse(build(pkg, { relocators })), 1), mesh);
});

const files = (process.env.UOBJECT_FILES ?? "").split(":").filter((dir) => dir && existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((file) => /\.(usx|unr|u)$/i.test(file)).map((file) => join(dir, file)));

test("reads and moves every static mesh", { skip: files.length === 0 }, () => {
  let count = 0;
  for (const file of files) {
    const pkg = parse(readFileSync(file));
    const meshes = pkg.exports.map((_, i) => i + 1).filter((ref) => className(pkg, ref) === "StaticMesh");
    if (meshes.length === 0) continue;
    const before = meshes.map((ref) => readStaticMesh(pkg, ref));
    addName(pkg, "Shifts every export by this name");
    assert.throws(() => build(pkg), PackageError, file);
    const moved = parse(build(pkg, { relocators }));
    meshes.forEach((ref, i) => {
      assert.deepEqual(readStaticMesh(moved, ref), before[i], `${file}: ${path(moved, ref)}`);
      assert.deepEqual(writeStaticMesh(moved, ref, before[i]!), moved.exports[ref - 1]!.data, `${file}: ${path(moved, ref)} rewrites byte for byte`);
    });
    count += meshes.length;
  }
  console.log(`moved ${count} static meshes`);
});

test("edits a static mesh and reads the edit back", { skip: files.length === 0 }, () => {
  for (const file of files) {
    const pkg = parse(readFileSync(file));
    const ref = pkg.exports.findIndex((_, i) => className(pkg, i + 1) === "StaticMesh") + 1;
    if (ref === 0) continue;
    const mesh = readStaticMesh(pkg, ref);
    const edited = { ...mesh, vertices: mesh.vertices.map((vertex) => ({ ...vertex, position: { ...vertex.position, z: vertex.position.z * 2 } })), triangles: mesh.triangles.slice(1) };
    pkg.exports[ref - 1]!.data = writeStaticMesh(pkg, ref, edited);
    addName(pkg, "Moves the mesh");
    assert.deepEqual(readStaticMesh(parse(build(pkg, { relocators })), ref), edited, file);
    return;
  }
});
