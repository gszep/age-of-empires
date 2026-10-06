# Celts livestock control — partial native calibration (#304)

2026-10-06: **BLOCKED for implementation**, not a completed bonus. Measured on
current build **185872, not pinned 48987**, as authorised by the owner. All
ownership and clock readings below were **observed visually**. Native PID22012,
fullscreen 2560×1440; inherited UHD-unchecked settings were not changed. Only
single-player editor Tests were used. Final state is the main menu; no scenario
was saved, game restarted, service restarted, import run or checkpoint run.

## Source and runtime diagnosis

The resolved owned root was
`/home/fraser/.local/share/Steam/steamcmd/linux32/steamapps/content/app_813780`.
Pinned DAT tech405 (`C-Bonus, Dominant LOS`, civ13) uses effect417: its sole
command is type1, a97, b0, c−1, d1: **set** resource97 to1. Constants.xs names
it `cAttributeDominantSheepControl`. English help120162 says livestock within
Celt unit LOS cannot be stolen. These identify the attribute, not arbitration.
The local source dump is `livestock-source.txt` beside the native receipts.

`updateAnimals` currently collects living non-animal units, tests them against
the animal's `herdRange`, and refuses any contested claim. It never reads
resource97 or a sight source's LOS. `data.ts` derives imported herdRange from
the sheep's LOS, not the claimant's LOS. A protection-only early return would
not reproduce the enemy-owned and Gaia results below. Conversely, simply
preferring a dominant claimant within the existing herd radius would not
establish the longer-distance King case. The ordinary King control also
retained its sheep: do not call it a successful Celt-only protection control.

No simulation/importer change was made. The command remains explicitly
unmodelled, and the importer test asserting that remains intact. The assigned
worktree started clean at5072af8; no cheap-worker partial diff, failing check
log or exact attempt transcript was supplied there. Inherited native recipes
were read; this run's failed attempts are retained rather than silently erased.

## Fixtures and observations

Evidence root (ignored, durable, not game assets to commit):
`.local/worktrees/issue-304-celt-sheep/.local/native/` in the primary checkout.
Each named PNG has a same-stem JSON action/time/PID/rectangle receipt.

The useful editor layout had P1 King placed at(1050,700), sheep(1400,700), P2
Scout Cavalry(1460,700), and spare villagers at(700,1000)/(2100,1000).
These are **placement pixels, not measured tile distances**. The King is
visibly separated from the sheep; the Scout is adjacent. P2 personality None;
civilizations fixed explicitly, not Random. Read the civ panels in
`live-control-settings`, `live-p2-celts`, `live-p1-celt-fixed`,
`live-p2-teuton-fixed`, `live-both-celt-fixed`, and `live-final-p2-fixed`.

| Case | Observed result | PNG evidence |
|---|---|---|
| P1 Teuton King and owned sheep, P2 Teuton Scout | Sheep stayed P1 at00:12; **not** the requested capturing control | `live-control4` |
| Same owned-sheep/King setup, P2 changed to Celts | Sheep became P2 Celts at00:12 | `live-celt-thief` |
| P1 changed to Celts, P2 restored to Teutons | Sheep stayed P1 Celts at00:12 | `live-celt-king-protection` |
| P1 Celt King replaced by Outpost | Sheep became P2 Teutons at00:12; Outpost-only sight did not protect in this setup | `live-outpost-placed`, `live-celt-outpost-result` |
| Both nearby P1 sight sources removed, P1-owned Celt sheep restored, P2 Teutons | Sheep became P2 Teutons at00:11 | `live-final-layout`, `live-final-p1-sheep`, `live-outside-owner` |
| Gaia sheep, restored P1 Celt King, P2 Teuton Scout; Outpost still present | Sheep became P1 Celts by00:12 | `live-gaia-place`, `live-gaia-king`, `live-gaia-owner-read` |
| Same Gaia start, both civilizations Celts | Sheep was P1 Celts at00:12 | `live-both-celt-gaia` |

The Gaia observations do **not** establish simultaneous processing order,
equal-distance ties, or a general two-Celt owner rule. First acquisition may
precede protection; no tick-level native trace was captured. The Outpost
remained in both Gaia Tests, although the earlier Outpost-only case did not
protect. No source geometry, capture interval or boundary equality was fitted.

## Rejected/limited attempts

- Initial Ram/sheep/Scout layout retained sheep for **both** Celt and Teuton
  P1. Scout pursuit/Ram movement and close initial spacing did not discriminate
  protection. `live-protected-paused` and `live-control-paused` are not proof
  of the bonus.
- A Trade Cart replacement did not steal the control sheep. This does not
  prove a generic Trade Cart eligibility rule.
- Changing placement owner while Delete mode was active failed: a King was
  placed for P2 (`live-king-placed`). It was removed and rebuilt for P1 before
  accepted King comparisons. Early Tests ended in defeat/victory; adding one
  spare villager per player prevented that.
- The first Outpost deletion missed. `live-celt-no-source*` are **not**
  outside-all-LOS evidence: the Outpost remained. `live-final-layout` verifies
  the later successful removal of both King and Outpost.
- Clicking old in-Test coordinates after camera recentering sometimes selected
  nothing or the spare villager. `live-gaia-owner-read` is the corrected sheep
  selection. Do not substitute an action filename for its visible panel.

## Bounded continuation

1. Rebuild the King fixture and use actual Scout movement, not just Test-start
   overlap. Ctrl+Shift+F2 was tested to switch to P2 in an editor Test; it also
   recenters the camera. Establish a non-Celt capturing control with the same
   source/geometry, and explain the existing Teuton King retention first.
2. Separate first Gaia acquisition from later protection: approach in both
   orders, reverse player slots/creation order, then test **already-owned**
   sheep between two Celts. Repeat the Gaia comparison without the Outpost.
3. Establish leaving/re-entering mobile LOS, death, conversion and garrison
   behavior. Outpost is only one building negative control, not every building.
4. Only then implement the shared attribute consumer and enable the importer
   effect, with public movement/capture, opponent and JSON-continuation tests.
   Existing runtime tests do not provide acceptance coverage for this bonus.

**Import requirement:** none for this documentation-only handoff. Once the
effect is supported, published profiles need regeneration through the full
`npm run import:aoe2` entrypoint in the coordinator's slot; merely enabling the
runtime cannot activate an effect currently emitted as unmodelled. No sprite
decoder change is indicated by this investigation.

Final capture: `livestock-final-main-menu.png`, receipt07:55:02+01:00,
PID22012. No background job was started by this worker.

## Outcome checks

- `npx vitest run src/sim/herd-food.test.ts src/sim/economy-hunting.test.ts
  src/sim/celts.test.ts --maxWorkers=1`: exit0, **21 passed, 21 skipped**,
  10.78s wall. All skipped tests are the owned Celts suite: this worktree has
  no imported manifest. These are baseline regression checks, not validation
  of an implemented resource97 consumer.
- `npx tsc --noEmit -p .`: exit0, 7.59s wall.
- `git diff --check`: passed. Logs/timings: `.local/checks/livestock-*`.
- Python importer tests not run: importer unchanged. No public movement or
  JSON-continuation acceptance test for resource97 was added. No clocks were
  widened and no assertion was removed to obtain these results.
