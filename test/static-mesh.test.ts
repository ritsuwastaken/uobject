import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addName, build, className, parse, PackageError, path, type Package } from "@ritsuwastaken/upackage";
import { ObjectError, readStaticMesh, relocators } from "../src/index.ts";

test("refuses objects that aren't static meshes", () => {
  const pkg: Package = { version: 129, licensee: 0, flags: 1, guid: new Uint8Array(16), generations: [], names: [], imports: [], exports: [], trailer: new Uint8Array() };
  addName(pkg, "None");
  assert.throws(() => readStaticMesh(pkg, 0), ObjectError);
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
    meshes.forEach((ref, i) => assert.deepEqual(readStaticMesh(moved, ref), before[i], `${file}: ${path(moved, ref)}`));
    count += meshes.length;
  }
  console.log(`moved ${count} static meshes`);
});
