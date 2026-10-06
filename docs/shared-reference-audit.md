# Shared-limit reference audit — 2026-09-26

Bounded follow-up to `444e91b`; no simulation rules changed. Owned prose now
supports two previously inferred policies. The remaining questions below are
not user-approved choices or measured DE parity.

Tracking: market #128, conversion #178, Treason #240, charge #242, PDF audit
#60, deployment preservation #241, deferred diplomacy #138.

## Verification

The remaining combat/garrison/elevation/conversion manual reading was completed
on2026-09-28; see [manual-audit.md](manual-audit.md) for page-level findings and
explicit negative results for elevation multipliers and route-profit formulas.
The source-reading task #60 is complete; the runtime questions below remain.

The tooling/evidence follow-up passed the full one-worker owned checkpoint on
2026-09-27 after the host became idle: **960 Vitest tests /73 files**, build,
**130 Python/owned-content tests**, and real-browser debug smoke. Exit0 and
`GATE GREEN` are recorded in `.local/shared-reference-audit-gate.log`. The two
PDF extraction tests ran in that Python suite. No timeouts were widened, no
simulation rules changed, and the live shared service was not restarted.

## Sources and extraction

Root resolved with `tools/depot.py`: SteamCMD `app_813780`. Paths below are
relative to `depot_813781`, except widget UI in `depot_813782/widgetui`.

- Enumerated `Docs/en`: AoK Manual, TC Manual, TC Tech Tree PDFs; WHATSNEW,
  Readme, Readme_a, Readmex, ReadmeX_a, EULA, WARRANTY RTFs and NOTICE.
  Enumerated `Docs/All`: AoK/TC CP Strategy Builder and TC Random Map Scripting
  Guide DOCs. Other language manuals were listed, not translated or read.
- `pdftotext`/`pdftoppm` and Python PDF libraries were absent. Locked
  **pypdf 6.10.2 (BSD-3-Clause)** now reads all three English PDFs via
  `tools/pdf_text.py`; SHA-256 and physical page numbers accompany the text.
  Output remains ignored (`.local/audit-{aok,tc,tree}.json`). A compressed
  original fixture and actual manual passages test the extraction boundary.
  Some decorative glyphs extract as `/cNN`; the tech-tree PDF emits an xref
  repair warning. Neither is used as an exact layout/table parser.
- Manual SHA-256: AoK `8128cfdcfa0a77f9d79876769fbc98946f7c53f6bdfa6de8c79879de1d7a668c`;
  TC `53f309b4a28bc7997d6a09c6c03306a36d02ca8e0a9ede4bc97449bd42387a80`.
  These are **legacy manuals shipped in the pinned depot**, not modern patch
  documentation. Their old costs/bonuses do not override current DAT values.
- Read the topic passages, AI DOC commodity facts/actions and line-parameter
  discussion (via `strings`), XS Attributes/task enums and complete `Effects.xs`.
  `xs/xs.txt` contains only its filename. RTF topic search found no rule answer.

## Results and remaining capture questions

The native acceptance procedure for conversion is now in
[conversion-reference-checklist.md](conversion-reference-checklist.md). It
separates native measurements from regressions of the current implementation.
The user's 2026-09-30 clarification resolves the mobile-cargo policy: retained
passenger ownership, no automatic ejection, carrier-owner-only unloading. This
is implemented and recorded as user-supplied evidence, not an agent-made native
capture. Building cargo and the other exceptions remain unresolved.

| Topic | Owned evidence now established | Still unresolved |
|---|---|---|
| Market | AoK printed pp46–47 (PDF49–50) explicitly says all players affect prices and the rate updates after each transaction. 100-unit lots, transaction fee and Guilds are stated. DAT resource 78=.3; effect 15 sets .15. | Initial bases 100 food/wood,130 stone; ±3 steps;20–10000 bounds; ceiling buy/floor sell; exact Shift500 rounding/partial-fill semantics. The manual's **example** sell-wood 70 is not an initial-price table. |
| Conversion | AoK printed p33 (PDF36) says converted units cannot be upgraded and retain their conversion-time attributes. Printed p39 (PDF42) confirms control/colour and population. AI Builder DOC line-parameter discussion independently allows mixed upgrade tiers after conversion. | Villager/fishing task changes and economic capacities, recipient Ballistics, player-resource exceptions, reconversion/passengers, and modern special abilities. No blanket extension of the snapshot is justified by that general sentence. Both trebuchet forms and King immunity remain intact. |
| Treason | AoK printed p13 (PDF16) confirms repeated paid temporary King signals and a notification sound. Current localization28408/41112/41114 supplies 400 gold, immediate deduction, team reveal and flashing X. | No exact lifetime, blink period, live/snapshot position or refresh rule was found in the inspected sources.10 simulation seconds and 500ms remain chosen/inferred. Old TC p45 lists combined Spies/Treason as ageIV; it does not resolve the current mode-specific action's age/queue availability. |
| Siphons | Current DAT effect 915 sets max1/type 6 on529/532/1103 (also scenario1302). Charge projectile2629 and the particle chain are real. | Initial fullness, recharge clock interpretation, launch event, target mask 64, one extra shot per ready swing, friendly-fire selection and vanish2 damage lifetime still need capture; see the chain below. |

### Market/resource cross-check

Batch-read Gaia/Briton/Frank civ resources against XS names: TradeGoods9=0,
TradeProducation10=0, TradeGoodQuality59=1, TradeMarketLevel60=0,
SourceMarketOrDock70/71=0; none supplies the price curve. Stockpiles0–3 and
StartingFood/Wood/Stone/Gold91–94 are zero; they do not establish Regicide's
starting preset. Spies183 and SpiesDiscount197 are zero, not reveal durations.

Enumerated DAT JSONs and read `airesourcetypes.json` (resource-node identities),
`AIConsts.json` (jump-end-of-file10000, not a market cap), market 84/tasks,
`ai/AiBuilder/market.per`, `Promisory/trade.per` price predicates, and
`Promisory/{defaultConstants,customConstants}.per` topic entries. The latter
name observations/AI thresholds/building costs, not an exchange algorithm.
AoK/TC CP Strategy Builder `commodity-buying-price`, `commodity-selling-price`,
`buy-commodity` and `sell-commodity` specify queries and one-lot actions only.
`Effects.xs` contains technology callbacks, not a market or Treason function.
These are bounded negative findings, not a claim that every owned file was read.

### Siphons chain and unimplemented field semantics

Briton and Frank529/532/1103 share charge max0/recharge~.04/event 0/type 0/
target 64/projectile2629 before research. All have **task 133**, named
`cTaskTypeChargeAttack` by XS: work values 2/8, range~1.2, work_flag_2=2001,
auto-search0, enable-targeting 0, no task graphics. Those numbers are **not**
implemented as a guessed burst count, cooldown or targeting rule.

2629 has speed 3, own attacks 11:1/16:0/2:0/4:2/60:1, blast.5/level 2,
reload 1, friendly_fire_damage1, projectile type 0/smart 1/hit 0/vanish2/
area_effect_specials0/arc~.45. Dead-unit is−1; no resource lifetime storage or
tasks. Tracking unit 677, mode 2/density 1 leads to graphic 3823
(`flamethrower_flame`).677 also has dead-unit−1 and no resource lifetime.
Dying graphic12726 names `impact_grenade`; its frame duration~3.333 differs
from the particle's explicit 1.5-second visual duration. The particle JSON's
Once/Complete/Persistent flags are presentation, not proof of repeated damage.

XS names charge attributes59–62/125/162 but provides no target-bit legend.
The Briton unit-array mask inventory includes−1,0,38,63,64,127,191 across
different charge modes/events; treating 64 as a unit class is unjustified.
`Tools_Builds/docs/AGE_ReadMe.txt` records added charge fields, not their bit
semantics; localization12268/12362 merely labels Vanish Mode/Charge Target.
Current code's exact tuple guard is a supported-roster restriction, not a
general mask interpreter. Existing outcomes test the chosen behavior only.

### Treason presentation search

Read `widgetui/mappanel.json`: MapView geometry and an empty child list, no
timer. Widget-wide search finds icon 19 in materials/icons, not reveal timing.
WPFG XAML topic search found no relevant timer. Enumerated shader filenames
and scanned strings of `resources/_common/shaders/d3d11/*.so`; no
Treason/Spies/blink/flash/King/charge parameter match. This does not prove a
generic unnamed animation parameter could never apply. DAT117 disables 408;
408/effect 420 sets Spies183, not a ten-second reveal timer. No executable was
disassembled.

## Deployment and deferred dependencies

Historical passive inspection (2026-09-26): live `GET /__match/config` returned **version 1**, while
`GET /src/shared/protocol.ts` serves **SHARED_VERSION=2**. The service uses the
mutable main checkout; server imports remain in memory while browser modules
come from disk. Thus a reload is already incompatible, not a deployment fix.
Service active, MainPID631, zero automatic restarts. No established5173 TCP
connection or default `.local/shared-match.json` was present at inspection.
That is not proof of recoverable in-memory state or permission to reset it.

`shared/client.ts` rejects config mismatch before joining. `shared/server.ts`
requires both matching version and SHA-256 of current rules; a checkpoint
omits the rules themselves. Version-matched recovery is tested; **v1→v2
migration is absent**. Changing only a version byte or hash would bypass the
guard without demonstrating simulation compatibility. A safe upgrade needs
the old rules/runtime retained, a read-only state export, private continuation
and two-client recovery verification, and a coordinated switch preserving
state/queues/AI takeover/settings. No restart, join, reset, checkpoint edit or
Tailscale change was performed during that audit. Its preservation requirement
applied to that then-unexported match.

**Superseded operational state, 2026-10-01:** the owner explicitly confirmed no
current match needed preservation. The rebooted host already reported version 2;
the private two-browser check found a separate hardcoded version 1 in the gateway.
That is corrected, the host/frontend now use a pinned release, and both installed
endpoint configs report version 2 with the correct seats. Private evolved-match,
two-client and restart recovery checks pass. See [shared play](shared-play.md)
and [handoff](handoff.md) for the release/evidence. This fresh deployment does not
supply or prove generic v1→v2 migration of an old match.

Unlocked diplomacy/cooperative victory remain deferred. They depend on
authoritative relations and asymmetric/mutual alliance semantics, targeting,
visibility/Spies/Treason sharing, gates/garrison/healing, AI and team outcomes,
plus protocol persistence—not merely enabling buttons. AoK pp45–46 additionally
restricts tribute to allies with Lock Teams; current locked 1v1 enemy tribute
is an adapter mismatch to calibrate under #138, not evidence of native parity.
