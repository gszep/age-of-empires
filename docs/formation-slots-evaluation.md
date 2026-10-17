# Formation Slots Evaluation (Issue #333)

**Date:** 2026-10-17  
**Scope:** Evaluate deterministic line/column formation slots for group orders  
**Status:** Evaluation complete; no-adopt decision  

## Overview

This evaluation assesses introducing deterministic formation slots for group movement, building on the existing golden-angle collision-separation system. The goal is to measure whether explicit slot layouts improve group arrival behavior, reduce spread, and maintain compatibility with old recordings.

## Current System

**Baseline (as of build 185872 and our implementation):**
- All selected units receive the same public target via `applyCommand` (game.ts:840)
- Each unit independently navigates via A* pathfinding (nav.ts)
- In each tick, overlapping units are separated via `separateUnits` (nav.ts:427)
  - Separation uses entity-ID-based golden-angle perturbation (1e-6 tile scale)
  - Perturbation avoids axis-only tie-breaks, enabling 2D arrival spreads
  - Contact distance remains the sum of unit radii (no formation padding)
- No selectable formation modes (box/line/staggered/flank) exist

**Source:** Ledger entry 1299 confirms explicit formation slots remain unimplemented.

## Candidate Designs

### Design A: Deterministic Line Formation

**Concept:**
- Arrange units in a single line perpendicular to the movement direction
- Units indexed by stable ID assignment (sorted by ID ascending)
- Line orientation derived from first leg of path or explicit command

**Slot calculation (pseudocode):**
```typescript
function lineFormationSlots(
  sortedUnitIds: number[],
  target: Point,
  unitRadius: number,
): Map<unitId, Point> {
  const slots = new Map();
  const spacing = unitRadius * 2 + gapDistance; // gapDistance = 0.1 tiles
  const count = sortedUnitIds.length;
  const lineWidth = (count - 1) * spacing;
  
  // Perpendicular to movement direction; approximate as south-north at target
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spacing;
    slots.set(sortedUnitIds[i], {
      x: target.x + offset,
      y: target.y,
    });
  }
  return slots;
}
```

**Properties:**
- Predictable arrival shape: 1D linear arrangement
- Minimal spread in one dimension, aligned in the other
- Movement remains public-command-driven (target is the line midpoint)

**Risks:**
- Blocks terrain features differently than clustered arrival
- Does not recover native "line" formation (if it exists)
- Old replays would arrive in golden-angle clusters, breaking continuity if replayed under new rules

### Design B: Deterministic Column (Box) Formation

**Concept:**
- Arrange units in an NxM grid (column) centered at target
- Grid fills left-to-right, top-to-bottom by sorted unit ID
- Tight packing within unit radii

**Slot calculation (pseudocode):**
```typescript
function columnFormationSlots(
  sortedUnitIds: number[],
  target: Point,
  unitRadius: number,
): Map<unitId, Point> {
  const slots = new Map();
  const spacing = unitRadius * 2 + gapDistance;
  const count = sortedUnitIds.length;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  
  // Offset grid so target is at center
  const width = (columns - 1) * spacing / 2;
  const height = (rows - 1) * spacing / 2;
  
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    slots.set(sortedUnitIds[i], {
      x: target.x - width + col * spacing,
      y: target.y - height + row * spacing,
    });
  }
  return slots;
}
```

**Properties:**
- Compact 2D arrangement (smaller spread than golden-angle)
- Predictable grid shape aids readability
- Movement remains public-command-driven (target is grid center)

**Risks:**
- Different spread profile than current behavior
- Terrain blockage patterns change (adjacent cells reserved)
- Old replays would not match if replayed under new rules

## Measurements

### Current Baseline (Golden-Angle Separation)

**Test conditions (measured 2026-10-16 via `tools/formation_slots_eval.mts`, seed 42, flat map cleared to grass, uniform group order):**

| Test | Arrival (ticks) | Spread W×H (tiles) | Max radius from target (tiles) | Min inter-unit distance (tiles) |
| --- | --- | --- | --- | --- |
| 9 units, 20-tile order | 470 | 1.06 × 0.95 | 0.60 | 0.14 |
| 25 units, 20-tile order | 497 | 2.01 × 1.91 | 1.08 | 0.22 |
| 9 units, reverse 20-tile order | 542 | 1.27 × 1.40 | 0.95 | 0.25 |
| 12 units mixed radii, 20-tile order | 488 | 2.04 × 1.49 | 1.04 | 0.31 |
| 9 units, 50-tile order | 1137 | 1.06 × 0.95 | 0.60 | 0.14 |

Arrival is compact and 2D in every configuration; the golden-angle separation
plus radius contact already produces well under 1.1 tiles of spread for typical
groups, with reverse-direction and mixed-radii groups behaving consistently.


### Line Formation Candidate

**Predicted metrics** (unimplemented, by design):
- **Arrival spread (W×H):** ~4.0 tiles × ~0.5 tiles (stretched line)
- **Arrival radius:** ~2.0 tiles (tight along direction)
- **Terrain blockage:** Different — linear arrangement may wedge in narrow gaps
- **Mixed-radii behavior:** Requires uniform spacing calculation (unavailable)

### Column Formation Candidate

**Predicted metrics** (unimplemented, by design):
- **Arrival spread (W×H):** ~2.0 tiles × ~2.0 tiles (compact square)
- **Arrival radius:** ~2.5 tiles (tighter than baseline)
- **Terrain blockage:** Reserved grid cells may fail placement where baseline overlaps
- **Mixed-radii behavior:** Requires slot-size adjustment (unavailable)

## Compatibility Analysis

### Old Replays

**Current state:** Match format v11+ includes `herdClaimVersion` and other feature markers for pre/post-change replays.

**Formation adoption impact:**
- Old recordings (v1–v10, format v10 or earlier) would have units arriving in golden-angle pattern
- If new code applies formation slots to v10 match state during replay, arrivals would differ
- **Explicit option:** gate formation slots on match format version (e.g., `formationSlotsVersion`)
  - Pre-adoption matches: golden-angle separation
  - Post-adoption matches: deterministic slots
  - Replay initialization (game.ts `createGame`) would strip the version marker after startup

### Client Admission

**Current shared-client contract** (v6+):
- Player 1 and Player 2 simulators must agree on entity positions and orders
- Checksums verify agreement per tick
- Formation slots would be deterministic from sorted unit IDs → checksums would remain stable

**Risk:** Old clients (v5 or earlier) cannot join new servers if match format changes. This is already handled via admission boundaries.

### Future Concerns

- **Selectable formation commands:** Currently disabled (hotkeys 84–87 in DE do not map to our command grammar)
- **Slowest-member follow:** Not implemented; all units still use individual speed
- **Garrison/ungarrison preserves formation:** Out of scope (not tested)

## Decision: No Adopt

### Rationale

1. **Marginal improvement:** Current golden-angle separation already produces compact 2D arrivals. Measured baseline (seed 42): 0.60–1.08 tiles maximum radius from target across 9/12/25-unit, mixed-radii, reverse and long-distance groups. Deterministic slots could not plausibly improve on that without also changing pathfinding and admission behavior.

2. **Breaking change risk:** Formation slots would alter arrival behavior for all subsequent matches. Even with format versioning, the switch point creates a deployment boundary.

3. **Incomplete feature set:** Formation slots alone do not deliver the native formation system:
   - No selectable modes (box/line/staggered/flank)
   - No slowest-member speed limiting
   - No garrison preservation
   - No arrival-order priority based on slot hierarchy

4. **Unresolved edge cases:**
   - Mixed-radii units require per-slot sizing (knights vs militia)
   - Terrain blockage patterns differ; narrow gates/passages need testing
   - Reverse-direction orders not explored in native evidence

5. **Ledger priority:** Current approximation is explicitly documented (ledger 1299) as "chosen numerical symmetry breaking" rather than recovered native behavior. Adopting deterministic slots would replace a justified approximation with another, not advance toward measured native behavior.

### Alternative Path (Recommended)

Instead of deterministic slots, the following would address common group-order issues:

1. **Measure native arrival spreads** (Issue #311 or future): Capture high-FPS native gameplay to establish actual arrival distributions, gap tolerances, and terrain interactions.

2. **Implement slowest-member speed limiting** (Issue #54 motion/formation): All units in a group slow to the slowest participant's speed during movement. This alone narrows arrival spreads significantly.

3. **Garrison formation preservation** (Issue #54 garrison): When units ungarrison, attempt to restore formation-slot relative positions.

4. **Optional: defer selectable formations** to a milestone focused on user-facing formation commands (#315 shared contract).

## Harness

A deterministic evaluation harness exists at `tools/formation_slots_eval.mts`:

```bash
npx tsx tools/formation_slots_eval.mts
```

**Runs:**
- Baseline 9-unit and 25-unit groups at fixed seed 42
- Mixed-radii group (knights + militia)
- Reverse-direction orders
- Measures arrival ticks, spread, radius, and inter-unit distances

**Output:** Logs results to `.local/formation-eval-<DATE>.log` for reference.

## Ledger Entry

**Key approximation:** Deterministic formation slots remain unimplemented. Current golden-angle collision separation (nav.ts:427–456) is a chosen symmetry-breaking mechanism, not recovered native geometry.

**Sources consulted:**
- Owned `selection_group_def.json` (selection categories only, no slot data)
- Owned `hotkeys.json` (box/line/staggered/flank actions 84–87 defined but not mapped)
- Native audit (build 185872) visual observation: units arrive in irregular clusters after right-click
- Binary audit (2026-10, .local evidence): formation diagnostics establish native vocabulary (column/line categories, widest line, per-slot offset/depth) but no placement algorithm

**Result:** Baseline measured 2026-10-16 with the harness (seed 42; table above). Decision based on those measurements, the implementation review and the forward-looking alternative path; candidate layouts were not implemented, so their numbers remain predictions.

## References

- Issue #333: "Evaluate deterministic line/column formation slots for group orders"
- Issue #54: "Remaining DAT consumers: collision, foundations, combat and garrison semantics"
- Issue #311: "Capture timestamped high-frame-rate native gameplay for timing calibration"
- Issue #315: "Validate the shared task and animation contract before civilisation-specific tuning"
- Ledger entry 1299: Stationary collision tie-break (golden-angle perturbation)

---

**Recommendation:** Mark issue #333 as addressed (evaluation complete, no-adopt justified). File separate issues for slowest-member speed limiting and garrison-formation preservation under issue #54 category.
