import { ArchiveError, Reader, Writer } from "@ritsuwastaken/farchive";
import { className, path, readProperties, writeProperties, type ObjectRef, type Package } from "@ritsuwastaken/upackage";
import { readName, readQuat, readVector, writeArray, writeName, writeQuat, writeVector } from "./archive.ts";
import { flexTracksSince, lineage2 } from "./constants.ts";
import { ObjectError } from "./error.ts";
import { relocateWith } from "./walk.ts";
import type { AnimNotify, AnimSequence, AnimTrack, MeshAnimation, Motion } from "./types.ts";

const readTrack = (reader: Reader): AnimTrack => ({ flags: reader.u32(), rotations: reader.array(readQuat), positions: reader.array(readVector), times: reader.array((r) => r.f32()) });

const readMotion = (reader: Reader, l2: boolean): Motion => {
  const motion: Motion = { rootSpeed: readVector(reader), trackTime: reader.f32(), startBone: reader.i32(), version: reader.i32(), boneIndices: [], tracks: [], root: { flags: 0, rotations: [], positions: [], times: [] } };
  motion.boneIndices = reader.array((r) => r.i32());
  motion.tracks = reader.array(readTrack);
  motion.root = readTrack(reader);
  if (!l2 && motion.version >= flexTracksSince && reader.index() !== 0) throw new ObjectError("Compressed (flex) animation tracks aren't supported", reader.offset);
  return motion;
};

const pairs = (r: Reader) => r.array((p) => p.skip(8));

const skipSequenceExtra = (r: Reader, licensee: number) => {
  r.skip(8);
  if (licensee >= lineage2.sequenceExtra) r.skip(4);
  r.index();
  if (licensee >= lineage2.sequenceTiming) r.skip(4);
  if (licensee >= lineage2.sequenceLink) r.skip(4);
  if (licensee === lineage2.sequenceGroups) pairs(r);
  if (licensee >= lineage2.sequenceGroupDetails) {
    r.u8();
    pairs(r);
    r.array((g) => {
      g.skip(4);
      pairs(g);
    });
    r.skip(8);
    pairs(r);
  }
};

const utf16 = new TextDecoder("utf-16le");

const roughMoves = (pkg: Package) => pkg.version >= 123 && pkg.licensee >= lineage2.roughMoves;

interface Read {
  animation: MeshAnimation;
  offsets: number[];
  base?: number;
}

const readAnimation = (pkg: Package, ref: ObjectRef, l2: boolean): Read => {
  const data = pkg.exports[ref - 1]!.data;
  const reader = new Reader(data, { offset: readProperties(pkg, data).end });
  const offsets: number[] = [];
  let base: number | undefined;
  const version = reader.i32();
  const bones = reader.array((r) => ({ name: readName(pkg, r), flags: r.u32(), parent: r.i32() }));
  let motions: Motion[];
  if (l2 && roughMoves(pkg)) {
    const at = reader.offset;
    const end = reader.i32();
    const ends: [number, number][] = [[at, end]];
    motions = reader.array((r) => {
      const local = r.offset;
      const localEnd = r.i32();
      const motion = readMotion(r, true);
      ends.push([local, localEnd - r.offset]);
      return motion;
    });
    ends[0]![1] = end - reader.offset;
    for (const [where, delta] of ends) {
      if ((base ??= delta) !== delta) throw new ObjectError(`${path(pkg, ref)} has a motion that does not end where its offset says`, where);
      offsets.push(where);
    }
  } else motions = reader.array((r) => readMotion(r, l2));
  const sequences = reader.array((r) => {
    const sequence: AnimSequence = {
      bookmark: r.f32(),
      name: readName(pkg, r),
      groups: r.array((g) => readName(pkg, g)),
      startFrame: r.i32(),
      frames: r.i32(),
      notifies: r.array((n) => {
        const notify: AnimNotify = { time: n.f32(), function: readName(pkg, n), object: n.index() };
        if (l2 && pkg.version >= lineage2.notifyText) notify.text = utf16.decode(n.take(n.i32() * 2));
        return notify;
      }),
      rate: r.f32(),
    };
    if (l2) {
      const at = r.offset;
      skipSequenceExtra(r, pkg.licensee);
      sequence.extra = new Uint8Array(data.subarray(at, r.offset));
    }
    return sequence;
  });
  if (!reader.atEnd) throw new ObjectError(`${path(pkg, ref)} has ${reader.remaining} unexpected bytes after its sequences`, reader.offset);
  return { animation: { version, bones, motions, sequences }, offsets, base };
};

const walkAnimation = (pkg: Package, ref: ObjectRef): Read => {
  if (ref <= 0 || className(pkg, ref) !== "MeshAnimation") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a mesh animation in this package`);
  try {
    return readAnimation(pkg, ref, false);
  } catch (error) {
    if (pkg.licensee === 0 || !(error instanceof ArchiveError)) throw error;
    return readAnimation(pkg, ref, true);
  }
};

export function readMeshAnimation(pkg: Package, ref: ObjectRef): MeshAnimation {
  return walkAnimation(pkg, ref).animation;
}

export const relocateMeshAnimation = relocateWith((pkg, ref) => {
  const { offsets, base } = walkAnimation(pkg, ref);
  return { lazy: offsets, base };
});

const writeTrack = (writer: Writer, track: AnimTrack) => {
  writer.u32(track.flags);
  writeArray(writer, track.rotations, (q) => writeQuat(writer, q));
  writeArray(writer, track.positions, (v) => writeVector(writer, v));
  writeArray(writer, track.times, (t) => writer.f32(t));
};

export function writeMeshAnimation(pkg: Package, ref: ObjectRef, animation: MeshAnimation): Uint8Array {
  if (ref <= 0 || className(pkg, ref) !== "MeshAnimation") throw new ObjectError(`${ref > 0 ? path(pkg, ref) : ref} is not a mesh animation in this package`);
  const entry = pkg.exports[ref - 1]!;
  const writer = new Writer();
  const alternate = animation.sequences.some((sequence) => sequence.extra !== undefined);
  const rough = alternate && roughMoves(pkg);
  const base = rough ? entry.offset : 0;
  if (base === undefined) throw new ObjectError(`${path(pkg, ref)} has no file offset; set its offset to 0 for a new export`);
  writer.bytes(entry.data.length ? entry.data.subarray(0, readProperties(pkg, entry.data).end) : writeProperties(pkg, []));
  writer.i32(animation.version);
  writeArray(writer, animation.bones, (bone) => {
    writeName(pkg, writer, bone.name);
    writer.u32(bone.flags);
    writer.i32(bone.parent);
  });
  const end = writer.length;
  if (rough) writer.i32(0);
  writeArray(writer, animation.motions, (motion) => {
    const local = writer.length;
    if (rough) writer.i32(0);
    writeVector(writer, motion.rootSpeed);
    writer.f32(motion.trackTime);
    writer.i32(motion.startBone);
    writer.i32(motion.version);
    writeArray(writer, motion.boneIndices, (i) => writer.i32(i));
    writeArray(writer, motion.tracks, (track) => writeTrack(writer, track));
    writeTrack(writer, motion.root);
    if (!alternate && motion.version >= flexTracksSince) writer.index(0);
    if (rough) writer.patchI32(local, base + writer.length);
  });
  if (rough) writer.patchI32(end, base + writer.length);
  writeArray(writer, animation.sequences, (sequence) => {
    writer.f32(sequence.bookmark);
    writeName(pkg, writer, sequence.name);
    writeArray(writer, sequence.groups, (group) => writeName(pkg, writer, group));
    writer.i32(sequence.startFrame);
    writer.i32(sequence.frames);
    writeArray(writer, sequence.notifies, (notify) => {
      writer.f32(notify.time);
      writeName(pkg, writer, notify.function);
      writer.index(notify.object);
      if (alternate && pkg.version >= lineage2.notifyText) {
        const text = notify.text ?? "";
        writer.i32(text.length);
        for (let i = 0; i < text.length; i++) writer.u16(text.charCodeAt(i));
      }
    });
    writer.f32(sequence.rate);
    if (alternate) {
      if (!sequence.extra) throw new ObjectError(`Sequence ${sequence.name} is missing the extra data the other sequences have`);
      writer.bytes(sequence.extra);
    }
  });
  return writer.result();
}
