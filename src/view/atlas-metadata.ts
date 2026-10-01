/** Wire-only frame interning. Hydration shares arrays; no pixel/geometry changes. */
type FrameAtlas = { frames?: unknown[]; framesRef?: string };
type AtlasEntity = { atlases?: Record<string, FrameAtlas>; annexes?: AtlasEntity[] };
type FrameManifest = {
  entities?: Record<string, AtlasEntity>;
  civilizations?: Record<string, { entities?: Record<string, AtlasEntity> }>;
  atlasFrames?: Record<string, unknown[]>;
};

export function expandAtlasFrames<T extends FrameManifest>(manifest: T): T {
  for (const profile of [manifest, ...Object.values(manifest.civilizations ?? {})]) {
    for (const entity of Object.values(profile.entities ?? {})) {
      for (const part of [entity, ...(entity.annexes ?? [])]) {
        for (const atlas of Object.values(part.atlases ?? {})) {
          if (atlas.framesRef === undefined) continue;
          const frames = manifest.atlasFrames?.[atlas.framesRef];
          if (!Array.isArray(frames)) throw new Error(`Missing atlas frame set: ${atlas.framesRef}`);
          atlas.frames = frames;
          delete atlas.framesRef;
        }
      }
    }
  }
  delete manifest.atlasFrames;
  return manifest;
}
