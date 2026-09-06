# Native Command Inventory

Derived from every Node/Electron call site in the renderer as of `340d067`.

This is the API surface that must exist between the UI and the OS. It serves two
purposes at once:

1. It is the contract for a `contextIsolation: true` preload bridge.
2. It is the `#[tauri::command]` list for a future Tauri port.

The commands are written at **domain level**, not filesystem level, deliberately.
A bridge that exposes `writeFile(path, data)` is a renaming of the current
problem: the renderer still composes paths, still owns transactional ordering,
and still holds an arbitrary-write primitive. Neither the security fix nor the
Rust port gets easier. The commands below take project/chapter identities and
return finished results.

## Current state

| Layer | Node-free | Total |
|---|---|---|
| `components/views/` | 29 | 31 |
| `components/controllers/` | 18 | 36 |

The only views that reach the OS directly are `about_display.js` and
`missing-pups_display.js`; both should route through commands below and join the
node-free set.

- 106 synchronous `fs.*Sync` calls across 18 renderer files.
- 9 `ipcMain` handlers exist today; 5 of the renderer's IPC calls are `sendSync`.
- Renderer-side Node dependencies: `fs`, `path`, `os`, `crypto`, `https`,
  `child_process`, `archiver`, `unzipper`, `nodemailer`.

---

## A. Environment and shell

Mostly already IPC. Small, and the first group to move.

| Command | Replaces | Notes |
|---|---|---|
| `getAppPaths()` | `get-directories` (`index.js:490`) | userData, home, temp, docs, app, downloads. Currently `sendSync` at `render.js:4` — module-load-time and synchronous, so this one blocks the whole async conversion. Do it first. |
| `getPlatform()` | `process.platform` / `process.arch` (`updates.js:117-130`, `about_display.js:75`) | Returns `{ platform, arch }`. |
| `getFileRequestedOnOpen()` | `get-file-requested-on-open` (`index.js:501`) | Also `sendSync`, `render.js:20`. |
| `setTheme(mode)` | `set-dark-mode` (`index.js:505`) | Tauri: window theme API. |
| `showAppMenu()` | `show-menu` (`index.js:563`) | `keybindings.js:87`. |
| `confirmExit()` | `exit-app-confirmed` (`index.js:480`) | `render.js:846,849,865`. |
| `notifyRendererReady()` | `renderer-ready` (`index.js:486`) | `render.js:1126`. Fire-and-forget startup signal; the only command here with no return value. |

Event (main → renderer): `onFileOpenedFromOutside` (`render.js:1102`).

---

## B. Project lifecycle

`components/models/project.js`

| Command | Replaces |
|---|---|
| `openProject(path)` | `readFileSync` + `JSON.parse` (`project.js:49`) |
| `saveProject(project)` | `writeFileSync` (`project.js:136`, `:251`) |
| `saveProjectAs(project, newDir, newFilename)` | the `mkdirSync`/`copyFileSync` sequence (`project.js:183-195`) |
| `verifyProjectFiles(project)` → missing chapter filenames | `existsSync` loop (`project.js:290`); also `missing-pups_display.js:189,222,289,322` |
| `materializeBundledProject(bundledDir, writableDir)` → path to open | `copyExampleToUserData()` (`render.js:91-103`), called for the Frankenstein example only (`render.js:78`) |

`saveProjectAs` is six filesystem operations that must succeed or fail together.
It is one command, not six bridge calls.

`materializeBundledProject` exists because the Frankenstein example lives inside
the read-only install directory, so editing it in place fails with EACCES. It
copies to userData on first open and returns the writable path, falling back to
the read-only original if even that copy fails.

The Help doc deliberately does **not** use it: it is reference material that has
to describe the installed version, so it is opened in place and the project is
marked `isReadOnly` (`render.js:822-837`). That flag is renderer-side policy, not
a native command — `saveFile()` refuses to write while it is set
(`project.js:107-115`), an explicit save routes to Save As, and autosave skips.
Nothing new crosses the boundary for it.

Under Tauri the bundled originals become resource-directory reads, which is a
different API from ordinary file access — worth noting now so it is not
discovered late. The read-only case matters there too: a Tauri resource path is
not writable at all, so the same distinction has to survive the port.

---

## C. Chapter I/O

`components/models/chapter.js`

| Command | Replaces |
|---|---|
| `loadChapter(projectDir, chapsDir, filename)` → mdfc text | `chapter.js:73` |
| `saveChapter(projectDir, chapsDir, filename, mdfc)` | `chapter.js:112` |
| `saveChapterAtomic(projectDir, chapsDir, oldFilename, newFilename, mdfc)` | the rename → write → restore-on-failure dance at `chapter.js:134-165` |
| `deleteChapterFiles(projectDir, chapsDir, filename)` | `chapter.js:47-50` (chapter + notes) |
| `loadChapterNotes(...)` / `saveChapterNotes(...)` | `chapter.js:187-188`, `:205` |
| `findAvailableChapterFilename(projectDir, chapsDir, base)` | `existsSync` loop at `chapter.js:223` |

`saveChapterAtomic` is the strongest argument in this document for domain-level
commands. Today it is five ordered `fs` calls in the renderer implementing a
rollback by hand. In Rust it is one function with a real error type, and the
renderer cannot get the ordering wrong because the ordering is no longer its
concern.

---

## D. Settings, corkboard, error log

| Command | Replaces |
|---|---|
| `loadUserSettings()` / `saveUserSettings(obj)` | `user-settings.js:73`, `:83-84` |
| `loadCorkboard(projectDir)` / `saveCorkboard(projectDir, cards)` | `corkboard.js:46-47`, `:61` |
| `logError(text)` | append + size rotation, `error-log.js:43-46` |
| `readErrorLog()` / `clearErrorLog()` | `error-log.js:61-62`, `:76-77` |
| `readLicenses()` | `about_display.js:123-124` |

`logError` is called from nearly every module. Making it async is the widest
blast radius of any single item here — worth converting on its own commit.

---

## E. Filesystem browser

`file-manager.js` + `file-dialog_display.js` implement a keyboard-driven in-app
file browser. That is a product feature (mouse-free operation), not an accident,
so this group stays deliberately generic — it is the documented exception to the
domain-level rule above.

| Command | Replaces |
|---|---|
| `listDirectory(path)` → `{name, isDirectory}[]` | `readdirSync` (`file-manager.js:140`, `backup-project.js:130`, `missing-pups_display.js:322`) |
| `pathExists(path)` | `file-manager.js:150`, and the boot checks at `render.js:67,71,73,77` |
| `statEntry(path)` | `file-manager.js:30` |
| `createDirectory(parent, name)` | `file-manager.js:106-107` |
| `moveEntry(source, dest)` | `file-manager.js:61`, `:96` — must keep the refuse-on-existing-destination guard at `:54-56` |
| `copyEntry(source, dest, recursive)` | `file-manager.js:11` |
| `deleteEntry(path, recursive)` | `file-manager.js:116-117`, `backup-project.js:120-121` |

Under Tauri these need an explicit FS scope. Since the user picks arbitrary
project locations, expect a runtime scope grant on directory selection rather
than a static allowlist.

---

## F. Import

| Command | Replaces |
|---|---|
| `readTextFile(path)` | `import.js:94`, `:156` (already async — these port cheaply) |
| `extractZip(zipPath, destPath)` | `file-manager.js:158-168` (`unzipper`) |
| `importDocx(path)` → `{ documentXml, footnotesXml }` | `docx-import.js:8`, `:22`, `:32-34` |

`unzipper` is Node-stream-only and has no browser path; under Tauri it becomes
the `zip` crate. Note that `importDocx` should return the XML *text*, not a temp
directory — the XML parsing in `docx-import.js` is pure string work and stays in
the webview.

---

## G. Export and compile

| Command | Replaces |
|---|---|
| `ensureDirectory(path)` | `export.js:43-44` |
| `writeTextFile(path, contents)` | `export.js:136,157,161,165`; `compile.js:70,80,90,100` |
| `writeBinaryFile(path, bytes)` | `delta-to-docx.js:10` (docx buffer) |
| `buildEpub(filepath, htmlChapters, meta)` | `epub.js:18-56` (`archiver` + `crypto.randomUUID`) |

`docx` (npm) has a browser build (`Packer.toBlob`), so the generation logic in
`delta-to-docx.js` stays in the webview and only the write crosses the boundary.
`archiver` does not — `buildEpub` takes the assembled HTML and zips it natively.

---

## H. Backup

| Command | Replaces |
|---|---|
| `archiveProject(projectDir, destDir, name)` → archive filename | `backup-project.js:66-79` (`archiver`) |
| `listBackups(dir)` | `backup-project.js:130` |
| `pruneBackups(paths)` | `backup-project.js:120-121` |

---

## I. Spellcheck

`nspell` is pure JS and stays in the webview. Only dictionary loading crosses.

| Command | Replaces |
|---|---|
| `loadDictionary()` → `{ aff, dic }` | `spellcheck.js:19-20` |
| `loadPersonalDictionary()` → `string[]` | `spellcheck.js:22`, `:93` |
| `savePersonalDictionary(words)` | `spellcheck.js:105`; folds in the bootstrap at `:38-44` |

---

## J. Credentials

The biggest simplification available. Today `crypto.js` (scrypt, AES-GCM) and
`credential-store.js` run key derivation and hold key material **in the
renderer**, and apply `chmodSync(0o600)` from there too.

Collapse the group to four commands, and the renderer never touches a key:

| Command | Replaces |
|---|---|
| `isSecureStorageAvailable()` | `secure-storage.js:14` (`sendSync`) |
| `storeCredential(service, secret)` | `credential-store.js:203-248` + the `crypto.js` encrypt path |
| `getCredential(service)` | same, decrypt path (incl. the legacy-format fallback at `crypto.js:85`) |
| `clearCredentials()` | `credential-store.js:154-155` |

The existing `secure-storage-encrypt` / `-decrypt` IPC pair (`index.js:545`,
`:554`) disappears into these — it is an implementation detail of the store, not
an API. Under Tauri this maps to `keyring-rs`, plus the availability-detection
logic already written at `index.js:517-539`, which is sound and should carry
over as-is.

---

## K. Network and hardware

Everything here is already out-of-process work stuck in the renderer.

| Command | Replaces | Tauri target |
|---|---|---|
| `checkForUpdate()` | `https.request` (`updates.js:40`) | `tauri-plugin-updater`, or `reqwest` |
| `downloadUpdate(url, destPath)` + progress event | `updates.js:185-252` | same |
| `installUpdate(path)` | `spawn('sudo', ['-S','apt','install'])` (`updates.js:259`) | same |
| `sendEmail(config, message, attachments)` | `nodemailer` (`email-doc.js:190`) | `lettre` |
| `wifiListNetworks()` / `wifiConnect(ssid, psk)` / `wifiGetAddress()` | `nmcli` and `hostname -I` spawns (`wifi-manager.js:13,62,91`) | `Command` or D-Bus |
| `getBatteryCapacity()` | `/sys/class/power_supply` reads + `cat` spawn (`battery-monitor.js:56,73`) | sysfs read, or the `battery` crate |

`email-doc.js` also writes and unlinks temp files around `os.tmpdir()`
(`:119-135`, `:147`, `:180`). Fold that into `sendEmail` — the renderer should
hand over content and never learn a temp path.

---

## Summary

**~47 commands.** By disposition:

- **Stays JS in the webview, no command needed** — `markdownFic`, `mdfc-to-html`,
  `mdfc-to-md`, `quill-utils`, `wordcount`, `renumber-chapters`, `findreplace`,
  the `convert-*` modules, `delta-to-docx` generation, `nspell`, and all 28
  node-free views. This is the bulk of the codebase, and it ports untouched.
- **Becomes a Rust command** — groups B, C, D, E, F, G, H, I.
- **Becomes a Tauri plugin or crate, largely rewritten** — groups J and K.

## Suggested order

Each step ships on its own; the bridge can coexist with `nodeIntegration: true`
until the last one.

1. **Group A**, especially `getAppPaths`. It is `sendSync` at module load in
   `render.js:4`, so nothing else can go async cleanly until it does.
2. **`logError`** (group D). Widest call graph, least logic — good calibration
   for how invasive the async conversion really is.
3. **Groups B and C** — the core, and the best-tested (`test/render.test.js` is
   1,104 lines). Highest value, green tests the whole way.
4. **Rest of D, then I and E** — settings, spellcheck, file browser.
5. **Groups F, G, H** — import, export, backup.
6. **Group J** — credentials, with the collapse described above.
7. **Group K** — updates, email, wifi, battery.
8. Flip `contextIsolation: true` and drop `nodeIntegration` once nothing
   `require`s `fs`. `src/index.js:45-47`.
