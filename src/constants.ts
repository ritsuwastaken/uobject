export const textureFormats = ["P8", "RGBA7", "RGB16", "DXT1", "RGB8", "RGBA8", "NODATA", "DXT3", "DXT5", "L8", "G16", "RRRGGGBBB"] as const;

export const blockFormats: Readonly<Record<string, number>> = { DXT1: 8, DXT3: 16, DXT5: 16 };

export const pixelFormats: Readonly<Record<string, number>> = { P8: 1, L8: 1, RGB16: 2, G16: 2, RGB8: 3, RGBA8: 4, RGBA7: 4 };

export const maxTextureHeader = 256;

export const mipTail = 4 + 4 + 1 + 1;

export const textureCompressionVersion = 84;

export const paletteAlphaVersion = 66;

export const opaque = 255;

export const flexTracksSince = 3;

export const lodMeshVersions = { legacy: 2, impostor: 3, tesselation: 4 } as const;

export const meshVersions = { authentication: 120, collision: 124, collisionModels: 125 } as const;

export const lineage2 = { sequenceObject: 1, sequenceExtra: 2, sequenceTiming: 0x14, roughMoves: 0x19, sequenceLink: 0x19, sequenceGroups: 0x1a, sequenceGroupDetails: 0x1b, meshExtra: 3, meshWeights: 0x12, newWedges: 0x1c, meshTail: 0x23, notifyText: 131, vectorVerts: 133, lodExtra: 5, lodExtraByte: 6 } as const;

export const staticMeshVersions = { streams: 112, collisionFlags: 114, compressedCollision: 126, physics: 100, authentication: 120 } as const;

export const lineage2StaticMeshExtras = [42, 26] as const;
