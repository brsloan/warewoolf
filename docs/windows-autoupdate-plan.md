# Windows in-app updates, via Squirrel and Electron's built-in autoUpdater

## What this is

Today a Windows writer who takes an update does this:

1. Help → About → **Check For Updates**
2. **Download** → "Downloaded Into Downloads Folder"
3. Opens Explorer, finds `warewoolf_<version>_Windows_x64.exe`, double-clicks it
4. Clears SmartScreen: "Windows protected your PC" → More info → Run anyway
5. Squirrel installs, the app relaunches

This plan collapses steps 3–5 into one click:

1. Help → About → **Check For Updates**
2. **Install** → "Downloading update..." → "Update ready"
3. **Restart** → windows close, the update is applied, WareWoolf reopens on the new version

The writer never opens a file manager and never sees SmartScreen, because nothing
downloaded is executed: Squirrel's already-installed `Update.exe` applies the package.
That last point matters more than it looks. A good share of this project's Windows
users are on work or university machines, and the SmartScreen prompt is the step most
likely to be policy-blocked out from under them.

**Windows only.** Linux keeps its password dialog and `apt`; macOS keeps "it's in your
Downloads folder". Neither changes, and neither should.

## Decisions already made — do not re-litigate these

**Electron's built-in `autoUpdater`, not `electron-updater`.** electron-updater does not
support Squirrel.Windows at all; adopting it would mean migrating the entire build
pipeline from electron-forge to electron-builder and moving every existing Windows user
from a Squirrel install to an NSIS one. The built-in updater consumes what
`maker-squirrel` already produces. See the notes at the top of
`.github/workflows/release.yml` for how the Windows asset got its current shape.

**User-initiated only.** No check on launch, no background download, no install on quit.
This app runs on writerdecks tethered to phone hotspots; a surprise 163 MB download is a
real cost to a real person. The writer asks, and only then does anything happen.

**The manual download path stays.** The Install button becomes the happy path, not the
only one. Squirrel's failure modes are opaque, and when it fails the writer must still be
able to fall back to downloading the installer themselves — which is exactly what
`downloadUpdate` already does.

**`autoUpdater` is an Electron main-process API, so it does not go in
`platform-node.js`.** That file requires `fs`, `path`, `os`, and third-party modules, but
never `electron` — that is what lets the whole contract suite run under plain `node`
against real files. `autoUpdater` belongs in the same shape as `nativeTheme`, the
application menu and `app.quit()`: implemented in `index.js` and handed to the backing as
an injected hook (`onSetTheme`, `onShowAppMenu`, `onConfirmExit` are the models to copy).

**The renderer does not name the feed URL.** It passes the release tag it already got
from `checkForUpdate`. The backing validates the tag's shape and composes the URL from
the same `RELEASE_ASSET_HOSTNAME` / `RELEASE_ASSET_PATH_PREFIX` constants
`downloadUpdate`'s allowlist is spelled from, so the two cannot drift. This is the same
correction Phase 9c made to `downloadUpdate`'s destination path, for the same reason.

---

## Step 1 — Publish the Squirrel feed files

`maker-squirrel` produces three files in `out/make/squirrel.windows/x64/`:

```
RELEASES                          the feed index
warewoolf-<version>-full.nupkg    the package RELEASES points at
warewoolf-<version> Setup.exe     renamed by the workflow to warewoolf_<version>_Windows_x64.exe
```

Only the `.exe` is uploaded today. The updater needs all three, served under the
release's download prefix, so that `https://github.com/brsloan/warewoolf/releases/download/<tag>/RELEASES`
resolves.

In `.github/workflows/release.yml`, extend the Windows job's `upload-artifact` step:

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: release-asset-windows-x64
          path: |
            out/make/squirrel.windows/x64/warewoolf_*_Windows_x64.exe
            out/make/squirrel.windows/x64/warewoolf-*-full.nupkg
            out/make/squirrel.windows/x64/RELEASES
          if-no-files-found: error
```

Two constraints on this step, both worth a comment in the file:

- **Do not rename the `.nupkg`.** `RELEASES` references it by exact filename. A real
  `RELEASES` line looks like this:

  ```
  6FF54F5F9744B52B54ADC9490A6BF9ECDC1CF467 warewoolf-2.5.0-full.nupkg 162752209
  ```

  Rename the file and Squirrel looks for something that isn't there.

- **Neither new asset name may contain a substring the in-app updater matches on.**
  `extractUpdateDownloadInfo` (`src/components/controllers/updates.js`) does
  `bin.name.includes(binType)` over a `find()`, where `binType` is one of `amd64`,
  `arm64`, `Windows_x64`, `MacOS_Intel`, `MacOS_AppleSilicon`, `MacOS_Legacy`. Neither
  `RELEASES` nor `warewoolf-<version>-full.nupkg` contains any of them, so they are safe
  as-is — but this is the same hazard that made the Apple Silicon asset `AppleSilicon`
  rather than `arm64`, and any future asset must be checked against it.

Extend the existing "Verify the Windows asset is an installer" step to also assert that
the `RELEASES` line names the `.nupkg` actually being uploaded. That check is cheap and it
catches the one failure that would otherwise only appear on a writer's machine.

## Step 2 — Contract additions

In `src/components/controllers/platform.js`:

**Two commands, group K**, next to the existing update commands:

```js
startSquirrelUpdate: { group: 'K', params: ['tag'], returns: 'void' },
quitAndInstallUpdate: { group: 'K', params: [], returns: 'void' },
```

Document in the comment above them, in the style of the surrounding entries:

- Why `tag` and not a URL (the renderer does not name the feed; see the decisions above).
- That both are win32-only and reject `UNAVAILABLE` elsewhere.
- That `startSquirrelUpdate` resolves as soon as the check is *started* — the outcome
  arrives as an event, because Squirrel's download has no synchronous completion to
  await and no progress to report.

**Two events**, appended to `EVENTS`:

```js
'app-update-downloaded', 'app-update-failed'
```

`app-update-failed` carries a message string. Emit it for Electron's `error` event **and**
for `update-not-available` — if Squirrel finds nothing after `checkForUpdate` already told
the writer an update exists, something is wrong with the feed, and the writer must not be
left watching a spinner forever.

**Counts to update alongside these:**

| Location | Currently | Becomes |
|---|---|---|
| `test/platform-ipc.test.js:161` | `EVENTS.length, 38` | `40` |
| `test/platform.test.js:403` | `EVENTS.length, 38` | `40` |

There is no asserted count for `COMMANDS`, only prose. Seven comments say "all 65
commands", and the table already holds 70 — the number went stale as later phases added
entries and nothing failed, because nothing checks it. Do not add "65 → 72" edits to this
change: either leave all six alone, or fix them in a separate commit that says that is
what it is doing. They are in `src/index.js:527`,
`src/components/controllers/platform-ipc.js:22`, `test/fake-bridge.js:16`,
`test/platform-host.test.js:38`, `test/platform-ipc.test.js:69`, `test/platform.test.js:71`
and `test/render.test.js:64`.

`test/platform.test.js` has a guard that reads `index.js` and asserts every declared event
matches a channel the main process actually sends, and vice versa. It will fail until
Step 3 lands. That is the guard doing its job — do not weaken it.

## Step 3 — Main process (`src/index.js`)

Add `autoUpdater` to the `electron` require, and two hooks to the `createNodeBacking`
options object where `onSetTheme` / `onShowAppMenu` / `onConfirmExit` already live:

```js
onStartSquirrelUpdate: function(feedUrl){ /* set the feed, register listeners once, check */ },
onQuitAndInstallUpdate: function(){ /* closeConfirmed = true; autoUpdater.quitAndInstall(); */ },
```

Requirements:

- **Register the `autoUpdater` listeners once**, not per call. A writer who clicks Install,
  hits an error, and clicks again must not get two `app-update-downloaded` events.
- **Wire the events to `mainWindow.webContents.send('app-update-downloaded')` and
  `send('app-update-failed', message)`** — literal channel names, because the guard test
  greps for exactly that.
- **Set `closeConfirmed = true` before `quitAndInstall()`.** `quitAndInstall` closes all
  windows; without this the window-close handler re-prompts the writer mid-update.
- **Refuse during Squirrel's first run.** Squirrel holds a file lock immediately after
  installing, and update checks fail there in a way that looks like a bug. If
  `process.argv` includes `--squirrel-firstrun`, emit `app-update-failed` with a message
  saying WareWoolf was just installed and to try again shortly, rather than calling
  `checkForUpdates()`.

## Step 4 — Node backing (`src/components/controllers/platform-node.js`)

Add the two hooks to the options destructuring, defaulting to no-ops like their group A
neighbours, and implement the two commands in the group K section:

- Both reject `PlatformError(CODES.UNAVAILABLE, ...)` when `currentPlatform() !== 'win32'`.
  Not `NOT_IMPLEMENTED` — the command exists, this platform just has a different update
  path, which is the same distinction `getBatteryCapacity` already draws.
- `startSquirrelUpdate` validates `tag` against `/^v\d+\.\d+\.\d+$/` and rejects
  `INVALID_ARGUMENT` otherwise. This is what stops a tag from walking out of the release
  prefix.
- It then composes the feed URL from the existing constants —
  `'https://' + RELEASE_ASSET_HOSTNAME + RELEASE_ASSET_PATH_PREFIX + tag` — and hands the
  finished URL to the hook. Composing it here rather than in `index.js` keeps it beside
  the allowlist `downloadUpdate` checks against, so a change to one is a change to both.

## Step 5 — Renderer controller (`src/components/controllers/updates.js`)

Two additions, in the existing callback style of the file (no promises out to callers):

```js
function startWindowsUpdate(tag, onDownloaded, onFailed){ ... }
function finishWindowsUpdate(){ ... }
```

`startWindowsUpdate` subscribes to both events via `platform.on`, calls
`platform.startSquirrelUpdate({ tag })`, and **unsubscribes both handlers as soon as either
one fires**. `test/fake-bridge.js` deliberately tracks listener counts so a test cannot
pass while leaving a live listener behind; honour that.

`finishWindowsUpdate` calls `platform.quitAndInstallUpdate()`.

## Step 6 — About panel (`src/components/views/about_display.js`)

The `platformInfo.platform == 'linux'` / else branching at the download button grows a
win32 branch. Its states:

| State | Button | Text |
|---|---|---|
| update found | **Install Update** | (release notes, as now) |
| clicked | disabled | "Downloading update... this may take several minutes." |
| `app-update-downloaded` | **Restart To Finish** | "Update ready." |
| `app-update-failed` | **Download Installer** | the failure, plus "You can install it yourself instead." — then the existing `downloadUpdate` path |

Be honest in the downloading copy about the wait. Electron's built-in `autoUpdater` has no
`download-progress` event, so there is nothing to put in a progress bar; the package is
around 163 MB, and on a hotspot that is minutes of apparent silence. (The current
Windows flow shows no progress either, so this is not a regression — but it is now a
longer silence, because the writer is waiting in the app rather than watching a browser
download.)

**Restart must not discard unsaved work.** Route the Restart button through the same
check the app already runs for `exit-app-clicked` before calling `finishWindowsUpdate()`.
Do not call `quitAndInstallUpdate` directly from the button handler.

## Step 7 — Tests

- **`test/platform.test.js`** — both commands reject `UNAVAILABLE` off win32; the tag
  pattern rejects a bad tag with `INVALID_ARGUMENT` and never calls the hook; a good tag
  produces exactly the expected feed URL; `EVENTS.length` and the index.js channel guard.
- **`test/updates.test.js`** — `startWindowsUpdate` subscribes, fires the right callback
  on each event, and leaves zero listeners behind afterwards (assert via the fake bridge's
  `listenerCount`). Plus a regression test: a release listing that includes `RELEASES` and
  `warewoolf-<v>-full.nupkg` alongside the assets still matches the `.exe` for win32.
- **`test/about_display.test.js`** — the win32 branch shows Install rather than Download;
  the downloaded event swaps in the Restart button; the failed event falls back to the
  manual download path.
- **`test/platform-ipc.test.js`** — the count assertion.

There is no unit test for Squirrel itself. That is expected; see verification below.

## Step 8 — Docs

- Group K table and notes in `docs/native-command-inventory.md`.
- A changelog line in the README's "Unreleased" list, in the plain-language voice the
  others use — what the writer now does, not what the code does.

---

## Verification

The unit tests cover everything up to the boundary. Squirrel itself can only be checked by
hand, and it cannot be checked from `npm start` — an unpackaged app has no `Update.exe`
beside it, so `autoUpdater` fails immediately. The recipe:

1. `npx electron-forge make --platform=win32 --arch=x64 --targets=@electron-forge/maker-squirrel`
   at the current version, and run the resulting `Setup.exe` to get a real install.
2. Bump `version` in `package.json`, make again, and put that build's `RELEASES`,
   `.nupkg` and `Setup.exe` somewhere the installed app can reach as a feed — a real
   draft release on the repo is the honest test, since it exercises GitHub's redirect to
   its asset CDN, which is the part a local static server would not.
3. Launch the installed (older) app, Help → About → Check For Updates → Install → Restart.
4. Confirm it reopens on the new version, and that Add/Remove Programs still lists one
   WareWoolf, not two.

Also worth confirming once, since it is the whole point of the feature: that step 3
produces no SmartScreen prompt.

## Out of scope

- **Delta packages.** Squirrel supports them, but generating one needs the *previous*
  release's feed at build time (`remoteReleases` on the maker), and with GitHub Releases
  that URL contains the previous tag — which changes every release and cannot be a static
  value in `package.json`. Worth revisiting; not part of this.
- **macOS.** Squirrel.Mac validates the code signature, and this project signs nothing.
  That is a certificate problem, not a code problem.
- **Linux.** The existing `apt` flow is well-suited to a keyboard-only writerdeck with no
  polkit agent, which is more than can be said for any off-the-shelf alternative.
- **Automatic or background checking.** See the decisions above.
