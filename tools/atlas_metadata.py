"""Intern repeated frame arrays without changing any atlas pixels or geometry."""
import hashlib
import json


def entity_atlases(manifest):
    for profile in [manifest, *manifest.get('civilizations', {}).values()]:
        for entity in profile.get('entities', {}).values():
            for part in [entity, *entity.get('annexes', [])]:
                yield from part.get('atlases', {}).values()


def expand_atlas_frames(manifest):
    """Hydrate shared arrays in place; legacy inline manifests are already valid."""
    table = manifest.get('atlasFrames', {})
    for atlas in entity_atlases(manifest):
        key = atlas.get('framesRef')
        if key is not None:
            if key not in table:
                raise ValueError(f'missing atlas frame set: {key}')
            atlas['frames'] = table[key]
            del atlas['framesRef']
    manifest.pop('atlasFrames', None)
    return manifest


def intern_atlas_frames(manifest):
    """Content-addressed IDs keep output independent of profile/traversal order."""
    expand_atlas_frames(manifest)
    table, identities = {}, {}
    for atlas in entity_atlases(manifest):
        if 'frames' not in atlas:
            continue
        frames = atlas.pop('frames')
        identity = id(frames)
        key = identities.get(identity)
        if key is None:
            encoded = json.dumps(frames, separators=(',', ':'), sort_keys=True).encode()
            key = hashlib.sha256(encoded).hexdigest()
            identities[identity] = key
        if key in table and table[key] != frames:
            raise ValueError('atlas frame digest collision')
        table[key] = frames
        atlas['framesRef'] = key
    manifest['atlasFrames'] = table
    return manifest
