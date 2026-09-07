# Driven tests — against the packaged app, not the source

Everything in `test/*.test.js` runs against the source tree or the built bundle, in Node, with
jsdom. Nothing in it runs with `contextIsolation` actually on, in a real Chromium, out of a real
package. These scripts do.

**They are not part of `npm test`, on purpose.** `npm test` globs `test/*.test.js`, which does not
match this subdirectory; and `packagerConfig.ignore` already excludes `^/test($|/)`, so none of it
ships. They need a packaged build, they open a real window, and they take about a minute — none of
which belongs in a suite you run on every change.

## Why they exist

A green suite has failed to predict a working artifact five times in this project:

1. the zstd `.deb` — installed nowhere but the build machine;
2. the untested renderer bundle — deleting it left the suite green;
3. the close/finish guard;
4. `index.js` not parsing — it requires `electron` on line 1, so nothing in the suite loads it;
5. the bundle's own output format at Phase 9b — esbuild's CJS output left a bare top-level
   `module.exports`, which worked only because `nodeIntegration` put a `module` in the page.

Four of the five were findable only against a packaged build. That is the whole argument.

## Running them

```bash
npm run package && node test/driven/drive.js
```

`drive.js` finds the app itself: `out/warewoolf-<platform>-<arch>/…` for the host, then the usual
Linux install locations. Override it when you want a specific artifact — and on the Pi you do,
because the thing worth testing there is what the `.deb` installed, not what `out/` happens to hold:

```bash
WAREWOOLF_EXE=/opt/WareWoolf/warewoolf node test/driven/drive.js
```

Exit code is 0 only if every check passed. Full detail, including the checks that passed, lands in
`test/driven/results.json`.

```bash
node test/driven/sandbox-probe.js
```

Reads the renderer's actual posture back off a running build — what `webPreferences` asked for
against what `app.getAppMetrics()` reports. See the Phase 9b write-up in
`docs/upgrade-and-isolation-plan.md` for why "requested" and "effective" are not the same question,
and why the sandbox decision is gated on this answering correctly on the Pi.

## What `drive.js` covers

33 checks, from a clean `userData` directory every run — which matters, because
`loadInitialProject()`'s materialize-the-bundled-example branch only runs on a first launch.

- **The isolation itself.** No `require`/`module`/`process`/`Buffer`/`__dirname` in the page;
  `window.warewoolf` has exactly `invoke`/`on`/`off`; no `ipcRenderer`, no `electron`; and a
  `Function`-constructor escape into a foreign realm finds no `require` either.
- **Startup.** The bundled Frankenstein example opens with its 29 chapters, materialized into
  `userData` rather than opened read-only from the install directory, with no failure popup.
- **Save.** Text typed through Chromium's own input pipeline lands in `Quick Start.txt` on disk
  after File > Save, and the project file is rewritten as valid JSON.
- **Groups E/G/H/I/J.** File Manager over a real directory, the real 946KB dictionary across IPC,
  `writeTextFile`/`writeBinaryFile`/`buildEpub`/`archiveProject` landing on disk, and a credential
  sealed and described without the plaintext ever coming back.
- **`.docx` export, through the real UI.** Exporting the active chapter to `.docx` produces a real
  file on disk that opens as a zip with real chapter text inside — the check added for the Phase 9c
  regression where `saveDocx`'s `docx.Packer.toBuffer()` needed the Node `Buffer` global that a
  contextIsolated, `--platform=browser` renderer does not have. `test/*.test.js` runs this module in
  plain Node, where `Buffer` exists, so no unit test can tell a working export from a broken one;
  this is the only layer that runs it with `Buffer` actually absent.
- **Rule 5.** A `PlatformError`'s `code` *and* `details` crossing real Electron IPC, and — end to
  end through the app's own facade — a deleted chapter file surfacing in the error log as a
  `PlatformError` rather than a flattened `Error`.
- **Events.** Both menu-channel shapes, sent from the main process the way a menu click sends them.
- **Silence.** An empty error log and no uncaught renderer exceptions throughout.

## Two traps worth knowing before you edit `checks.js`

**Type through `Input.insertText`, never `editorQuill.insertText()`.** A Quill API insert arrives
with source `'api'`, which the app's change tracking deliberately ignores, so it leaves
`hasUnsavedChanges` false and File > Save writes nothing. The check passes trivially and proves
nothing. Chromium's input pipeline arrives as source `'user'`, like a keystroke.

**Do not compute an expected path with Node's `path`.** The renderer composes with `/` on every
host (`src/components/controllers/path-utils.js`); `path.join` rewrites that to `\` on Windows. A
test written with `path.join` agrees with the code on both platforms while pinning two different
answers. `fwd()` at the top of `checks.js` is there for this.

Also: `window.warewoolf.invoke()` is the *raw* bridge, below `platform-ipc.js`. A failing command
resolves with an error **envelope** there rather than throwing — the throwing happens one layer up.
That is not a bug, and a check that expects a rejection from `invoke()` is testing the wrong layer.

## Dependencies

None. `cdp.js` is about eighty lines over Node 22's global `WebSocket`.
