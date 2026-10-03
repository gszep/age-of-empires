# Verified checkpoint workflow

## Acceptance before implementation

Write the reported symptom, expected behaviour and its independent source in the
issue before choosing a fix. Source data is evidence for values; native captures
or explicit human policy establish semantics where the files do not. A probe
must discriminate the reported defect, not merely prove a neighbouring subsystem.

`tools/acceptance.json` maps feature boundaries to maintained browser/outcome
scenarios, source references and tiers. It is a starting registry, not universal
coverage. Extend it when touching an unmapped boundary. Commands:

```bash
node tools/acceptance.mjs plan HEAD
node tools/acceptance.mjs run shared "Gateway follows host protocol; locator retries DOM replacement; no assertions or clocks removed"
node tools/acceptance.mjs check HEAD
```

Receipts under `.local/acceptance/` bind results to non-Markdown working files and
imported JSON metadata, commands, scope notes and time. Edits during a run make
its receipt fail. Historical logs are not automatically certified as current.
Raw bulk artwork is not hashed by this fingerprint: decoder/output changes still
require importer and rendered-pixel checks. A complete renderer receipt must name
that separate evidence.

Review `.local/acceptance/scope-review.diff`: supplied ages/resources/buildings,
removed assertions and altered clocks all matter. The explicit `known-gap`
AI progression scenario currently fails; it is not silently waived or covered by
the green Feudal-start component test. `check` will report it as missing a pass.
The general gate remains the four existing stages. Feature and endurance checks
are separate required evidence for their affected boundaries; do not blindly run
every expensive soak for every documentation/tooling edit.

## Harness enforcement

`.opencode/plugins/safeguards.js` invokes the maintained shell/commit guards before
Bash tools. Claude retains its existing wiring. The guards are policy checks, not
a security sandbox or a complete shell parser. They enforce supported normal
tool calls; do not bypass them with encoded commands or wrapper scripts.

After plugin/config changes **restart OpenCode**. The current session does not
hot-load plugins. `node tools/harness_smoke.mjs` uses the installed CLI, an isolated
scratch Git repository and a local mock provider to verify eleven actual tool
calls: bare/pattern/loop waits, missing/stale gate refusals, a gated commit,
the Markdown-only exemption, and successful file/gone/PID handle waits. Git
history is checked after each call; per-call results and raw CLI/provider output
are retained. No global Git configuration, paid inference or real provider
credentials are required. Unit tests alone are not proof of active-session
enforcement.

Preflight requires a current receipt bound to guards, plugin, fixture, wait helper,
preflight implementation, project config and installed CLI version. A new failed
probe removes the old receipt, and edits during a probe cannot earn a pass.
`OPENCODE_PURE` is rejected because it disables external plugins. This controlled
fresh-process fixture is not proof about arbitrary global config or an existing
server: preflight also checks resolved permissions and explicitly reports that
boundary. Use harmless live-session probes after a restart before an unattended run.

## Externally supervised unattended runs

```bash
node tools/run-supervised.mjs overnight-unique-name 480 15 opencode run "<agreed task and stopping rule>"
```

The external process records `.local/runs/<name>/status.json`, a fixed wall-clock
deadline and child process group. The plugin records completed-tool timestamps.
Provider heartbeat bytes are not progress. Fifteen minutes without a completed
tool stops the run; the total deadline applies even if tools keep completing.
The values above are chosen run policy, not native game or provider constants.

For a healthy longer import/gate, start it with a retained job handle and register
a finite lease before waiting:

```bash
node tools/run-job.mjs <pid> 3600 "owned import"
tools/wait_for.sh file .local/<job>.exit 600
```

The lease must name a live PID and cannot extend the run deadline. It does not
change the provider's ten-minute request timeout. On timeout the supervisor stops
its child process group and records `blocked`; separately detached jobs survive
and must be inspected using their registered handle before resuming. A successful
child exit means the process completed, not that the feature acceptance passed.
This wrapper must launch the run: it cannot retroactively supervise this chat.

## Bounded, durable integration

```bash
node tools/worktree.mjs create issue-name HEAD
# Implement and verify in .local/worktrees/issue-name.
# Integrate its commits normally, then:
node tools/worktree.mjs retire issue-name
```

The helper permits one managed integration worktree, refuses a second, and refuses
retirement of dirty or unmerged work. Main-tree work is the coordinating slice;
keep any additional parallel task bounded and read-only until integration catches
up. Implementation patches/worktrees never belong under `/tmp`. `.local/**` stays
excluded from main-tree test discovery. These are recoverability constraints,
not permission to create agents or commits without the task's authorisation.

## Shared deployment

`node tools/shared-release.mjs <unique-name>` copies application code and JSON
metadata into `.local/releases/<name>`, preserving modes and recording hashes.
Release startup rejects modified files or dependency-lock drift. Its Vite cache
is private and source watching/HMR is disabled. Bulk artwork and installed
dependencies remain shared local resources; do not replace them during a match.

Verify a candidate on private ports before switching services. The host installer
now requires an explicit release directory. Saved state remains at the main
repository's `.local/shared-match.json`; incompatible state still fails with78.
Archiving/resetting an existing match requires the standing operational permission
or explicit owner instruction. No generic v1→v2 state migration is claimed.
