#!/usr/bin/env python3
"""Resolve consumed Wwise events and decode their owned media with vgmstream.

This intentionally implements only the small, evidenced AKPK/BNK boundary the
slice consumes: event -> Play action -> sound/container -> embedded DIDX media.
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
from dataclasses import dataclass
from pathlib import Path
from struct import unpack_from
from typing import Any

from wwise_pck import extract, read_index


@dataclass(frozen=True)
class Bank:
    name: str
    objects: dict[int, tuple[int, bytes]]
    media: dict[int, bytes]


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
    return chunks


def read_bank(name: str, data: bytes) -> Bank:
    chunks = _chunks(data)
    hirc = chunks.get(b"HIRC")
    didx = chunks.get(b"DIDX")
    payload = chunks.get(b"DATA")
    if hirc is None or didx is None or payload is None:
        raise ValueError(f"{name}: bank lacks HIRC/DIDX/DATA")

    count = unpack_from("<I", hirc, 0)[0]
    offset = 4
    objects: dict[int, tuple[int, bytes]] = {}
    for _ in range(count):
        object_type = hirc[offset]
        size = unpack_from("<I", hirc, offset + 1)[0]
        object_id = unpack_from("<I", hirc, offset + 5)[0]
        objects[object_id] = (object_type, hirc[offset + 9:offset + 5 + size])
        offset += 5 + size
    if offset != len(hirc):
        raise ValueError(f"{name}: malformed HIRC object table")

    media: dict[int, bytes] = {}
    for offset in range(0, len(didx), 12):
        media_id, data_offset, size = unpack_from("<3I", didx, offset)
        media[media_id] = payload[data_offset:data_offset + size]
    return Bank(name, objects, media)


def read_banks(pack: Path) -> list[Bank]:
    banks: list[Bank] = []
    with pack.open("rb") as handle:
        for entry in read_index(handle)["banks"]:
            data = extract(handle, entry)
            try:
                banks.append(read_bank(str(entry.id), data))
            except ValueError:
                # Init/control banks may legitimately have no embedded media.
                continue
    return banks


def _object_references(payload: bytes, objects: dict[int, tuple[int, bytes]]) -> list[int]:
    # HIRC object lists are packed and not guaranteed to be 4-byte aligned.
    references: list[int] = []
    for offset in range(len(payload) - 3):
        candidate = unpack_from("<I", payload, offset)[0]
        if candidate in objects and candidate not in references:
            references.append(candidate)
    return references


def resolve_event(bank: Bank, event_name: str) -> list[int]:
    event_id = wwise_id(event_name)
    event = bank.objects.get(event_id)
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
            if media_id in bank.media and media_id not in media_ids:
                media_ids.append(media_id)
            return
        # Random/sequence and switch containers ultimately reference sounds.
        if object_type in (5, 6):
            for reference in _object_references(object_payload, bank.objects):
                if bank.objects[reference][0] in (2, 5, 6):
                    descend(reference, visited)

    for action_id in action_ids:
        action = bank.objects.get(action_id)
        if not action or action[0] != 3 or len(action[1]) < 6:
            continue
        # Scope byte, action-type byte, then the target HIRC object ID.
        descend(unpack_from("<I", action[1], 2)[0], set())
    return media_ids


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def import_audio(pack: Path, ui_manifest: Path, out: Path, decoder: str = "vgmstream-cli") -> dict[str, Any]:
    executable = shutil.which(decoder)
    if not executable:
        raise FileNotFoundError(f"{decoder} is required (macOS: brew install vgmstream)")
    aliases: dict[str, str] = json.loads(ui_manifest.read_text()).get("sounds", {})
    banks = read_banks(pack)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.wav"):
        old.unlink()

    imported: dict[str, Any] = {}
    source_hashes: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="aoe2-audio-") as temporary:
        temp = Path(temporary)
        for alias, event_name in sorted(aliases.items()):
            matches = [(bank, media_id) for bank in banks for media_id in resolve_event(bank, event_name)]
            if not matches:
                raise ValueError(f"Wwise event {event_name!r} did not resolve to embedded media")
            files = []
            for index, (bank, media_id) in enumerate(matches):
                media = bank.media[media_id]
                wem = temp / f"{media_id}.wem"
                suffix = "" if len(matches) == 1 else f"-{index}"
                target = out / f"{alias}{suffix}.wav"
                wem.write_bytes(media)
                subprocess.run(
                    [executable, "-i", "-o", str(target), str(wem)],
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                )
                with wave.open(str(target), "rb") as decoded:
                    duration = decoded.getnframes() / decoded.getframerate()
                files.append({
                    "file": target.name,
                    "mediaId": media_id,
                    "bankId": int(bank.name),
                    "seconds": round(duration, 6),
                    "sha256": sha256(target.read_bytes()),
                })
                source_hashes[str(media_id)] = sha256(media)
            imported[alias] = {"event": event_name, "files": files}

    version_result = subprocess.run([executable, "-V"], capture_output=True, text=True)
    try:
        decoder_version = json.loads(version_result.stdout)["version"]
    except (json.JSONDecodeError, KeyError):
        decoder_version = "unknown"
    manifest = {
        "audio": imported,
        "source": {
            "pack": pack.name,
            "mediaSha256": source_hashes,
            "decoder": {"name": "vgmstream-cli", "version": decoder_version},
        },
    }
    (out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--ui-manifest", type=Path, default=Path("public/imported/aoe2/ui/manifest.json"))
    parser.add_argument("--out", type=Path, default=Path("public/imported/aoe2/audio"))
    parser.add_argument("--decoder", default="vgmstream-cli")
    args = parser.parse_args()
    import_audio(args.pack, args.ui_manifest, args.out, args.decoder)
    print(args.out / "manifest.json")


if __name__ == "__main__":
    main()
