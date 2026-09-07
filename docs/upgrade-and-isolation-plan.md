# Plan: Electron Upgrade, then Context Isolation

Companion to [`native-command-inventory.md`](./native-command-inventory.md), which
holds the command-by-command detail for Part 2.

Baseline (`fc501a3`): Electron 18.3.15, Quill 1.3.7, 830 tests passing in ~22s,
zero native modules, `src/index.js` untested.

**Status as of `0aa3e3a`.** Part 1 steps 1–3 are done: baseline tagged
(`pre-electron-upgrade-baseline`), electron-forge unified to 7.11.2 (`834a772`),
test script scoped and `test/` excluded from packages (`fffcbd6`), and Electron
jumped 18.3.15 → **44.2.0** (`9a4bdbf`).

Steps 4 and 5 are done: all 26 majors' breaking changes read against the actual
API surface, with nothing requiring a code change — `sandbox` stays false because
`nodeIntegration: true` disables it (verified from the live docs, not assumed;
that reasoning expired at Phase 9b, where `sandbox: false` became an explicit
line rather than an inherited one — see the write-up there),
`new-window` and the `crashed` events were already on their replacements, and
`getSelectedStorageBackend`'s `basic_text`/`unknown` sentinels are unchanged.
Step 6 is done, including a real writerDeck on Pi OS Lite + Xorg + Matchbox; the
three bugs it surfaced are fixed in `a0a199c`, `0aa3e3a` and `bd615c7`.

Step 7 is done: `v2.4.0` tagged at `fc67c9c`, built by CI, and the resulting
arm64 `.deb` installed and verified on the writerDeck — app launches under
Matchbox, Help doc opens and behaves correctly (which also confirms
`packagerConfig.ignore` keeps `examples/` in the package).

**Part 1 is complete.** Suite is at 830. Part 2 is clear to start.

**Part 2, Phase 0 is complete.** `esbuild` bundles `src/render.js` (CommonJS
as-is, `platform: node`, `--external:electron`) into `src/render.bundle.js`,
and `src/index.html` loads that instead of the raw `render.js`. Node builtins
resolve as externals automatically under `platform: node` and still go through
Node integration, unchanged. The bundle is generated, not committed
(`.gitignore`'d); `npm run build:renderer` produces it, and `prestart`/
`prepackage`/`premake` npm hooks run it ahead of `electron-forge
start`/`package`/`make` for local use. CI calls `npx electron-forge`
directly rather than through `npm run`, so those hooks don't fire there —
`.github/workflows/release.yml` gets its own explicit `npm run build:renderer`
step in each platform job instead. Verified: 824 tests green, and a packaged
Windows build (`electron-forge package`) launches and renders the Frankenstein
example correctly from the bundle.

**The suite does not test the bundle by default, so it is made to.** Every other
test here exercises the source tree; the app loads only the bundle. Deleting
`src/render.bundle.js` outright left all 830 tests green — a build regression,
an esbuild resolution failure, or simply never running the build would all ship
an app that cannot start behind a clean suite. `test/render-bundle.test.js`
closes that: it loads the built bundle through the same jsdom harness
`render.test.js` uses and asserts it runs its startup path, mounts both Quill
editors, still exports the API the menu drives it through, and — the actual
Phase 0 property — contains **no relative `require()` calls**, with only Node
builtins and `electron` left external. A `pretest` hook builds the bundle so it
is always present and current. Verified non-vacuous by mutation: rebuilding with
one module deliberately left external fails two of the six.

`--sourcemap` is on, so renderer devtools show real source rather than 2.8mb of
bundled output — worth having before Part 2 starts moving 61 commands through
this code. The 4.9mb `.map` ships inside the package (it is not in
`packagerConfig.ignore`), which is deliberate: ~1.5% of the installed size, in
exchange for readable stack traces out of a user's real install.

**At Phase 9 this build changes.** `--platform=node` is right while
`nodeIntegration` is on — Node builtins resolve as externals through it. Once
`contextIsolation` is on they are simply unavailable, so the flag becomes
`--platform=browser` and every surviving builtin import fails at build time.
That is the desired behavior (it is how the flip proves nothing was missed), but
it should be expected rather than discovered. Note the limit found in Phase 2:
this catches *imports*, not bare global reads like `process.platform`, which
compile through and fail at runtime instead.

**Part 2, Phase 1 is complete.** The contract lives in
`src/components/controllers/platform.js`, which declares **61 commands** across
the inventory's groups A–K and **36 events**, and requires nothing — not `fs`,
not `electron`. That last part is the property that carries it through Phase 9:
the contract file still builds once esbuild switches to `--platform=browser`, and
`src/components/controllers/platform-node.js` is the file that has to be gone by
then. A test asserts it, so the property cannot rot quietly.

`createPlatform(backing)` wraps a backing in the contract: one async method per
declared command, every rejection a `PlatformError` with a stable `code`, and
the result frozen. Nothing outside the table is reachable — which is what makes
"the renderer cannot read a stored secret" a checkable claim rather than a
convention, since the node backing's `resolveSecret` is deliberately not a
command and is therefore invisible through the facade.

Four contract rules were forced by the two hard commands rather than chosen:

- **One object argument, always.** Tauri's `invoke()` takes named arguments;
  positional ones do not exist in its IPC. Discovered from the target platform,
  not from taste, and it applies to all 61.
- **A command returns whatever the renderer must not compute.**
  `saveChapterAtomic` allocates the chapter filename and hands it back.
- **Multi-step operations are one command**, so the renderer cannot mis-order
  native steps.
- **Failure is loud.** Both bugs this project has already shipped — a save that
  failed with EACCES and said nothing, and a `.deb` that could not be unpacked —
  were silence, not wrongness.

Backed by `test/platform.test.js` (33 tests; suite is now **863**), verified
non-vacuous by four mutations: allocating the filename before stashing the old
file, dropping the rollback, letting a notes failure fail the chapter save, and
making `describeCredential` pass the store's object straight through. Each
fails the tests that exist for it and nothing else.

No call sites were converted. Phases 2–8 fill in the backing one group at a
time; every command not yet implemented rejects with `NOT_IMPLEMENTED` naming
its group, so the suite says what is still outstanding.

**Line references were re-verified against `569cba4` before any design work**,
since they had gone stale twice before. Every count in the inventory holds — 106
`fs.*Sync` calls across 18 files, 9 `ipcMain` handlers, 5 `sendSync` calls, 29/31
node-free views, 18/36 node-free controllers — and every per-file reference
resolves, except two: the Help doc's `sysDirectories.app` read is at
`render.js:830`, not `:807`, and the `webPreferences` block Phase 9 flips is at
`index.js:54-59`, not `:45-47`. Both are corrected in place.

**Three findings from Phase 1, each a correction to the inventory** — recorded
in full in [`native-command-inventory.md`](./native-command-inventory.md):

1. **`saveChapterAtomic`'s published signature was wrong.** It took
   `newFilename` as an input, which implies a separate
   `findAvailableChapterFilename` call — splitting the transaction and opening a
   race between the name being chosen and the write happening. It takes the
   *title* and returns the allocated filename.
2. **The credential group is 7 commands, not 4,** and `getCredential` is not one
   of them. See the inventory; this is the one that would have been most
   expensive to discover in Phase 7.
3. **The event surface was missing entirely.** The inventory named one
   main→renderer event; there are 36. Every one has to cross the bridge in
   Phase 9 or the menu silently stops working.

`npm test` is bare `node --test`, which recursively discovers test files from
cwd (excluding only `node_modules`). Run it after any `electron-forge
package`/`make`, and it also picks up the stale copy of `test/` that forge
writes into `out/…/resources/app/test/` — silently re-running an old copy of
the suite against an old copy of `src/`, which can mask a real regression
during upgrade verification. `scripts.test` is scoped to
`node --test "test/*.test.js"` to prevent this (note: `node --test test/`
alone does not work — it needs the quoted glob). `out/` is also excluded from
packaged releases via `packagerConfig.ignore` in `package.json`.

---

# Part 1 — Electron upgrade

Independent of the isolation work, and first. It closes a four-year gap in
security patches, it may improve ARM performance on its own, and doing it after
the isolation work would mean two rounds of cross-platform smoke testing instead
of one.

## What makes this easier than it looks

- **No native modules.** Every runtime dependency (`archiver`, `docx`,
  `nodemailer`, `nspell`, `quill`, `unzipper`) is pure JS. There are no `.node`
  binaries outside Electron itself, so there is no node-gyp rebuild, no ABI
  mismatch, and no prebuild matrix. This removes the usual worst part of an
  Electron jump.
- **A small, stable main-process API surface.** `src/index.js` uses about twenty
  distinct Electron calls: `app.getPath/quit/on/isPackaged/name/getVersion/
  applicationMenu`, `BrowserWindow`, `Menu.buildFromTemplate/setApplicationMenu`,
  `nativeTheme.themeSource`, `safeStorage.*`, `webContents.send/on/openDevTools/
  setWindowOpenHandler`, and `ipcMain.on`. All still exist and are stable. The
  `webContents.on` handlers are `will-navigate` and `render-process-gone` — the
  latter already the modern replacement for the `crashed` events removed in 29.
  Check against the file, not this list: it was written from a grep and missed
  `render-process-gone` on the first pass.
- **The renderer is already hardened.** `setWindowOpenHandler` deny,
  `will-navigate` deny, gated devTools, and the close guard are already in place
  (`index.js:108-118`), so the upgrade does not have to introduce them.

## What actually carries risk

**Not the code — the support matrix.** The likely breakage is which platforms you
can still ship to:

- Electron ships `x64` and `arm64` Linux binaries only, and supports distro
  versions still maintained by both Chromium and the distro maker. Raspberry Pi
  OS **Bookworm** (glibc 2.36) is comfortably inside that; **Bullseye** (2.31)
  sits right at Chromium's floor and is now on Debian LTS; **Buster** (2.28) is
  out. 32-bit Pi OS (`armv7l`) is not a supported Electron target at all — the
  release workflow already builds `arm64` only, so this changes nothing.
- Windows 7/8/8.1 support ended at Electron 22.
- macOS minimum moved to 10.15+.

**Window mode on the writerDeck: Ozone/X11 against Matchbox.** The documented
writerDeck stack is Raspberry Pi OS **Lite + Xorg + matchbox-window-manager**,
launched from `.xinitrc` via `startx`. There is no desktop image and therefore no
Wayland session, so Wayland is not a concern for this deployment — even at
Electron 38+, where `--ozone-platform` defaults to `auto`, "auto" resolves to X11
with no Wayland session present.

The real risk is X11-side. Electron replaced its legacy X11 backend with the
Ozone abstraction across the majors being jumped, and `kiosk: isLinux`
(`index.js:60`) depends on the window manager honoring EWMH fullscreen hints.
Matchbox is about as minimal a WM as exists. Verify on a real writerDeck that the
upgraded build still comes up as a true fullscreen kiosk window.

**Wayland still matters for desktop-image users.** The published arm64 `.deb` is
generic, and users who did not follow the writerDeck wiki may be on the Bookworm
desktop image, which does default to Wayland (labwc on Pi 4/5). Crossing Electron
38 flips those users from XWayland to native Wayland and changes kiosk/fullscreen
semantics. If that segment matters, pin it:
`app.commandLine.appendSwitch('ozone-platform', 'x11')`. Note that
`ELECTRON_OZONE_PLATFORM_HINT` was removed in Electron 38 — it must be a
command-line switch, not an env var.

**Lite has no keyring.** `isSecureStorageAvailable()` (`index.js:517-539`) is
load-bearing on the writerDeck rather than merely defensive. Its behavior is
already correct; do not let an upgrade regress it, and exercise the email flow on
a real Lite install during the smoke pass.

**GPU and memory on ARM.** Electron's arm64 build is stock Chromium, not the
Pi-patched Chromium Raspberry Pi ships — no hardware video decode, and V3D
acceleration may need `--disable-gpu` or `--use-gl=egl`. Already true at 18, but
newer Chromium leans harder on GPU compositing, so watch for a regression. On
2GB Pi 4 units, measure memory rather than assuming the per-chapter lazy loading
absorbs it.

**Verification is manual.** `src/index.js` has no tests, and the 830 existing
tests run under plain Node — they will pass regardless of the Electron version
and prove nothing about the upgrade. The real oracle is a smoke pass on each
target.

## Steps

**1. Record the baseline.** `npm test` (expect 830 pass), then build on each
target you ship. Tag the commit so there is a known-good point to diff against.

**2. Unify electron-forge first, as its own commit.** The config is currently
skewed: `cli`, `maker-deb`, `maker-rpm`, `maker-squirrel`, and `maker-zip` are on
`^6.0.0-beta.54` while `maker-dmg` is on `^7.3.1`. Move everything to current 7.x
and confirm builds still produce artifacts *before* changing Electron. Debugging
a forge problem and an Electron problem simultaneously is the main avoidable
mistake here.

**3. Jump straight to latest stable.** Do not walk the majors one at a time.
With a twenty-call API surface and no native modules, stepping through fifteen-plus
releases costs days and finds nothing. If the single jump produces a confusing
failure, *then* bisect to an intermediate major.

**4. Read the breaking-changes list once, filtered.** Go through Electron's
cumulative breaking-changes doc and check only against the twenty calls above.
Most entries will not apply. Pay attention to anything touching `safeStorage` on
Linux, since `isSecureStorageAvailable()` (`index.js:517-539`) depends on
`getSelectedStorageBackend` behavior.

**5. Confirm the webPreferences still mean what they meant.** Electron 20 made
renderers sandboxed by default, but `nodeIntegration: true` at `index.js:55`
implies `sandbox: false`, so behavior should be unchanged. Verify rather than
assume — if this silently changed, nothing in the renderer would load and the
failure would look unrelated. *(This is exactly the coupling Phase 9b had to
handle on the way out: removing `nodeIntegration` un-disables the default, so the
flip would have enabled the OS sandbox as a side effect had it not written
`sandbox: false` out explicitly.)*

**6. Smoke pass, per platform.** The features that exercise the parts an upgrade
can break:

- Open, save, Save As, Save Copy; the in-app file dialog listing real directories
- Chapter create/rename/delete/reorder, renumber, trash, reference section
- Import: plaintext, MarkdownFic, `.docx`
- Export: txt, mdfc, md, HTML, docx, epub — individually and via Compile
- Corkboard, outliner, word count, spellcheck
- Alt to summon the menu; every close path (X, Alt+F4, Cmd+Q, Cmd+W) hitting the
  unsaved-changes guard
- Dark/light/system theme switching
- Email a draft (exercises `safeStorage` + the credential store end to end)
- Auto-save and auto-backup
- **On a real writerDeck (Pi OS Lite + Xorg + Matchbox, launched via `startx`):**
  that `kiosk` still yields a true fullscreen window under Ozone/X11, typing
  latency and scroll smoothness in a long chapter, memory on a 2GB Pi 4, the
  email flow (exercises the no-keyring `safeStorage` fallback), and the wifi
  manager and battery monitor — Pi-only paths nothing else covers

**7. Ship it as its own release.** Do not begin Part 2 until this is out and has
survived contact with real use. If modern Chromium meaningfully improves Pi
performance, that also updates the Tauri calculation.

## Smoke-pass findings

**Read-only install directory (fixed, `a0a199c` + `0aa3e3a`).** The bundled
Frankenstein example and the Help doc were opened in place from inside the
install directory, which normal users cannot write to — every autosave and manual
save failed with EACCES, silently, with no UI feedback. Both now copy to userData
on first open via `copyExampleToUserData()` (`render.js:91-104`).

Two things follow from this that outlive the fix:

- It is the first bug the upgrade smoke pass caught, and it is a *packaging*
  bug, not an Electron-version bug — it would have been present at 18.3.15 in any
  packaged install.
- The fix added a new renderer→OS operation, tracked as
  `materializeBundledProject` in the inventory. It is currently **untested** —
  `copyExampleToUserData` has no coverage in `test/`, and the failure mode it
  handles (a read-only install dir) is exactly the one a dev machine never
  reproduces. Worth a test before Part 2 starts converting this code.

**A green build is not an installable artifact (fixed, `fc67c9c`).** The first
`v2.4.0` build succeeded on every job and still produced a `.deb` that Raspberry
Pi OS Bullseye refused outright: `dpkg-deb: error: archive uses unknown
compression for member 'control.tar.zst'`. dpkg gained zstd support in 1.21;
Bullseye ships 1.20.9. `electron-installer-debian` 3.2.0 only passes `dpkg-deb`
a `-Z` flag when `compression` is set, and with none set it inherits
`dpkg-deb`'s default — which Ubuntu patches to zstd. So building on
`ubuntu-latest` shipped a package that could not be unpacked on the platform the
release notes claim to support. Nothing to do with Electron or forge.

Fixed by pinning `compression: "xz"` in the maker options, plus a CI step that
inspects the built artifact with `ar t` and fails if it finds a `.zst` member —
this failure only appears on a machine no build-matrix job runs on, which is
exactly how it reached a tagged release.

Two things worth carrying forward:

- The v2.3.0 and v2.3.1 Linux debs were built by the same workflow on the same
  runners, so they are almost certainly zstd too. If anyone reports an older
  release failing to install on a Pi, this is why.
- **The lesson generalizes to Part 2.** Phase 0 replaced how the renderer loads
  and passed the whole suite while the app's actual entry point went entirely
  untested — `test/render-bundle.test.js` closes that specific hole, but only
  that one. Nothing in the suite still proves a *packaged* build starts. Every
  phase that changes packaging or module loading needs verifying as an installed
  build on the writerDeck, not just as a green suite.

**`sysDirectories.app` sweep: clean.** All four consumers checked; nothing else
writes into the install directory, and no renderer code uses `__dirname` or
`process.cwd()` at all. Every remaining write target derives from `userData`,
`docs`, `temp`, a project directory, or a user-chosen path.

| Consumer | Access |
|---|---|
| `spellcheck.js:17-20` — reads `en_US-large.aff` / `.dic` | read-only (personal dict writes go to `userData`) |
| `about_display.js:96` — reads `licenses.txt` | read-only |
| `render.js:62` — Frankenstein example | fixed in `a0a199c` |
| `render.js:830` — Help doc | fixed in `0aa3e3a` |

**Resolved: the copy is never refreshed.** Fixed by making the Help doc a
read-only reference project (option 2 of the three below). It now opens in place
from the install directory, so it always describes the installed version, and
`project.isReadOnly` keeps anything from trying to write there: `saveFile()`
refuses while it is set, an explicit save routes to Save As so an annotated copy
gets a home the reader chose, autosave skips, and the title bar says
`(read-only)`. The Frankenstein example still copies to userData — it is a
starter project meant to be edited, where a stale copy costs nothing.

Covered by 11 new tests (7 in `project.test.js`, 4 in `render.test.js`), which
also close the untested-`copyExampleToUserData` gap noted above. Suite is now
**824**. The original problem is recorded below as it stood.

*The problem, as it stood.* Both call sites were guarded by
`fs.existsSync(writablePath)`, so the userData copy was made once and reused
forever. A release that updated the Help doc — as `a82aae2` did — would never be
seen by anyone who had already launched the app. It was introduced by the EACCES
fix rather than pre-existing, and it landed right before a release whose Help doc
had changed.

Simply re-copying when the bundled version is newer would have been worse, not
better: `fs.cpSync` defaults to `force: true`, so it silently overwrites — verified
against a file containing "USER NOTES", which the copy destroyed outright. That
is what ruled out a timestamp check and made this a design decision rather than a
one-line patch.

**Resolved in Phase 4: the example's copy fallback silently restored the original
bug.** If `cpSync` threw, `copyExampleToUserData` returned the read-only bundled
path, so saves against the Frankenstein example failed with EACCES exactly as
before, with no user feedback. Fixed as the finding itself predicted:
`materializeBundledProject` returns `{ path, writable, error }` rather than a
bare path, `loadInitialProject()` hands `writable` to `setProject()` as the
read-only flag, and the example behaves like the Help doc — Ctrl+S offers Save As
instead of failing into the log, and the reason the copy failed reaches the error
log rather than disappearing into a successful-looking return.

The fix turned out to need more than "set the flag from `loadInitialProject()`":
`loadFile()` clears the flag on every load and `convertLegacyProject()` ends in an
unconditional save, so the flag has to be passed *into* `setProject()` rather than
set on the way back, and `convertLegacyProject()` needs its own guard because its
conversions write through `chapter.js` rather than through `project.saveFile()`.
Both are covered by tests; see the Phase 4 write-up above.

---

# Part 2 — Context isolation

## Phase 0 — Introduce a bundler (the actual blocker)

This is the step that is easy to miss and blocks everything else.

`src/index.html` loads the renderer with a single plain `<script src="render.js">`
tag. The entire 71-module CommonJS graph — every `require('./chapter-list')`,
every `module.exports` — is resolved **at runtime by Node integration in the
renderer**. Turning off `nodeIntegration` does not just remove `require('fs')`.
It removes `require` altogether, and the app does not load at all.

So before any bridge work: add an **esbuild** step producing a single
`render.bundle.js`, and point the script tag at it. esbuild consumes the existing
CommonJS as-is — no module-system migration, no source changes. Mark Node
builtins external for now; they still resolve through Node integration, which is
still on.

This phase changes no behavior. It ships on its own, and it is verified by the
app running normally with 830 tests still green.

## Phase 1 — Design the injectable platform facade — **done**

**The key decision, and the one worth the most care.** Delivered as
`platform.js` (contract) + `platform-node.js` (the node backing) +
`test/platform.test.js`; see the Phase 1 status block above for what it settled.

The existing tests do not mock the filesystem. They create real temp directories
and assert against real files (`chapter.test.js`, `render.test.js`, and others
use `fs.mkdtempSync`). If modules simply start calling `window.warewoolf.*`, that
entire suite dies — and losing 830 tests at the start of a 47-command refactor
is how this project fails.

So the facade must be **injected, not global**. One module — `platform.js` —
exports the command surface from the inventory. It has multiple backings:

| Backing | Used by | Notes |
|---|---|---|
| Direct `fs`/Node | the test suite | Keeps all 830 tests running against real files, unchanged in spirit |
| `ipcRenderer.invoke` | the shipped Electron app | The preload bridge |
| Tauri `invoke` | a future Tauri build | One-file swap |

Tests already prime `require.cache` to inject a fake `ipcRenderer`
(`render.test.js:41`), so the injection pattern is established — this extends
it rather than inventing something new.

Get the shape right here. Everything downstream is mechanical only if this is
correct.

## Phases 2–7 — Convert, group by group

Order from the inventory, each shipping independently while `nodeIntegration`
stays on:

**Phase 2 — Group A (environment) — done.** All seven commands are implemented
in both `platform-node.js` (injected `paths`/`fileRequestedOnOpen`/four action
hooks, exercised only by `platform.test.js` - see below) and the new
`platform-ipc.js` (real `ipcRenderer.invoke`, one channel per command name).
`index.js` grew a generic `handlePlatformCommand()` registering
`ipcMain.handle` for each, replacing the old `get-directories`/
`get-file-requested-on-open`/`set-dark-mode`/`show-menu`/`exit-app-confirmed`/
`renderer-ready` sendSync/send handlers outright - nothing else called them.

`getAppPaths` and `getFileRequestedOnOpen` were both `sendSync` at module load
in `render.js` (`:4` and `:20`) - the plan above named only the first, but
both block synchronous startup equally, and `createPlatform` wraps every
command in a promise regardless of backing, so converting either forces the
same problem. Both, plus the `userSettings`/`credentialStore` construction
that depends on the first, now live in an async `loadPlatformState()`; the
five module-scope statements that needed to move were `render.js`'s old
`:4,5,20,46,47`, not four. `module.exports` starts as `{ ready: <promise> }`
and is populated in place once `loadPlatformState()` reaches the end -
`registerKeybindings()`'s call site had to move inside that function too,
since it captured `userSettings` by value rather than through a getter.
`keybindings.js`'s own `show-menu` send became a second, independent
`createPlatform(createIpcBacking())` instance, matching how it already
required `electron` on its own.

Electron does not forward a thrown error's custom properties across
`ipcMain.handle` - only `.message` survives serialization - so a failing
handler resolves with a `{ __platformError, code, message }` envelope instead
of rejecting, and `platform-ipc.js` is the one place that unwraps it back into
a real `PlatformError`. Nothing in Group A actually exercises that path
today, but every later group will need it, so it is built and tested now
rather than discovered in Phase 4.

**Group A is not fully converted, and it is five call sites rather than two.**
`getPlatform` is implemented and working in both backings, but five renderer
modules still read `process.platform`/`process.arch` directly. They fall into
two groups, and only the first was recorded when Phase 2 shipped:

**Deferred deliberately, to Phase 8.** `updates.js:117-130,179` and
`about_display.js:75` sit inside Group K's own synchronous helpers
(`extractUpdateDownloadInfo`, `downloadUpdate`, the About popup's update-check
handler). Converting them now would mean either reaching into Group K's control
flow early or bolting an async call onto otherwise-synchronous functions and
unwinding it again in Phase 8. Left as plain `process.*` reads — still correct
under `nodeIntegration: true` — until Group K converts alongside
`checkForUpdate`/`downloadUpdate`/`installUpdate`.

**Owned by no phase at all**, which is the part worth fixing:
`corkboard_display.js:3`, `settings_display.js:186,203`, and `render.js:206`.
None of these are Group K; they are ordinary UI code that the Phase 2 write-up
missed, so no later phase is currently going to touch them.

**They will not fail at build time in Phase 9.** The plan's safety net there is
that switching esbuild to `--platform=browser` makes every surviving Node
builtin *import* fail loudly. `process.platform` is a global property read, not
an import, so it is not covered — verified by building a one-line module that
reads it under `--platform=browser`, which compiles clean and emits the read
verbatim. Under `contextIsolation: true` there is no `process` in the renderer,
so these fail at **runtime** instead:

- `corkboard_display.js:3` is `const isMac = process.platform === "darwin"` at
  **module scope**, so it throws while the bundle is being evaluated and the app
  does not start at all.
- `settings_display.js:186,203` and `render.js:206` are inside functions, so
  they fail later and narrowly — when the reader opens Settings, or when the
  battery display is enabled on a Pi. That is the worse failure of the two,
  because it survives a smoke pass that does not happen to open Settings.

**Assigned to Phase 3.** `getPlatform` already exists in both backings, so it
is roughly four lines of call-site change, plus the module-scope one in
`corkboard_display.js`, which needs the same treatment `getAppPaths` got.
Folded in there rather than left to Phase 9, which is meant to be an audit, not
a conversion.

Worth a grep in the Phase 9 audit regardless: `process.`, `__dirname` and
`process.cwd()` across renderer code, since none of them are import-shaped and
none are caught by the build.

Verified: `test/render.test.js` and `test/render-bundle.test.js` (73 render.js
tests, 6 bundle tests) now exercise the async boot path end to end, including
`await`ing `require('../src/render').ready` in place of the old synchronous
require - `freshRender()`'s and `renderWithLastProject()`'s own doc comments
explain why `require()` cannot do that waiting itself. Two new test files,
`test/platform-ipc.test.js` (6 tests) and five tests added to
`test/platform.test.js`, cover the new backing directly. Suite is now **874**.

**Phase 3 — `logError`, plus the Group A sweep — done.** Widest call graph,
least logic, and it held up as a calibration exercise: the async conversion
itself is small, and almost all of the churn landed in test setup rather than
in production call sites.

`logError` stayed **fire-and-forget**. All ~98 call sites sit in `catch` blocks
whose return value nobody uses and are untouched — they still just call
`logError(err)`. The facade's `logError`/`readErrorLog`/`clearErrorLog` went
into `platform-node.js` (the 1MB truncate-then-append behavior moved there
verbatim from the old `error-log.js:43-46`); `error-log.js` itself lost `fs`
and `path` entirely and now holds a module-scope `platform` reference set once
via `setPlatform()`, replacing `setLogDirectory()`. `logError`'s own wrapper
still returns the promise `platform.logError()` produces — nothing in
production reads it, but it is always internally `.catch()`-ed first, so a
failed write can never surface as an unhandled rejection, and a test can
`await` a specific call instead of polling the log file for it to land.
`readErrorLog`/`clearErrorLog` are value-returning and *are* awaited, but their
only consumer is `error-log_display.js`, so `showErrorLog()` and its Clear Log
handler became `async` and that was the entire blast radius on the view side.
The contract's `readErrorLog` staying named `loadErrorLog()` in the source is
unchanged and still deliberate.

**Routed through a second, node-backed platform instance, not IPC.** Group D is
plain `fs`, like groups C and J — reachable directly through nodeIntegration —
so `render.js`'s `loadPlatformState()` now builds a second `createPlatform(
createNodeBacking({ paths: sysDirectories }))` instance alongside the
IPC-backed one Group A uses, and hands that to `error-log.js`. Nothing in
`platform-ipc.js` or `index.js` changed for this phase; that second instance is
what has to be swapped for the ipc backing at Phase 9, alongside C and J, once
nodeIntegration goes away and `fs` stops being reachable from the renderer at
all.

**One inventory count corrected.** This document's own text above said ten test
files call `setLogDirectory` — a grep against the actual tree found **nine**
(`chapter.test.js:20`, `project.test.js:21`, `utils.test.js:36`,
`user-settings.test.js:11`, `updates.test.js:38`, `spellcheck.test.js:40`,
`import.test.js:29`, `file-manager.test.js:28`, and `error-log.test.js` itself,
which called it throughout). All nine now configure a node-backed platform
instance in their `test.before`/`beforeEach` instead. Eighteen test files touch
`error-log` in total, as stated; the other nine only ever mock
`errorLog.logError` via `t.mock.method` and never called `setLogDirectory`, so
they needed no changes.

Also carried the three unowned `getPlatform` call sites recorded under Phase 2
— `corkboard_display.js:3`, `settings_display.js:186,203`, `render.js:206`,
all reverified against the current tree before editing. `corkboard_display.js`'s
module-scope `const isMac = process.platform === "darwin"` got the same
treatment `getAppPaths` did in Phase 2: it is now a `var` defaulting to `false`,
set from a `platformInfo` argument `showCorkboard()` takes and render.js passes
in, rather than read at module-evaluation time. `settings_display.js`'s
`showSettings()` and `render.js`'s own `applyUserSettings()` both gained the
same `platformInfo` (resolved once via `platform.getPlatform()` in
`loadPlatformState()`, alongside the pre-existing `sysDirectories`) in place of
reading `process.platform` directly. `updates.js` and `about_display.js` are
untouched, exactly as planned — deferred to Phase 8.

Verified: suite is now **876** (one new test, covering `logError` staying
inert and non-throwing when nothing has configured a platform yet).

**Part 2 is at Phase 8, complete. Suite is 1047.** All eleven groups, A through
K, are implemented in `platform-node.js` and called by the renderer. Nothing
in `COMMANDS` rejects `NOT_IMPLEMENTED` any more. Phase 9 — the flag flip — is
clear to start, but has not been started.

**Phase 4 — Groups B and C (projects, chapters) — done.** The core, and the
best-tested. Line references were re-verified against the current tree before any
design work, as they have gone stale twice in this project: every reference in
group C holds exactly, every reference in group B holds, and the one that had
drifted is `copyExampleToUserData()` — `render.js:178-190`, not `:91-103`, since
Phase 2 moved it into `loadPlatformState()`'s orbit. Corrected in place.

**`saveChapterAtomic` needed no design work — it already existed.** Phase 1 wrote
it into `platform-node.js` because it was the command that constrained the
contract's shape, so `chapter.js`'s hand-rolled stash/allocate/write/
restore-on-failure sequence became one call and the three load-bearing orderings
(stash before allocating, drop the stash last, a failed rollback is a third
outcome) were already written down and already tested.

**The real design work was `saveProjectAs`, and the contract was wrong about
it.** It declared `contents`, so that it would write the `.woolf` itself. It
cannot, and the reason is an ordering constraint rather than a preference: Save
As has to write out every chapter with unsaved changes, those writes go through
group C, and group C *allocates* the filename — so the filenames the `.woolf`
must list are not known until after those writes, and those writes cannot happen
until the new chapters directory exists. Three steps, forced:

1. `saveProjectAs` — parse the target path, make both directories, copy across.
2. Group C — save the dirty chapters into the new location.
3. `saveProject` — write the `.woolf`, every filename in it now final.

Passing `contents` into step 1 would mean writing a `.woolf` naming the pre-save
filenames and then rewriting it; a failed rewrite would leave a project file
pointing at chapter files whose names had since changed, which is worse than no
file at all. Nothing about the transaction is lost — the operations that must
succeed or fail together are still the two mkdirs and the copy loop, still one
command, exactly the sequence the contract's own note cited
(`project.js:183-195`). `copyOnly` was dropped at the same time for a simpler
reason: Save a Copy does identical work on disk and differs only in whether the
*renderer* repoints its own chapters afterward. Both corrections are recorded in
`platform.js` and in the inventory.

**`project.isReadOnly` stays a renderer-side UI flag**, as the contract already
said, and stays in the same place — the top of `saveFile()`, above the chapter
saves rather than merely above the project-file write, since a read-only
project's chapter files are equally unwritable and each would be a separate
swallowed `EACCES`. `PERMISSION_DENIED` is the backstop for when the flag is
wrong.

**Two ordering bugs, both found by writing the tests for that flag**, and both in
`convertLegacyProject()` — the least obvious write path in group B, since it runs
on every `setProject()` and ends in an unconditional `project.saveFile()`:

- `setProject()` now takes the read-only flag as an argument. `loadFile()` clears
  it on every load, so a caller that set it afterward had already let
  `convertLegacyProject()` save over the file. That is how the bundled example,
  opened out of the install directory when its copy fails, was written to before
  anything knew it was read-only.
- `convertLegacyProject()` returns early for a read-only project. Its two
  conversions write through `chapter.js` rather than `project.saveFile()`, so the
  guard did not cover them.

**`materializeBundledProject` closes the open finding below.** The fallback that
opens the bundled example in place now comes back `writable: false` with the
reason, the caller sets `isReadOnly` from it, and Ctrl+S offers Save As the way
it does for the Help doc rather than every later save dying with EACCES in
silence.

**A notes failure no longer leaves a chapter looking saved.** `saveFile()` used
to clear `hasUnsavedChanges` before `saveNotesFile()` ran, so notes that never
reached disk were dropped on exit without a prompt. They now keep the chapter
dirty and are reported.

**The async ripple was the bulk of the hours.** `getFile()`/`getContentsOrFile()`
reach disk, so everything that reads a chapter became async: `wordcount`,
`compile`, `export`, `findreplace`, `renumber-chapters`, the four `convert-*`
controllers, `email-doc`, and the ten views that drive them. `delta-to-docx` is
the one deliberate exception — it takes the project word count as an argument
rather than computing it, because it is a document generator with no other I/O
and making it async for one line of a title page would be the wrong trade. That
also ends a quadratic re-read: `export.js` calls it once per chapter and each
call re-counted the entire project.

`render.js` gained `detached()`, applied at every boundary where something drops
the return value on the floor — a menu channel, a keybinding, a file dialog's
callback, the autosave timer — so an async failure is reported rather than
becoming an unhandled rejection with nothing on screen. Only rejections are
caught; a synchronous throw propagates exactly as before, so nothing that used to
fail loudly starts failing quietly.

Verified: **920 tests pass** (from 876). Six mutations checked for non-vacuity —
writing the `.woolf` before the chapter saves, moving the read-only guard below
them, marking a chapter clean when its notes failed, flagging read-only after the
legacy conversion, reporting the copy fallback as writable, and dropping
`convertLegacyProject`'s guard — each fails the tests written for it and nothing
else. The sixth initially survived, which is how the legacy-read-only test came
to be written.

**And verified as a packaged build**, per the lesson recorded under
"A green build is not an installable artifact" below. An `electron-forge package`
build launched against a clean userData directory: it materialized the bundled
example, opened it, rewrote the `.woolf` through `saveProject` (a marker key that
`stringifyProject` strips was gone after a relaunch), rendered the chapter list
and chapter text, and saved typed text into a chapter file through
`saveChapterAtomic` — leaving no `old_v_temp` stash behind and writing nothing to
the error log.

**Also folded in: a boot failure is now reported** (`dfe017c`).
`loadPlatformState()` had no try/catch and no rejection handler, and every part
of startup runs inside it, so a failure anywhere became an unhandled rejection
and a blank window — two empty editors, no keybindings, no menu, nothing on
screen. `src/components/views/startup-error_display.js` follows
`project-load-error_display.js`'s pattern and depends on nothing but the DOM and
one pure helper, since anything it needed from the platform, from user settings
or from the open project could be the very thing that failed. It has no dismiss
button: there is no working app behind it. The rejection is re-thrown after
reporting so `ready` still rejects.

**Phase 5 — Rest of D, then I and E — done.** Settings, corkboard, error-log
licenses, spellcheck dictionaries, the in-app file browser. Line references were
spot-checked against the current tree rather than re-derived wholesale, and held:
`user-settings.js:73/:83-84`, `corkboard.js:46-47/:61`, `about_display.js:123-124`,
`spellcheck.js:19-20/:22/:38-44/:93/:105`, and every `file-manager.js` reference.

**One more contract correction, the same shape as Phase 4's two.**
`loadCorkboard`/`saveCorkboard` were declared taking/returning parsed `card[]`,
which would have moved `parseCardsString`/`generateCardsString` - the
marker-escaping logic for card labels that collide with `# ` or `[x] `/`[<digit>]
` - into `platform-node.js`. That is exactly the class of format-parsing logic
groups B and C already keep out of the backing: `loadChapter`/`saveChapter` cross
raw text, not a parsed chapter, for the same reason. Corrected to raw text, params
renamed `chaptersDir`/`contents` (the corkboard file lives beside the chapters,
not the `.woolf`, so `projectDir` was the wrong name too) - `corkboard.js` keeps
parsing exactly as before, just behind an `await`. Recorded in `platform.js`.

**Two designs, not one, for how a module reaches the node backing.** Group A's
"second independent instance" pattern (keybindings.js, Phase 2) turned out to
generalize into two distinct shapes, not a single new rule:

- **A module with no natural per-call path argument** (many scattered call sites,
  no local directory info) takes the shared `nodePlatform` instance via a
  `setPlatform()` it exports, exactly like `error-log.js`. `user-settings.js` is
  this shape - `loadUserSettings()`/`saveUserSettings()` are parameterless on the
  contract (the backing owns the path), so a per-call instance would have nowhere
  to get `paths.userData` from that render.js doesn't already have. Wired
  alongside the other three `setPlatform()` calls in `loadPlatformState()`.
- **A module whose commands take no injected config at all** - every argument is
  already a full path or is irrelevant to the command (group E's browsing
  primitives; corkboard's `chaptersDir`) - holds its own standing
  `createPlatform(createNodeBacking({}))` at module scope and needs no wiring
  from render.js whatsoever. `corkboard.js`, `file-manager.js` and
  `missing-pups_display.js` are this shape.
- **spellcheck.js is neither.** `loadDictionary()`/`loadPersonalDictionary()`/
  `savePersonalDictionary()` need `paths.app`/`paths.userData`, but every call
  site here already receives `sysDirectories` as an ordinary argument (unlike
  error-log's ~98 call sites, which have no such thing to hand it). So it builds
  a platform from that argument per call, the same instinct as the "second
  independent instance" but keyed off data already in hand rather than off a
  wiring point in `loadPlatformState()`. This also meant `spellcheck.test.js`
  needed almost no restructuring - it already threaded a different
  `sysDirectories` through every test.

**Group E stayed generic, on purpose - and stripping it down to the primitives
means the app-specific policy that used to live inside `fs` calls now lives in
`file-manager.js` instead of disappearing.** Two collision policies used to be
two different bare `fs.renameSync` call sites with two different behaviors -
renaming refused an existing destination, cutting and pasting silently
uniquified onto one. `moveEntry` implements only the stricter policy (refuse,
reject `ALREADY_EXISTS`) because a generic command can only have one collision
rule; `moveFiles`' cut-paste auto-uniquify is renderer-side logic built from
`pathExists`/`statEntry`, the same way `copyFiles`' uniquifying always was. The
refuse-on-existing-destination guard itself (`file-manager.js:54-56` before this
phase) moved into `moveEntry` unchanged in behavior, verified by mutation:
deleting the guard's `fs.existsSync` check passes every test except the one
written for it (`renameFiles regression: refuses to overwrite...`), which fails
exactly as expected.

`listDirectory`'s `isDirectory` crosses as a plain boolean, not a dirent's
`isDirectory()` method - a function cannot survive IPC/Tauri serialization. Every
caller (`file-manager_display.js`, `file-dialog_display.js`,
`missing-pups_display.js`, and their tests) changed from `.isDirectory()` to
`.isDirectory` accordingly. The dotfile filter `getFileList()` used to apply
stayed in `file-manager.js` rather than moving into the generic `listDirectory`
command, for the same reason the collision policies did.

**`getAllSubdirs()` in `missing-pups_display.js` was already dead code** - defined,
recursive, and never called by anything (`getAvailableSubdirs()` only ever used
its sibling `getFirstLevelDirs()` directly). Converting it to the async
`listDirectory` call would have left a function whose recursive self-calls
silently assigned a `Promise` where an array was expected - a landmine for
whoever next touched this file, and Phase 9's audit would have had no build-time
way to catch it either. Deleted rather than converted.

**The two things flagged as boot/UI-order surprises going in, resolved:**

- `user-settings.js` loads during `loadPlatformState()`, before `initialize()` -
  already true since Phase 2's boot rewrite. Making `load()`/`save()` async meant
  one line changed at the call site (`userSettings = await
  getUserSettings(...).load();`); the boot ordering itself needed no rework.
- `file-dialog_display.js`'s `populateFileList()` no longer lists its directory
  in the same tick the dialog opens - `getFileList()` now always resolves on a
  microtask, even against the node backing. `showFileDialog()` became `async`
  and its callers (`saveProjectAs`/`saveProjectCopy`/`openAProject` in
  `render.js`) don't await it (unchanged - the dialog reports through its
  callback, not its return value), so it gained a `.catch(reportDetachedFailure)`
  instead. `render.test.js`'s docsDir comment survives unchanged - the directory
  still has to exist, just not synchronously within the triggering call - and four
  tests needed a `flushMicrotasks()` added after opening a dialog, matching the
  pattern already used elsewhere in that file for other async menu commands.

**The async ripple was, again, mostly in test bodies.** Every synchronous
assertion that followed a call into `corkboard_display.js`, `spellcheck_display.js`,
`file-manager_display.js`, `file-dialog_display.js` or `missing-pups_display.js`
had to either await the call directly or `flushMicrotasks()` afterward - the
`getFileList`/`getCardsFromFile`/`runSpellcheck` mocks in these suites already
returned plain values rather than promises, and `await` on a plain value still
defers to the next microtask, so every one of these tests needed the same
mechanical fix Phase 4 needed for chapter reads. One correctness bug surfaced by
this, not by a test: `missing-pups_display.test.js`'s `deleteBtn.onclick()`
handler runs `removeChapterFromProject()` synchronously before its first
`await`, so state assertions right after a click kept passing even
unmodified - but the *rest* of the handler (`fillMissingChapsList`/`fillFileList`,
both async now) kept running after the test function returned, throwing
`ReferenceError: document is not defined` into an unhandled rejection once
`test.afterEach` tore down `global.document`. Fixed by awaiting those specific
`onclick()` calls rather than firing-and-forgetting them.

**Verified as a packaged build**, per the "green suite has twice failed to
predict a working artifact" lesson: an `electron-forge package` build launched
against a clean `--user-data-dir`, materialized the Frankenstein example
correctly (confirming `loadPlatformState()`'s boot order still holds with
`user-settings.js` in it), and two of this phase's own conversions were
exercised live rather than only under the test suite - the File Manager
(Ctrl+Shift+F) listed and navigated real directories on disk through the
converted `listDirectory`, and Spell Check (Ctrl+7) loaded the real shipped
dictionary through `loadDictionary()`/`loadPersonalDictionary()` and flagged a
real misspelling with real suggestions. No error log was written by either.

**Phase 6 — Groups F, G, H (import, export, backup) — done.** These are the
commands that get a manuscript into and out of the app, so correctness was
weighted over speed throughout: a silently truncated `.epub` or `.docx` is the
worst failure this project can have, since the writer only discovers it when
they send the file to an agent. Line references were re-derived rather than
trusted - every one in groups F/G/H had drifted since the inventory was
written, from earlier phases' own async conversions shifting surrounding code.
Corrected in place; see the inventory.

**The real design work was `buildEpub`, and the table was wrong about it, the
same shape as Phase 5's `loadCorkboard`/`saveCorkboard` correction.** It
declared `buildEpub(filepath, htmlChapters, meta)`, which would have moved
`epub.js`'s ~250 lines of OPF/NCX/TOC/XML-escaping generation into
`platform-node.js` alongside the zipping. That is exactly the class of
format-generation logic groups B/C/D already keep out of the backing -
`loadChapter`/`saveChapter` cross raw text, not a parsed chapter, for the same
reason. Corrected to `buildEpub(filepath, entries)`, where `entries` is
`{ name, content }[]` - every entry already-generated text. `epub.js` keeps
every generation and escaping function completely unchanged and now assembles
`entries` itself (mimetype, container.xml, content.opf, toc.ncx, toc.xhtml, one
chapter_N.xhtml per chapter, the stylesheet) before handing them to the native
command, which does exactly one thing: zip them to `filepath`. The one piece of
zip-format knowledge that *is* native - the EPUB spec's requirement that the
`"mimetype"` entry be first and stored uncompressed - lives in the native
command, which is the right side of the boundary for it: it is a property of
the zip container, not of epub generation.

**A real bug surfaced and was fixed during the conversion, not carried over: the
original `archiveProject` (backup-project.js) listened on `archive.on('finish',
...)`.** `'finish'` only means archiver pushed its last bytes into the pipe, not
that `fs` flushed them to disk - resolving on it risks handing back a backup
archive name before the file is actually complete on disk, the identical
failure mode `epub.js`'s own `htmlChaptersToEpub` was already written to avoid
by listening on the write stream's `'close'` instead. The native `archiveProject`
and the corrected `buildEpub` both listen on `'close'`, with the reasoning
recorded as a comment directly on the code, since it is easy to "simplify" back
to `'finish'` without noticing anything is wrong - archiver's own event fires
first and looks equivalent under a synchronous read-back in a fast test.

**That last point is not hypothetical - it is what mutation-checking this
specific guard found.** Swapping `'close'` for `'finish'` in both `buildEpub`
and `archiveProject` and re-running `platform.test.js`, `epub.test.js`, and
`backup-project.test.js` left every test green. On this system's local
filesystem, a small file's `'finish'` and `'close'` events land close enough in
succession that no test built around reading the result straight back detects
the difference - the race exists, but provoking it deterministically would need
an artificial delay this suite doesn't have anywhere else. The correction is
kept on the strength of the reasoning (and the epub precedent, which already
had a passing regression test for the property before this phase touched it)
rather than on a red-to-green mutation result. Recorded here rather than
papered over, since the instruction to mutation-check what's preserved is only
useful if a null result gets reported as a null result.

**Two mutations *did* fail as expected**, confirming the guards they target are
real: dropping `buildEpub`'s `store: entry.name === 'mimetype'` flag fails
exactly `epub.test.js`'s "mimetype is the first zip entry and is stored
uncompressed" and `platform.test.js`'s equivalent buildEpub test, and nothing
else; removing the per-path `try/catch` in `pruneBackups` fails exactly
`pruneBackups keeps deleting after an entry that throws` (added specifically
because the first version of that test only exercised the
already-missing-path branch, which never reaches the `try/catch` at all -
`fs.existsSync` guards it first - and so passed with or without the mutation
until rewritten to include a genuinely-throwing entry).

**`importDocx`'s temp directory changed shape, not just which command owns
it.** The old `tempUnzipDocx` unzipped every docx to the same fixed
`sysDirectories.temp + '/docxguts'` and never removed it, so residue from one
import could bleed into the next and the directory grew without bound over a
session - and `sysDirectories` had to be threaded through `docx-import.js` as a
parameter for that path to be reachable at all. The native `importDocx` unzips
into its own `fs.mkdtempSync()` directory instead, reads `document.xml`/
`footnotes.xml` out of it, and removes the directory again in a `finally` -
whether the import succeeded or failed - before ever resolving or rejecting.
`docx-import.js`'s own `importDocx(filepath, split, cback)` dropped the
`sysDirectories` parameter entirely, since nothing in it needs one any more;
`import.js`'s one call site was updated to match. Verified by mutation: deleting
the `finally{ cleanup(); }` block fails exactly the two tests written for it
(one in `platform.test.js`, one in `docx-import.test.js`) and nothing else.

**`archiveProject` deliberately does not follow groups B/C's convention of
concatenating onto an assumed trailing-slash directory - it uses `path.join`
for every filesystem path it touches.** `saveProjectAs`/`saveChapterAtomic` can
assume a trailing slash because `project.directory` always comes from
`splitPath()`, which appends one; `archiveProject`'s `projectDir`/`destDir`
carry no such guarantee - `backup-project.test.js`'s own fixtures build
`project.directory` from `fs.mkdtempSync()` (no trailing slash), and
`email-doc.js` passes `os.tmpdir()` as `destDir` (also none). Concatenating
onto either would have silently produced a malformed path. This was reasoned
out rather than discovered by a failing test - but a related mismatch *was*
caught by one: `createBackupsDirectory` initially returned `createDirectory`'s
own result path, which group E's command normalizes to forward slashes,
against a test asserting `path.join(docsDir, 'backups')` - correct on POSIX,
and a real failure on this Windows machine, since the two strings name the
same directory with different separators and `assert.strictEqual` does not
know that. Fixed by having `createBackupsDirectory` use the `createDirectory`
call only for its side effect and build the path it returns the same way the
original function did.

**`saveDocx`'s public callback signature was deliberately left untouched.**
`writeBinaryFile` only replaces its internal `fs.writeFileSync` call; every
existing test in `delta-to-docx.test.js` that drives `saveDocx(filepath, doc,
callback)` needed no changes at all. That mattered for a bug this phase fixed
in passing: `compile.js`'s `compileDocx` used to call `saveDocx(filepath, doc)`
with no completion callback, which is fire-and-forget - `docx.Packer`'s promise
kept resolving in the background after `compileDocx` returned, so
`compileProject`'s own completion callback could fire (and `compile_display.js`
could report the compile done) while the `.docx` was still mid-write. `.epub`
never had this problem, because `htmlChaptersToEpub` was always driven through
its own completion callback. `compileDocx` now awaits `saveDocx` via its
existing callback wrapped in a `Promise`, which closes the gap without changing
`saveDocx`'s signature at all.

**`export.js`'s plain-text writers (`.txt`/`.mdfc`/`.md`/`.html`) are awaited
directly in `exportChapter`'s loop, not routed through the `taskStarted`/
`taskDone` bookkeeping `.docx`/`.epub` use.** They are a single platform call
each with no further async work of their own once that call resolves, unlike
`.docx`/`.epub`, which finish on their own callback well after `exportChapter`
returns - so awaiting them inline is what keeps `exportProject`'s loop, and
therefore its own completion callback, from moving on before they land. This
was checked by mutation and turned out **not** to be independently observable
here either: removing the `await` and reverting to a bare call left
`export.test.js` fully green, because the very next line in the same loop
iteration (`await chap.getNotesContentOrFile()`) already yields a microtask,
which was enough time in practice for the unawaited write to finish first. The
explicit `await` is kept anyway - it removes the race outright rather than
depending on an unrelated statement happening to yield at the right moment,
which is exactly the kind of coincidental correctness that breaks the next time
someone reorders this loop.

Verified: **974 tests pass** (from 950). Twenty-four new tests, split across
`test/platform.test.js` (contract coverage for all ten Phase 6 commands,
including the argument-validation sweep the other groups have), one new test
in `test/docx-import.test.js` (temp-directory cleanup), and two rewritten in
`test/backup-project.test.js` (`deleteOldBackups` is now async, and the
already-covered "bad path" case was split into "already missing" versus
"genuinely throws" once the mutation check above showed the original only
tested the former). `test/import.test.js`, `test/export.test.js`,
`test/compile.test.js`, `test/epub.test.js`, and `test/delta-to-docx.test.js`
needed **no changes** - the design goal throughout this phase was preserving
every external callback/return shape those suites already drive, changing only
what crosses to `fs` underneath.

**Verified as a packaged build, and beyond it.** An `electron-forge package`
build launched against a clean `--user-data-dir` came up with no error log
written and materialized the bundled Frankenstein example correctly, matching
every earlier phase's packaged-build check. Past that: this environment has no
tool for driving a native Electron window's menus interactively (the available
browser automation targets web pages, not native windows), so the Export/
Compile menu items themselves were not clicked through the UI. In its place, a
script loaded the real `project.js`/`chapter.js` models against the actual
Frankenstein project the packaged app had just materialized on disk, and called
the real, unmodified `compileProject/exportProject` - the same functions the UI
calls - through the real node-backed platform. It produced a genuine 193,875-byte
`.epub` (36 entries, `mimetype` first and stored uncompressed, real chapter
text in `chapter_1.xhtml`) and a genuine 168,798-byte `.docx` (~75,373 words of
real body text extracted from `word/document.xml`, including the generated
title page), plus a 33-file `.txt` export with the expected `-notes_`/`-ref_`/
numbered-prefix naming. Both archives were re-opened and read back
programmatically rather than merely checked for existence, which is the
non-UI equivalent of "open the results." What this does not cover: visually
confirming either document renders correctly in Word/an EPUB reader, and the
in-app Export/Compile dialogs themselves, which remain unexercised by anything
in this phase.

**Phase 7 — Group J (credentials) — done.** Unlike every phase before it, the
commands already existed: Phase 1 built and contract-tested all seven in
`platform-node.js`. The work was the renderer side, and it is the first phase
whose deliverable is a *removal* — no key derivation, no session key, no seal,
no `credentials.json` write and no `chmod` happens in the renderer any more.

**The decision this phase had to make first, and what it turned on.** Rule 6 is
"secrets are referenced, never returned", and its enforcement is `sendEmail`
resolving `SAVED_SECRET` natively. `sendEmail` is group K, Phase 8. So converting
group J now meant choosing between (a) leaving a documented, temporary rule-6
violation for Phase 8 to remove, and (b) pulling `sendEmail` forward so no
version ever has both the new store and a plaintext round-trip.

**Chose (a)**, on two grounds.

The first is that (b)'s benefit is about *released* versions, and there are none
in the middle of Part 2. `main` is still at `569cba4`, the last tag is `v2.4.0`
on the pre-Part-2 baseline, and every phase from 1 to 9 ships to writers as a
single release once the flag is flipped. There is no version in between for (b)
to protect.

The second is what (b) actually costs. `sendEmail`'s contract entry says it also
absorbs the temp-file dance around `os.tmpdir()` (`email-doc.js:126-135,147,
172-192`). Pulling it forward *without* that means shipping a command whose
`attachments` may name an arbitrary path the renderer composed — an
arbitrary-file-read primitive across the boundary, which is materially worse than
the leak it was meant to close and which Phase 9's audit would then have to
catch. Pulling it forward *with* it means reopening `archiveProject` and
`buildEpub`'s call sites, which is group G/H work from Phase 6, inside Phase 7,
on top of unrelated group K work. It is not "mixing two groups"; it is three.

**What (a) actually costs turned out to be much less than the framing suggested,
because the sentinel could be adopted immediately even though its resolver could
not.** The naive reading of (a) is "keep `getPassword()`", which would have meant
adding a `getCredential` command to `COMMANDS` — contaminating the one artifact
this whole exercise produces — or handing the dialogs a plaintext to put in the
DOM, which is the leak itself. Neither was necessary. The dialogs now put
`SAVED_SECRET` in the password field *today*, exactly as the contract intends,
and the sentinel travels untouched to `emailFile()`, which turns it into the
password on the last line before `nodemailer`. So:

- The saved password never reaches the DOM. That is the leak rule 6 exists to
  close, and it is closed now, not in Phase 8.
- The residual violation is five lines in `email-doc.js`: a local variable, for
  as long as it takes to hand it to `nodemailer`. It is never stored, never
  rendered, and never held by a dialog across a user interaction.
- The resolver is `backing.resolveSecret`, which is deliberately not a declared
  command and therefore unreachable through a `platform` instance. It has to be
  handed over explicitly, by `render.js`, the one file that builds the backing —
  `require('./components/controllers/email-doc').setSecretResolver(nodeBacking.
  resolveSecret)`. Phase 8 deletes that line and the seam with it.
- `COMMANDS` is untouched by the compromise. Nothing temporary entered the
  contract.

**One contract correction, deliberate, the same shape as Phases 4–6's:
`storeCredential` takes `SAVED_SECRET` too.** Phase 1 identified `sendEmail` as
the place the UI names a secret it must not hold, and stopped there. It is not
the only one. Unticking "Protect With Passphrase" on an already-saved password
re-seals it under the unattended backend — and the dialog does not have the
password to re-seal, and must not. Without this the sentinel string itself gets
stored *as* the password: silently, reporting success, destroying a real saved
password with 24 characters of nothing, discovered weeks later as an
authentication failure that reads like "your saved password is wrong". The
sentinel now means "re-seal what is already stored" on the way in, resolved
inside the backing, so the plaintext leaves the store and goes back into it
without crossing. It is refused with `INVALID_ARGUMENT` when nothing is stored
and with `LOCKED` when the credential is locked, for the same reason.

**A second correction: `migrateLegacyCredential` returns `{ recognized,
migrated }`, not `{ migrated }`.** One flag collapsed two outcomes the caller
has to tell apart, because clearing `userSettings.senderPass` stays with the
caller. `recognized` means the blob was in the pre-2.2.2 format and the settings
field is dead — clear it. `migrated` means a password was actually recovered and
re-sealed. They differ for a legacy-shaped blob that decrypts to nothing, which
a 2.2.1 writer who ticked "remember" with an empty password field has in their
settings file today. The old `migrateLegacyPassword` cleared the field for them;
keying the clear off `migrated` would have left a dead blob to be re-read and
re-decrypted on every launch from then on, with nothing anywhere saying so.

**One deliberate departure from "preserve the behaviour exactly", recorded
because it is a departure.** The old `migrateLegacyPassword` ignored a failed
re-save and cleared `userSettings.senderPass` regardless — destroying the only
copy of the password when the keystore was broken or the disk was full. The
command rejects instead, and `render.js`'s catch leaves the settings field
alone, so the next launch tries again. Everything else about the migration is
preserved to the letter, including doing nothing when there is nothing to
migrate and doing nothing on the second launch.

**Unticking "Remember Password?" now clears after the send rather than before
it.** Not a design flourish — a forced consequence. That checkbox has always
meant "send with it this once, then forget it", and the old dialog could clear
the store immediately and still send because it was holding the plaintext. It
now holds only a reference, so clearing first would leave the send with a
sentinel and nothing to resolve it against. The clear moved to the send's
completion, on both the success and the failure path, so the password is
forgotten either way exactly as before.

**The sentinel goes into an `<input type=password>` value and contains NUL
characters, so that was checked against real Chromium before anything was built
on it** — a real `BrowserWindow`, `value` set and read back: 24 characters in,
24 characters out, `charCodeAt(0) === 0`. Had Chromium sanitised it, every
"unchanged" check would have failed silently and every Send would have tried to
store a mangled sentinel over the writer's real password. A jsdom equivalent is
pinned as a test so the unit suite cannot quietly stop depending on it.

**Deletions.** `credential-store.js` lost `migrateLegacyPassword()` (replaced by
the command plus `render.js`'s own clear — it took a `userSettings` object and
wrote to it, which was never this store's file) and `getStoreFilepath()` (dead
since before this phase). `crypto.js` is unchanged and `credential-store.js`
keeps its `fs` writes and its scrypt/AES calls, because they are still called —
by `platform-node.js`, on the native side of the boundary, which is the point.
The renderer requires neither file any more.

**Mutation-checked, fifteen mutations across the legacy path, the migration, the
sentinel and the resolver wiring.** Thirteen were killed immediately. Two survived and were worth the
exercise:

- **`decryptLegacy`'s own `isLegacyBlob` guard could be removed with every test
  still green.** It was being tested by accident: a current-format blob's IV is
  12 bytes (GCM) and `aes-256-ctr` demands 16, so `createDecipheriv` threw and
  the `try/catch` produced the same `null` the guard would have. The guard's
  actual job — refusing a versioned blob outright, rather than by luck of IV
  length — had nothing asserting it. Now pinned by a blob that is versioned like
  a current one but carries a legacy-length IV.
- **`savedPlaceholder`'s `!credentials.locked` term could be dropped with every
  test still green.** Send still refused on `credentials.locked`, so nothing was
  overwritten and no assertion moved; what broke was only what the writer is
  *told* — a password field full of dots for a password that cannot be read.
  Now pinned by a test on the field and the unlock row.

The frozen legacy fixture is the same idea applied to the thing that matters
most. `crypto.test.js` already tested the legacy path against `encryptTheOldWay()`,
a second reimplementation of the pre-2.2.2 format living in the test file — which
would drift alongside `crypto.js` and keep passing while every real writer's
password stopped decrypting. There is now a written-down blob nothing in the repo
generates, asserted in `crypto.test.js`, `platform.test.js` and `render.test.js`.
Changing `LEGACY_KEY` by one character fails five tests; changing
`LEGACY_ALGORITHM` fails nine. This matters more here than anywhere else in the
project because of *how* it fails: the writer gets no error, no log line and no
artifact to inspect — the password is simply gone, possibly months later, with
nothing to say it was ever there. Same silent-failure class as the close/finish
bug, minus the file you could go and look at.

**Verified: 1009 tests pass** (from 976). Four were removed — the
`migrateLegacyPassword` tests in `credential-store.test.js`, whose subject no
longer exists — and **thirty-seven added**: seven in `platform.test.js`
(`storeCredential` and the sentinel, the frozen legacy fixture, the
recognized/migrated matrix, the failed re-seal), ten in
`email-doc_display.test.js` (which now drives a **real node backing over a real
temp directory** rather than the hand-written credential-store fake it used to,
since a fake would have had to reimplement the sentinel re-seal and would then
agree with itself rather than with the backing the app runs), five in
`email-doc.test.js` (the resolver seam and its three failure paths), three in
`error-log_display.test.js`, three in `crypto.test.js` and nine in
`render.test.js` — six driving the boot migration through a **real
`freshRender()` boot** against a `user-settings.json` written the way 2.2.1 wrote
one, because that is where it actually runs, and three driving the menu commands
that wire the resolver.

**The resolver is wired from the two menu commands, not from
`loadPlatformState()`, and that was a measurement rather than a preference.**
Requiring `email-doc.js` pulls in `nodemailer`, `archiver` and the docx/epub
writers: **308ms of module evaluation** on this machine, and a good deal more on
the Pi this project's writerDeck actually runs on. Boot should not pay that for a
seam Phase 8 deletes, and neither dialog can open without loading the module
anyway. The risk that buys is a third route to `emailFile()` appearing without
the wiring — which fails silently until a writer clicks Send and is told there is
no saved password while one sits there perfectly readable — so both routes have a
test, and removing `openEmailController()` from either menu command fails them
(mutations N and O).

**Verified as a packaged build, twice over, both backends, across a real process
restart.** `electron-forge package`, then the packaged `src/index.html` and
`src/render.bundle.js` loaded into a real `BrowserWindow` by a harness main that
registers the same group A and `secure-storage-*` IPC handlers `src/index.js`
does — including the real `safeStorage` availability detection, copied verbatim,
not stood in for. `nodemailer.createTransport` was replaced so nothing was
actually sent; everything else was the shipped code.

- **safeStorage backend.** A `user-settings.json` holding a real 2.2.1-era blob
  was migrated during the app's own boot: `senderPass` null in the file,
  `credentials.json` written with `backend: "safeStorage"` (Windows DPAPI), no
  startup error and an empty error log. The dialog then opened with the sentinel
  in the password field and neither the migrated password nor the new one
  anywhere in the DOM; a password typed and saved through the real dialog
  survived a **fresh process**, and the real `emailFile()` resolved the sentinel
  and handed `nodemailer` the actual password.
- **passphrase backend.** Saved under a passphrase, then relaunched: found
  `locked: true`, `resolveSecret` refused with `LOCKED` rather than returning
  null, the password field was left empty, the unlock row was shown, a wrong
  passphrase gave "Wrong passphrase.", the right one filled the field with the
  sentinel, and the send got the real password. `credentials.json` was
  byte-identical before and after, so unlocking and sending rewrote nothing.

- **the real menu path, through the real bundled renderer.** The two checks above
  drove the packaged `src/` modules; this one drove `src/render.bundle.js` as
  `index.html` loads it, with main sending the same `send-via-email-clicked`
  channel `src/index.js` sends, into `render.js`'s own `menuCommands` table and
  its own platform instance. A 2.2.1 blob migrated during boot (`senderPass`
  null, `credentials.json` written, empty error log, the recovered password
  readable only through `resolveSecret` from main); the menu opened the real
  dialog with the sentinel in the field and the migrated password nowhere in the
  DOM; Send stored a newly typed password and put the field back to the
  sentinel, with the password nowhere in the DOM afterwards.

**A mistake worth recording, since this document is the record.** That last check
clicked Send, and Send sends. The intent was to stop it at the network by
replacing `dns.lookup` from `executeJavaScript`, and that does not work — Node's
`net` layer does not go through the reference being replaced. So two runs opened
an SMTP connection to Gmail and attempted a login, both rejected with
`535-5.7.8 Username and Password not accepted`. The credentials were synthetic
(`writer@example.invalid` / `app-password-under-test`), invented for the check;
no real credential was involved. It was still an outbound request to a third
party that nothing about this phase needed, and the second one happened after the
first was noticed and believed fixed. Phase 8 owns `sendEmail` and will want to
exercise it: the transport has to be replaced *inside* the bundle — mark
`nodemailer` external, or inject the transport the way `createWriteStream` is
injected — never a network-level block bolted on from outside.

What this does not cover: clicking the Send Via Email menu item with a mouse.
There is still no tool in this environment that can drive a native Electron
window's menus — the same gap Phase 6 recorded — but the channel that menu item
sends, and everything downstream of it, are exercised above.

**Phase 8 — Group K, done.** Updates, email, wifi, battery. Unlike every phase
since Phase 4, none of the eight commands existed in `platform-node.js` when
this phase started — Phase 1 declared them and Phases 2–7 only ever wired
call sites to implementations already written. This phase had to build
`checkForUpdate`, `downloadUpdate`, `installUpdate`, `sendEmail`,
`wifiListNetworks`, `wifiConnect`, `wifiGetAddress` and `getBatteryCapacity`
from nothing. Four contract corrections came out of it, recorded in full in
`native-command-inventory.md`'s group K section:

1. `checkForUpdate()` returns the raw parsed GitHub release JSON, not a
   packaged shape — the version-comparison and asset-matching logic stays in
   `updates.js`, pure data work with no OS dependency, the same reasoning
   group D and G corrections already established.
2. `downloadUpdate` resolves on the destination write stream's `'close'`, not
   when the HTTPS response finishes piping — the identical truncated-file risk
   Phase 6 fixed in `buildEpub`/`archiveProject`, corrected the same way.
3. `installUpdate`'s `path` is constrained to one this same backing produced
   via a prior `downloadUpdate` call, tracked in a session-scoped set — not a
   directory allowlist or filename pattern, both of which a renderer-composed
   path could satisfy by construction.
4. `sendEmail`'s `attachments` is a three-way shape (`content`, `projectArchive`,
   `epubEntries`), not a flat `{filename, content, encoding}` for every case —
   the two that need zipping are built into a `sendEmail`-owned temp file and
   read back as bytes, so no attachment ever names a path the renderer
   composed.

**This phase inherited one specific obligation from Phase 7, closed as part of
correction 4 above.** `emailFile()` no longer resolves `SAVED_SECRET` itself
through an injected `backing.resolveSecret` — it forwards `secret` straight to
`platform.sendEmail()`, which resolves the sentinel on the far side of the
boundary exactly like `storeCredential` already did. `setSecretResolver` and
`readSavedSecret()` are deleted from `email-doc.js` entirely, not merely
unused, and `render.js` no longer holds the raw node backing at all — only the
wrapped `platform` instance it already used for everything else. Nothing in
the renderer can reach a stored secret by any route now, and rule 6 holds
without an exception.

**The three things flagged going in, and how each was resolved:**

- **`sendEmail` and the residual rule-6 violation.** Covered above. The design
  that made it possible without duplicating `archiveProject`'s or `buildEpub`'s
  own logic: `sendEmail`'s `projectArchive`/`epubEntries` attachment builders
  call those two group H/G functions directly, pointed at a temp file
  `sendEmail` owns (`fs.mkdtempSync()`, read back as a `Buffer`, directory
  removed before resolving or rejecting) rather than reimplementing the
  zipping. `email-doc.js` itself lost `fs`, `os`, `path` and `nodemailer`
  entirely — `emailAsZip` hands over a project's identity
  (`projectDir`/`chapsDir`/`sourceFilename`) rather than archiving anything
  itself, and `emailAsEpub` calls a new `assembleEpubEntries()` export split
  out of `epub.js`'s `htmlChaptersToEpub` (pure entry-generation, no OS
  dependency) instead of writing an epub to a path first. A real gap surfaced
  while wiring this up: `archiveProject`'s "cannot back up a project with no
  filename" guard lived only in `backup-project.js`'s own wrapper, one level
  above the native command — `sendEmail`'s `projectArchive` path calls the
  native command directly and would have had no guard at all, handing
  `archiver` a directory where it expects a file. Moved into
  `platform-node.js`'s `archiveProject` itself, so every caller gets it, not
  only the one that happened to add it first.
- **`installUpdate`'s path, and `wifiConnect`'s smaller version of the same
  question.** Covered in correction 3 above. `wifiConnect` needed no new
  guard: ssid/psk already cross as separate `spawn()` argv elements with no
  shell, the same discipline `installUpdate`'s password-via-stdin follows, and
  that was sufficient — the risk there is argv/shell injection, not a
  privileged file-path primitive.
- **`updates.js:117-130`'s platform/arch asset matching, and the release
  workflow's naming comment.** Read before writing anything here. The
  amd64/arm64/Windows_x64/MacOS_AppleSilicon substring matching stayed
  completely unchanged in `updates.js` — only the source of platform/arch
  moved, from `process.platform`/`process.arch` to `platform.getPlatform()`
  (group A, already implemented). Nothing about the matching itself, or the
  substrings it looks for, was touched.

**Two of `wifi-manager.js`'s seven functions stay unconverted, recorded as an
open item rather than silently left.** `getConnectionState`, `getWifiStatus`,
`enableWifi` and `disableWifi` have no group K command behind them — they were
never declared in `COMMANDS`, and extending the contract for Wi-Fi radio
toggling and connection-state polling was not part of this phase's mandate.
They still spawn `nmcli` directly. This is the same shape as the three stray
`process.platform` reads Phase 2 found "owned by no phase at all" and Phase 3
picked up — flagged here instead, since Phase 9's flip will break these four
call sites outright (`child_process` stops being reachable from the renderer)
and nothing currently owns fixing that.

**Mutation-checked.** Deleting `installUpdate`'s vouched-path guard
(`vouchedUpdatePaths.has(targetPath)`) fails exactly the two tests written for
it — one in `platform.test.js`, one in `updates.test.js` — and nothing else.
Swapping `downloadUpdate`'s `'close'` listener back to `'finish'` is
independently observable here, unlike Phase 6's `buildEpub`/`archiveProject`
finding: the direct proof test fails cleanly, and the error-path tests (a 404,
a request error) hang outright rather than passing silently, since
`file.destroy()` never emits `'finish'` at all — a stronger signal than the
close-enough-together non-result Phase 6 got checking the success path on this
machine's fast local filesystem. Removing `archiveProject`'s new empty-filename
guard reproduces the same class of hang, confirming the gap it closes is real.

**Verified: 1047 tests pass** (from 1009). Thirty-eight net new: forty-one in
`platform.test.js` (contract coverage for all eight commands, including the
documented error codes — `UNAVAILABLE` for a missing `nmcli`/battery is
asserted as the ordinary case, not an edge case, matching the instruction this
phase started from), one added to `updates.test.js` and one to
`wifi-manager.test.js` (a `wifiConnect` failure-path regression neither had
before), three fewer in `battery-monitor.test.js` (`getBatteryPercent`/
`getBatteryName`'s own tests folded into `checkBatteryMinutely`-level ones now
that both functions are gone), one fewer in `email-doc.test.js`, and one fewer
in `render.test.js` (three tests proving Phase 7's resolver-wiring seam
replaced by two proving the menu commands hand each dialog a working platform
instance — the wiring step itself no longer exists to test). Every test file
touched needed the same two mechanical fixes throughout: `platform.js`'s
`createPlatform()` wraps every backing call in `Promise.resolve().then(...)`,
so a call that used to observe a synchronous side effect (a spawned process, an
HTTPS request) now needs a microtask flush first; and `createNodeBacking()`
resolves its injectable `https`/`spawn`/`nodemailer` seams once, at
construction, so a test mocking the real module has to do it *before*
building (or rebuilding, via a `freshXxx()` require-cache bust) the platform
instance under test — the same ordering `wifi-manager.test.js`'s and
`battery-monitor.test.js`'s own `freshWifiManager()`/`freshBatteryMonitor()`
helpers already required for `spawn`, now generalized to `updates.js`'s
`https`/`spawn` and `email-doc.test.js`'s mail transport (the latter sidesteps
the ordering question entirely by injecting `createMailTransport` straight
into each test's own `createNodeBacking()` call rather than monkey-patching
the real `nodemailer` module).

**Verified against real external state, read-only.** `checkForUpdate()`,
called directly against the packaged bundle's `platform-node.js` with no
fakes, reached the real GitHub API and returned the real `v2.4.0` release
(five assets) — proving the HTTPS transport is wired correctly end to end
without ever attempting a write (no download, no install). On this same
Windows machine, `getBatteryCapacity()` and `wifiListNetworks()` both reject
`UNAVAILABLE` as expected (no `/sys/class/power_supply`, no `nmcli`), and
`wifiGetAddress()` resolves `''` rather than erroring — Windows does have a
`hostname` binary, unlike `nmcli`, but it doesn't understand `-I` and prints
nothing to stdout, which resolves as "no address" rather than a spawn failure.
None of this required a live SMTP server, a real release feed beyond the one
read-only check above, real `nmcli`, or a real battery, matching the
instruction this phase started from. Learning from Phase 7's own recorded
mistake — an SMTP connection actually opened while trying to verify the send
path from outside — nothing here sends mail or writes anywhere; `sendEmail`'s
own correctness is covered by `platform.test.js`'s injected `createMailTransport`
fakes instead, which is the "replace the transport inside the bundle" approach
Phase 7's write-up asked for.

**Verified as a packaged build.** `electron-forge package` produced a working
`.exe`; launched against a clean `--user-data-dir`, it materialized the
Frankenstein example and wrote no error log, matching every earlier phase's
packaged-build check. Not covered, for the same reason as every phase before
it: there is still no tool in this environment that can drive a native
Electron window's menus, so the About/Wi-Fi Manager/Send Via Email dialogs
were not clicked through the UI. What crosses the boundary underneath them
(`platform.checkForUpdate`/`downloadUpdate`/`installUpdate`/`sendEmail`/
`wifiListNetworks`/`wifiConnect`/`wifiGetAddress`/`getBatteryCapacity`) is
exercised directly instead, both under the test suite and against real
external state as described above.

**The wifi gap Phase 8 recorded is closed. Not Phase 9, and not part of Phase
8 either — a step in between, so Phase 9 is a flag flip rather than an
interface design exercise.** Phase 8's own write-up flagged four of
`wifi-manager.js`'s seven functions (`getConnectionState`, `getWifiStatus`,
`enableWifi`, `disableWifi`) as spawning `nmcli` directly with no group K
command behind them, unowned by any phase, and certain to break outright once
`nodeIntegration` goes away. `wifiGetConnectionState`, `wifiGetStatus`,
`wifiEnable` and `wifiDisable` are now in `COMMANDS` (group K is 12 commands,
not 8) and implemented in `platform-node.js`, alongside the three added in
Phase 8. `enableWifi`/`disableWifi` map to `wifiEnable`/`wifiDisable`, both
declared with an explicit empty `params: []` — they toggle the radio as a
whole, not a specific device, unlike `wifiConnect`'s ssid/psk.

**Ending the duplication was the point, not just adding the missing
commands.** `platform-node.js` had carried its own copy of `nmcli`'s terse-output
field-splitting (`splitNmcliFields`) specifically because three of
`wifi-manager.js`'s seven functions had a command and four didn't, so
`wifi-manager.js` kept a second copy for the other four. With all seven behind
a command, `wifi-manager.js` no longer parses `nmcli` output at all — the
whole parse lives in `platform-node.js`, once. `wifi-manager.js` itself lost
`child_process` entirely and now wraps all seven platform calls in the same
`reportUnlessUnavailable` pattern the first three already used (log a real
failure, stay quiet for `UNAVAILABLE` — nmcli missing is the ordinary case off
a writerDeck, not a failure worth logging every time this dialog opens).

**Converting the remaining four functions to promises made
`wifi-manager_display.js` async throughout, which is where the actual design
work was.** `updateStateUntilConnected()` polls `getConnectionState` every
250ms until the radio reports `connected`, recursing via `setTimeout` — a
shape the file already had a cancellation guard for
(`wifiManagerGeneration`/`isCurrent()`, bumped on close or reopen), because the
old callback-based poll had exactly the same "must not outlive a closed
dialog" requirement. Converting to a promise-based `pollUntilConnected()`
async loop reopened the question from a different angle: nothing external can
cancel a promise the way `clearTimeout` cancels a timer, so the existing guard
had to move from "checked once at the top of the recursive call" to "checked
at the top of every loop iteration, and again after every `await`" — every
point where the loop would otherwise touch the DOM or schedule more work.

This is the same class of hazard Phase 5 hit in `missing-pups_display.test.js`
— async work that outlives the DOM it was scheduled against, which surfaced
there as an unhandled-rejection crash rather than a clean test failure,
because a handler kept running past its first `await` after the test's own
teardown had already deleted `global.document`. It doesn't reproduce in
exactly that shape here, because every one of `wifi-manager.js`'s functions is
designed to never reject — each catches its own platform-level error and
resolves a fallback value, the same discipline `getWifiNetworks`/
`connectToNewWifi`/`getIpAddress` already followed before this change. But the
underlying risk (a poll that keeps running, and keeps trying to update a
dialog nobody can see, after Close) is the same shape regardless of whether it
would crash, and it is what the guard exists to stop.

Mutation-checked directly: removing the loop's own `isCurrent()` check (so it
becomes an unconditional `while(true)`) fails exactly the two tests that count
`getConnectionState` calls across a Close and a reopen, and nothing else — the
inner `if(!isCurrent()) return` right after the `await` still catches the call
already in flight before it touches the DOM, which is itself
independently mutation-tested: a dedicated test leaves a `getConnectionState()`
call pending, clicks Close, then resolves it with `state: 'connected'` and
asserts the (now-stale) state label was never written to. Removing that
specific `if` fails exactly that test and no other. A third test reproduces
the Phase 5 failure shape directly — Close, then delete `global.window`/
`global.document`, then let the pending poll step actually run — and asserts
no unhandled rejection surfaces.

Verified: **1062 tests pass** (from 1047). Fifteen net new: twelve in
`platform.test.js` (contract coverage for all four commands, including
`UNAVAILABLE` off a missing `nmcli` as the ordinary case, matching every other
wifi/battery command in this group), a net one in `wifi-manager.test.js` (new
UNAVAILABLE-vs-genuine-failure coverage added for the four newly-converted
functions, netted against two now-obsolete "calls back exactly once"
regression tests removed - that failure mode belonged to the old hand-rolled
callback plumbing and cannot recur once every call returns a real promise),
and a net two in `wifi-manager_display.test.js` (the existing poll-cancellation
tests converted to the async API, plus the two new tests described above).

## Phase 9 — Flip the flag

**Split in two, and 9a shipped before 9b was started.** The reason is the one
that made Part 1 unify electron-forge before touching Electron: a failure in
9a-and-9b together is ambiguous between "the bridge is wrong" and "the flag
broke something," and this is the worst place in the project to be debugging two
things at once. 9a is reversible and testable; 9b is the moment the app either
loads or does not.

### Phase 9a — Build the bridge, flags untouched — **done**

Shipped in two commits, and it is the largest phase in Part 2 by some distance:
`platform-ipc.js` implemented 9 of 65 commands when it started, `index.js` had 6
`ipcMain` handlers, `preload.js` did not exist, 36 events still ran on raw
`ipcRenderer`, and the node backing was still in the renderer.

**The structural problem was solved first, before any of the 56 commands.**
`test/platform.test.js` had 179 tests and every one of them built
`createPlatform(createNodeBacking(...))` directly — 59 sites, mostly through the
`platformIn(t, options)` helper. There was no way to run any of them against the
ipc backing, which means nothing in the suite said the two backings behave alike.
That was the stated purpose of the Phase 5 backfill, and as written it could not
be fulfilled.

Not solved by duplicating the tests: `platformIn` is parameterized over a
transport and the whole suite runs twice — once direct, once through a fake
bridge. "Fake" is only the process hop. Both halves are the shipped code
(`platform-ipc.js` on the near side, `platform-host.js` on the far side), with
`structuredClone` — the same algorithm Electron's IPC uses — standing in for the
boundary. The bugs that class of test catches are exactly the ones the boundary
introduces:

- **`PlatformError` does not cross as an `Error`.** `platform.js` says so in its
  own comment. A `code` arriving `undefined` turns every documented failure path
  into a silent generic `IO_ERROR` — rule 5 going quiet for all 65 commands at
  once. `platform-host.js`'s envelope is what prevents it. Non-vacuous by
  mutation: dropping the code from the envelope fails 37 of the bridge-side
  tests; dropping the details fails 3 more (`saveChapterAtomic`'s `rolledBack`,
  and group J's `service`).
- **Buffers arrive as `Uint8Array`.** `writeBinaryFile` already coped
  (`Buffer.isBuffer(x) ? x : Buffer.from(x)`); the transport is what proves it,
  since the direct pass never sees anything but a real `Buffer`.
- **`SAVED_SECRET` is a string with NUL bytes at both ends.** Phase 7 verified it
  survives a Chromium password input; that said nothing about structured clone,
  and now both are checked.

**Two real bugs came out of it, neither visible to any test that existed.**

`user-settings.js` sent the live settings object across `saveUserSettings`,
`save`/`load`/`getSettingsFilepath` included. Structured clone throws on a
function outright, so every save rejected the moment the write was in another
process. It went unnoticed for the same reason it was easy to write: the write
used to be a `JSON.stringify` in this same process, and stringify drops functions
silently, so the file on disk was always right. Only the `SETTINGS_SCHEMA` fields
cross now — which is also the schema's existing job, since a key it does not name
can never be copied back onto the live object on load.

`index.js` did not parse. It requires `'electron'` on its first line, so nothing
in the suite loads it, and it is also the one file in `src/` that esbuild never
sees — so it had neither of the two nets every other file has. The only symptom
was a native "A JavaScript error occurred in the main process" dialog on a
packaged build, found by packaging the app and reading the dialog with UI
Automation. Both it and `preload.js` are compile-checked by the suite now
(`new vm.Script(source)` — it does not run a line, but that is the failure with
no other net), mutation-checked by breaking the file deliberately.

**What shipped.** `preload.js` publishes exactly `invoke`/`on`/`off` as
`window.warewoolf` and nothing else. The one-line version of that file would have
been `exposeInMainWorld('ipc', ipcRenderer)`, and it would have given up the whole
exercise: every channel in the app, plus `sendSync`, plus `sendTo`, reachable from
anything running in the page. What crosses instead is a command name checked
against `COMMANDS` and an event name checked against `EVENTS` — the same tables
the renderer and the main process are written against, so there is one list and
not three. Two things are dropped on the way through: the `IpcRendererEvent`
(whose `sender` is a live handle back into the ipc machinery — handlers get the
payload arguments only, which is the one call-shape change in `render.js`), and
anything not in those tables.

`preload.js` is bundled (`npm run build:preload`), not loaded as source. A
preload script only keeps arbitrary `require()` while `sandbox` is false, which is
true today *only because* `nodeIntegration` is on — the reasoning Part 1 recorded
for leaving `sandbox` alone evaporates at 9b. Bundled, the one require left is
`'electron'`, which a sandboxed preload still provides. A test asserts the preload
bundle has nothing else external.

`index.js` registers one `ipcMain.handle` per entry in `COMMANDS` — from the table,
not one call per command, with a test asserting no command gets a hand-written
registration alongside it. A command with no handler is not a build error or a
crash; it is an `invoke()` that never settles, in the app only. The node backing
moved into the main process, and group A's five injected hooks in
`platform-node.js` (`onSetTheme`/`onShowAppMenu`/`onConfirmExit`/
`onNotifyRendererReady`, and `paths`) — which existed so `platform.test.js` could
exercise the contract's shape against fakes — became the real thing.
`fileRequestedOnOpen` gained a getter form, because macOS's `'open-file'` can set
it after the backing is constructed.

On the renderer side, fifteen modules that held their own
`createPlatform(createNodeBacking({}))` now hold an ipc-backed one, and `render.js`
— which held two platforms — holds one. `secure-storage.js` and the three
`sendSync` channels it drove are deleted; `safeStorage` is a direct call in the
main process. Two commands stopped taking paths because the main process owns
them: spellcheck's three (so `sysDirectories` no longer threads through
`spellcheck_display.js`) and `about_display.js`'s `readLicenses`.

**Confirmed rather than assumed, by reading the rebuilt bundle:** `crypto.js`,
`credential-store.js`, `secure-storage.js`, `platform-node.js`, `nodemailer`,
`archiver` and `unzipper` are all gone from the renderer. What is left external is
exactly `fs` (`render.js`'s four `existsSync` checks in `loadInitialProject`) and
`path` (`backup-project.js`'s basename/dirname/join and `import.js`'s
basename/extname — pure string work, no I/O). `electron` is gone from that list
too, which is 9a's deliverable in one line. A test pins the exact pair, so a
builtin creeping back into the renderer fails now, naming itself, rather than at
the flip as an esbuild resolution error several modules deep.

**Verified on a packaged Windows build from a clean userData directory**, driven
over CDP — the renderer through `--remote-debugging-port`, the main process
through `--inspect`, so menu channels could be sent the way a menu click sends
them. A green suite has failed to predict a working artifact three times in this
project (the zstd `.deb`, the untested bundle, the close/finish guard), and it
failed again here: the suite was green while `index.js` would not parse.

What the driven pass established: the Frankenstein example opens with its 29
chapters and no startup-failure popup; text typed through Chromium's own input
pipeline and saved with File > Save lands in `Quick Start.txt`, the chapter the
editor was showing; the File Manager browses a real directory; Spell Check loads
the real 946KB dictionary across IPC; Send via Email shows the `SAVED_SECRET`
sentinel in the password field rather than the plaintext, against a real
`safeStorage` keystore; `writeTextFile`/`writeBinaryFile` (a genuine
`Uint8Array`)/`buildEpub`/`archiveProject` all land on disk; both a plain menu
channel (`word-count-clicked`) and a payload-carrying one (`about-clicked`) reach
the renderer and render; a `PlatformError`'s `code` **and** `details` survive real
Electron IPC; an undeclared command is refused at the bridge; `getCredential` does
not exist; and the error log is empty throughout.

Verified: **1262 tests pass** (from 1062). 200 net new — 169 of them the contract
suite's second pass through the bridge, and 31 genuinely new: 10 in
`preload.test.js`, 13 in `platform-host.test.js`, a rewritten
`platform-ipc.test.js` (6 plumbing tests replaced by 10 behavioral ones), 2 in
`user-settings.test.js` for the settings-object bug, and 2 in
`render-bundle.test.js` pinning what is left to remove at 9b.

### Phase 9b — Flip the flag — **done, with one open finding and one gap**

`contextIsolation: true`, `nodeIntegration` gone, `--platform=browser`. The
renderer runs isolated: `require`, `module`, `process`, `Buffer` and `__dirname`
are all `undefined` in the page, and `window.warewoolf` — invoke/on/off — is the
only thing that reaches the main process.

**The two inherited items were small, as 9a predicted, and one of them was not.**

`path` became `src/components/controllers/path-utils.js`. Not written from
scratch: `file-manager.js` already had `normalizeSlashes`/`splitPath`/`basename`/
`extAndStem`, built in Phase 5 for the same reason and already covered by that
module's regression tests, so the file is those helpers extracted rather than a
third implementation of them. `backup-project.js` and `import.js` use them now,
and `file-manager.js` requires what it used to define.

The one real decision in it was the separator, and it is the thing 9a's note
about "pure string manipulation" understated. These helpers compose with `/`,
always, on every host — which is not what `path.join` does. **On Windows
`path.join('C:/Users/x/Documents', 'backups')` answers `C:\Users\x\Documents\backups`**,
rewriting a separator the rest of the renderer had already settled on:
`index.js:517-522` forward-slashes every entry of `sysDirectories` on the way
out, `platform-node.js:293` normalizes every path handed to a group B/C command,
and `utils.js`'s `convertFilepath()` normalizes anything a user types into a
settings field. `path.join` was the one thing fighting that convention, and
`createBackupsDirectory` is where it showed: on Windows it persisted a backslash
`backupDirectory` into `user-settings.json` even though `docsDir` had arrived
forward-slashed. That is the one visible behavior change in this phase. Existing
settings are unaffected — `splitPath`/`basename`/`join` all normalize on the way
in, and a test pins that a backslash `backupDirectory` written by an older
version still prunes correctly.

`backup-project.test.js` had been asserting
`userSettings.backupDirectory === path.join(docsDir, 'backups')`, which is
exactly the trap: computed with the host's own `path`, it agreed with the code on
both platforms while pinning two different answers. It states the one answer now.

`fs` was the four `existsSync` calls in `render.js`'s `loadInitialProject()`, and
that was the small one — `pathExists` already existed and `await` was the whole
change. The chain stays an if/else-if rather than becoming an eager
`Promise.all`: the checks are ordered by preference, not merely grouped, and
short-circuiting is load-bearing. No reordering was needed in
`loadPlatformState()`; `initialize()` was already awaited inside it, after
`error-log.setPlatform(platform)`.

**`crypto.js` and `credential-store.js` were NOT deleted, and should not be.**
9a recorded them as "already gone", and that is true of the *renderer* — they left
the bundle when the node backing moved to the main process, verified again here at
zero externals. But leaving the renderer relocated them; it did not make them
dead. `platform-node.js:37-38` requires both, and uses them: `getCredentialStore`
backs group J's `storeCredential`/`describeCredential`/`unlockCredential` at
`:1069`, and `decryptLegacy`/`isLegacyBlob` back `migrateLegacyCredential` at
`:1169`/`:1173` — the 2.2.1 password migration that runs on every launch on real
machines. Deleting them would have broken credential storage and the legacy
migration in the main process, silently for anyone who never opens the email
dialog. "Out of the renderer" and "unused" are not the same claim, and the
inventory now says so where it used to imply otherwise.

**Two things this phase turned up that no test in the suite could have.**

**The bundle format would have shipped a dead app.** esbuild with
`--platform=node` emits CJS, and the entry point's `module.exports.ready = ...`
survived into the output as a bare top-level statement (`render.bundle.js:29376`
before this phase). That worked only because `nodeIntegration: true` put a
`module` in the page. An isolated page has none, so the very first statement of
the renderer would have thrown `ReferenceError: module is not defined` — a black
window, no error dialog, on an app whose suite was entirely green.

`render-bundle.test.js` could not have caught it, and the reason is worth
recording: it loaded the bundle with `require()`, which is the one way the app
never loads it. `index.html:35` loads it with a plain `<script>` tag. Under
`require()` a `module` object is always real, so the test was structurally
incapable of seeing the failure. The bundle is now an IIFE published under
`--global-name=warewoolfRenderer`, and the test evaluates it with
`vm.runInThisContext` — top-level `var` landing on the global object, exports read
off that global, nothing supplying `module`. That last part is the assertion.
Verified by mutation: rebuilt with the old flags, three of the bundle tests fail
with `module is not defined`, which is the exact error the packaged app would have
shown.

This is the fifth time in this project a green suite has failed to predict a
working artifact — after the zstd `.deb`, the untested bundle, the close/finish
guard, and `index.js` not parsing. It is the first of the five that a test change
caught before packaging rather than after.

**Removing `nodeIntegration` would have turned the OS sandbox on by itself.**
Electron's `sandbox` has defaulted to `true` since v20 and is disabled
automatically only while `nodeIntegration: true` is set (`electron.d.ts:19514`).
So dropping `nodeIntegration` without saying anything about `sandbox` would have
been two irreversible-feeling changes in one commit — precisely what splitting 9a
from 9b, and what keeping Part 1's forge and Electron steps apart, existed to
avoid. `sandbox: false` is written out explicitly in the flip commit so the flip
stayed one variable, and a test now requires it to be set explicitly rather than
inherited.

**The sandbox decision: not yet, and gated on one specific thing.**

Evaluated separately after the flip was committed, on its own evidence rather than
on argument. With `sandbox: true`, a packaged Windows build passes the same 29
driven checks, unchanged. The flag is genuinely load-bearing and not silently
ignored: `app.getAppMetrics()` reports the renderer (`Tab`) as `sandboxed: true`
with it on and `sandboxed: false` with it off. `preload.bundle.js` has only
`electron` external, which a sandboxed preload still provides, and a test pins
that.

So on Windows the answer is yes, and the cost is zero. It is **not** committed,
for one reason: turning it on newly puts the renderer process into the OS-level
sandbox, and on Linux that depends on machinery this project has never exercised —
unprivileged user namespaces, or a correctly SUID `chrome-sandbox` in the
installed tree. A `.deb` that gets that wrong fails at startup, not gracefully,
and the Linux target runs `kiosk: true`, so the symptom is a black screen on the
writerDeck. This project has already shipped one `.deb` that only failed on the
device (the zstd compression bug), and the whole premise of this phase is that a
green Windows run does not predict the Linux artifact.

**The decision, recorded: turn `sandbox: true` on as its own commit, immediately
after the Pi pass below, and re-run the driven checks on the Pi with it both off
and on.** Not "someday" — it is one line, it is already known to work on one
platform, and the only thing between it and shipping is the pass that phase owes
anyway.

**Verified on a packaged Windows build from a clean userData directory**, driven
over CDP — the renderer through `--remote-debugging-port`, the main process
through `--inspect` so menu channels could be sent the way a menu click sends
them. 29 checks, all passing:

- The isolation itself: no `require`/`module`/`process`/`Buffer`/`__dirname` in
  the page; `window.warewoolf` has exactly `invoke`/`on`/`off`; no `ipcRenderer`
  or `electron`; and a `Function`-constructor escape into a foreign realm finds no
  `require` either.
- The bundled Frankenstein example opens with its 29 chapters, materialized into
  the clean userData rather than opened read-only from the install directory, with
  no startup-failure popup.
- Text typed **through Chromium's own input pipeline** lands in `Quick Start.txt`
  on disk after File > Save, and the project file is rewritten as valid JSON with
  29 chapters. The input pipeline is not incidental: an `editorQuill.insertText()`
  arrives as source `'api'`, which the app's change tracking deliberately ignores,
  so a programmatic insert leaves `hasUnsavedChanges` false and File > Save writes
  nothing. Driving it any other way tests nothing.
- File Manager browses a real directory; `listDirectory` returns `isDirectory` as
  a plain boolean.
- Spell Check loads the real 946KB dictionary across IPC.
- `storeCredential` seals against a real `safeStorage` keystore and
  `describeCredential` reports `hasPassword` without ever returning the secret;
  Send via Email shows the `SAVED_SECRET` sentinel (24 chars, NUL-delimited) in the
  password field rather than the plaintext, and no command hands the plaintext
  back.
- `writeTextFile`, `writeBinaryFile` (a genuine `Uint8Array`), `buildEpub` and
  `archiveProject` all land on disk.
- A `PlatformError`'s `code` **and** `details` cross real Electron IPC intact
  (`NOT_FOUND` with `{command}`, `INVALID_ARGUMENT` with `{service}`), and — the
  other half, end to end through the app's own facade — a chapter file deleted out
  from under the running app surfaces in the error log as a `PlatformError`, not a
  flattened `Error`.
- An undeclared command is refused at the bridge.
- Both menu-channel shapes reach the renderer: a plain one (`word-count-clicked`)
  and a payload-carrying one (`about-clicked`), with its argument.
- The error log is empty throughout, and no uncaught exceptions in the renderer.

Verified: **1279 tests pass** (from 1262). 17 net new — 15 in
`path-utils.test.js`, one in `backup-project.test.js` pinning that a backslash
`backupDirectory` from an older settings file still resolves, and one in
`render-bundle.test.js` asserting `index.js`'s flags directly. Two tests were
removed rather than patched, both deliberately: "leaves only Node builtins and
electron external", which would have gone on passing while asserting the opposite
of this phase, and 9a's `fs`/`path` countdown, which reached zero. Every new net
is mutation-checked — a builtin import fails the build, `nodeIntegration: true`
fails the flag test, an implicit `sandbox` fails it too, a `join` delegating to
Node's `path.join` fails four path tests and one backup test, and the old bundle
format fails three bundle tests.

#### Open finding from `/security-review` — renderer to root, on Linux

The review found nothing wrong with the bridge itself. `preload.js` validates
against `COMMANDS`/`EVENTS` with `hasOwnProperty` (so `constructor`/`__proto__`
cannot be smuggled as a command name), strips the `IpcRendererEvent`, and exposes
three functions. No live handle, function or sender crosses. `on`/`off` both
validate, and there is no `send`/`sendSync`/`sendTo`. Every `spawn` in the main
process uses an argv array — no shell anywhere. Group E/F/G's arbitrary-path
primitives are the documented concession and nothing exceeds them. `path-utils.js`
strips leading separators from every argument but the first, so a later absolute
argument cannot reset the root.

**One thing does not hold, and it is the one command that escalates privilege.**

`installUpdate` runs `sudo -S apt install <path>`, and its entire defence is that
`path` must be in `vouchedUpdatePaths`. Both this document (line 1219) and the
inventory (group K) reject a directory allowlist or filename pattern on the
explicit grounds that "a renderer-composed path could satisfy [them] by
construction", and assert that "this backing watched the bytes land here" is not
renderer-forgeable.

It is. `downloadUpdate` (`platform-node.js:1269`) is the only producer of vouches
and it takes **both** `url` and `destPath` from the renderer, unvalidated —
`updates.js:133-137` composes `destPath` renderer-side from `downloadInfo`, which
is parsed renderer-side too. Worse, the already-downloaded shortcut at
`platform-node.js:1276-1280` vouches `destPath` on nothing but `fs.existsSync`,
with no HTTP request at all. So the guard reduces to "the renderer called
`downloadUpdate` on this path first", which is one extra IPC call:

1. `writeBinaryFile` a malicious `.deb` to `/tmp/x.deb` — group G, fully conceded.
2. `downloadUpdate({ url: <anything>, destPath: '/tmp/x.deb' })` — `existsSync` is
   true, so it resolves immediately and vouches the path. No network traffic.
3. `installUpdate({ path: '/tmp/x.deb', password: <anything> })` — the guard
   passes, `dpkg` runs the package's `postinst` as root.

The comment at `:1266-1268` justifies the shortcut as "a file this backing can see
sitting at the exact path it would itself have written the release asset to". The
premise is false: the backing does not choose that path, the renderer does.

The sudo password is the only remaining obstacle, and it is weak on exactly the
target hardware — Raspberry Pi OS commonly ships the first user with `NOPASSWD`
sudo. Where a password is required, the renderer draws the update dialog itself
(`install-update_display.js`), so it can ask for one. And this is not only an
untrusted-renderer concern: the *benign* flow is equally unprotected, since
`downloadInfo.url` comes from JSON parsed in the renderer.

Secondary, same function: `targetPath` is a bare argv element, so a vouched path
beginning with `-` is read by `apt` as an option rather than a package file
(`-oDPkg::Pre-Invoke::=...`). The design note at `platform.js:341-342` correctly
rules out *shell* injection but not *argument* injection.

**Why this is 9b's finding and not Phase 8's.** The vouching code is Phase 8's,
but before this flip the renderer had `child_process` and could spawn `sudo`
itself — there was no boundary for the guard to fail at. It exists precisely so
that this phase's boundary would hold, and post-flip it is the only remaining path
from renderer to root. The flip is what makes it matter.

**Not fixed here, deliberately.** The fix changes `downloadUpdate`'s contract:
the backing has to allocate `destPath` itself inside an `fs.mkdtempSync` directory
and return it (the same "the command allocates the name" discipline
`saveChapterAtomic` and `archiveProject` already follow), the `url` has to be
validated against the hosts the release API actually returns, the `existsSync`
shortcut's vouch has to go, and `installUpdate` needs `'--'` before `targetPath`
plus an absolute-path/`.deb` check. That is a contract change to a group K
command, and it belongs in its own commit for the same reason everything else in
this phase did.

#### Outstanding

- **The Pi pass has not been run.** Pi OS Lite, Xorg, Matchbox, kiosk mode, and
  typing latency in a long chapter — none of it. The Windows pass above is real
  and the Linux one is simply not done, so nothing here should be read as
  cross-platform verification. This is the same gap that produced the zstd `.deb`,
  and it is the gate on the sandbox decision above.
- **macOS is untested too**, including the `open-file` path that
  `fileRequestedOnOpen`'s getter form exists for.
- The `installUpdate` finding above.

---

# Part 3 — Which model for which phase

The useful heuristic given this repo: **Opus where the tests cannot tell you that
you are wrong; Sonnet where they can.** With 830 fast, real-filesystem tests, that
line is unusually clear here.

| Work | Model | Reasoning |
|---|---|---|
| Part 1, all steps | **Sonnet** | Empirical loop: bump, run, read the error, fix. The judgment is in reading release notes against a known API list. Escalate only if a failure is genuinely confusing. |
| Support-matrix call (drop Buster? Win7?) | **You** | A product decision about your users, not a technical one. |
| Phase 0 (bundler) | **Sonnet** | Well-trodden, and verified by "app runs, 830 tests pass". |
| Phase 1 (facade design) | **Opus** | The contract for all 61 commands. A wrong shape is expensive and invisible to tests — exactly the failure mode Sonnet is worst at catching. |
| Phases 2, 3, 5, 6, 8 | **Sonnet** | High-volume, repetitive sync→async conversion with a strong test oracle. This is the bulk of the hours and the best Sonnet fit in the project. |
| Phase 4 — `saveChapterAtomic` | **Opus** | Hand-rolled rollback with ordering constraints. Failures are silent and corrupt manuscripts. |
| Phase 7 — credentials | **Opus** | Crypto, key handling, and a legacy-format fallback whose breakage looks like nothing until a user's stored password stops decrypting. |
| Phase 9a — build the bridge | **Opus** | Two of its three hardest parts were invisible to the suite as it stood: the contract tests could not run against the ipc backing at all, and `index.js` has neither a test nor a build to catch it. |
| Phase 9b — flip and audit | **Opus** + `/security-review` | Adversarial review of a security boundary; the whole point of the exercise. |

Between phases, `/code-review` on each batch is worth more than model choice —
the mechanical work fails in mechanical ways, and review catches those cheaply.
