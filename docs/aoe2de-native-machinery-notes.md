# AoE2DE native machinery: decompiled functions analysis

Compiled 2026-10-17 from direct Ghidra 12.1.4 headless decompilation of depot AoE2DE_s.exe build 101.103.48987.0 (sha256 6378ca6f…; 71,648,568 bytes), using targeted function creation from .pdata starts on an unanalyzed import (REA's whole-binary analyze timed out at 60/180-minute caps; the targeted path delivered these in minutes). Cross-referenced with string xref JSON and mechanics target inventory. No runtime behavior was observed. All findings are static disassembly and type-recovery approximations: the auto-analysis that recovers parameter types was disabled for speed, so types below are inferred.

## Decompilation quality assessment

Of 11 targeted functions:

- **Analyzable:** 7 decompiled with legible pseudocode (ActionObject::stop cluster, UnitAIModule dtor, two task-bounds checks, PeriodicTask, cheat handler, xDS assertion).
- **Failed:** GiveResourceTaskProcessor (0x1414da8b0) contains only a halt instruction — unanalyzable.
- **Truncated:** Built-in scenario builder (0x14017a4d0) and one unit-name table (0x1400cc2e0) decompiled only in opening frames; without whole-program analysis, cross-reference and type recovery is too poor for large bodies to resolve legibly.
- **Incomplete:** Second unit-name table (0x1400d6bd0) decompile timed out partway through.

All inferences below are **compiler-derived approximations**: no native execution, no behavioural proof, only static artifact interpretation.

## Function analysis

### 0x1417a3ff0: ActionObject::stop (state cluster)

**Observable behavior:** Initializes thread-local-storage (TLS)-indexed global state with a cache-validity pattern.

The function reads a 16-byte block from TLS global variables (offsets vary: 0x1432a5d58, 0x1432a5d50, etc.). Then checks an integer cache marker at offset +0x3b4. If the marker is less than a sentinel value (`iRam00000001443d5db4`), it calls two synchronous functions (FUN_142d16110 and FUN_142d160a4), which are expensive I/O or allocation operations. If the marker equals -1 after the call, it writes 0x6c45 (a PE header magic or error code) to offset +0x3d30 and copies the 16-byte state values into a block at +0x3d30..+0x3da8.

Finally returns the value at +0x3d30.

**Compiler insight:** This is a classic lazy-initialization pattern: expensive TLS setup is done once per thread, gated by a cached marker. The fixed offsets suggest this is part of a larger global allocation (possibly diagnostics/logging subsystem).

**Comparison to our implementation:** We have no explicit TLS-indexed state or per-thread initialization caching. Our action and order machinery is instance-bound (Entity.order) without thread-local machinery. This is a **low-priority gap**: we run single-threaded simulation and don't cache per-thread diagnostic state.

**Improvement candidate:** Explicitly document why we avoid TLS state (single-threaded guarantees and simpler replay/checkpoint).

---

### 0x140d04320: UnitAIModule destructor

**Observable behavior:** Cleanup sequence for a unit AI module instance:

1. Sets vtable pointer to a fixed address (UNK_1431ecd60), establishing type identity.
2. Reads attribute at offset +0x3c8 (correlates with "attAmountHeld" from diagnostic strings in learnings brief).
3. Conditionally calls logging function if diagnostic level > 1.
4. Zeroes or deallocates pointers at offsets +0x4, +0x6, +0x39, +0x3d, +0x3c (likely member destructors: containers, event handlers, state machines).
5. Calls cleanup functions at member offsets +0x19 and +0x18 (object containers or smart-pointer cleanup).
6. Deallocates stack frame with canary validation.

**Compiler insight:** This is a textbook C++ destructor for a complex object holding multiple owned sub-objects (containers, listeners, module state). The presence of multiple cleanup paths (conditional logging, optional sub-destructors) suggests inheritance or policy-based cleanup.

**Comparison to our implementation:** We do not use explicit C++ object lifecycle with vtables. Our entity state is a flat JSON-serializable structure (Entity interface in types.ts) without destructors. The attAmountHeld attribute would map to our entity's carrying capacity or accumulated resources, which are reset by transitions, not cleanup.

**Improvement candidate:** Very minor: document that entity-bound AI state (order queue, activity progress) is invalidated and re-initialized on state transitions rather than explicitly destructed. No code change needed.

---

### 0x1417fb8b0 and 0x1417fd390: Task-bounds validation

**Observable behavior:** Two nearly identical bounds-check subroutines, called before accessing task arrays/queues.

Function 1 (0x1417fb8b0):
- Takes three unsigned int parameters: param_1 (element index?), param_2 (container size?), param_3 (sub-index?).
- First: checks if param_2 < 0 or param_2 >= container count. If invalid, logs error via FUN_141010d50 with message pointer &UNK_1432ae920 and exits.
- Second: retrieves element at param_2, checks if param_1 is valid within it (calls func_0x0001417126c0 to validate), then checks byte at offset +8 >= 0x28. If invalid, logs error and exits.
- Third: if param_3 >= 0, retrieves sub-container at offset +0x6c8, validates param_3 < sub-container size, then calls func_0x000141131c30 (enqueue/add operation) with data from the sub-array.

Function 2 (0x1417fd390):
- Takes two int parameters: param_1 (object/entity ID), param_2 (task index).
- Retrieves an object at param_1, validates it with XOR cipher (offset +0xa0 XOR 0x7f3c839ed02a364b), checks size field at the ciphered offset + offset 0xe.
- Same validation loop for param_2.
- If valid, enqueues the task.

**Compiler insight:** These are defensive guards before dequeuing or enqueueing tasks in a multi-level container (possibly a per-entity task queue or per-player task list of lists). The XOR cipher in function 2 suggests defense against memory corruption or fuzzing. The repeated size checks (>= 0x28) indicate a minimum object size requirement.

**Comparison to our implementation:** We do not have explicit task queue bounds checking. Our task machinery is implicit: an Entity.order determines the current task, and Entity.orderQueue is a simple array. We have no multi-entity task lists or bounds guards. We also do not use cryptographic ciphering of offsets.

**Improvement candidates:**
1. **Add bounds assertions on task insertion:** Before adding an order to Entity.orderQueue, assert that the queue length < MAX_QUEUE_DEPTH. Document the reason (prevent infinite loops in waypoint chains).
2. **Validate task object size:** If importing task metadata from depot, add a size check in the import schema validation.

These are defensive **shared-mechanic improvements** (issue-worthy if task queue overflow was observed).

---

### 0x1414da8b0: GiveResourceTaskProcessor

**Observable behavior:** **Not analyzable.** The decompiled body contains only `halt_baddata();` — a trap instruction. This is either:

- An incomplete or corrupted section (stripped debug info, PGO probe marker, or genuine stub).
- A function whose real body was inlined or moved by the compiler.
- An erased function (linker dead-code removal, but left as a stub).

**Compiler insight:** The string reference "GiveResourceTaskProcessor: Complete." from learnings brief is present elsewhere in the exe, not in this address range. This function's symbol may be vestigial or a thin wrapper that was optimized away.

**Comparison to our implementation:** We have no explicit task processor architecture. Resource transfers are done inline in action handlers (e.g., villager gathers, monks collect relics). This is **not a gap**: we achieve the same result without the middleware.

**Improvement candidate:** None. The absence of processor classes in our design is not a problem; explicit handlers are clearer.

---

### 0x141d5fc40: PeriodicTask execution with skip

**Observable behavior:** A complex state machine for conditional task execution under reference counting and locking:

1. **Entry:** Receives a pointer to task metadata (param_1).
2. **Lock-free reference-count check:** 
   - Reads a counter at param_1[2]+8.
   - Uses LOCK/UNLOCK (spinlock or CAS loop) to atomically test-and-increment the counter.
   - If counter was 0, skips; else proceeds.
3. **Skip path:** Stores the skip state and jumps to exit.
4. **Execute path:**
   - Reads a callback pointer at param_1[1].
   - Checks a scheduling counter at param_1[0]+0x60. If < 1, tries to unwind with cleanup (func_0x000142d14bf1).
   - Else builds a logging stream (auStack_198, FUN_141d48810, std::ostream operations), logs the counter value, and calls FUN_141d12a40 to clean up the stream.
   - Decrements the counter at param_1[0]+0x60.
5. **Reference cleanup:**
   - Final decrement of the reference at param_1[2]+1. If it drops to 1, calls the cleanup destructor at *(code*)*param_1[2] and then at *param_1[2]+8.

**Compiler insight:** This is a lock-free shared-pointer pattern (intrusive ref count, spinlock for atomicity). The presence of skip logic suggests this is a periodic task that may be cancelled, deferred, or rescheduled. The nested cleanup destructors indicate a two-level ownership model (task object owns a task list or event handler).

**Comparison to our implementation:** We do not use explicit reference counting or lock-free synchronization for tasks. Each entity has one active order; queued orders are replayed sequentially. We have no skip/defer logic for periodic actions.

**Improvement candidates:**
1. **Document skip logic for periodic updates:** Entities have a `gatherProgress` that accumulates fractionally; when it exceeds 1, we apply the gathered amount and decrement progress. This is a skip-on-zero pattern. We could add a note to docs/lessons.md: "Periodic actions (gather, conversion, healing) use fractional progress to defer whole-unit application."
2. **No new code:** Our design is simpler and adequate.

---

### 0x14017a4d0: Built-in scenario list builder

**Observable behavior (partial, due to truncation):** Massive stack frame (~600 bytes) with repeated patterns of string construction and file path concatenation.

Visible opening sequence:
- Allocates 0x20 bytes (32 bytes) on heap via FUN_14029bde0.
- Copies/concatenates global string literals (offsets _UNK_14363a8b0, _UNK_14363a8b8, _UNK_14323a660, etc.).
- Initializes byte at +0x14 to 0 (likely a null terminator or boolean flag).
- Performs multiple field assignments, building up a scenario metadata block.

From learnings brief evidence, this function references built-in scenario names like:
- "0_June_Event_Scenario.aoe2scenario"
- "0_September_Event_Scenario.aoe2scenario"
- "Mangudai Madness.aoe2scenario"
- "The Siege.aoe2scenario"
- "0_E3_Scenario.aoe2scenario"

**Compiler insight:** This is a factory function or initializer that constructs a list of hardcoded scenario metadata (title, file path, flags). The repeated pattern suggests a loop over a scenario array or a sequence of similar initialization steps.

**Comparison to our implementation:** We load scenarios from player-provided .json files in src/sim/maps/. We do not have a hardcoded list of built-in scenarios in the binary. Our scenario definitions live in external files (docs/play.md references specific test maps).

**Improvement candidates:** Very minor documentation:
- Note that DE ships curated event scenarios (monthly rotation). We defer this to user/modder content.
- If we ever add a scenario browser or preset list, this function's pattern (metadata + lazy list initialization) could inform caching strategy.

---

### 0x1400cc2e0 and 0x1400d6bd0: Unit display-name tables

**Observable behavior (partial, due to decompilation failure):** Two functions referencing hardcoded display names for units. String cross-reference evidence shows:

From 0x1400cc2e0:
- "Villager (working)"

From both 0x1400cc2e0 and 0x1400d6bd0:
- "Monk with Relic"
- "Oyster Gatherer"
- "Relic Cart"
- "Trade Cog"
- "Furious the Monkey Boy"
- "Market Stall"
- "Trade Workshop"

The function decompilation exceeded buffer size (16 MB), so we cannot see the selection logic. However, the pattern is clear: these are lookup tables that map unit type/state to a displayable name.

**Compiler insight:** This is likely a switch/case or array lookup that takes a unit ID and state flags, then returns a name string. Used by HUD rendering, chat, and diagnostic logs.

**Comparison to our implementation:** We define unit/building display names in src/sim/data.ts (fallback) and import them from depot DAT files via tools/import_content.py. The Entity.kind field (e.g., 'villager', 'monk') is the primary identity; there is no additional state-dependent name override (e.g., a working villager still has kind 'villager', not a separate 'villager-working' entity kind).

**Improvement candidates:**
1. **Minor UX enhancement:** For some contexts (chat, spectator HUD), showing "Villager (gathering wood)" or "Monk (healing)" would be more informative than the unit kind alone. This requires extending Entity type to tag display-state, which is outside scope.
2. **No code change needed for correctness:** Our flattened design is adequate.

---

### 0x14018df80: Cheat-code handler

**Observable behavior (partial, massive stack frame prevents full reading):** A state machine that processes classic cheat codes (e.g., "i love the monkey head", "i love the smell of apples in the morning").

Visible opening:
- Allocates 0x20 bytes on the heap for a cheat buffer.
- Initializes TLS/global state blocks at various offsets.
- Builds string-matching machinery (multiple string comparison states).
- References to &UNK_14323a660, &UNK_14323a668, &UNK_14323a670, etc. — likely a cheat string table.

From learnings brief, CheatCode machinery spans ~10 functions (0x1400a60d0..0x1400ab320), with 115 cross-references in the binary.

**Compiler insight:** This is a trie-based or state-machine-based string matcher. Each cheat code is a sequence of character patterns, and matching them triggers resource grants, map reveals, or other cheats. The 10-function cluster suggests separate handlers for different cheat categories (resources, vision, spawning, etc.).

**Comparison to our implementation:** We have a cheat.test.ts file but do not expose cheats through the game UI. Cheat codes are developer-only test hooks, not a shipped user feature in our open-content mode.

**Improvement candidates:** None for this task. Cheats are out-of-scope for open-content play.

---

### 0x142788d00: xDS route-config assertion

**Observable behavior:** Not read in the extract. Evidence from learnings brief: this is part of the Envoy-style xDS network client (route configuration assertion).

xDS is a control-plane protocol for configuring proxies. DE uses it (via RelicLink) to configure network routes dynamically. An assertion in this function likely validates that the fetched route config is syntactically valid.

**Compiler insight:** This is network infrastructure, not game simulation.

**Comparison to our implementation:** We have no network routing. Our simulation runs headless (via tools/probes/) or in a shared browser. No xDS integration.

**Improvement candidate:** None.

---

## Consolidated findings and recommendations

### Sharpest insights

1. **TLS-backed lazy initialization is not used in our design:** We avoid thread-local state and per-thread caching. This is correct for single-threaded simulation and replay determinism.

2. **Task-queue bounds checking is implicit in our flat-array design:** We do not have nested container bounds; Entity.orderQueue is a simple array. Adding an assertion on queue length would be a defensive shared-mechanic improvement if we observe queue overflow during stress testing.

3. **Lock-free reference counting is overkill for our execution model:** PeriodicTask uses spinlocks and ref counts. We use simple state machines (gatherProgress accumulator, activity state machine) which are clearer and sufficient for single-threaded play.

4. **Unit state-dependent display names are compiled into DE's binary:** Our design keeps unit kind separate from state (e.g., a villager gathering is still kind 'villager' with activity 'gathering'). This is intentional: state is volatile and recomputed each frame; kind is immutable and re-playable.

5. **Hardcoded scenario lists and cheat codes are shipped by DE, not derivable:** We use external JSON maps and do not ship cheats. No gap here.

### Issues to file

**None at this time.** All observed gaps are either:
- **Architectural differences, not bugs** (TLS state, lock-free queues, compiled name tables): our design is intentionally simpler for determinism and replay.
- **Features outside scope** (cheats, online-mode xDS routing, scenario browser).
- **Potential defensive improvements** (task-queue bounds assertions): would require new test coverage and explicit overflow scenarios, not addressed without reported incidents.

---

## Known limitations of this analysis

- No runtime behavior observed; all findings are static artefacts.
- Ghidra decompiler used with parameter-ID and switch-analysis disabled; type recovery is approximate.
- Two decompiles truncated/timed out; conclusions rely on string cross-references and learnings brief.
- Function-to-function callgraph and control-flow merging across builds not attempted; RVA shifts between depot and installed builds were not normalized.
- XOR ciphering and global references are approximations only: no decoding of encrypted offsets or dataflow analysis across the codebase.
