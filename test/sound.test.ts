import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addName, build, className, parse, path, writeProperties, type Package } from "@ritsuwastaken/upackage";
import { ObjectError, readSound, relocators, writeSound } from "../src/index.ts";

const sample = (): Package => {
  const pkg: Package = { version: 129, licensee: 0, flags: 1, guid: new Uint8Array(16), generations: [], names: [], imports: [], exports: [], trailer: new Uint8Array() };
  addName(pkg, "None");
  const core = addName(pkg, "Core");
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Package"), outer: 0, name: addName(pkg, "Engine") });
  pkg.imports.push({ classPackage: core, className: addName(pkg, "Class"), outer: -1, name: addName(pkg, "Sound") });
  return pkg;
};

test("writes a new sound and reads it back after building", () => {
  const pkg = sample();
  pkg.exports.push({ class: -2, super: 0, outer: 0, name: addName(pkg, "Beep"), flags: 0, data: writeProperties(pkg, []) });
  assert.throws(() => writeSound(pkg, 1, { format: "WAV", data: new Uint8Array([1]), extra: new Uint8Array() }), ObjectError);
  pkg.exports[0]!.offset = 0;
  const sound = { format: "WAV", data: new Uint8Array([82, 73, 70, 70, 1, 2, 3]), extra: new Uint8Array([9, 9]) };
  pkg.exports[0]!.data = writeSound(pkg, 1, sound);
  const back = parse(build(pkg));
  assert.deepEqual(readSound(back, 1), sound);
  back.exports[0]!.data = writeSound(back, 1, { ...sound, data: new Uint8Array(1000) });
  addName(back, "Moves the sound");
  assert.equal(readSound(parse(build(back, { relocators })), 1).data.length, 1000);
});

const files = (process.env.UOBJECT_FILES ?? "").split(":").filter((dir) => dir && existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((file) => /\.(uax|ukx|u|unr)$/i.test(file)).map((file) => join(dir, file)));

test("rewrites every sound byte for byte and replaces their data", { skip: files.length === 0 }, () => {
  let count = 0;
  for (const file of files) {
    const pkg = parse(readFileSync(file));
    const sounds = pkg.exports.map((_, i) => i + 1).filter((ref) => className(pkg, ref) === "Sound");
    if (sounds.length === 0) continue;
    for (const ref of sounds) {
      const sound = readSound(pkg, ref);
      assert.deepEqual(writeSound(pkg, ref, sound), new Uint8Array(pkg.exports[ref - 1]!.data), `${file}: ${path(pkg, ref)}`);
      pkg.exports[ref - 1]!.data = writeSound(pkg, ref, { ...sound, data: sound.data.subarray(0, sound.data.length >> 1) });
    }
    const moved = parse(build(pkg, { relocators }));
    for (const ref of sounds) assert.equal(readSound(moved, ref).data.length, readSound(pkg, ref).data.length, `${file}: ${path(moved, ref)}`);
    count += sounds.length;
  }
  console.log(`rewrote ${count} sounds`);
});
