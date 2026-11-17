# @ritsuwastaken/uobject

Read and write the native data of objects in Unreal Engine 1 and 2 packages: textures, palettes, sounds, static meshes, skeletal meshes and animations.

Works on top of [@ritsuwastaken/upackage](https://github.com/ritsuwastaken/upackage).

## Usage

```bash
npm install @ritsuwastaken/uobject
```

```ts
import { readFile } from "node:fs/promises";
import { className, parse, path } from "@ritsuwastaken/upackage";
import { decodeMip, readPalette, readTexture } from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("Engine.utx"));
pkg.exports.forEach((_, i) => {
  if (className(pkg, i + 1) !== "Texture") return;
  const texture = readTexture(pkg, i + 1);
  const palette =
    texture.format === "P8" ? readPalette(pkg, texture.palette) : undefined;
  const image = decodeMip(texture.mips[0]!, texture.format, palette);
  console.log(
    path(pkg, i + 1),
    texture.format,
    image.width,
    image.height,
    image.data.length,
  );
});
```

### Replacing a texture

```ts
import { readFile, writeFile } from "node:fs/promises";
import { build, findExport, parse } from "@ritsuwastaken/upackage";
import {
  encodeMip,
  mipmaps,
  readTexture,
  relocators,
  writeTexture,
  type Image,
} from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("Engine.utx"));
const ref = findExport(pkg, "DefaultTexture");
const image: Image = {
  width: 256,
  height: 256,
  data: new Uint8Array(256 * 256 * 4),
};
const texture = readTexture(pkg, ref);
const mips = mipmaps(image).map((mip) => encodeMip(mip, "DXT5"));
pkg.exports[ref - 1]!.data = writeTexture(pkg, ref, {
  ...texture,
  format: "DXT5",
  width: 256,
  height: 256,
  mips,
});
await writeFile("Engine.utx", build(pkg, { relocators }));
```

## Sounds

```ts
import { readFile, writeFile } from "node:fs/promises";
import { build, className, parse, path } from "@ritsuwastaken/upackage";
import { readSound, relocators, writeSound } from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("ChrSound.uax"));
for (const [i, entry] of pkg.exports.entries()) {
  if (className(pkg, i + 1) !== "Sound") continue;
  const sound = readSound(pkg, i + 1);
  console.log(path(pkg, i + 1), sound.format, sound.data.length);
  if (path(pkg, i + 1) === "Step.Grass")
    entry.data = writeSound(pkg, i + 1, {
      ...sound,
      data: await readFile("grass.wav"),
    });
}
await writeFile("ChrSound.uax", build(pkg, { relocators }));
```

## Static meshes

```ts
import { readFile } from "node:fs/promises";
import { className, parse, path } from "@ritsuwastaken/upackage";
import { readStaticMesh } from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("StaticMeshes/Aden_Castle_S.usx"));
pkg.exports.forEach((_, i) => {
  if (className(pkg, i + 1) !== "StaticMesh") return;
  const mesh = readStaticMesh(pkg, i + 1);
  console.log(
    path(pkg, i + 1),
    mesh.vertices.length,
    mesh.indices.length / 3,
    mesh.uvs.length,
  );
});
```

## Skeletal meshes and animations

```ts
import { readFile, writeFile } from "node:fs/promises";
import { addName, build, className, parse } from "@ritsuwastaken/upackage";
import {
  readMeshAnimation,
  readSkeletalMesh,
  relocators,
  writeMeshAnimation,
} from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("Animations/ShrekCharacters.ukx"));
for (const [i, entry] of pkg.exports.entries()) {
  if (className(pkg, i + 1) === "SkeletalMesh") {
    const mesh = readSkeletalMesh(pkg, i + 1);
    console.log(mesh.bones.length, mesh.lods[0]?.points.length);
  }
  if (className(pkg, i + 1) === "MeshAnimation") {
    const animation = readMeshAnimation(pkg, i + 1);
    animation.sequences.forEach((sequence) => (sequence.rate *= 2));
    entry.data = writeMeshAnimation(pkg, i + 1, animation);
  }
}
addName(pkg, "Extra");
await writeFile("Animations/ShrekCharacters.ukx", build(pkg, { relocators }));
```

Skeletal meshes store absolute file offsets, so `upackage` refuses to move one unless you pass `relocators` (or `relocateSkeletalMesh`, `relocateStaticMesh` and `relocateMeshAnimation`) to `build`.
