# @ritsuwastaken/uobject

Read and write the native data of objects in Unreal Engine 1 and 2 packages: textures, sounds, static meshes, skeletal meshes and animations.

Uses [@ritsuwastaken/upackage](https://github.com/ritsuwastaken/upackage).

## Usage

```bash
npm install @ritsuwastaken/uobject
```

### Textures

```ts
import { readFile, writeFile } from "node:fs/promises";
import { build, findExport, parse } from "@ritsuwastaken/upackage";
import { decodeMip, encodeMip, mipmaps, readPalette, readTexture, relocators, writeTexture } from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("Engine.utx"));
const ref = findExport(pkg, "DefaultTexture");

const texture = readTexture(pkg, ref);
const palette = texture.format === "P8" ? readPalette(pkg, texture.palette) : undefined;
const image = decodeMip(texture.mips[0]!, texture.format, palette);

const mips = mipmaps(image).map((mip) => encodeMip(mip, "DXT5"));
pkg.exports[ref - 1]!.data = writeTexture(pkg, ref, { ...texture, format: "DXT5", mips });
await writeFile("Engine.utx", build(pkg, { relocators }));
```

### Sounds

```ts
import { readFile, writeFile } from "node:fs/promises";
import { build, findExport, parse } from "@ritsuwastaken/upackage";
import { readSound, relocators, writeSound } from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("Sounds.uax"));
const ref = findExport(pkg, "Step.Grass");

const sound = readSound(pkg, ref);
pkg.exports[ref - 1]!.data = writeSound(pkg, ref, { ...sound, data: await readFile("grass.wav") });
await writeFile("Sounds.uax", build(pkg, { relocators }));
```

### Meshes and animations

```ts
import { readFile, writeFile } from "node:fs/promises";
import { build, className, parse } from "@ritsuwastaken/upackage";
import { readMeshAnimation, readSkeletalMesh, readStaticMesh, relocators, writeMeshAnimation } from "@ritsuwastaken/uobject";

const pkg = parse(await readFile("Characters.ukx"));
for (const [i, entry] of pkg.exports.entries()) {
  const ref = i + 1;
  if (className(pkg, ref) === "StaticMesh") console.log(readStaticMesh(pkg, ref).vertices.length);
  if (className(pkg, ref) === "SkeletalMesh") console.log(readSkeletalMesh(pkg, ref).bones.length);
  if (className(pkg, ref) === "MeshAnimation") {
    const animation = readMeshAnimation(pkg, ref);
    animation.sequences.forEach((sequence) => (sequence.rate *= 2));
    entry.data = writeMeshAnimation(pkg, ref, animation);
  }
}
await writeFile("Characters.ukx", build(pkg, { relocators }));
```

Textures, sounds and meshes store absolute file offsets, so always build with `relocators`. For an export you add yourself, set its `offset` to 0 before writing its data.
