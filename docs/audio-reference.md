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
  The completion consumer now watches an owned foundation become a building;
  this exact timing interpretation remains inferred (#243).
- Terrain0's `wwise_sound_id`3923190460, shore1/2's1923763734,
  forest5/10's811708576, desert14's151185016 and deep-water22's1597834659
  resolve to ambient media. Playback now uses a bounded visible-camera-centre
  pool. Container mixing, timing and spatial rules remain #243; a flat media
  list does not specify the reference soundscape.
- Attack graphics can have `wwise_sound_id`0 while `angle_sounds_used`1 and
  nonempty `angle_sounds`: read frame/direction sound entries before declaring
  an attack silent. Militia attack1096 has event542552093 at frame12 in every
  direction; builder work1598 has1893274449 at frame12. Archer627 has two
  events at frames15/21. These now follow the renderer's attack/work clock,
  including skipped frames and per-swing resets. Death-wide cues play only
  when the visible live entity transitions; snapshots establish a baseline.
- Bank1638387902 contains119 music tracks (HIRC11),121 music segments (10),
  nine music random/sequence containers (13), one music switch container (12),
  plus events/actions. These include frontend/lobby/history music, and must
  not all be treated as the in-game playlist. See the named gameplay dialogue
  tree below (#115).

### Verification boundary

`tools/test_audio.py` constructs cross-bank/cross-pack fixtures, including
prefetch replacement, a colliding bus ID, non-Play actions and corrupt banks.
The owned integration test decodes an event whose complete stream is in
`Base.1.pck`, asserts duration over one second, and compares manifest/WAV bytes
across reversed pack order. Existing UI and civilisation-voice tests still run.
This establishes extraction and decoding, not acoustic equivalence to Wwise's
mixer, random weights, effects or interactive-music transitions.

`tools/audio_smoke.mts` adds real-browser playback evidence for #114: actual
selection/move/attack gestures, a paid house build button/placement, weapon and
hammer frame cues and completion. It waits for HTMLMediaElement `playing`, then
decodes played owned WAVs in Chrome and measures nonzero PCM. Looking away
silences combat and unseen terrain; watcher tests cover reveal/reconnect,
direction changes, paused frames and bounded missed intervals. This does not
claim a microphone comparison against a running DE mixer.

## Reviewed Persian Trade Cart source gaps (#271)

The owner approved an explicit unavailable-cue policy on2026-10-02 after the
following source audit. This removes the publication blocker; it does **not**
recover these sounds or establish native silence/fallback behaviour.

| Persian alias suffix | Unsigned Wwise event | Owned reference |
| --- | ---: | --- |
| `trade-cart-select` |3167914911| DAT8 unit128 selection (`-1127052385` signed) |
| `trade-cart-train` |955679769| DAT8 unit128 training |
| `events/2892846699` |2892846699| Graphic4862 ORIE cart death, frame15 |

All three are absent from every HIRC object table in the supplied common packs
(sound depot813783, manifest8547122694393480152). The earlier Artemis audit also
checked its matching English813787 Base/Base.1/DLCParis packs and found none.
This is absence before civilisation-switch filtering, not a graph decoding
failure. Local inventory contains no loose WAV/WEM/BNK alternative. The same
regional cart IDs appear in several other civilisations, but the approved
exception is restricted to the three `civilizations/persians/` aliases and the
`Persians` switch. DAT legacy sound305 still lists ordinary cart WAV names; that
does not establish a native fallback for the distinct modern Wwise IDs.

`import_audio.py` retains each gap under the audio manifest's top-level
`unavailable`, with its event ID, switch, reason and issue271. It does not add an
empty file or substitute audio under `audio`. The cart's move/attack cues and
the separate death event1206866217 remain imported normally. Existing complete
profiles retain their prior manifest shape.

An object of **any type** at a reviewed ID disables the exception. A recovered
playable event imports normally; wrong types, broken graphs, missing media,
incomplete stream prefixes and decoder failures remain failures. Unknown IDs,
aliases or switches also fail. The published coverage contract now requires
every consumed alias to be either playable owned media or an exact, visible
reviewed gap; the sets must be disjoint. Tests exercise both recovery and failure
paths, as well as real Persian DAT records and deterministic owned-WAV decoding.

## Saracen aliases of the shared Trade Cart source gaps (#271)

The October3 Saracen audit enumerated every consumed profile cue against both
supplied common packs (five banks). Exactly three fail, with no HIRC object in
any bank: `civilizations/saracens/trade-cart-select`3167914911,
`trade-cart-train`955679769 and `events/2892846699`2892846699, all with switch
`Saracens`. Evidence: `.local/saracens-audio-audit.log`; the initial full import
stopped at `TCART select`. These are independently verified absent source events,
not a general extension to every civilisation sharing cart graphics.

These are the same three regional Trade Cart event objects as the Persian gaps
above, absent before switch filtering, not three additional missing sounds.
Duplicate#286 was consolidated into#271. The exact Saracen alias tuples publish
as unavailable with issue271. The same present-object,
missing-stream and recovery guards apply. No silence WAV or replacement voice
is generated, and native fallback behaviour remains unverified. Fixture tests
cover Saracen publication, recovered real decoding and broken-present-event
rejection. #271 tracks original-source recovery for both profiles.

## Gameplay music (#115)

```sh
uv run --locked python tools/audio_inventory.py --music
```

The bank's HIRC15 `Ingame_Music` hashes to2613926250. Its one-argument dialogue
tree has31 leaf states: `MUSIC01` through `MUSIC30`, plus one non-media plug-in
control. Each numbered state maps to a sound object, which names a streamed
medium. The parser verifies the depth, argument, exact tree byte count, root
child span, leaf weights/probabilities and trailing empty property bundles.
The two-digit names are corroborated by their hashes in all30 leaves; the
numeric ordering is the local playlist policy, not a claim to implement the
closed engine's dynamic/chapter choices.

This is distinct from `Play_Music_Switch`1228139402 → music switch24633563.
Its state labels include `frontend`, `lobby`, `credits`, `history`, `win` and
`lose`; the long19-segment container270503669 belongs to `lobby`. Extracting
that attractive-looking container as gameplay music would have been wrong.
`sounds.json` does not name gameplay music. `widgetui/history.json` names
history stingers; `screenoptions.json` defines Soundtrack Playlist/Music Volume.
Localization98846 describes Standard, Classic, Reverse, Dynamic, Immersive and
Shuffle; Classic is the soundtrack without the civilisation theme. The current
consumer plays the available numbered soundtrack without themes.

### Missing complete streams (#244)

| State | Sound object | Media ID | Embedded prefix bytes |
| --- | ---: | ---: | ---: |
| MUSIC17 |174633414|730136042|25016|
| MUSIC27 |585835830|438278983|25206|
| MUSIC30 |662278358|1057400168|26922|

All three sources declare stream type1, but neither installed shared pack's
stream index contains their media IDs. Both external-stream tables are empty.
The optional English813787 depot is not installed; the installed root contains
813781/813782/813783/813784/1039811. The decoder can accept these prefixes as
millisecond-long audio, so successful decoding alone is insufficient. The
importer excludes them in explicit `music.unavailable` records and never
substitutes unrelated music. #244 tracks source recovery/availability.

The remaining27 complete tracks decode to6676.378775 seconds and1281865912
bytes of deterministic WAV (about1.28GB). Only the current track is loaded in
the browser; native ended events advance and wrap the playlist. Gesture unlock,
pause/resume and hidden/foreground preserve the current playhead; restart
releases it. Media failures are bounded, and absent owned audio stays silent.
`tools/music_smoke.mts` loads/plays every actual track and uses native seeking
and ended events to traverse the playlist, checking one live source, expected
durations and lifecycle controls. `MUSIC_SOAK=1` additionally waits for one
natural full playlist; it freezes scene redraws during that audio-only interval.
The 2026-09-27 run passed all27 natural endings and wrapped at13:10BST,
retaining one live soundtrack source. The first probe attempt hit CDP's default
RPC lifetime before a song finished; the maintained probe now receives short
per-track binding notifications instead of holding one two-hour RPC. Game and
fixture timing limits were not widened to hide a playback failure.

## Play-action layering and timing (#248)

All five owned banks declare BKHD version154. Of150 distinct consumed events,
119 have one playable action,23 have two, four have three and four have four:
193 Play actions in total. Flattening them into one variation pool discarded
simultaneous/offset layers. Reproduce their independent roots and parameters:

```sh
uv run --locked python tools/audio_inventory.py --event 1091801433 --event 542552093 --event 3923190460
```

- Militia training1091801433: immediate horn603334752, plus a separate voice
  pool delayed500ms. They are not alternative variants of the same sound.
- Militia attack542552093: two separate pools, the second delayed100ms.
- Grass3923190460: four independent pools, each with3000ms fade-in.
- The consumed Play actions use only properties58 (DelayTime, integer ms),
  59 (TransitionTime, integer ms) and60 (Probability, float percent). Four
  actions also carry signed delay-randomizer offsets. All193 use curve4,
  linear. The two property bundles and nine-byte suffix are walked exactly;
  unsupported versions/properties/curves fail explicitly.

Property semantics are corroborated by the Wwise editor observations in
[wwiser's notes](https://github.com/bnnm/wwiser/blob/master/doc/EDITOR.md#eventsactionsetc)
and the factual v154 enum mapping in
[`wdefs.py`71654ed](https://github.com/bnnm/wwiser/blob/71654ed1a2c4642894bd7e7ed79eba66986fb770/wwiser/parser/wdefs.py).
The repository's parser walks the owned bytes independently; no external parser
implementation is incorporated.

The manifest retains file indices per action plus delay/range, fade/range and
probability. The browser chooses one variation per action, schedules each layer,
and applies the linear fade after playback starts. Delayed layers count toward
the24-source cap. New acknowledgements, reset and hidden-tab cleanup cancel
pending playback/fades too. Cosmetic probability/range sampling derives from
the match seed without consuming simulation randomness.

Container random weights, continuous-loop graphs, bus DSP and spatial balance
remain #243. In particular, the ambient event is still a bounded repeated
invocation rather than Wwise's continuously running nested containers.

The browser acceptance observes all four grass layers starting at zero gain and
the long wind layer reaching its configured gain after the3-second envelope.
A real militia train-button completion plays both pools with a measured500.8ms
delay between Play calls. Fade measurement uses the monotonic playback-start
clock: Chrome's media playhead lagged it by about230ms in one probe, so comparing
those two clocks directly was an invalid assertion. Unit tests cover the linear
ramp, cancellation, probability and independent simulation randomness.
