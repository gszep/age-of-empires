# Owned audio evidence

## Build185872 Wwise172 format audit (#324)

The frozen185872 common and English banks declare **BKHD172**; the retained
48987 common banks declare154. Source format reference:
[wwiser08e937b](https://github.com/bnnm/wwiser/tree/08e937b649bc7007c234bbd59e34a41d5eef3b38),
particularly `parser/wparser.py` (Event, LoadSource, NodeBaseParams, StateChunk,
RanSeqCntr, SwitchCntr, ActionPlay, DialogueEvent and BankHeader) and `wdefs.py`.
No explicit redistribution licence was present at that revision: wwiser was
used only as a private research/audit executable, not vendored or added as a
dependency. `tools/wwise_hirc.py` independently implements the documented field
layouts; no third-party implementation is incorporated.

| Structure read |154 →172|
|---|---|
| AKPK/PCK | Still version1; sized language/bank/stream/external tables,20-byte bank/stream entries addressed by block×index. Common map names `sfx`; English map contains `en` and `sfx`. Bounds/counts/string offsets are now validated; nonempty external-source tables remain unsupported and fail explicitly. |
| BKHD | Same40-byte header (six u32 values plus16-byte hash), with optional alignment padding. Missing/truncated headers or versions other than154/172 fail at bank load, before sharing objects; music and event consumers also enforce the version. No version inferred from filenames. |
| HIRC envelope | Same u8 type/u32 section length/u32 ID; exact table end, duplicate chunks/IDs and truncated bodies checked. |
| Event4 | **Seven new bytes**: flags u8, instance limit u16, cooldown f32, before the variable-length action count. All audited172 events use zero; non-default event-control semantics fail instead of being ignored. Action count uses MSB-first7-bit groups, not LEB128. |
| Action3 | Same scope/type u16, target u32, bus flag and scalar/ranged property bundles. Every action body is validated before filtering Play versus control actions: exact suffixes for audited Stop/Pause/Resume/SetBusVolume/SetState/PlayEvent/Play forms. Short/malformed siblings cannot disappear behind a valid Play. Play adds curve u8/bank ID u32/bank type u32; Delay58/transition59/probability60 unchanged. All consumed Play actions remain linear curve4. Other curves in unconsumed actions can be structurally audited but still fail if requested for playback. |
| Sound2 | Same plugin u32/stream u8/source ID u32/cache ID u32/in-memory size u32/source flags u8; sized source-plugin data when plugin type2. Media ID is still at offset5, not cache ID. Complete streams take precedence over DIDX prefixes. |
| Shared audio-node parameters | FX/metadata/property/positioning/aux/voice/RTPC structures unchanged for these versions. **Each nonempty state group gains a u32 group-usage ID** after group ID. The complete counted structure is walked, including inline state properties. |
| Random/sequence5 | Same loop/range/transition/mode fields, child IDs and u16-counted (play ID,weight) playlist.172 follows actual playlist edges, not incidental IDs in parent/FX/parameter fields. Playlists can reference objects in another bank outside the bank-local child inventory. |
| Switch6 | Same group/default/continuous flag, child IDs, switch packages and node/fade records. One switch-node flag bit is renamed ContinuePlayback→ContinueAcrossSwitch, with no width change. Civilization branches retain source order; unsupported graph nodes and missing referenced media fail. |
| Dialogue15 / music | Same one-argument decision-tree layout and12-byte leaf records. Existing exact tree/weight/property-suffix guards remain. |
| DIDX/DATA | Unchanged12-byte ID/offset/size records, bounded against DATA. Their existence does not prove a streaming prefix is a playable file. |

The external reference parser consumed **44,236 HIRC objects in13 banks**
(48987:17,012;185872 common:17,828;185872 English:9,396), with **zero parser
errors and zero unexplained-byte skips**. This includes control/bus/music and
attenuation objects outside the importer's gameplay graph traversal. The
independent reader exactly walks **43,019** Sound/Random/Switch/Event/Action
objects across those banks. Non-consumed structures remain outside the local
mixer implementation, not evidence for acoustic equivalence. Synthetic tests
cover both versions, state usage IDs, multibyte counts, complete/truncated
containers, incidental-ID rejection, split-bank playlists and broken layers.

Version154 uses the existing resolver unchanged. A private full48987 decode
was followed by a full current-code manifest rerun, reusing PCM only after
checking each alias's media ID, source SHA256 and WAV SHA256: **manifest bytes
identical,42,309 WAV selections verified**. No source or public asset writes.

### 185872 pack placement and coverage

| Snapshot path | Bytes | Banks | Streams |
|---|---:|---:|---:|
| `wwise/Base.pck` |292260719|5|228|
| `wwise/Base.1.pck` |733879405|0|680|
| `wwise/en/Base.pck` |24415107|3|160|
| `wwise/en/Base.1.pck` |205106290|0|2650|

In the merged-install facade,813783 and813787 point at the same install root.
The English material is under **`wwise/en`**, not a second copy of the common
`wwise/Base.pck`. DLC packs are also present (including English DLCParis).
The common pair resolves all currently consumed cues except the six reviewed
Trade Cart gaps below. Joining the two English Base
packs adds **zero** consumed cue resolutions and does not recover MUSIC17/27/30.

The private185872 audio stage decoded **8,139 cues /42,373 WAV entries**,
including27 music tracks. Relative to the published48987 manifest:1 alias
added,2 removed,6,825 serialized cue records changed,1,313 unchanged. Only217
common cues change normalized media/PCM pools or action layers;6,608 changes
are **ordering-only**, not provenance or new audio. A controlled three-way
comparison forces the structural reader on154 as well: structural48987 versus
published48987 yields **zero substantive parser changes**; structural48987
versus structural185872 yields **217 source changes** (213 Byzantine bank-only
playlist changes,1 Viking monk train DAT-only reroute,3 Viking monk DAT reroutes
whose newly selected bank paths also change). Normalization sorts each variation
pool and remaps layer file indices to media IDs, preserving PCM hashes/durations,
action IDs and all timing/probability fields. The unchanged154 production path
still reproduces published bytes;172 deterministically follows playlist order
instead of legacy byte-occurrence order. Positional WAV filenames consequently
reorder with the pool; no samples or layers are added/lost by that reordering.
This is not a claim that every source delta is a newly recorded sound.
The added alias is Vikings graphic event2841441069; removed aliases are
Vikings graphic events2300401013 and2467571964.

All following edges are in bank232745270. These controls distinguish unchanged
DAT routes with changed bank children from changed DAT routes into existing
bank paths:

| Cue | Source attribution |
|---|---|
| Byzantine Archer4 select | DAT event2301632855 unchanged → action657013067 → switch11356742 (Byzantines branch3777346574) → random195043900. Playlist sound IDs565525228/561195654/738659447 become566833236/580647850/400809331. Media840928471/1038182325/296425037 become232406091/99901242/968752947. Bank-edge change, not parser selection. |
| Byzantine Militia74 select | Same DAT event and same bank path as Archer4; the same three playlist replacements explain the change. |
| Byzantine Villager83 select | DAT event3746790103 unchanged → action49029369 → switch310994831 → random252110874. Media885874642/122946151/747618557/138669935 become976663584/458032094/743959926/470328306 through replacement sound children. Bank-edge change. |
| Viking Monk125 train | DAT event4162654086 →2235729375. Old path: action517516224→random789163948→sound48084166→media1010371078. New path: action925796198→random779885862→sound814157156→media531099322. Both paths already exist in both builds' banks; crossed DAT/bank inputs confirm a DAT reroute. |

There are **no unreviewed unresolved consumed cues in this common-pack run**.
The same six Saracen/Turk Trade Cart aliases remain explicitly unavailable under#271, and the same three
incomplete music streams remain listed under#244. No new silence exceptions
were added. Container weighting/continuous-loop scheduling, bus DSP, spatial
mixing and switch-transition envelopes retain the existing#243 boundary.

**New#271 recovery evidence, not a substitution:** scanning30 additional DLC
banks finds all three missing event IDs in `Pompeii.pck`, bank966081492. The
standalone bank resolves them to complete pools (four media for selection/train,
six for death), without a Civilization switch. However, joining Pompeii with
the common packs fails on conflicting embedded media76423142. That pack belongs
to a different content mode; importing it indiscriminately could change unrelated
cues. The events are no longer accurately described as absent from *all owned
files*. The current pipeline's common/English absence and reviewed silence are
unchanged; safe source scoping/recovery remains a separate#271 decision.

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
Init bus 30729851 collides with a gameplay event; actions930760380 and86531576
have bank-specific payloads. Blind dictionary overwrites are therefore incorrect.
Conflicting shared objects are excluded from cross-bank fallback; bank-local
objects remain authoritative. Stream reads are lazy, keeping the larger pack
out of memory until a consumed cue needs it.

### Follow-up sources found

- DAT `bird.wwise_move_sound_id` / `wwise_attack_sound_id` resolve in the
  gameplay bank232745270. Briton villager 83 has1116525532 for both, resolving
  four acknowledgements; militia 74 has move−514951588 (three) and
  attack−533257881 (four). These are order voices, not weapon impacts.
- Town centre 109 `building.wwise_construction_sound_id` is1357475385, the same
  event as its selection sound, resolving media448598844. The previous claim
  that no owned construction cue exists was based only on `sounds.json`.
  The completion consumer now watches an owned foundation become a building;
  this exact timing interpretation remains inferred (#243).
- Terrain0's `wwise_sound_id`3923190460, shore 1/2's1923763734,
  forest 5/10's811708576, desert 14's151185016 and deep-water 22's1597834659
  resolve to ambient media. Playback now uses a bounded visible-camera-centre
  pool. Container mixing, timing and spatial rules remain #243; a flat media
  list does not specify the reference soundscape.
- Attack graphics can have `wwise_sound_id`0 while `angle_sounds_used`1 and
  nonempty `angle_sounds`: read frame/direction sound entries before declaring
  an attack silent. Militia attack 1096 has event542552093 at frame 12 in every
  direction; builder work 1598 has1893274449 at frame 12. Archer627 has two
  events at frames 15/21. These now follow the renderer's attack/work clock,
  including skipped frames and per-swing resets. Death-wide cues play only
  when the visible live entity transitions; snapshots establish a baseline.
- Bank1638387902 contains 119 music tracks (HIRC11),121 music segments (10),
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
| `trade-cart-select` |3167914911| DAT8 unit 128 selection (`-1127052385` signed) |
| `trade-cart-train` |955679769| DAT8 unit 128 training |
| `events/2892846699` |2892846699| Graphic4862 ORIE cart death, frame 15 |

All three are absent from every HIRC object table in the supplied common packs
(sound depot 813783, manifest8547122694393480152). The earlier Artemis audit also
checked its matching English813787 Base/Base.1/DLCParis packs and found none.
This is absence before civilisation-switch filtering, not a graph decoding
failure. Local inventory contains no loose WAV/WEM/BNK alternative. The same
regional cart IDs appear in several other civilisations, but the approved
exception is restricted to the three `civilizations/persians/` aliases and the
`Persians` switch. DAT legacy sound 305 still lists ordinary cart WAV names; that
does not establish a native fallback for the distinct modern Wwise IDs.

`import_audio.py` retains each gap under the audio manifest's top-level
`unavailable`, with its event ID, switch, reason and issue 271. It does not add an
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
as unavailable with issue 271. The same present-object,
missing-stream and recovery guards apply. No silence WAV or replacement voice
is generated, and native fallback behaviour remains unverified. Fixture tests
cover Saracen publication, recovered real decoding and broken-present-event
rejection. #271 tracks original-source recovery for both profiles.

## Gameplay music (#115)

```sh
uv run --locked python tools/audio_inventory.py --music
```

The bank's HIRC15 `Ingame_Music` hashes to2613926250. Its one-argument dialogue
tree has 31 leaf states: `MUSIC01` through `MUSIC30`, plus one non-media plug-in
control. Each numbered state maps to a sound object, which names a streamed
medium. The parser verifies the depth, argument, exact tree byte count, root
child span, leaf weights/probabilities and trailing empty property bundles.
The two-digit names are corroborated by their hashes in all 30 leaves; the
numeric ordering is the local playlist policy, not a claim to implement the
closed engine's dynamic/chapter choices.

This is distinct from `Play_Music_Switch`1228139402 → music switch24633563.
Its state labels include `frontend`, `lobby`, `credits`, `history`, `win` and
`lose`; the long 19-segment container270503669 belongs to `lobby`. Extracting
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

All three sources declare stream type 1, but neither installed shared pack's
stream index contains their media IDs. Both external-stream tables are empty.
The optional English813787 depot is not installed; the installed root contains
813781/813782/813783/813784/1039811. The decoder can accept these prefixes as
millisecond-long audio, so successful decoding alone is insufficient. The
importer excludes them in explicit `music.unavailable` records and never
substitutes unrelated music. #244 tracks source recovery/availability.

The remaining 27 complete tracks decode to6676.378775 seconds and1281865912
bytes of deterministic WAV (about 1.28GB). Only the current track is loaded in
the browser; native ended events advance and wrap the playlist. Gesture unlock,
pause/resume and hidden/foreground preserve the current playhead; restart
releases it. Media failures are bounded, and absent owned audio stays silent.
`tools/music_smoke.mts` loads/plays every actual track and uses native seeking
and ended events to traverse the playlist, checking one live source, expected
durations and lifecycle controls. `MUSIC_SOAK=1` additionally waits for one
natural full playlist; it freezes scene redraws during that audio-only interval.
The 2026-09-27 run passed all 27 natural endings and wrapped at13:10BST,
retaining one live soundtrack source. The first probe attempt hit CDP's default
RPC lifetime before a song finished; the maintained probe now receives short
per-track binding notifications instead of holding one two-hour RPC. Game and
fixture timing limits were not widened to hide a playback failure.

## Play-action layering and timing (#248)

All five owned banks declare BKHD version 154. Of150 distinct consumed events,
119 have one playable action,23 have two, four have three and four have four:
193 Play actions in total. Flattening them into one variation pool discarded
simultaneous/offset layers. Reproduce their independent roots and parameters:

```sh
uv run --locked python tools/audio_inventory.py --event 1091801433 --event542552093 --event 3923190460
```

- Militia training1091801433: immediate horn603334752, plus a separate voice
  pool delayed500ms. They are not alternative variants of the same sound.
- Militia attack542552093: two separate pools, the second delayed100ms.
- Grass3923190460: four independent pools, each with3000ms fade-in.
- The consumed Play actions use only properties58 (DelayTime, integer ms),
  59 (TransitionTime, integer ms) and 60 (Probability, float percent). Four
  actions also carry signed delay-randomizer offsets. All193 use curve 4,
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
the 24-source cap. New acknowledgements, reset and hidden-tab cleanup cancel
pending playback/fades too. Cosmetic probability/range sampling derives from
the match seed without consuming simulation randomness.

Container random weights, continuous-loop graphs, bus DSP and spatial balance
remain #243. In particular, the ambient event is still a bounded repeated
invocation rather than Wwise's continuously running nested containers.

The browser acceptance observes all four grass layers starting at zero gain and
the long wind layer reaching its configured gain after the 3-second envelope.
A real militia train-button completion plays both pools with a measured 500.8ms
delay between Play calls. Fade measurement uses the monotonic playback-start
clock: Chrome's media playhead lagged it by about 230ms in one probe, so comparing
those two clocks directly was an invalid assertion. Unit tests cover the linear
ramp, cancellation, probability and independent simulation randomness.
