# Mobile Support Work Plan — Obsidian Git Plugin

## Status

| Stage | Status | Date |
|---|---|---|
| Stage 0: Diagnostics | ✅ Complete | 2026-05-12 (see work log) |
| Stage 1: Hardening | 🔲 Pending |
| Stage 2: Memory | 🔲 Pending |
| Stage 3: Robustness | 🔲 Pending |
| Stage 4: UX | 🔲 Pending |
| Stage 5: Tests | 🏗️ Infrastructure ready | 2026-05-12 |

---

## Overview

This document outlines findings from a comprehensive codebase analysis and a staged plan for making the Obsidian Git plugin work reliably on Android (target: Samsung Note 10+).

---

## Part 1: Architecture Summary

### Git Backend Selection

The plugin uses a **Strategy Pattern** with two Git implementations chosen at runtime:

| | Desktop | Mobile |
|---|---|---|
| **Class** | `SimpleGit` | `IsomorphicGit` |
| **Library** | `simple-git` (npm) | `isomorphic-git` (npm, v1.36.3) |
| **Implementation** | Spawns native `git` binary | Pure JavaScript |
| **Platform gate** | `Platform.isDesktopApp` | All other platforms |
| **Filesystem** | Direct via Node `fs` | `MyAdapter` wrapping Obsidian Vault adapter |
| **Auth** | SSH_ASKPASS + file watcher | HTTP Basic via callbacks + `requestUrl` |
| **Merge** | Native git merge/rebase | Custom `diff3` merge driver |

### Key Files

| File | Purpose | Lines |
|---|---|---|
| `src/main.ts` | Plugin orchestrator, init, commands, error display | 1635 |
| `src/gitManager/isomorphicGit.ts` | All isomorphic-git operations | 1319 |
| `src/gitManager/myAdapter.ts` | Filesystem bridge for isomorphic-git | 222 |
| `src/gitManager/gitManager.ts` | Abstract base class, contract | 330 |
| `src/gitManager/simpleGit.ts` | Desktop git via simple-git | 1457 |
| `src/constants.ts` | Default settings, platform defaults | 389 |
| `src/types.ts` | TypeScript interfaces | ~330 |
| `src/promiseQueue.ts` | Sequential operation queue | 49 |
| `src/automaticsManager.ts` | Auto commit/push/pull timers | 270 |
| `polyfill_buffer.js` | Buffer polyfill for mobile | 9 |
| `esbuild.config.mjs` | Build configuration | 73 |

### Critical Platform Gates

- `main.ts:539` — `useSimpleGit` getter: `return Platform.isDesktopApp`
- `constants.ts:34` — `refreshSourceControl` defaults to desktop-only
- `tools.ts:117` — Diff view forced to unified on mobile
- `commands.ts:239` — Amend command desktop-only
- `settings.ts:489` — Hunk/line-author settings hidden on mobile

---

## Part 2: Identified Issues

### 🔴 Critical: "Cannot find a valid git repository" Bug

**Location:** `src/gitManager/isomorphicGit.ts:629-634`

```typescript
async checkRequirements(): Promise<"valid" | "missing-repo"> {
    const headExists = await this.plugin.app.vault.adapter.exists(
        `${this.getRepo().dir}/.git/HEAD`
    );
    return headExists ? "valid" : "missing-repo";
}
```

**Problems:**

1. **Path construction when `basePath` is empty:** `getRepo().dir` returns `this.plugin.settings.basePath` which defaults to `""`. The template literal `` `${""}/.git/HEAD` `` produces `/.git/HEAD`. On Obsidian mobile, the vault adapter's `exists()` may not correctly resolve this leading-slash path.

2. **Does NOT respect `gitDir` setting:** When `settings.gitDir` is set (e.g., user cloned repo to a custom `.git` directory), the check still looks for `.git/HEAD` at the basePath location. The `gitdir` config passed to isomorphic-git at line 72 (`gitdir: this.plugin.settings.gitDir || undefined`) is completely ignored.

3. **No diagnostic logging:** When check fails, there is zero logging to help debug WHY — is the path wrong? Does the directory not exist? Is `.git` missing entirely, or just `HEAD`?

### 🔴 Critical: `updateBasePath()` No-Op Bug

**Location:** `src/gitManager/isomorphicGit.ts:902-904`

```typescript
updateBasePath(basePath: string): Promise<void> {
    this.getRepo().dir = basePath;
    return Promise.resolve();
}
```

`getRepo()` creates a **new object every call**, so mutating `.dir` on the returned object has zero effect on subsequent calls. This method is effectively a no-op. Fortunately, the clone flow directly sets `this.settings.basePath` before calling `clone()`, so it works there, but any code path that relies on `updateBasePath()` alone (like changing basePath in settings) may silently fail.

### 🔴 Critical: No Operation Timeouts

**Location:** `src/promiseQueue.ts`

The `PromiseQueue` has no timeout mechanism. If any isomorphic-git operation hangs (e.g., network stalls during clone/pull/fetch), the entire queue is blocked permanently. On mobile with unreliable networks, this is a frequent failure mode.

The only "timeout" in isomorphicGit.ts is informational — a Notice after 20 seconds (`status()` at line 153, `getUnstagedFiles()` at line 1018).

### 🔴 Critical: Full HTTP Body Buffering

**Location:** `src/gitManager/isomorphicGit.ts:1305-1319`

```typescript
async function asyncIteratorToArrayBuffer(
    iterator: AsyncIterableIterator<Uint8Array>
): Promise<ArrayBuffer> {
    const stream = new ReadableStream({...});
    const response = new Response(stream);
    return await response.arrayBuffer();
}
```

The entire request body is collected into a single `ArrayBuffer` before sending through `requestUrl`. Similarly, responses come back as a single `ArrayBuffer`. On Samsung Note 10+ (typically 8-12GB RAM), large repos during clone/pull could exhaust available memory, causing crash or buffer overflow.

### 🟡 High: No Network Error Handling on Mobile

**Location:** `src/main.ts:1581-1593` and `src/gitManager/simpleGit.ts:1260-1281`

Only `SimpleGit` converts network errors to `NoNetworkError` and enters offline mode. IsomorphicGit throws raw errors, which:
- Don't trigger the "offline mode" state
- Show repetitive error popups on network retry
- Don't have user-friendly messages

### 🟡 High: In-Memory Index Buffering

**Location:** `src/gitManager/myAdapter.ts:79-82,114-148`

The entire `.git/index` binary is stored as an `ArrayBuffer` in `this.index`. For repos with many tracked files, this could be several MB. Cleared only on `saveAndClear()`.

### 🟡 High: No Cancellation Mechanism

Long operations (`status`, `pull`, `clone`, `fetch`) cannot be cancelled mid-flight. The 20-second "takes longer" notice is purely informational.

### 🟠 Medium: `branchIsMerged` Always True

**Location:** `src/gitManager/isomorphicGit.ts:712-714`

```typescript
branchIsMerged(_: string): Promise<boolean> {
    return Promise.resolve(true);
}
```

Users can delete unmerged branches without warning on mobile.

### 🟠 Medium: No `readlink`/`symlink` Support

**Location:** `src/gitManager/myAdapter.ts:186-191`

Throws errors if isomorphic-git tries to read or create symlinks. While symlinks are rare in Obsidian vaults, this could cause unexpected failures.

### 🟠 Medium: Build Target Limitations

**Location:** `esbuild.config.mjs:44` — `target: "es2018"`

The `es2018` target doesn't support `for await...of` natively, requiring the manual workaround functions at the bottom of isomorphicGit.ts (lines 1272-1319). Moving to a newer target could simplify code but needs mobile compatibility verification.

### 🟢 Low: Conflict Detection Gap

**Location:** `src/main.ts:889-898`

On mobile, existing merge conflicts are only detected during commit attempts (not via status). This is a known limitation noted in comments.

---

## Part 3: Staged Implementation Plan

### Stage 0: Diagnostics & Verification Infrastructure

**Goal:** Add logging and diagnostic tools to understand exactly what's failing on mobile.

**Tasks:**

#### 0.1: Add diagnostic logging to `checkRequirements()`
- Log the resolved path being checked
- Log whether `.git` directory exists
- Log whether `.git/HEAD` exists
- Log current `basePath` and `gitDir` settings values
- Log Obsidian vault adapter base path for context

#### 0.2: Create a "Git Repository Diagnostics" command
- New command available on all platforms
- Shows: basePath, gitDir, resolved repo path, .git existence, HEAD existence, remote config, branch info
- Output as a Notice or modal with copyable text

#### 0.3: Fix path construction in `checkRequirements()`
- When `basePath` is empty, use `.git/HEAD` (not `/.git/HEAD`)
- When `gitDir` is set, check that path instead of `.git/HEAD`
- Use `normalizePath` consistently

#### 0.4: Fix `updateBasePath()` no-op
- Either: store `dir` as instance variable and read from it
- Or: remove the method and rely on settings-based approach

**Test:**
- Manual test: Fresh install → run diagnostics → verify correct paths
- Manual test: Set custom `basePath` → run diagnostics → verify
- Manual test: Set custom `gitDir` → run diagnostics → verify

**Human gate:** User verifies diagnostic output on Samsung Note 10+.

#### Stage 0 Work Log (2026-05-12)

**Device:** Samsung Note 10+ (Android) connected via USB/ADB to M1 MacBook Pro
**Vault:** `personalVault` split setup (git repo outside vault)

**Changes made:**

1. **`checkRequirements()` — [isomorphicGit.ts:642](src/gitManager/isomorphicGit.ts#L642)**
   - Switched from `vault.adapter.exists()` (sandboxed to vault root) to `this.fs.stat()` (MyAdapter — falls back to native adapter for paths outside vault). Required for split vault/git setups where `.git` is outside the Obsidian vault.
   - Added diagnostic logging: resolves and logs `dir`, `gitdir`, `headPath`, whether HEAD exists, and whether `.git` directory exists.

2. **`getRepo()` — [isomorphicGit.ts:72](src/gitManager/isomorphicGit.ts#L72)**
   - Added path normalization: auto-prepends missing leading `/` on Android-style absolute gitDir paths (3+ segments, no leading `.` or `/`). e.g. `storage/emulated/0/Documents/...` → `/storage/emulated/0/Documents/...`

3. **Diagnostics command — [commands.ts:563](src/commands.ts#L563)**
   - New "Git repository diagnostics" command available on all platforms
   - Shows: platform, backend, basePath, gitDir, resolved paths, HEAD exists, `.git` dir exists
   - Output in Notice (visible on mobile, no dev tools needed)
   - Also tries `../.git/HEAD` as alternative for split vault/git setups

4. **`updateUpstreamBranch()` — [isomorphicGit.ts:961](src/gitManager/isomorphicGit.ts#L961)**
   - Push failure no longer prevents upstream config from being set (catch → log → continue)
   - Passes remote URL explicitly to `git.push()` to bypass isomorphic-git config lookup issues
   - Now sets both `branch.<name>.remote` AND `branch.<name>.merge` (was only setting merge)

5. **`getCurrentRemote()` — [isomorphicGit.ts:720](src/gitManager/isomorphicGit.ts#L720)**
   - When `branch.<current>.remote` is not set (common with non-"origin" remote names), falls back to scanning all remotes to find the one tracking the current branch, then falls back to first available remote. Previously hardcoded to `"origin"`.

6. **`branchInfo()` — [isomorphicGit.ts:691](src/gitManager/isomorphicGit.ts#L691)**
   - Now uses `getCurrentRemote()` instead of duplicating the remote resolution logic with `"origin"` hardcoded default.

7. **`fetch()` and `push()` — [isomorphicGit.ts](src/gitManager/isomorphicGit.ts)**
   - Both now resolve the remote URL via `getRemoteUrl()` and pass it directly to isomorphic-git, bypassing internal git config lookup (which can fail on Android scoped storage).

8. **Remote URL fallback — [localStorageSettings.ts](src/setting/localStorageSettings.ts)**
   - Added `getRemoteUrl()`, `setRemoteUrl()`, `getRemoteUrls()` to local storage settings
   - `setRemote()` now stores URL in plugin local storage as fallback (essential on Android where git config may not be writable from vault adapter sandbox)
   - `getRemoteUrl()` checks git config first, falls back to local storage

**Root causes identified:**
- `vault.adapter.exists()` / `vault.adapter.read()` cannot access paths outside the Obsidian vault on Android → fix: use MyAdapter which falls back to native adapter
- `updateUpstreamBranch()` was calling `git.push()` before setting upstream config, and push failure blocked config from being saved
- `getCurrentRemote()` hardcoded `"origin"` default; user's remote was named `"personalVault"`
- `branchInfo()` had separate remote resolution from `getCurrentRemote()` — both needed fixing
- Plugin's path mapping (`basePath` mechanism) assumes git repo is inside vault, not vice versa

**Phone configuration fixes:**
- Moved `.git` from outer directory into vault root (git now inside vault, matching plugin assumptions)
- Set `basePath: ""`, `gitDir: ""`, disabled all auto-sync intervals
- Created `.gitignore` with `.DS_Store`, workspace files, `.trash/`
- Flattened repo structure: `personalVault/file.md` → `file.md` (vault = git root)

**Test results:**
- Manual test on Samsung Note 10+: plugin finds repo, pull succeeds, push succeeds
- Desktop: push/pull working, repo structure flattened

---

### Stage 1: Hardening Core Operations

**Goal:** Prevent crashes and hangs during fundamental git operations.

#### 1.1: Add operation timeouts to `PromiseQueue`
- Add configurable timeout (default: 5 minutes)
- On timeout: abort operation, show error, clear queue
- Make timeout configurable via settings (with mobile-safe defaults)

#### 1.2: Add per-operation abort controller
- Pass `AbortSignal` through to isomorphic-git operations
- Wire to the timeout mechanism from 1.1
- Show "Cancel" button on long-operation notices (replaces passive 20s notice)

#### 1.3: Add memory pressure monitoring
- Before large operations (clone, pull), check available memory
- If close to limit, warn user and suggest:
  - Shallow clone (`depth` parameter)
  - Selective sync (stage individual files)
  - Close other apps

#### 1.4: HTTP response size limiting
- Add `maxResponseSize` check (configurable, default 100MB)
- Reject responses exceeding limit with clear error message
- Suggest shallow clone or smaller repo

#### 1.5: Network error detection for isomorphic-git
- Port the `NoNetworkError` pattern from SimpleGit
- Detect: timeout, DNS failure, connection refused, SSL errors
- Enter "offline mode" like desktop does
- Add exponential backoff for auto-retries

**Tests:**
- Unit test: Timeout mechanism fires correctly
- Unit test: Abort controller cancels in-progress operation
- Manual test: Pull large repo, verify timeout and cancellation
- Manual test: Disconnect network, verify offline mode behavior

**Human gate:** User tests pull/push/clone with network disconnection on Samsung Note 10+.

#### Stage 1 Work Log (2026-05-12)

**Device:** Samsung Note 10+ (Android) connected via USB/ADB to M1 MacBook Pro
**Vault:** `personalVault` (git repo inside vault, flattened from Stage 0)

**Changes made:**

1. **Operation timeouts — [promiseQueue.ts](src/promiseQueue.ts)**
   - Rewrote `PromiseQueue` with dual API: legacy `addTask()` (unchanged) and new `addTaskAsync()` returning a `Promise<T>`
   - `addTaskAsync()` supports per-task `timeoutMs` and a queue-level `defaultTimeoutMs` constructor option
   - On timeout, the task's `AbortController` fires and a `TimeoutError` is thrown (rejected via Promise, not shown as a plugin error popup)
   - Non-timeout errors still go through `displayError()` for user visibility

2. **Per-operation abort controller — [promiseQueue.ts](src/promiseQueue.ts)**
   - Each queued task gets an `AbortController`; its `AbortSignal` is passed via `TaskContext.signal`
   - Callers can check `signal.aborted` to bail out early in long operations

3. **HTTP response size limiting — [isomorphicGit.ts](src/gitManager/isomorphicGit.ts)**
   - After receiving HTTP response, checks `res.arrayBuffer.byteLength` against a 100MB max
   - Throws `ResponseTooLargeError` if exceeded — prevents OOM crashes on mobile during clone/pull of large repos

4. **Network error detection for isomorphic-git — [isomorphicGit.ts](src/gitManager/isomorphicGit.ts) + [networkErrors.ts](src/networkErrors.ts)**
   - New `networkErrors.ts` module with `classifyHttpError()`, `NetworkError`, `ResponseTooLargeError`, `isTransientMessage()`
   - `classifyHttpError()` detects: DNS failure, timeout, connection refused/reset, SSL errors, unreachable host
   - `requestUrl` call wrapped in try/catch: network-level failures throw `NetworkError` with user-friendly message
   - HTTP status ≥ 400 classified; network-transient errors throw `NetworkError`, auth/not-found errors fall through to isomorphic-git's `onAuthFailure` callback
   - Ports the `NoNetworkError` pattern from SimpleGit to the isomorphic-git codepath

**What was NOT implemented (deferred):**
- **1.3 Memory pressure monitoring** — no cross-platform API available; response size limit (1.4) serves as the primary guard
- Cancel button on long-operation notices — the abort signal infrastructure is in place but UI wiring deferred to Stage 4 (UX)

**Human validation (2026-05-12):**
- ✅ Plugin loads and finds repo on Samsung Note 10+
- ✅ Perceived performance improvement (likely from error classification short-circuiting)
- ✅ No crashes observed in basic operations

---

### Stage 2: Memory Optimization

**Goal:** Reduce memory footprint of git operations on mobile.

#### 2.1: Chunked HTTP body handling
- Replace `asyncIteratorToArrayBuffer` with streaming approach where possible
- Use chunked transfer for push (stream request body)
- If streaming via `requestUrl` is not possible, limit chunk sizes

#### 2.2: Paginated `walk` and `statusMatrix` for large repos
- Add file count limits to `status()` and `getUnstagedFiles()`
- Implement progressive/paginated loading for repos with many files
- Add setting: "Max files to process per operation" (mobile default: 500)

#### 2.3: Index buffer size limits
- Add size check before caching `.git/index`
- Fall back to direct read/write for very large indexes
- Log warning when index exceeds threshold

#### 2.4: Stream diff generation
- Use incremental diffing for large files
- Add file size limit for diff generation (configurable)

**Tests:**
- Bench test: Memory usage before/after with large repo
- Unit test: Chunked HTTP body assembly
- Manual test: Clone large repo, monitor memory

**Human gate:** User tests with 1000+ file vault on Samsung Note 10+.

---

### Stage 3: Robustness & Edge Cases

**Goal:** Handle edge cases gracefully and provide better error recovery.

#### 3.1: Implement `branchIsMerged` for isomorphic-git
- Use `git.walk` to compare branches
- Determine if branch is fully merged into current branch
- Match SimpleGit behavior

#### 3.2: Graceful handling of `readlink`/`symlink` errors
- Catch and log symlink errors without failing the operation
- Return appropriate fallback values

#### 3.3: Configurable retry for transient failures
- Add retry count setting (default: 2 for mobile)
- Exponential backoff between retries
- Only retry on network/timeout errors, not auth or logic errors

#### 3.4: Conflict detection improvement
- Add conflict detection during `status()` on isomorphic-git
- Check for `.orig` files or MERGE_HEAD
- Surface conflicts earlier, not just on commit

#### 3.5: Repository recovery tools
- Add "verify repository" command
- Add "repair index" command (rebuild from working tree)
- Graceful handling of corrupted `.git` state

**Tests:**
- Unit test: `branchIsMerged` returns correct results
- Unit test: Symlink error handling
- Manual test: Corrupt `.git` directory, run recovery tools

**Human gate:** User tests recovery flow on Samsung Note 10+.

---

### Stage 4: UX Improvements

**Goal:** Make mobile experience smooth and informative.

#### 4.1: Mobile-optimized progress indicators
- Replace passive "takes longer" notices with active progress bars
- Show file count, transfer size, estimated time
- Ensure progress updates don't themselves cause performance issues

#### 4.2: Settings validation
- Validate `basePath` and `gitDir` paths when user changes them
- Show immediate feedback if path doesn't contain a valid repo
- Prevent invalid configurations from being saved

#### 4.3: Mobile-specific settings defaults
- `refreshSourceControl`: `false` (already default on mobile)
- `disablePopups`: `true` for network warnings (less intrusive)
- New: `mobileLowMemoryMode`: enables all memory-saving options
- New: `mobileOperationTimeout`: shorter timeout default for mobile

#### 4.4: Improved error messages
- Replace raw isomorphic-git errors with user-friendly messages
- Add "What to do" suggestions in error notices
- Common scenarios: auth failure, network error, OOM, path issues

**Tests:**
- UX review: Progress indicators during pull/clone
- Manual test: Trigger common errors, verify message quality

**Human gate:** User reviews mobile UX on Samsung Note 10+.

---

### Stage 5: Test Suite

**Goal:** Build comprehensive automated test coverage.

#### 5.1: Unit tests for `MyAdapter`
- File read/write with mock vault
- Index caching and clearing
- Path resolution edge cases

#### 5.2: Unit tests for `IsomorphicGit` core operations
- `checkRequirements()` with various path/config combinations
- `status()`, `stageAll()`, `commit()` with mock isomorphic-git
- `updateBasePath()` behavior

#### 5.3: Unit tests for `PromiseQueue`
- Timeout behavior
- Sequential execution
- Error recovery

#### 5.4: Integration tests
- Init repo → add files → stage → commit → push (mock HTTP)
- Clone with depth
- Pull with merge and merge conflict
- Network error recovery

#### 5.5: Mobile-specific stress tests
- Large repo (>1000 files) performance
- Network interruption during operations
- Memory pressure simulation

**Test framework:** Jest or Vitest (compatible with esbuild workflow)

**Human gate:** Review test coverage report before Stage 5 complete.

---

## Part 4: Implementation Order & Dependencies

```
Stage 0 (Diagnostics) ──► Stage 1 (Hardening) ──► Stage 2 (Memory) ──► Stage 3 (Robustness) ──► Stage 4 (UX)
                                                    │
                                                    └──► Stage 5 (Tests) — runs in parallel with all stages
```

Each stage:
1. Implement changes
2. Write/update tests (Stage 5 tasks)
3. Build (`pnpm run build`)
4. **Human gate:** User tests on Samsung Note 10+
5. User signs off → proceed to next stage

---

## Part 5: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| isomorphic-git has unfixable bugs | Medium | High | Isolate with try/catch, add fallback guidance |
| `requestUrl` cannot stream on mobile | High | Medium | Accept chunked buffering as best available |
| Mobile Obsidian API limitations | Medium | Medium | Diagnostic logging to identify API gaps |
| Memory constraints too tight for large repos | High | Medium | Document repo size limits, recommend shallow clone |
| Build target (es2018) incompatible with modern JS | Low | Low | Test before upgrading target |

---

## Part 6: Success Criteria

1. Plugin can initialize and find git repo on Samsung Note 10+ (no "missing-repo" error)
2. Clone succeeds for repos up to 500MB
3. Pull succeeds without crashes
4. Push succeeds
5. Auto-commit works on interval
6. Network errors handled gracefully (no crash, clear message)
7. Operations cancellable by user
8. Memory usage stays within limits for repos up to 1000 files
