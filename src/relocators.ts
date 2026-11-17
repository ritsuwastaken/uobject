import type { Relocator } from "@ritsuwastaken/upackage";
import { relocateMeshAnimation } from "./animation.ts";
import { relocateSkeletalMesh } from "./mesh.ts";

export const relocators: Readonly<Record<string, Relocator>> = { MeshAnimation: relocateMeshAnimation, SkeletalMesh: relocateSkeletalMesh };
