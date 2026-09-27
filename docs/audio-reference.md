# Owned audio evidence

## Pack boundary (#57, 2026-09-27)

Patch pins are in `tools/aoe2-source.json`. `tools/audio_inventory.py` reads the
pack indices and bank HIRC metadata without publishing or copying assets:

```sh
uv run --locked python tools/audio_inventory.py --event 1357475385 --event 1116525532
```

| Shared depot 813783 | Bytes | Banks | Streams |
| --- | ---: | ---: | ---: |
| `wwise/Base.pck` | 327052161 | 5 | 73 |
| `wwise/Base.1.pck` | 683019998 | 0 | 649 |

The second pack contains streams, not additional banks. 720 of the 722 stream
IDs also occur in a bank's DIDX, but those embedded entries can be short prefetch
prefixes (for example media74285056:5844 embedded bytes versus607570 streamed).
The importer now prefers the complete stream, opens both packs, retains
control-only banks, and joins bank graphs while preserving local ID precedence.
Init bus30729851 collides with a gameplay event; actions930760380 and86531576
have bank-specific payloads. Blind dictionary overwrites are therefore incorrect.
Conflicting shared objects are excluded from cross-bank fallback; bank-local
objects remain authoritative. Stream reads are lazy, keeping the larger pack
out of memory until a consumed cue needs it.

### Follow-up sources found

- DAT `bird.wwise_move_sound_id` / `wwise_attack_sound_id` resolve in the
  gameplay bank232745270. Briton villager83 has1116525532 for both, resolving
  four acknowledgements; militia74 has move−514951588 (three) and
  attack−533257881 (four). These are order voices, not weapon impacts.
- Town centre109 `building.wwise_construction_sound_id` is1357475385, the same
  event as its selection sound, resolving media448598844. The previous claim
  that no owned construction cue exists was based only on `sounds.json`.
  The field names the sound; its exact completion timing still needs a consumer.
- Terrain0's `wwise_sound_id`3923190460, shore1/2's1923763734,
  forest5/10's811708576, desert14's151185016 and deep-water22's1597834659
  resolve to ambient media. Container mixing, timing and spatial rules need
  separate implementation; a flat media list does not specify a soundscape.
- Attack graphics can have `wwise_sound_id`0 while `angle_sounds_used`1 and
  nonempty `angle_sounds`: read frame/direction sound entries before declaring
  an attack silent.
- Bank1638387902 contains119 music tracks (HIRC11),121 music segments (10),
  nine music random/sequence containers (13), one music switch container (12),
  plus events/actions. Music is present in owned metadata. `sounds.json` names
  no gameplay music event; resolve the music graph for #115 rather than
  selecting arbitrary streams. Music object traversal is not implemented by
  the effects-only resolver yet.

### Verification boundary

`tools/test_audio.py` constructs cross-bank/cross-pack fixtures, including
prefetch replacement, a colliding bus ID, non-Play actions and corrupt banks.
The owned integration test decodes an event whose complete stream is in
`Base.1.pck`, asserts duration over one second, and compares manifest/WAV bytes
across reversed pack order. Existing UI and civilisation-voice tests still run.
This establishes extraction and decoding, not acoustic equivalence to Wwise's
mixer, random weights, effects or interactive-music transitions.
