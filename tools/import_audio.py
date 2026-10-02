#!/usr/bin/env python3
"""Resolve consumed Wwise events and decode their owned media with vgmstream.

This intentionally implements only the small, evidenced AKPK/BNK boundary the
slice consumes: event -> Play action -> sound/container -> DIDX or PCK media.
The codec remains delegated to the permissively licensed vgmstream CLI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import wave
from collections import ChainMap
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from struct import unpack_from
from typing import Any

from wwise_pck import PackedFile, extract, read_index


# Reviewed source gaps, not a general missing-audio fallback. DAT8's ORIE cart
# names these events, but the pinned common/English banks contain no HIRC object
# for them (#271, docs/audio-reference.md). The owner approved silence for these
# three Persian aliases only on 2026-10-02. Other profiles require their own audit.
REVIEWED_ABSENT_CUES = {
    ("civilizations/persians/trade-cart-select", 3167914911, "Persians"),
    ("civilizations/persians/trade-cart-train", 955679769, "Persians"),
    ("civilizations/persians/events/2892846699", 2892846699, "Persians"),
}


@dataclass(frozen=True)
class Stream:
    pack: Path
    entry: PackedFile

    def read_bytes(self) -> bytes:
        with self.pack.open("rb") as handle:
            data = extract(handle, self.entry)
        if len(data) != self.entry.size:
            raise ValueError(f"{self.pack.name}: truncated stream {self.entry.id}")
        return data


@dataclass(frozen=True)
class Bank:
    name: str
    objects: Mapping[int, tuple[int, bytes]]
    media: Mapping[int, bytes | Stream]
    pack: str = ""
    version: int = 0


def wwise_id(name: str) -> int:
    """Wwise's lowercase 32-bit FNV-1 string ID."""
    value = 2166136261
    for byte in name.lower().encode("utf-8"):
        value = (value * 16777619) & 0xFFFFFFFF
        value ^= byte
    return value


def _chunks(data: bytes) -> dict[bytes, bytes]:
    chunks: dict[bytes, bytes] = {}
    offset = 0
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        size = unpack_from("<I", data, offset + 4)[0]
        end = offset + 8 + size
        if end > len(data):
            raise ValueError(f"truncated Wwise bank chunk {tag!r}")
        chunks[tag] = data[offset + 8:end]
        offset = end
    if offset != len(data):
        raise ValueError("trailing bytes after Wwise bank chunks")
    return chunks


def read_bank(name: str, data: bytes) -> Bank:
    chunks = _chunks(data)
    hirc = chunks.get(b"HIRC")
    didx = chunks.get(b"DIDX")
    payload = chunks.get(b"DATA")
    if hirc is None:
        raise ValueError(f"{name}: bank lacks HIRC")
    if (didx is None) != (payload is None):
        raise ValueError(f"{name}: bank has incomplete DIDX/DATA")

    if len(hirc) < 4:
        raise ValueError(f"{name}: truncated HIRC count")
    count = unpack_from("<I", hirc, 0)[0]
    offset = 4
    objects: dict[int, tuple[int, bytes]] = {}
    for _ in range(count):
        if offset + 9 > len(hirc):
            raise ValueError(f"{name}: truncated HIRC object")
        object_type = hirc[offset]
        size = unpack_from("<I", hirc, offset + 1)[0]
        if size < 4 or offset + 5 + size > len(hirc):
            raise ValueError(f"{name}: invalid HIRC object size")
        object_id = unpack_from("<I", hirc, offset + 5)[0]
        objects[object_id] = (object_type, hirc[offset + 9:offset + 5 + size])
        offset += 5 + size
    if offset != len(hirc):
        raise ValueError(f"{name}: malformed HIRC object table")

    media: dict[int, bytes] = {}
    didx = didx or b""
    payload = payload or b""
    if len(didx) % 12:
        raise ValueError(f"{name}: malformed DIDX table")
    for offset in range(0, len(didx), 12):
        media_id, data_offset, size = unpack_from("<3I", didx, offset)
        if data_offset + size > len(payload):
            raise ValueError(f"{name}: truncated embedded media {media_id}")
        media[media_id] = payload[data_offset:data_offset + size]
    version = unpack_from('<I', chunks[b'BKHD'])[0] if b'BKHD' in chunks else 0
    return Bank(name, objects, media, version=version)


def read_banks(pack: Path) -> list[Bank]:
    return read_audio_packs([pack])


def read_audio_packs(packs: Sequence[Path]) -> list[Bank]:
    """Join bank graphs and stream indices, retaining bank-local ID precedence.

    DIDX can contain only a stream's prefetch prefix. The full PCK stream wins.
    Streams stay on disk until consumed. Wwise IDs are not globally unique:
    Init's buses collide with events, and Play actions can differ by bank ID.
    Only unambiguous objects are exposed as cross-bank fallbacks; each bank's
    own objects always win. Do not silently overwrite a conflicting object.
    """
    banks: list[Bank] = []
    streams: dict[int, Stream] = {}
    shared_objects: dict[int, tuple[int, bytes]] = {}
    ambiguous: set[int] = set()
    shared_media: dict[int, bytes | Stream] = {}
    for pack in sorted(set(packs)):
        with pack.open("rb") as handle:
            index = read_index(handle)
            for entry in index["streams"]:
                stream = Stream(pack, entry)
                if entry.id in streams and streams[entry.id].read_bytes() != stream.read_bytes():
                    raise ValueError(f"conflicting stream {entry.id} in {pack.name}")
                streams[entry.id] = stream
            for entry in index["banks"]:
                bank = read_bank(str(entry.id), extract(handle, entry))
                banks.append(Bank(bank.name, bank.objects, bank.media, pack.name, bank.version))
                for object_id, value in bank.objects.items():
                    if object_id in shared_objects and shared_objects[object_id] != value:
                        ambiguous.add(object_id)
                    shared_objects[object_id] = value
                for media_id, data in bank.media.items():
                    if media_id in shared_media and shared_media[media_id] != data:
                        raise ValueError(f"conflicting embedded media {media_id}")
                    shared_media[media_id] = data
    for object_id in ambiguous:
        del shared_objects[object_id]
    # Events are entry points of their owning bank, not cross-bank fallbacks.
    # Sharing them would resolve each cue once for every loaded bank.
    shared_objects = {key: value for key, value in shared_objects.items() if value[0] != 4}
    return [Bank(bank.name, ChainMap(bank.objects, shared_objects),
                 ChainMap(streams, bank.media, shared_media), bank.pack, bank.version) for bank in banks]


def _object_references(payload: bytes, objects: Mapping[int, tuple[int, bytes]]) -> list[int]:
    # HIRC object lists are packed and not guaranteed to be 4-byte aligned.
    references: list[int] = []
    for offset in range(len(payload) - 3):
        candidate = unpack_from("<I", payload, offset)[0]
        if candidate in objects and candidate not in references:
            references.append(candidate)
    return references


SWITCH_CONTAINER = 6


def switch_branch(
    bank: Bank, payload: bytes, group: str, switch: str,
) -> list[int] | None:
    """The children a switch container plays for one value of one switch.

    A unit's voice event covers every civilisation through a switch on
    `Civilization`, so playing it whole would import forty languages. The
    container's switch table is `(switch id, count, children...)` records; the
    fields before it are variable-length node parameters, so the table is found
    by looking for the group id and accepting only a walk where every child is
    a real object and the records end where the count says they do.
    """
    group_id = wwise_id(group)
    switch_id = wwise_id(switch)
    for start in range(len(payload) - 12):
        if unpack_from("<I", payload, start)[0] != group_id:
            continue
        cursor = start + 4 + 4 + 1  # group, default switch, continuous flag
        if cursor + 4 > len(payload):
            continue
        count = unpack_from("<I", payload, cursor)[0]
        cursor += 4
        if count > 256 or cursor + count * 4 + 4 > len(payload):
            continue
        children = [unpack_from("<I", payload, cursor + i * 4)[0] for i in range(count)]
        if not children or not all(child in bank.objects for child in children):
            continue
        cursor += count * 4
        groups = unpack_from("<I", payload, cursor)[0]
        cursor += 4
        if groups > 256:
            continue
        found: list[int] | None = None
        for _ in range(groups):
            if cursor + 8 > len(payload):
                return None
            value = unpack_from("<I", payload, cursor)[0]
            items_count = unpack_from("<I", payload, cursor + 4)[0]
            if items_count > 256 or cursor + 8 + items_count * 4 > len(payload):
                return None
            items = [unpack_from("<I", payload, cursor + 8 + i * 4)[0] for i in range(items_count)]
            if not all(item in bank.objects for item in items):
                return None
            if value == switch_id:
                found = items
            cursor += 8 + items_count * 4
        # The table parsed: an absent branch means this container plays nothing
        # for that switch, not that every branch should play. Falling through
        # would import every civilisation's voices in silence.
        return found if found is not None else []
    return None


def resolve_event(bank: Bank, event_name: str, switch: str | None = None) -> list[int]:
    return resolve_event_id(bank, wwise_id(event_name), switch)


def resolve_event_id(bank: Bank, event_id: int, switch: str | None = None) -> list[int]:
    """Every available medium one event plays.

    Widget cues arrive as a name to hash; unit voices arrive as the DAT's own
    `wwise_*_sound_id`, which is already the hashed id (as a signed integer).
    `switch` narrows a civilisation switch container to one branch.
    """
    event = bank.objects.get(event_id & 0xFFFFFFFF)
    if not event or event[0] != 4:
        return []
    payload = event[1]
    action_ids = [unpack_from("<I", payload, 1 + index * 4)[0] for index in range(payload[0])]
    media_ids: list[int] = []

    def descend(object_id: int, visited: set[int]) -> None:
        if object_id in visited:
            return
        visited.add(object_id)
        item = bank.objects.get(object_id)
        if not item:
            return
        object_type, object_payload = item
        if object_type == 2 and len(object_payload) >= 9:
            media_id = unpack_from("<I", object_payload, 5)[0]
            if object_payload[4] in (1, 2) and not isinstance(bank.media.get(media_id), Stream):
                return  # a streamed source's DIDX prefix is not a playable file
            if media_id in bank.media and media_id not in media_ids:
                media_ids.append(media_id)
            return
        if object_type == SWITCH_CONTAINER and switch is not None:
            branch = switch_branch(bank, object_payload, "Civilization", switch)
            if branch is not None:
                for reference in branch:
                    descend(reference, visited)
                return
        # Random/sequence and switch containers ultimately reference sounds.
        if object_type in (5, 6):
            for reference in _object_references(object_payload, bank.objects):
                if bank.objects[reference][0] in (2, 5, 6):
                    descend(reference, visited)

    for action_id in action_ids:
        action = bank.objects.get(action_id)
        if not action or action[0] != 3 or len(action[1]) < 6 or action[1][1] != 4:
            continue
        # Scope byte, action-type byte, then the target HIRC object ID.
        descend(unpack_from("<I", action[1], 2)[0], set())
    return media_ids


def play_parameters(payload: bytes) -> dict[str, Any]:
    """Pinned v154 Play action property bundles; exact walk, no mixer emulation.

    Owned bytes corroborate the v154 property IDs:58 DelayTime (ms),59
    TransitionTime (ms),60 Probability (%). Ranged values are offsets. The
    remaining nine bytes are interpolation curve, bank ID and reserved word.
    """
    if len(payload) < 18 or payload[1] != 4:
        raise ValueError('malformed v154 Play action')
    cursor = 7
    values: dict[int, int | float] = {}
    ranges: dict[int, list[int | float]] = {}
    for destination, width in ((values, 1), (ranges, 2)):
        if cursor >= len(payload):
            raise ValueError('truncated Play property count')
        count = payload[cursor]
        keys = payload[cursor + 1:cursor + 1 + count]
        cursor += 1 + count
        if len(keys) != count or cursor + count * width * 4 > len(payload):
            raise ValueError('truncated Play property bundle')
        for key in keys:
            if key not in (58, 59, 60) or key in destination:
                raise ValueError(f'unsupported or repeated Play property {key}')
            fmt = '<' + ('f' if key == 60 else 'i') * width
            numbers = list(unpack_from(fmt, payload, cursor)); cursor += 4 * width
            destination[key] = numbers[0] if width == 1 else numbers
    if cursor + 9 != len(payload):
        raise ValueError('malformed Play action suffix')
    curve = payload[cursor]
    if curve != 4:
        raise ValueError(f'unsupported Play interpolation curve {curve}')
    delay = values.get(58, 0)
    fade = values.get(59, 0)
    probability = values.get(60, 100)
    if delay < 0 or fade < 0 or not 0 <= probability <= 100:
        raise ValueError('invalid Play timing/probability')
    for low, high in ranges.values():
        if low > high:
            raise ValueError('inverted Play randomizer range')
    return {
        'delaySeconds': delay / 1000, 'delayRange': [value / 1000 for value in ranges.get(58, [0, 0])],
        'fadeSeconds': fade / 1000, 'fadeRange': [value / 1000 for value in ranges.get(59, [0, 0])],
        'probability': probability, 'probabilityRange': ranges.get(60, [0, 0]), 'curve': curve,
    }


def resolve_event_layers(bank: Bank, event_id: int, switch: str | None = None) -> list[dict[str, Any]]:
    event_id &= 0xffffffff
    event = bank.objects.get(event_id)
    if not event or event[0] != 4:
        return []
    if bank.version != 154:
        raise ValueError(f'{bank.name}: unsupported Play-action bank version {bank.version}')
    payload = event[1]
    if not payload or len(payload) != 1 + payload[0] * 4:
        raise ValueError('malformed event action list')
    layers = []
    for index in range(payload[0]):
        action_id = unpack_from('<I', payload, 1 + index * 4)[0]
        action = bank.objects.get(action_id)
        if not action or action[0] != 3 or len(action[1]) < 6 or action[1][1] != 4:
            continue
        # Reuse the existing scoped effects resolver for this one root only.
        one = Bank(bank.name, ChainMap({event_id: (4, bytes([1]) + action_id.to_bytes(4, 'little'))}, bank.objects),
                   bank.media, bank.pack, bank.version)
        media = resolve_event_id(one, event_id, switch)
        if media:
            layers.append({'actionId': action_id, 'media': media, **play_parameters(action[1])})
    return layers


def dialogue_leaves(payload: bytes) -> dict[int, int]:
    """The pinned one-argument HIRC15 decision tree, with an exact node walk.

    Probability byte; depth u32; argument ID u32/type u8; tree byte size u32;
    mode u8; 12-byte nodes (key, child span or audio ID, weight, probability).
    The two trailing empty property-bundle counts are retained as a guard.
    This deliberately rejects other Wwise versions/depths instead of guessing.
    """
    if len(payload) < 29 or payload[0] != 100 or unpack_from('<I', payload, 1)[0] != 1:
        raise ValueError('unsupported music dialogue depth/probability')
    size = unpack_from('<I', payload, 10)[0]
    if payload[9] != 0 or payload[14] != 0 or size % 12 or len(payload) != 15 + size + 2 or payload[-2:] != b'\0\0':
        raise ValueError('malformed music dialogue tree')
    root, first, count, weight, probability = unpack_from('<I4H', payload, 15)
    if root != 0 or first != 1 or (count + 1) * 12 != size or (weight, probability) != (50, 100):
        raise ValueError('unsupported music dialogue root')
    leaves = {}
    for index in range(count):
        key, target, weight, probability = unpack_from('<IIHH', payload, 27 + index * 12)
        if key in leaves or (weight, probability) != (50, 100):
            raise ValueError('ambiguous music dialogue leaf')
        leaves[key] = target
    return leaves


def music_catalogue(banks: Sequence[Bank]) -> dict[str, Any]:
    """Resolve the owned Ingame_Music/MUSIC01.. tree, not a lobby playlist."""
    event_id = wwise_id('Ingame_Music')
    matches = []
    for bank in banks:
        local = bank.objects.maps[0] if isinstance(bank.objects, ChainMap) else bank.objects
        if local.get(event_id, (None,))[0] == 15:
            matches.append(bank)
    if len(matches) != 1:
        raise ValueError('expected one owned Ingame_Music dialogue event')
    bank = matches[0]
    payload = bank.objects[event_id][1]
    if unpack_from('<I', payload, 5)[0] != event_id:
        raise ValueError('unexpected Ingame_Music argument')
    leaves = dialogue_leaves(payload)
    named = {wwise_id(f'MUSIC{index:02}'): (index, f'MUSIC{index:02}') for index in range(1, 100)}
    tracks, unavailable, controls = [], [], []
    for state_id, sound_id in leaves.items():
        sound = bank.objects.get(sound_id)
        if sound is None or sound[0] != 2 or len(sound[1]) < 9:
            raise ValueError(f'music state {state_id}: missing sound object')
        plugin = unpack_from('<I', sound[1])[0]
        if state_id not in named:
            if plugin != 0x80001:
                raise ValueError(f'unrecognized media-bearing music state {state_id}')
            controls.append({'stateId': state_id, 'soundId': sound_id, 'pluginId': plugin})
            continue
        index, name = named[state_id]
        media_id = unpack_from('<I', sound[1], 5)[0]
        track = {'index': index, 'name': name, 'stateId': state_id,
                 'soundId': sound_id, 'mediaId': media_id, 'bankId': int(bank.name)}
        if sound[1][4] in (1, 2) and not isinstance(bank.media.get(media_id), Stream):
            unavailable.append({**track, 'reason': 'stream absent; DIDX prefetch is incomplete'})
        elif media_id not in bank.media:
            unavailable.append({**track, 'reason': 'media absent'})
        else:
            tracks.append(track)
    if not tracks:
        raise ValueError('no complete owned in-game music tracks')
    return {'event': 'Ingame_Music', 'eventId': event_id,
            'tracks': sorted(tracks, key=lambda row: row['index']),
            'unavailable': sorted(unavailable, key=lambda row: row['index']), 'controls': controls}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def consumed_cues(ui_manifest: Path, content: Path | None) -> list[dict[str, Any]]:
    """Every cue the game plays, as (alias, how to find it in the banks).

    Widget clicks name a Wwise event; a unit's voices are Wwise ids the DAT
    already holds, narrowed to the imported civilisation's branch of the
    switch container they all share.
    """
    cues: list[dict[str, Any]] = []
    for alias, event in sorted(json.loads(ui_manifest.read_text()).get("sounds", {}).items()):
        cues.append({"alias": alias, "event": event, "id": wwise_id(event), "switch": None})
    if content is None or not content.is_file():
        return cues
    imported = json.loads(content.read_text())
    profiles = [("", imported), *((f"civilizations/{key}/", profile)
                for key, profile in sorted(imported.get("civilizations", {}).items()))]
    for prefix, profile in profiles:
        switch = profile.get("audio", {}).get("switch")
        events: set[int] = set()
        for key, entity in sorted(profile.get("entities", {}).items()):
            for name, event_id in sorted(entity.get("sounds", {}).items()):
                cues.append({
                    "alias": f"{prefix}{key}-{name}",
                    "event": f"{entity.get('internalName', key)} {name}",
                    "id": event_id,
                    "switch": switch,
                })
            for animation in entity.get("animations", {}).values():
                events.update(item["event"] for item in animation.get("soundEvents", []))
        for event in sorted(events):
            cues.append({"alias": f"{prefix}events/{event}", "event": f"graphic {event}",
                         "id": event, "switch": switch})
    for event in sorted({slot.get("soundEvent", 0) for slot in imported.get("terrain", {}).values()} - {0}):
        cues.append({"alias": f"terrain/{event}", "event": f"terrain {event}", "id": event, "switch": None})
    return cues


def reviewed_unavailable_cue(cue: dict[str, Any], banks: Sequence[Bank]) -> dict[str, Any] | None:
    """A reviewed absent event, never an existing event whose graph failed.

    Normalize signed DAT IDs only for comparison/evidence. A supplied object of
    *any* type at this ID revokes the exception: malformed graphs, wrong object
    types, absent switch branches, missing media and decoder errors still fail.
    If a later pack supplies a playable event, the normal importer uses it.
    """
    if 'id' not in cue:
        return None
    event_id = cue['id'] & 0xffffffff
    if (cue['alias'], event_id, cue['switch']) not in REVIEWED_ABSENT_CUES:
        return None
    if not banks or any(event_id in bank.objects for bank in banks):
        return None
    return {'event': cue['event'], 'eventId': event_id, 'switch': cue['switch'],
            'reason': 'event-absent-from-owned-banks', 'issue': 271}


def import_audio(
    pack: Path | Sequence[Path], ui_manifest: Path, out: Path, decoder: str = "vgmstream-cli",
    content: Path | None = None, music: bool = False,
) -> dict[str, Any]:
    executable = shutil.which(decoder)
    if not executable:
        raise FileNotFoundError(f"{decoder} is required (macOS: brew install vgmstream)")
    cues = consumed_cues(ui_manifest, content)
    packs = [pack] if isinstance(pack, Path) else list(pack)
    banks = read_audio_packs(packs)
    catalogue = music_catalogue(banks) if music else None
    if catalogue:
        for track in catalogue['tracks']:
            cues.append({'alias': f"music/{track['name']}", 'event': track['name'],
                         'bankId': track['bankId'], 'mediaId': track['mediaId']})
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.wav"):
        old.unlink()

    imported: dict[str, Any] = {}
    unavailable: dict[str, Any] = {}
    source_hashes: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="aoe2-audio-") as temporary:
        temp = Path(temporary)
        for cue in cues:
            alias, event_name = cue["alias"], cue["event"]
            layers = [] if 'mediaId' in cue else [(bank, layer) for bank in banks
                for layer in resolve_event_layers(bank, cue['id'], cue['switch'])]
            matches = [(bank, cue['mediaId']) for bank in banks if int(bank.name) == cue['bankId']] if 'mediaId' in cue else []
            for bank, layer in layers:
                for media_id in layer['media']:
                    if not any(b.name == bank.name and mid == media_id for b, mid in matches):
                        matches.append((bank, media_id))
            if not matches:
                gap = reviewed_unavailable_cue(cue, banks)
                if gap is not None:
                    unavailable[alias] = gap
                    continue
                raise ValueError(f"Wwise event {event_name!r} did not resolve to complete media")
            files = []
            for index, (bank, media_id) in enumerate(matches):
                source = bank.media[media_id]
                media = source.read_bytes() if isinstance(source, Stream) else source
                wem = temp / f"{media_id}.wem"
                suffix = "" if len(matches) == 1 else f"-{index}"
                target = out / f"{alias}{suffix}.wav"
                target.parent.mkdir(parents=True, exist_ok=True)
                wem.write_bytes(media)
                subprocess.run(
                    [executable, "-i", "-o", str(target), str(wem)],
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                )
                with wave.open(str(target), "rb") as decoded:
                    duration = decoded.getnframes() / decoded.getframerate()
                files.append({
                    "file": target.relative_to(out).as_posix(),
                    "mediaId": media_id,
                    "bankId": int(bank.name),
                    "pack": source.pack.name if isinstance(source, Stream) else bank.pack,
                    "storage": "stream" if isinstance(source, Stream) else "embedded",
                    "seconds": round(duration, 6),
                    "sha256": sha256(target.read_bytes()),
                })
                source_hashes[str(media_id)] = sha256(media)
            imported[alias] = {"event": event_name, "files": files}
            if layers:
                indices = {(bank.name, media_id): index for index, (bank, media_id) in enumerate(matches)}
                imported[alias]['layers'] = [
                    {**{key: value for key, value in layer.items() if key != 'media'},
                     'fileIndices': [indices[(bank.name, media_id)] for media_id in layer['media']]}
                    for bank, layer in layers]

    version_result = subprocess.run([executable, "-V"], capture_output=True, text=True)
    try:
        decoder_version = json.loads(version_result.stdout)["version"]
    except (json.JSONDecodeError, KeyError):
        decoder_version = "unknown"
    manifest = {
        "audio": imported,
        "source": {
            "packs": sorted({pack.name for pack in packs}),
            "bankVersions": {bank.name: bank.version for bank in banks},
            "mediaSha256": source_hashes,
            "decoder": {"name": "vgmstream-cli", "version": decoder_version},
        },
    }
    if catalogue:
        manifest['music'] = {**catalogue, 'playlist': [f"music/{track['name']}" for track in catalogue['tracks']]}
    if unavailable:
        # Do not publish empty/synthetic WAVs or claim these aliases are playable.
        # No field is added for existing complete profiles (byte-identical output).
        manifest['unavailable'] = unavailable
    (out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", type=Path, action="append", required=True)
    parser.add_argument("--ui-manifest", type=Path, default=Path("public/imported/aoe2/ui/manifest.json"))
    parser.add_argument("--out", type=Path, default=Path("public/imported/aoe2/audio"))
    parser.add_argument("--decoder", default="vgmstream-cli")
    parser.add_argument("--content", type=Path, default=Path(".local/aoe2de/content.json"))
    parser.add_argument("--music", action="store_true", help="include complete available in-game music streams")
    args = parser.parse_args()
    import_audio(args.pack, args.ui_manifest, args.out, args.decoder, args.content, args.music)
    print(args.out / "manifest.json")


if __name__ == "__main__":
    main()
