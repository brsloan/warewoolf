# Plan: Electron Upgrade, then Context Isolation

Companion to [`native-command-inventory.md`](./native-command-inventory.md), which
holds the command-by-command detail for Part 2.

Baseline at time of writing (`5ea64b9`): Electron 18.3.15, Quill 1.3.7, 863 tests
passing in ~23s, zero native modules, `src/index.js` untested.

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
  setWindowOpenHandler`, and `ipcMain.on`. All still exist and are stable.
- **The renderer is already hardened.** `setWindowOpenHandler` deny,
  `will-navigate` deny, gated devTools, and the close guard are already in place
  (`index.js:78-90`), so the upgrade does not have to introduce them.

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

**Wayland, and it is not the upgrade's fault.** Raspberry Pi OS Bookworm defaults
to Wayland (labwc on Pi 4/5), where Electron 18 was written for X11. The window
config at `index.js:52-53` — `kiosk: isLinux` plus `fullscreen: true` — is
exactly the surface whose semantics differ under Wayland/XWayland.

Test this on the **current** build before upgrading. The risk comes from Pi OS
changing underneath the app, not from the version bump, and it may already be
present at 18.3.15. Establishing that first avoids misattributing a pre-existing
bug to the upgrade. Newer Electron generally handles Wayland better.

**GPU and memory on ARM.** Electron's arm64 build is stock Chromium, not the
Pi-patched Chromium Raspberry Pi ships — no hardware video decode, and V3D
acceleration may need `--disable-gpu` or `--use-gl=egl`. Already true at 18, but
newer Chromium leans harder on GPU compositing, so watch for a regression. On
2GB Pi 4 units, measure memory rather than assuming the per-chapter lazy loading
absorbs it.

**Verification is manual.** `src/index.js` has no tests, and the 863 existing
tests run under plain Node — they will pass regardless of the Electron version
and prove nothing about the upgrade. The real oracle is a smoke pass on each
target.

## Steps

**1. Record the baseline.** `npm test` (expect 863 pass), then build on each
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
Linux, since `isSecureStorageAvailable()` (`index.js:487-509`) depends on
`getSelectedStorageBackend` behavior.

**5. Confirm the webPreferences still mean what they meant.** Electron 20 made
renderers sandboxed by default, but `nodeIntegration: true` at `index.js:46`
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
- **On a Bookworm Pi 4, against the pre-upgrade build first, then the new one:**
  kiosk/fullscreen behavior under Wayland, typing latency and scroll smoothness
  in a long chapter, memory on a 2GB unit, then the wifi manager and battery
  monitor (Pi-only paths nothing else covers)

**7. Ship it as its own release.** Do not begin Part 2 until this is out and has
survived contact with real use. If modern Chromium meaningfully improves Pi
performance, that also updates the Tauri calculation.

---

# Part 2 — Context isolation

## Phase 0 — Introduce a bundler (the actual blocker)

This is the step that is easy to miss and blocks everything else.

`src/index.html` loads the renderer with a single plain `<script src="render.js">`
tag. The entire 70-module CommonJS graph — every `require('./chapter-list')`,
every `module.exports` — is resolved **at runtime by Node integration in the
renderer**. Turning off `nodeIntegration` does not just remove `require('fs')`.
It removes `require` altogether, and the app does not load at all.

So before any bridge work: add an **esbuild** step producing a single
`render.bundle.js`, and point the script tag at it. esbuild consumes the existing
CommonJS as-is — no module-system migration, no source changes. Mark Node
builtins external for now; they still resolve through Node integration, which is
still on.

This phase changes no behavior. It ships on its own, and it is verified by the
app running normally with 863 tests still green.

## Phase 1 — Design the injectable platform facade

**The key decision, and the one worth the most care.**

The existing tests do not mock the filesystem. They create real temp directories
and assert against real files (`chapter.test.js`, `render.test.js`, and others
use `fs.mkdtempSync`). If modules simply start calling `window.warewoolf.*`, that
entire suite dies — and losing 863 tests at the start of a 45-command refactor
is how this project fails.

So the facade must be **injected, not global**. One module — `platform.js` —
exports the command surface from the inventory. It has multiple backings:

| Backing | Used by | Notes |
|---|---|---|
| Direct `fs`/Node | the test suite | Keeps all 863 tests running against real files, unchanged in spirit |
| `ipcRenderer.invoke` | the shipped Electron app | The preload bridge |
| Tauri `invoke` | a future Tauri build | One-file swap |

Tests already prime `require.cache` to inject a fake `ipcRenderer`
(`render.test.js:35-45`), so the injection pattern is established — this extends
it rather than inventing something new.

Get the shape right here. Everything downstream is mechanical only if this is
correct.

## Phases 2–7 — Convert, group by group

Order from the inventory, each shipping independently while `nodeIntegration`
stays on:

**Phase 2 — Group A (environment).** `getAppPaths` first: it is `sendSync` at
module load (`render.js:4`), so nothing else converts cleanly until it does.

**Phase 3 — `logError`.** Widest call graph, least logic. Treat it as a
calibration exercise for how invasive the async conversion really is before
committing to the core.

**Phase 4 — Groups B and C (projects, chapters).** The core, and the best-tested.
`saveChapterAtomic` (`chapter.js:134-165`) needs its transactional semantics
preserved exactly — get this reviewed carefully rather than fast.

**Phase 5 — Rest of D, then I and E.** Settings, corkboard, spellcheck
dictionaries, file browser.

**Phase 6 — Groups F, G, H.** Import, export, backup.

**Phase 7 — Group J (credentials).** The collapse to four commands described in
the inventory. Security-sensitive: key material stops living in the renderer, and
the legacy-format decrypt fallback (`crypto.js:85`) must keep working or existing
users lose stored credentials.

**Phase 8 — Group K.** Updates, email, wifi, battery.

## Phase 9 — Flip the flag

Set `contextIsolation: true`, remove `nodeIntegration`, mark Node builtins as
genuinely unavailable in the esbuild config so any survivor fails loudly at build
time rather than silently at runtime.

Then audit: grep for any remaining `require` of a Node builtin in renderer code,
and review the preload surface for anything that leaks an arbitrary-path
primitive. Run `/security-review` over the diff.

Full cross-platform smoke pass again, including the Pi.

---

# Part 3 — Which model for which phase

The useful heuristic given this repo: **Opus where the tests cannot tell you that
you are wrong; Sonnet where they can.** With 863 fast, real-filesystem tests, that
line is unusually clear here.

| Work | Model | Reasoning |
|---|---|---|
| Part 1, all steps | **Sonnet** | Empirical loop: bump, run, read the error, fix. The judgment is in reading release notes against a known API list. Escalate only if a failure is genuinely confusing. |
| Support-matrix call (drop Buster? Win7?) | **You** | A product decision about your users, not a technical one. |
| Phase 0 (bundler) | **Sonnet** | Well-trodden, and verified by "app runs, 863 tests pass". |
| Phase 1 (facade design) | **Opus** | The contract for all 45 commands. A wrong shape is expensive and invisible to tests — exactly the failure mode Sonnet is worst at catching. |
| Phases 2, 3, 5, 6, 8 | **Sonnet** | High-volume, repetitive sync→async conversion with a strong test oracle. This is the bulk of the hours and the best Sonnet fit in the project. |
| Phase 4 — `saveChapterAtomic` | **Opus** | Hand-rolled rollback with ordering constraints. Failures are silent and corrupt manuscripts. |
| Phase 7 — credentials | **Opus** | Crypto, key handling, and a legacy-format fallback whose breakage looks like nothing until a user's stored password stops decrypting. |
| Phase 9 — flip and audit | **Opus** + `/security-review` | Adversarial review of a security boundary; the whole point of the exercise. |

Between phases, `/code-review` on each batch is worth more than model choice —
the mechanical work fails in mechanical ways, and review catches those cheaply.
