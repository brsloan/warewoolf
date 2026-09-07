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
`nodeIntegration: true` disables it (verified from the live docs, not assumed),
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
failure would look unrelated.

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

**Part 2 is at Phase 6, complete. Suite is 974.** Groups A, B, C, D, E, F, G, H,
I and J are implemented in `platform-node.js`; only K still rejects with
`NOT_IMPLEMENTED`. Phase 7 is clear to start.

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

**Phase 7 — Group J (credentials).** The collapse to four commands described in
the inventory. Security-sensitive: key material stops living in the renderer, and
the legacy-format decrypt fallback (`crypto.js:85`) must keep working or existing
users lose stored credentials.

**Phase 8 — Group K.** Updates, email, wifi, battery.

## Phase 9 — Flip the flag

Set `contextIsolation: true`, remove `nodeIntegration`, mark Node builtins as
genuinely unavailable in the esbuild config so any survivor fails loudly at build
time rather than silently at runtime.

**That net only catches import-shaped survivors.** `--platform=browser` fails a
surviving `require('fs')`, but a bare global read — `process.platform`,
`__dirname`, `process.cwd()` — is not an import and compiles through verbatim
(verified in Phase 2; see the Group A note above). Those fail at runtime
instead, and a module-scope one stops the app from starting at all. Do not treat
a clean build as proof the renderer is Node-free.

Then audit: grep for any remaining `require` of a Node builtin in renderer code,
**and separately for `process.`, `__dirname` and `process.cwd()`**, which the
build will not flag. Review the preload surface for anything that leaks an
arbitrary-path primitive. Run `/security-review` over the diff.

Full cross-platform smoke pass again, including the Pi.

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
| Phase 9 — flip and audit | **Opus** + `/security-review` | Adversarial review of a security boundary; the whole point of the exercise. |

Between phases, `/code-review` on each batch is worth more than model choice —
the mechanical work fails in mechanical ways, and review catches those cheaply.
