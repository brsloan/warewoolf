# Native Command Inventory

Derived from every Node/Electron call site in the renderer as of `340d067`.
Line references re-verified against `569cba4`.

**Phase 1 has since turned this into executable form.**
`src/components/controllers/platform.js` is now the authoritative contract — 61
commands and 36 events, with the shapes below — and this document is its prose
companion. Where the two disagree, the file wins; the three places they disagreed
at the end of Phase 1 are corrected here and marked **(corrected in Phase 1)**.

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

### Events (main → renderer) — **(corrected in Phase 1)**

This document originally named one event. There are **36**:
`file-opened-from-outside-warewoolf` (`render.js:1163`) plus the 35 menu channels
dispatched by the loop at `render.js:1151-1158` and sent from `index.js` (`new-project-clicked`,
`open-clicked`, `save-clicked` and the rest). They are not commands, but they
cross the same boundary, and every one of them has to be carried through the
preload bridge in Phase 9 or the menu silently stops working — no error, just a
menu item that does nothing.

`platform.on(event, handler)` validates the name against the list and returns an
unsubscribe function, so a typo fails at subscribe time rather than becoming a
dead menu item. The list holds the **literal** channel names `index.js` sends on,
since the ipc backing passes them straight to `ipcRenderer.on()` — Phase 1 tidied
one of them to `file-opened-from-outside` and got it wrong, which a test now
prevents by cross-checking the list against `index.js`.

---

## B. Project lifecycle

`components/models/project.js`

| Command | Replaces |
|---|---|
| `openProject(path)` | `readFileSync` + `JSON.parse` (`project.js:49`) |
| `saveProject(project)` | `writeFileSync` (`project.js:136`, `:251`) |
| `saveProjectAs(project, newDir, newFilename)` | the `mkdirSync`/`copyFileSync` sequence (`project.js:183-195`) |
| `verifyProjectFiles(project)` → missing chapter filenames | `existsSync` loop (`project.js:290`); also `missing-pups_display.js:189,222,289,322` |
| `materializeBundledProject(bundledDir, writableDir, filename)` → `{ path, writable }` | `copyExampleToUserData()` (`render.js:91-103`), called for the Frankenstein example only (`render.js:78`) |

`saveProjectAs` is six filesystem operations that must succeed or fail together.
It is one command, not six bridge calls.

`materializeBundledProject` exists because the Frankenstein example lives inside
the read-only install directory, so editing it in place fails with EACCES. It
copies to userData on first open and returns the writable path, falling back to
the read-only original if even that copy fails.

It returns `{ path, writable }` rather than a bare path, which closes the open
finding in the plan doc: today that fallback silently restores the original bug,
because the caller gets a read-only path it cannot tell apart from a writable
one and every later save dies with EACCES in silence. With the flag, the caller
sets `project.isReadOnly` and the example behaves like the Help doc — Ctrl+S
offers Save As instead of failing into the log.

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
| `saveChapterAtomic({projectDir, chapsDir, oldFilename, title, mdfc, notesMdfc})` → `{filename, notesFilename, notesError}` | the rename → write → restore-on-failure dance at `chapter.js:134-165` |
| `deleteChapterFiles(projectDir, chapsDir, filename)` | `chapter.js:47-50` (chapter + notes) |
| `loadChapterNotes(...)` / `saveChapterNotes(...)` | `chapter.js:187-188`, `:205` |

`saveChapterAtomic` is the strongest argument in this document for domain-level
commands. Today it is five ordered `fs` calls in the renderer implementing a
rollback by hand. In Rust it is one function with a real error type, and the
renderer cannot get the ordering wrong because the ordering is no longer its
concern.

**(corrected in Phase 1)** The signature published here was
`(projectDir, chapsDir, oldFilename, newFilename, mdfc)`, and it was wrong in a
way worth recording. Taking `newFilename` as an *input* means the renderer got it
from a separate `findAvailableChapterFilename` call — which splits the transaction
in two and opens a race between the name being found free and the write happening.
So that command is gone from this group: the allocation loop
(`chapter.js:216-229`) lives inside `saveChapterAtomic`, which takes the chapter's
**title** and returns the filename it actually used.

Three properties of the current sequence are load-bearing and easy to lose:

1. **The old file is stashed before the new name is allocated.** Allocating first
   finds the chapter's own file sitting under the name it wants and appends `_2`,
   so every save of an unchanged title renames the file and strands the previous
   one. This is a one-line reordering away at all times, and it is silent.
2. **The stash is deleted last**, after the notes are dealt with, so the previous
   contents survive until everything else has succeeded. The original deletes it
   before the notes rename; both orderings are correct, and the later one is
   strictly safer.
3. **A failed rollback is a different outcome from a successful one.** If the
   write fails *and* the restore fails, the chapter has no file on disk at all
   and the caller must keep `hasUnsavedChanges` set. There are three outcomes,
   not two, which is why the command rejects with `rolledBack` on the error
   rather than returning a boolean.

Notes are handled inside the same call — they have to be, because their filename
is derived from the chapter's and a separate command leaves a window where they
sit under the old name. But the chapter's own file is the transaction: a notes
failure comes back as `notesError` and never fails a chapter that was already
written. That is reported rather than swallowed, which is what `saveNotesFile`
does today (`chapter.js:210-212`).

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

**(corrected in Phase 1)** This document proposed four commands, one of them
`getCredential(service)` returning the plaintext. Both numbers were wrong, and the
`getCredential` entry was wrong in kind rather than in detail.

**`getCredential` does not exist.** Today the saved password *is* read into the
renderer — `credentialStore.getPassword()` at `email-doc_display.js:14` and
`error-log_display.js:51` — and written straight into an `<input type=password>`
value (`:46` and `:52`). Under `contextIsolation` that is a plaintext credential
living in the DOM of a webview, which is the single thing this exercise exists to
prevent. Keeping the command would have carried the leak across the boundary
intact and called it a fix.

It is not needed, because **the thing that consumes the password is also native.**
`sendEmail` (group K) takes either a literal the writer just typed or the sentinel
`platform.SAVED_SECRET`, and resolves the sentinel on the far side. The resolver
is deliberately not a command, so it is unreachable through the facade at all.

This makes the UI *simpler*. The "did the writer type a new password?" check at
`email-doc_display.js:143` currently compares the field against a plaintext the
dialog had to fetch first; it becomes `value !== SAVED_SECRET`, which needs
nothing fetched.

Seven commands, and the renderer never touches a key or a secret:

| Command | Replaces |
|---|---|
| `isSecureStorageAvailable()` | `secure-storage.js:14` (`sendSync`) |
| `describeCredential(service)` → `{hasPassword, backend, locked, secureStorageAvailable}` | `credential-store.js:41-51`; everything the dialogs draw from, and the only thing they learn |
| `storeCredential(service, secret, passphrase?)` → `{backend}` | `credential-store.js:72-125` + the `crypto.js` encrypt path |
| `unlockCredential(service, passphrase)` → boolean | `credential-store.js:128-148`. A wrong passphrase is an ordinary `false`, not an error |
| `lockCredential(service)` | nothing — see below |
| `clearCredentials(service)` | `credential-store.js:154-155` |
| `migrateLegacyCredential(service, legacyBlob)` → `{migrated}` | `credential-store.js:168-181` + `crypto.js:80-93` |

Two of these have no equivalent today and are easy to miss:

- **`lockCredential`** exists because the passphrase-derived session key currently
  lives in a renderer closure (`credential-store.js:27`) that dies with the
  window. Once it lives natively, something has to end its life explicitly.
  (In the node backing it is exactly that: the store instance is discarded, and
  the key has nowhere else to be.)
- **`migrateLegacyCredential`** takes the blob and returns only whether something
  moved. The decrypt-and-reseal happens entirely on the native side, so the
  recovered plaintext never crosses. Clearing `userSettings.senderPass`
  afterward stays with the caller, which owns `user-settings.json`.

The existing `secure-storage-encrypt` / `-decrypt` IPC pair (`index.js:545`,
`:554`) disappears into these — it is an implementation detail of the store, not
an API. Under Tauri this maps to `keyring-rs`, plus the availability-detection
logic already written at `index.js:517-539`, which is sound and should carry
over as-is. The `service` argument is in the contract for that port: `keyring-rs`
is service-keyed, and only `email` exists today.

---

## K. Network and hardware

Everything here is already out-of-process work stuck in the renderer.

| Command | Replaces | Tauri target |
|---|---|---|
| `checkForUpdate()` | `https.request` (`updates.js:40`) | `tauri-plugin-updater`, or `reqwest` |
| `downloadUpdate(url, destPath)` + progress event | `updates.js:185-252` | same |
| `installUpdate(path)` | `spawn('sudo', ['-S','apt','install'])` (`updates.js:259`) | same |
| `sendEmail({service, sender, secret, receiver, attachments})` | `nodemailer` (`email-doc.js:190`) | `lettre` |
| `wifiListNetworks()` / `wifiConnect(ssid, psk)` / `wifiGetAddress()` | `nmcli` and `hostname -I` spawns (`wifi-manager.js:13,62,91`) | `Command` or D-Bus |
| `getBatteryCapacity()` | `/sys/class/power_supply` reads + `cat` spawn (`battery-monitor.js:56,73`) | sysfs read, or the `battery` crate |

`sendEmail`'s `secret` is either a literal the writer just typed or
`platform.SAVED_SECRET`, resolved natively — see group J. A typed password still
crosses, outbound, once; that is unavoidable, since they typed it into the DOM.
Nothing ever crosses inbound.

`email-doc.js` also writes and unlinks temp files around `os.tmpdir()`
(`:119-135`, `:147`, `:180`). Fold that into `sendEmail` — the renderer should
hand over content and never learn a temp path.

---

## Summary

**61 commands and 36 events**, as declared in `platform.js`. This document
originally estimated "~47" from its own tables; the real count came out of writing
the contract down, mostly from group J growing and from load/save pairs listed on
one row being two commands each. Per group: A 7, B 5, C 6, D 8, E 7, F 3, G 4,
H 3, I 3, J 7, K 8.

By disposition:

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
   `require`s `fs`. `src/index.js:54-59` (the `webPreferences` block — this
   pointed at `:45-47` until Phase 1 re-verified it).
