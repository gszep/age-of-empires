# Owned English manual audit (#60)

Completed 2026-09-28. This finishes the combat/garrison/elevation/conversion
reading left open by [the earlier shared-rule audit](shared-reference-audit.md),
including its trade-profit question. It is a source/documentation audit, not a
claim that every described feature is implemented or current DE behaviour has
been measured. No gameplay rules changed in this audit.

## Corpus and reproducibility

Resolve the owned root with `uv run --locked python tools/depot.py`. The sources
are under `depot_813781/Docs/en/` in that root. Re-extracted all three PDFs using
the existing locked pypdf 6.10.2 tool:

```sh
uv run --locked python tools/pdf_text.py "<root>/depot_813781/Docs/en/AoK Manual.pdf" > .local/docs/aok.json
uv run --locked python tools/pdf_text.py "<root>/depot_813781/Docs/en/TC Manual.pdf" > .local/docs/tc.json
uv run --locked python tools/pdf_text.py "<root>/depot_813781/Docs/en/TC Tech Tree.pdf" > .local/docs/tc-tree.json
```

| Source | Physical PDF pages | SHA-256 |
| --- | ---: | --- |
| AoK Manual.pdf | 130 | `8128cfdcfa0a77f9d79876769fbc98946f7c53f6bdfa6de8c79879de1d7a668c` |
| TC Manual.pdf | 50 | `53f309b4a28bc7997d6a09c6c03306a36d02ca8e0a9ede4bc97449bd42387a80` |
| TC Tech Tree.pdf | 18 | `e29bb08ed13d7fa5d9e4ce3dbd4dcdb21dea84f0a188d753baafef938c177519` |

The tree PDF emits an xref-repair warning but extracts. Decorative glyphs can
become `/cNN`; this is not a layout-faithful or table-column parser. Appendix
spreads can contain two printed pages in one PDF page, so references below name
both numbering systems. The technology tree was extracted, not re-audited as a
modern civilisation-availability table. Raw text remains ignored local content.

These are **legacy AoK/Conquerors manuals bundled with the pinned DE depot**.
The TC introduction explicitly describes itself as a supplement to AoK. Its
old ram capacities and villager restrictions, and the old unit/cost tables, do
not override patch-matched DAT/RMS/AI/XS or modern observed behaviour.

## Page-level findings

| Topic | Printed page → physical PDF page | What the prose establishes | Implementation comparison / remaining boundary |
| --- | --- | --- | --- |
| Attack and fog | AoK34,37 →37,40 | Autonomous enemy acquisition; explicit attacks; unseen building changes remain hidden; separate military/non-military alerts grouped by attacker/area over time. | Basic targeting/fog/audio exist. Exact alarm area/reset timing remains #243; the prose supplies no numeric clock or radius. |
| Elevation | AoK34 →37 | Cliffs obstruct movement; attacking from above has an advantage and from below a penalty. | Confirms the direction of the effect, **not** the 1.25/.75 multipliers, fractional-height policy or projectile timing in the implementation. Those remain inferred under #134. |
| Movement and formations | AoK35,40–43 →38,43–46 | Role-based placement in formations, slowest-member movement, locked line/box/staggered/flank arrangements; explicit patrol/guard/follow and four combat stances. | Our compact group destinations are not this complete formation/stance system. Current orders lack these modes and movement uses individual speed. Further field/command work is recorded on #54; exact defensive pursuit distance and formation algorithms are not stated. |
| Waypoints and transports | AoK36 →39 | Queued waypoints; loading, capacity display and shore unloading; allied carriage is described. | Existing command queues and transports cover the supported two-player subset. Allied interactions remain deferred under #138. |
| Building garrison | AoK37–38 →40–41 | Shelter, passive healing, ejection on heavy damage/destruction, visible occupancy flags, producer self-rally versus re-entry restrictions, ranged/villager firepower, and selective unloading. | Current capacity/type/heal/flag/volley/self-rally consumers have source support. Heavy-damage ejection and selective unloading are not implemented; recorded on #54. No damage threshold or detailed overflow/blocked-egress rule is supplied. |
| Town bell | AoK39 →42 | Shelter in available buildings; overflow keeps working; all-clear releases bell-recalled villagers and resumes work, with a fallback when the old job is impossible. | Corroborates recall/release/overflow intent. Our selected-TC reservation and search policy remains an adapter, not proof of the manual's global nearest-building behaviour. |
| Ram garrison | TC3,7–8 →5,9–10 | Infantry improves ram speed and building attack; archers shelter without firing; passenger ejection is described on destruction/conversion/diplomatic change. A carried ram **and its passengers** count against transport capacity. | No per-infantry numeric bonus: #161 remains calibration work. Legacy4/4/6 capacity and villager exclusion differ from modern supported rules. Reproduced missing nested transport accounting as #251. Conversion-passenger exceptions remain #178. |
| Conversion and inheritance | AoK33,39,105 →36,42,108 | Control/colour/population transfer, adjacent conversion for buildings/rams/trebuchets, post-conversion rest, technology gates, and retained conversion-time attributes without later upgrades. | Supports snapshot intent. Exclusion lists vary even between passages (e.g. towers), and modern task/player-resource/carrier exceptions still need verification under #178/#161. Does not give current min/max conversion clocks or a probability algorithm. |
| Healing and monastery technologies | AoK40,104–105 →43,107–108; TC20–21 →22–23 | Automatic nearby healing, multiple healers and no healing faith cost; Herbal Medicine speeds garrison healing; Heresy prevents ownership gain by death; Theocracy limits faith expenditure to one monk in a converting group. | Corroborates mechanics already implemented. Native stacking, target classes, exact timings and current technology availability remain DAT/runtime questions; the manual is not a blanket target-eligibility rule. |
| Smart workers | TC8 →10 | Builders take nearby gathering work after drop-site completion, cargo is banked when changing from building to a new gathering task, and group farm orders spread across untended farms. | Supports #79/#82 intent. Our accepted resources, search bounds, reservation/capture policy and wall-building algorithm remain explicit adapters. |
| Farm reseeding | TC7 →9 | Reseeding is paid, queued through mills, survives loss of mills, and benefits from relevant upgrades. | The current toggle is a modern-style integration, not the legacy prepaid queue. This passage does not determine current partial-farm upgrade or captured-crop semantics. |
| Tribute and commodity trade | AoK46–47 →49–50; TC8 →10 | Legacy30% tribute with100 delivered/130 paid; Coinage/Banking reduce fees; shared prices update per transaction;100-unit market lots; Shift500 and CTRL-all tribute. | Broad policy is owned; current fee parameters remain DAT-derived. Initial prices, step size, caps, partial-fill and bulk rounding remain #128. The manual's sale example is not an initial-price table. |
| Trade-route profit | AoK47 →50 | Carts use markets, cogs use docks; foreign partners may be enemies; longer routes pay more; route trade does not consume stockpiled goods; gold returns to the trader's own drop site. | **No profit formula**, map-size normalization, distance metric, cap or rounding is stated. The implemented rate/distance model remains inferred. |
| Ballistics and attack timing | AoK102,110–111 →105,112 | Ballistics improves hits on moving targets; the appendix describes tracking moving units. | Corroborates prediction intent, not the intercept algorithm or per-unit delay. Current attack delays must still come from DAT/graphic timing; legacy technology target lists are not modern eligibility. |
| Score (additional finding) | AoK18 →21 | Legacy stockpile value 0.1/resource, doubled value for completed assets/research with spent stock removed, transferred killed/converted unit value, and 10 points per 1% exploration. | Posted to #139 as a concrete starting source. Current scoring, refunds, discounts, rounding and special cases still require calibration; old example prices must not be copied. |

## Answers to the two explicit numeric questions

1. **Elevation bonus:** the manual states advantage/penalty, but not a numeric
   multiplier. Topic searches across both complete extracted manuals, followed
   by reading the terrain/combat and relevant appendix passages, did not locate
   a percentage. Do not relabel the current 1.25/.75 constants as owned.
2. **Trade profit:** the manual states a positive relationship with route length
   and explains the round trip, but supplies no equation. Commodity fees are a
   different mechanism and cannot be substituted for a route-profit formula.

## Concrete gap reproduced

During the audit, a capacity 20 Transport Ship using the current owned rules and holding 19 direct infantry
accepted a Battering Ram holding 6 more infantry. `canGarrison` returned true;
the public order succeeded and, after five ticks at an adjacent shore, the ram
was aboard. The ship had 20 direct entries but 26 total carried entities.
At that checkpoint, `canGarrison` counted only `garrison.length`. The TC p8 rule counts
nested passengers as well. Reproduction and acceptance criteria are filed as
**#251**; this audit does not silently change transport behaviour.

**Subsequent #251 implementation:** recursive cargo accounting now rejects that
boarding and is shared with owner observation/HUD. Exact-fit boarding, arrival
races, loaded-ram unloading/JSON continuation, sinking and legacy-save retention
have regression coverage. The paragraph above records the audit-time failure;
the implementation was a separate, user-authorized follow-up.

Other findings are attached to existing work items rather than left only here:
#54 (remaining movement/formation/stance and garrison edges), #131 (remaining
native siege targeting calibration; #278 implements the scoped friendly-blast
guard from TC pp3/5, and [trebuchet automation](trebuchet-automation.md) implements
the packed right-click flow from AoK p81), #161 (ram bonus
evidence without constants), #178 (conversion and passenger ejection), #134
(elevation), #128 (trade) and #139 (score). Allied/cooperative behaviour remains
the explicitly deferred #138 scope.

## Verification and limits

- Re-extracted both manuals and the tree using the locked, existing tool.
- `uv run --locked python -m unittest discover -s tools -p 'test_pdf_text.py' -v`:
  **2 tests passed**, including physical-page retention and owned prose anchors.
- Reviewed the requested topic passages in both manuals and cross-checked the
  corresponding implementation/ledger boundaries. This is not a read of every
  historical biography, translation, campaign or civilisation tree.
- Repository changes for this audit are Markdown only; no new dependency,
  importer, gameplay, rendered asset, timeout or live service change. Proprietary
  PDF/text bytes remain outside tracked files.

All three #60 actions are complete: extraction is available, the requested
sections have been read against the implementation, and the official-source
index now links this page-level record. Remaining implementation/calibration
issues are not reasons to keep the source-reading ticket open.
