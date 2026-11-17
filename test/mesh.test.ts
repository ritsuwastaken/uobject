import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addName, build, className, parse, PackageError, path, type Package } from "@ritsuwastaken/upackage";
import { readMeshAnimation, readSkeletalMesh, relocators, writeMeshAnimation, writeSkeletalMesh } from "../src/index.ts";

const sample = (version = 129, licensee = 0): Package => {
  const pkg: Package = { version, licensee, flags: 1, guid: new Uint8Array(16), generations: [], names: [], imports: [], exports: [], trailer: new Uint8Array() };
  addName(pkg, "None");
  const core = addName(pkg, "Core");
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Package"), outer: 0, name: addName(pkg, "Engine") });
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Class"), outer: -1, name: addName(pkg, "MeshAnimation") });
  return pkg;
};

test("writes and reads a mesh animation", () => {
  const pkg = sample();
  const animation = {
    version: 4,
    bones: [{ name: "root", flags: 0, parent: 0 }, { name: "arm", flags: 0, parent: 0 }],
    motions: [{ rootSpeed: { x: 0, y: 0, z: 0 }, trackTime: 2, startBone: 0, version: 4, boneIndices: [], tracks: [0, 1].map(() => ({ flags: 0, rotations: [{ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0.5, w: 0.5 }], positions: [{ x: 1, y: 2, z: 3 }], times: [0, 1] })), root: { flags: 0, rotations: [], positions: [], times: [] } }],
    sequences: [{ bookmark: 0, name: "wave", groups: ["Default"], startFrame: 0, frames: 2, notifies: [{ time: 0.5, function: "Step", object: 0 }], rate: 30 }],
  };
  pkg.exports.push({ class: -2, super: 0, outer: 0, name: addName(pkg, "Anims"), flags: 0, data: new Uint8Array() });
  pkg.exports[0]!.data = writeMeshAnimation(pkg, 1, animation);
  assert.deepEqual(readMeshAnimation(parse(build(pkg)), 1), animation);
});

test("writes and reads a mesh animation with extra sequence data", () => {
  const pkg = sample(131, 20);
  const track = { flags: 0, rotations: [{ x: 0, y: 0, z: 0, w: 1 }], positions: [{ x: 1, y: 2, z: 3 }], times: [0] };
  const animation = {
    version: 1,
    bones: [{ name: "root", flags: 0, parent: 0 }],
    motions: [{ rootSpeed: { x: 0, y: 0, z: 0 }, trackTime: 1, startBone: 0, version: 7, boneIndices: [0], tracks: [track], root: track }],
    sequences: [{ bookmark: 0, name: "attack", groups: [], startFrame: 0, frames: 1, notifies: [{ time: 0.5, function: "Hit", object: 0, text: "swing" }], rate: 30, extra: new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0]) }],
  };
  pkg.exports.push({ class: -2, super: 0, outer: 0, name: addName(pkg, "Anims"), flags: 0, data: new Uint8Array() });
  pkg.exports[0]!.data = writeMeshAnimation(pkg, 1, animation);
  assert.deepEqual(readMeshAnimation(parse(build(pkg)), 1), animation);
});

const files = (process.env.UOBJECT_FILES ?? "").split(":").filter((dir) => dir && existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((file) => /\.(ukx|u|usx|unr)$/i.test(file)).map((file) => join(dir, file)));

test("rewrites every animation set byte for byte", { skip: files.length === 0 }, () => {
  let count = 0;
  for (const file of files) {
    const pkg = parse(readFileSync(file));
    pkg.exports.forEach((entry, i) => {
      if (className(pkg, i + 1) !== "MeshAnimation") return;
      assert.deepEqual(writeMeshAnimation(pkg, i + 1, readMeshAnimation(pkg, i + 1)), new Uint8Array(entry.data), `${file}: ${path(pkg, i + 1)}`);
      count++;
    });
  }
  console.log(`rewrote ${count} animation sets`);
});

test("reads and moves every skeletal mesh and animation set", { skip: files.length === 0 }, () => {
  let count = 0;
  for (const file of files) {
    const pkg = parse(readFileSync(file));
    const refs = pkg.exports.map((_, i) => i + 1);
    const meshes = refs.filter((ref) => className(pkg, ref) === "SkeletalMesh");
    const animations = refs.filter((ref) => className(pkg, ref) === "MeshAnimation");
    if (meshes.length + animations.length === 0) continue;
    const before = [meshes.map((ref) => readSkeletalMesh(pkg, ref)), animations.map((ref) => readMeshAnimation(pkg, ref))];
    addName(pkg, "Shifts every export by this name");
    if (meshes.length) assert.throws(() => build(pkg), PackageError, file);
    const moved = parse(build(pkg, { relocators }));
    assert.deepEqual([meshes.map((ref) => readSkeletalMesh(moved, ref)), animations.map((ref) => readMeshAnimation(moved, ref))], before, file);
    animations.forEach((ref) => assert.deepEqual(writeMeshAnimation(moved, ref, readMeshAnimation(moved, ref)), moved.exports[ref - 1]!.data, `${file}: ${path(moved, ref)}`));
    meshes.forEach((ref) => assert.deepEqual(writeSkeletalMesh(moved, ref, readSkeletalMesh(moved, ref)), moved.exports[ref - 1]!.data, `${file}: ${path(moved, ref)}`));
    count += meshes.length + animations.length;
  }
  console.log(`moved ${count} skeletal meshes and animation sets`);
});

test("edits a skeletal mesh and reads the edit back", { skip: files.length === 0 }, () => {
  for (const file of files) {
    const pkg = parse(readFileSync(file));
    const ref = pkg.exports.findIndex((_, i) => className(pkg, i + 1) === "SkeletalMesh") + 1;
    if (ref === 0) continue;
    const mesh = readSkeletalMesh(pkg, ref);
    const lifted = { ...mesh, lods: mesh.lods.map((lod) => ({ ...lod, points: [...lod.points, { x: 1, y: 2, z: 3 }], smoothVertices: lod.smoothVertices.map((vertex) => ({ ...vertex, point: { ...vertex.point, z: Math.fround(vertex.point.z + 10) } })) })) };
    pkg.exports[ref - 1]!.data = writeSkeletalMesh(pkg, ref, lifted);
    addName(pkg, "Moves the mesh");
    assert.deepEqual(readSkeletalMesh(parse(build(pkg, { relocators })), ref), lifted, file);
    return;
  }
});
