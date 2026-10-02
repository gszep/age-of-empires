# Handoff — trebuchet automation verified, 2026-10-02

## Verified checkpoint: #131 and #133

Trebuchets now automatically deploy for eligible visible enemy buildings. Packed
right-click attacks approach, set up and fire; distant explicit targets cause
repacking/redeployment. Manual Pack holds until a new command, move orders can
cancel unfinished setup, and repeated moves do not restart packing. The example
AI gathers missing castle stone, builds/re-staffs a castle, reserves siege
resources, trains a bounded force and attacks known buildings through public
commands. [Contract and source audit](trebuchet-automation.md).

- **Full gate GREEN**,918s (15m18s):1351 TypeScript tests/108files,8 existing
  explicit skips, build,192 Python/owned import tests and general browser smoke.
  Log:`.local/trebuchet131-gate.log`. This includes the prior#133 working-tree
  changes. Only Markdown changed after gate start.
- **26 new outcome tests**:21deployment/control/JSON cases,5AI cases, with open
  and owned actual damage plus Japanese setup timing. The old packed-right-click
  assertion was replaced by the behavior explicitly described in the owned
  AoK manual p81; its timing/damage checks remain.
- Registered `trebuchet-automation` acceptance passes on this code/metadata:
  `.local/trebuchet131-acceptance.log` and
  `.local/acceptance/trebuchet-automation.json`. Real owned/open browser input
  covers Stop→automatic deployment/fire, paid castle training, packed right-click
  approach/fire, ground-click repacking, manual Pack hold and group Pack/Unpack.
  Owned checks bind original packed/deployed sprite art.
- AI acceptance supplies a late-game army, Imperial Age, housing and640stone;
  the remaining gathering, construction, training and bombardment are real.
  Early fixture attempts ended at the last-TC defeat shortcut or lacked sight
  of the second objective. The final fixture asserts its scouting precondition
  and supplies a second enemy TC. An intermediate full-map wall fixture exceeded
  the shell timeout and was replaced by the open-field durable-objective fixture;
  no test/browser timeout was widened. It is not a natural-start balance claim.
- Remaining: native acquisition/retarget/stance/task109 wait and interruption
  calibration under#131/#259; natural-start AI progression/balance under#124.
  The inferred rules are explicit in the ledger. No native-DE runtime capture,
  siege-specific two-client browser scenario or new strategy batch was run.
- This checkpoint is **not deployed**. Verification processes have
  exited; the managed household release is unchanged.

## Earlier gate verification: #133

Automatic gates now have authoritative `closed/open/blocked` state. Collision
and imported art read the same state; owner approach opens an uncontested gate,
enemy doorway contact closes it for everybody, and departure closes it again.
Owner routing can approach a closed gate without treating it as physically open.
All three gate kinds and both axes retain their doorway/post geometry.

- **Full gate GREEN**,908s (15m08s):1325 TypeScript tests/106files,8 existing
  explicit skips, build,192 Python/owned import tests and general browser smoke.
  Log:`.local/gates133-gate.log`. Only Markdown changed after gate start.
- Fifteen new gate tests cover crossing, automatic closure/reopening, enemy
  precedence, cached paths, foundations/destruction, neutral/dead units, both
  checksums and JSON continuation. Existing navigation/building/render tests pass.
- `npx tsx tools/gates_smoke.mts` passes public-command movement and actual
  imported poses for palisade/x, stone/y and fortified/x. A sealed wall forces
  owner passage through the gate; enemy contact closes it, retreat reopens it,
  and the owner returns through it before it shuts. The fixture disables the
  solo AI so it cannot overwrite the controlled enemy's orders. The first run
  reached owner passage but timed out at enemy contact with that AI still active;
  no assertion or timeout was relaxed. Log:`.local/gates133-browser-r2.log`.
  Registered as `automatic-gates`; the successful direct run is not a registry receipt.
- Owned DAT transform pairs789↔790,793↔794,64↔78 prove closed/open obstruction
  types2/0. Trigger range, enemy contact boundary, neutral handling and immediate
  tick transitions remain inferred in the ledger. Native timing/range, diagonal
  gates, two-client gate-specific acceptance and fallback gate artwork were not
  verified. #133 remains open for the native calibration boundary.
- This earlier browser evidence predates#131; the current combined-tree gate is
  listed above. Both changes are included in this checkpoint and are not deployed.

## Previous siege checkpoint: #278

This checkpoint includes the Mangonel-family automatic friendly-fire guard,
reviewed against `d1db0fc` and fully reverified. It is **not deployed** to the
household services; their live seven-profile release is still the one listed below.

- Mangonels, Onagers and Siege Onagers skip unsafe automatic targets, hold fire
  if a friend enters the blast area after acquisition, and resume or select a
  safe alternative. The optional automatic-order marker survives JSON saves;
  explicit and unmarked legacy attacks retain their existing friendly fire.
- The guard uses resolved blast radius/eligibility and current friendly bodies
  around current/nominal led aim, including buildings that actually take splash.
  It does not predict future friendly movement or protect against already
  airborne stones. Native pursuit/retarget/interception/scatter calibration stays
  under#131; the ledger names the legacy manual versus inferred implementation.
- **42 outcome tests pass**. The39 saved cases are retained; added regressions
  cover friendly buildings, unmarked legacy JSON orders and a Ballistics-led
  moving-target case whose explicit counterpart really hurts the friendly unit.
- Real-browser acceptance passes all three owned units and both fallback units:
  actual Stop, right-click move, right-click attack and the added **Attack Ground
  button plus ground click**, original owned body artwork, target/friendly HP and
  actual splash. Scenarios are staged; no original assertion or clock changed.
  Log:`.local/siege278-interactive-acceptance.log`.
- The original two-browser shared checks pass: paid training, equal state,
  selection-preserving recovery, reload,1500+ticks with0 unintended resyncs and
  checkpoint restart/reconnect. Log:`.local/siege278-interactive-shared.log`.
  Siege-specific saved-order continuation is covered by the outcome tests; the
  shared smoke is the existing generic scenario, not a two-client siege battle.
- **Full gate GREEN**,808s (13m28s):1310 TypeScript tests/105files,8 existing
  explicit skips, build,192 Python/owned import tests and real-browser smoke.
  Log:`.local/siege278-interactive-gate.log`. Registered siege-safety/shared
   receipts matched that checkpoint. Only Markdown changed after its gate start.
- Private verification processes have exited; the intended managed shared host
  remained running. At that checkpoint, parent#131 separated pending trebuchet
  automation/calibration from shipped Petards and group packing; see the current
  section above for the later implementation.

## Run ended; interactive Persian audio follow-up

The supervised worker exited at **2026-10-02 14:01 UTC** with a provider-operation
timeout, before its17:00UTC deadline. It left the separately verified#278 siege
changes uncommitted and did not create the planned final report. Baseline da81bf3;
actual worker start2026-10-01T21:30:37Z. Ten commits were pushed through8b91dcc.
Durable evidence: `.local/autonomous-20261001-{brief,progress}.md` and
`.local/runs/autonomous-20261001-r2/status.json`.

The preceding pushed checkpoint `d1db0fc` implements the owner's approved#271
source-gap policy below. Its focused/feature verification and exact staged-tree
full gate passed. The archived Persian implementation and live seven-profile
deployment were not replaced by that audio-only follow-up.

### Previous audio-only checkpoint verification (`d1db0fc`)

- **Full gate GREEN**,812s (13m32s):1268 TypeScript tests/104files,8 existing
  explicit skips, build,192 Python/owned import tests and real-browser smoke.
  Log:`.local/audio271-gate.log`; stage logs:`.local/audio271-gate-step-*.log`.
- Verification ran against exactly the staged audio change. Unrelated#278 work
  was archived, excluded from that test tree, then restored and compared with
  the archive byte-for-byte. Its then39 additional tests were not part of that
  checkpoint's1268 count; the siege change is included in the current checkpoint.
- Registered audio acceptance also passed on that exact tree:
  `.local/audio271-staged-acceptance.log`, `.local/acceptance/audio.json`.
  That receipt certifies `d1db0fc`'s code/metadata, rather than the subsequent
  combined siege checkpoint.
- Only Markdown changed after the gate started. No fixture clock or existing
  browser assertion was relaxed; the three-gap coverage policy was explicitly
  approved by the owner and tested as recorded below.

## Earlier pushed source checkpoints

| Commit | Verified scope | Remaining boundary |
| --- | --- | --- |
| f94b18e | Byzantines#185; lossless schema4 atlas-frame interning#268 (552→53MB) | Native healing/blast/rounding#267 |
| a208f7c | Original ordinary A/B attack art, source clocks/sounds/composites#270 | Native first/reset/naval cadence#272 |
| 5ced752 | Scoped dev/immutable watchers and actual cross-machine shared verification#273 | Detailed evidence in `.local/asset266-*` logs |

Each passed its full gate and feature/browser checks. Current delivered scope
is in [status](status.md); source/inferred distinctions are in [ledger](ledger.md).

## Islands fish checkpoint 0d86953 (#95)

- Salmon456 and dorado455 now have distinct original underwater/leap art alongside
  snapper458 and shore fish69. Shared fish-kind handling covers gathering/banking,
  continuation, AI, cursors and live/fog rendering. All four identities pass actual
  gathering/depletion/banking outcomes in both fallback and imported modes.
- Owned `GeneratingObjects.inc` global Gaia passes replace compulsory fish
  mirroring. Both unpaired resource-islet coasts receive shore fish across six
  tested seeds. A narrow owned extractor checks counts/spacing/season pairs;
  terrain and non-fish object placement remain unchanged by fish configuration.
- PH_DESERT selects dorado, spring/Mediterranean salmon; the borrowed Nearctic
  dressing uses the spring pair as an explicit inference. Native weighted seasons
  and missing Whale/Gaia Dock passes are#274. #95 retains grown-water-mask/native
  placement calibration; no native RNG parity is claimed.
- Full owned import EXIT0; gate GREEN1249TS/103files,8existing skips, build,
  186Python/owned and browser,758s. Final feature receipt covers49 outcomes plus
  original live→memory→live textures for all four fish and berries. Initial browser
  fixture positions outside scout sight were corrected; no clock changed or
  assertion waived. Observed HTTP404s are `favicon.ico`, not artwork.
- Logs:`.local/fish95-{import,gate,acceptance,soak}.log`. The fish content and gateway
  fix are now included in the privately verified household deployment below.

The unchanged default30-minute renderer soak for this fish checkpoint recorded
30samples, one completed round and Arabia/Windsor coverage, with0errors/invalid
bindings. Actual interval:06:21:01.913–06:50:59.607UTC; startup is inside the
established overall budget. Log:`.local/fish95-soak.log`. This is general renderer
endurance, not Islands-specific endurance or a physical-GPU FPS claim.

At the fish checkpoint, islands-fish, fish-fog and soak receipts matched and passed.
Its overall `acceptance.mjs check` reported the explicitly known-gap#124 AI progression
receipt missing, plus unmapped shared files. Those files were verified by the full
gate, owned fish source contracts, species gathering/banking outcomes, fishing AI
outcomes and cursor/continuation tests; no claim that its aggregate check was green
or that#124 is fixed.

## Gateway checkpoint 385da49 (#275, closed)

Private rollout checks exposed `ECONNRESET` on a reused upstream HTTP socket while
loading `/src/dev-debug-stats.ts`. The gateway now retries a body-free GET/HEAD
once on a fresh connection, before headers only. POST/body/fresh-socket failures
are not replayed; partial responses terminate safely. Eight real-upstream tests
cover those outcomes. The config endpoint also logs its failure cause.

Hash-verified Artemis/Ysgramor acceptance passes all original train clicks, equal
state, recovery, reload,1500+ticks with0unintended resyncs, checkpoint restart and
311guest PNG responses from local disk. Frozen host acceptance also passes, with
original x1 fish decoding, both resource-islet coasts and paid training/reload;
the gateway logs recovery of the reproduced reset. Logs:
`.local/proxy275-{cross-machine-final,frozen,confirmed-reset,gate}.log`.
Gate GREEN:1256TS/103files,8existing skips, build,186Python/owned and browser;
755s. The selected shared receipt and aggregate acceptance check pass. No fixture
clock or original browser assertion changed.

Earlier supposed-fixed remote attempts actually retained the old helper: a
post-stop `ps` exit1 skipped the chained copy. Their failures remain recorded and
are not claimed to test the fix. Corrected publication independently compared
local/remote SHA256 before running acceptance. The separate client failure mode,
silently starting solo on config502, is addressed in the following#276 checkpoint.

## Shared startup checkpoint 43e10ad (#276, closed)

Failed HTTP/network/JSON/configuration discovery keeps startup pending with a
visible unavailable/reconnecting notice. It preserves saved state and retries at
the existing1500ms reconnect cadence; a valid response joins without reloading.
Explicit solo, static404/successful HTML and explicit disabled config still work.
Protocol mismatch is visible rather than silently becoming a solo game.

Eleven focused cases and real owned/fallback browsers pass repeated502, no solo
HUD/debug startup, unchanged saved state, recovery to the saved match and a paid
train click. Normal two-browser acceptance passes all existing state/recovery/
reload/1500ticks/restart checks with0unintended resyncs. The first new fixture
incorrectly expected no debug connection record in standalone mode; the existing
schema always supplies one, so it now checks disconnected/no shared stats and
no discovery fetch for explicit solo. No original assertion or clock changed.
Logs:`.local/config276-{acceptance-r2,shared,gate}.log`.
Gate GREEN:1267TS/104files,8existing skips, build,186Python/owned and browser;
747s. Both selected feature receipts pass. Aggregate acceptance check only flags
the newly edited registry file as unmapped; that JSON was parsed and its commands
executed by the passing shared-startup/shared runs. The privately verified frontend
is now live as recorded below.

## Real atlas-cache verification (#257)

The previously implemented layer-aware cache now has the missing real-workload
proof: three complete isolated x1 imports replay the historical RGB565 correction.
Corrected cached/fresh publications have24715byte-identical files and identical
cache metadata. Exactly2558 unaffected shadow/outline/damage groups are reused;
1170main+1170player-colour groups regenerate. Atlas-only elapsed falls
2415.81→1666.23s (31.03%); aggregate CPU9209.14→6200.41s (32.67%) in this one
four-worker/nice10 run. No x2/universal/FPS claim. Decoded RGBA8 samples confirm
actual nontransparent texel changes in both dependent layers.

Method, complete hashes, timing limits and reproduction command:
[cache verification](reviews/2026-10-02-atlas-cache.md). Full study receipt:
`.local/cache257-study-r2/report.json`; pixel supplement:`pixel-evidence.json`.
The production decoder, cache implementation and live assets were not changed.
Checkpoint gate GREEN:1267TS/104files,8existing skips, build,186Python/owned and
real-browser smoke,831s (`.local/cache257-gate.log`). No fixture clock changed.

Source validation found the newly consumed default Slavic monk x1 file truncated
at1MiB (#277). Its existing pinned recovery copy validates; all1170 recovered
inputs pass and this is their only difference from default. The study used that
recovery read-only. Owner default-depot copy-back remains open; see
[source integrity](source-integrity.md).

## Live deployment (#266/#95/#275/#276)

- Host:<http://localhost:5173/>; solo:<http://localhost:5173/?solo=1>.
- Tailnet:<https://ysgramor.tail6e864b.ts.net:5173/>.
- Artemis gateway:<http://localhost:5174/>.
- Gateway/art updated at **08:08 UTC**, frontend at **08:57 UTC**, after private
  acceptance. At the **08:59 joint check**, both managed `open-empires-shared`
  services were active/running, NRestarts0, ExecMainStatus0; configs reported
  protocol2 and seats1/2. Artemis SSH timed out at09:14 and again12:35, so later
  remote live-health is unverified. All private remote jobs had already been cleaned.
- Ysgramor release:`.local/releases/autonomous-20261002-43e10ad`, source
  `43e10adfdfefa62aae3437065a30aa481a41e02b`, fingerprint
  `c54c2fd402804f6d9926edee17e7c9e665e91e5a909bc70402c57c7f545488f1`.
- Artemis gateway/source/art runtime:
  `/home/gszep/Documents/repos/age-of-empires/.local/owned-runtime-0d86953`;
  assets are its `public` directory. Its source was advanced to exact385da49,
  recorded in `.local/source-revision.txt`, with the helper SHA256 independently
  matched before acceptance. The original dirty application clone was preserved.
  This gateway proxies the newer43e10ad frontend; its assets/code did not need
  changing for that frontend-only update.
- Both have seven profiles/184 definitions each. Artemis has4598 x1 sprite pages;
  Ysgramor has4750 x2 pages. Each has3666 audio aliases and0 missing referenced
  image/audio files. Both resolve rules hash
  `15c4e2017d0f62c40dc979c60df45855dd80ec6bbce54d30db2678886b9def78`.
  Logs:`.local/fish95-{remote,local}-inventory.log`.
- Remote full import passes from patch-matched owned base depots, validating
  source integrity before decoding; no source recovery was needed.186 remote
  Python/import cases completed with1 existing x2-only skip.49 fish outcomes and
  the original-species/fog browser pass on Artemis's x1 renderer. Local relay:
  `.local/fish95-remote-verify.log`; individual logs are in that runtime's `.local`.
  Earlier Byzantine/Chinese/alternate-art evidence remains in asset266 logs.
- Actual two-machine shared smoke passes: both train clicks/equal state,
  selection-preserving recovery, reload,1500+ticks with0 unintended resyncs,
  checkpoint restart and311 guest PNG responses from Artemis disk
  (`.local/proxy275-cross-machine-final.log`).
- The actual frozen host entrypoint was also accepted privately with an Artemis
  guest: Islands rare-fish count, both resource-islet shores, source x1 fish PNG
  decoding, Byzantine/Japanese menu selection, paid training, equal state and
  reload. Latest receipt:`.local/config276-release.log`, tick85/hash25e94191, for
  the exact43e10ad frozen host with Artemis guest. Earlier candidate failures
  remain recorded; no timeout was widened. Live manifest-driven
  PNG signature checks also pass on both endpoints (`proxy275-live-*-assets.log`).
  Live client modules are byte-identical through both endpoints and contain the
  recovery logic (`config276-live-*-client.js`).
- Before switching, Artemis had no active5174 TCP connections; Ysgramor had two
  unchanged queued loopback connections and one CLOSE-WAIT socket. The authorised
  stop accounted for those. No current `.local/shared-match.json` existed before
  or after shutdown. Useful private candidate state is retained separately.
  Latest route/preservation notes are in `.local/config276-pre-deploy/`; gateway
  update notes are in `.local/proxy275-pre-deploy/`; prior
  deployment service evidence remains in `.local/asset266-pre-deploy/`. Direct
  local service-file Read was denied; no alternate file read was attempted, and
  the authorised maintained installer performed the service update.
  Both hosts' Tailscale route JSON is byte-identical before/after; no route reset.
- Preceding Ysgramor `.local/releases/autonomous-20261002-385da49`/`5ced752` and Artemis
  `.local/owned-runtime-a208f7c` remain intact for rollback, alongside the older
  review-followthrough-final/shared-gateway-review241/performance-runtime paths.
  No generic incompatible-checkpoint migration is claimed.
- Owned QA host/gateway/tunnel/Chrome processes have been stopped and their PIDs
  and private listening ports rechecked. Only the intended managed services
  survive. The user's interactive Artemis Chrome was not controlled or stopped.

## Persians#186: audio blocker removed under approved source-gap policy

Persians reached29 passing gameplay outcomes and four owned contracts; the broader
Persian/Chinese/Byzantine run passed69 cases before the added cart-conversion case.
Its full art/UI conversion succeeded, but audio publication failed.

Three Persian Trade Cart event IDs are absent from every supplied common bank:
3167914911 (selection),955679769 (training),2892846699 (animation). Artemis's
matching common and additional English Base/Base.1/DLCParis packs also lack them.
This is **#271**, not a civilisation-switch decoder failure. The overnight worker
retained the all-cues-playable requirement. On2026-10-02 the owner explicitly
approved allowing those exact three aliases to be recorded as unavailable.

The audio importer now publishes disjoint `audio` and `unavailable`
records. Only the three reviewed Persian alias/ID/switch tuples qualify, and an
existing object at an ID revokes the exception. Recovered playable events decode
normally; unknown missing events, malformed graphs, missing complete media and
decoder failures remain fatal. No placeholder or foreign/default cue is used.

Verification:12 synthetic audio tests,9 owned-audio integration tests (including
raw Persian cart records, real decoding and reversed-pack determinism),13 focused
view tests and `npm run build:public` pass. The registered audio acceptance also
passes its unchanged real-browser gestures, layered timing and12 non-silent PCM
checks (`.local/audio271-acceptance.log`, `.local/acceptance/audio.json`). No clock
changed. The coverage assertion explicitly adopts the approved
playable-or-reviewed-gap contract, rather than claiming every cue is audible.

The saved eight-profile content passed an isolated complete audio-stage test:
4324 consumed cues,4321 playable, exactly3 unavailable,27 music tracks and22534
decoded files. Evidence:`.local/audio271-pending-test.log` and
`.local/audio271-pending-fixture/verification.json`. This writes private fixture
output only; it is not a full `npm run import:aoe2` publication or Persian gameplay
acceptance. Original media recovery remains#271; the publication blocker is removed.

Pending code is staged/uncommitted in `.local/worktrees/persians186-blocked`, branch
`work/persians186-blocked`, basef94b18e. Its complete backup
`.local/persians186-blocked.patch` was compared byte-for-byte with the worktree's
staged diff before restoring main. No incomplete selectable Persian profile was
committed. Resume by integrating that staged implementation with current main's
audio fix; the archived worktree still has its original importer. Its
private-browser probe is authored but unrun; full regeneration, integration
regressions and the full Persian gate remain unmet. Source/aura/payout calibration
is#269. Earlier evidence:
`.local/persians-{source-tests,focused-r3,sim-r4,import}.log` and
`.local/audio271-{diagnose,trace}.log`.

## Remaining limits

Seven owned profiles are enabled. Scoped civilisation completion does not claim
native-DE parity. Terrain/compositing, conversion exceptions, audio/missing
streams, zero-time research/population settings, Japanese/Chinese/Byzantine and
ordinary A/B cadence calibration, and wonder countdown remain tracked. The
restored#124 Dark-Age-start AI acceptance remains explicitly failing/opt-in and
separate from its Feudal-start component case. The autonomous deadline has passed;
Persians can resume integration under the approved#271 exception above.
