# Native Command Inventory

Derived from every Node/Electron call site in the renderer as of `340d067`.
Line references re-verified against `569cba4`, and again for groups B and C
before Phase 4, for groups D/E/I before Phase 5, for groups F/G/H before
Phase 6, and for group J before Phase 7.

**Phase 1 has since turned this into executable form.**
`src/components/controllers/platform.js` is now the authoritative contract — 65
commands and 36 events, with the shapes below — and this document is its prose
companion. Where the two disagree, the file wins; the three places they disagreed
at the end of Phase 1 are corrected here and marked **(corrected in Phase 1)**,
the two Phase 4 found in group B are marked **(corrected in Phase 4)**, the one
Phase 5 found in group D is marked **(corrected in Phase 5)**, the one
Phase 6 found in group G — `buildEpub`'s signature — is marked
**(corrected in Phase 6)**, the two Phase 7 found in group J are marked
**(corrected in Phase 7)**, the four Phase 8 found in group K are marked
**(corrected in Phase 8)**, and the two Phase 9c found in group K — `downloadUpdate`'s
`destPath` and what `installUpdate`'s vouch actually records — are marked
**(corrected in Phase 9c)**.

This is the API surface that must exist between the UI and the OS. It serves two
purposes at once:

1. It is the contract for a `contextIsolation: true` preload bridge.
2. It is the `#[tauri::command]` list for a future Tauri port.

**As of Phase 9a the first of those is built.** `src/preload.js` publishes exactly
`invoke`/`on`/`off` as `window.warewoolf`, validating both names against the
`COMMANDS` and `EVENTS` tables in `platform.js` before anything crosses;
`src/components/controllers/platform-host.js` is the main-process half;
`src/index.js` registers one `ipcMain.handle` per entry in `COMMANDS`, from the
table itself. Every command in this document now crosses a process boundary in
the running app, and the node backing runs in the main process.

**As of Phase 9b the flag is flipped.** `contextIsolation: true`,
`nodeIntegration` gone, `--platform=browser`. `require`, `module`, `process`,
`Buffer` and `__dirname` are all `undefined` in the page, verified on a packaged
build, and `window.warewoolf` is the only thing that reaches the main process. The
renderer is now untrusted in the sense the whole exercise was for — which also
means every command below is an interface offered to untrusted code, and the two
places that matters most are group E (generic by design, see its own note) and
group K's `installUpdate`, the only command that escalates privilege. 9b's
security review found that command's guard forgeable; **Phase 9c fixed it**, and
in doing so changed `downloadUpdate`'s contract. See group K below and the Phase
9c write-up in `upgrade-and-isolation-plan.md`.

`sandbox` is still `false`, but it is an explicit line now rather than a
consequence of `nodeIntegration: true`. Turning it on passes the same driven
checks on Windows; it is gated on the Pi pass, for the reasons recorded there.

The commands are written at **domain level**, not filesystem level, deliberately.
A bridge that exposes `writeFile(path, data)` is a renaming of the current
problem: the renderer still composes paths, still owns transactional ordering,
and still holds an arbitrary-write primitive. Neither the security fix nor the
Rust port gets easier. The commands below take project/chapter identities and
return finished results.

## Current state

The table below is the state this document was written against, kept for what it
records about the size of the job. **After Phase 9a none of it is true any more**,
which is the point:

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

**Where it stands after Phase 9b**, read off the built `render.bundle.js` rather
than off the source tree:

- No `fs.*Sync` calls anywhere in the renderer. Zero `sendSync`. 65
  `ipcMain.handle` registrations, generated from `COMMANDS`.
- **Renderer-side Node dependencies: none.** Not "only builtins" — nothing is
  external at all, not a builtin, not `electron`, not a `node_modules` package. A
  test asserts the empty list, and `--platform=browser` makes a survivor a build
  error rather than a silent external. 9a's last two went in 9b: `fs`
  (`render.js`'s four `existsSync` checks) became `pathExists`, and `path` became
  `path-utils.js` — local string helpers extracted from the ones
  `file-manager.js` already had, composing with `/` on every host rather than with
  the host separator.
- `crypto.js`, `credential-store.js` and `platform-node.js` left the bundle in 9a.
  `secure-storage.js` is deleted outright, along with the three
  `secure-storage-*` `sendSync` channels it drove — group J predicted that
  ("the existing `secure-storage-encrypt` / `-decrypt` IPC pair disappears into
  these"), and this is where it happened.
- **`crypto.js` and `credential-store.js` are still live code, in the main
  process.** 9a recorded them as "already gone", which is true of the renderer and
  easy to misread as unused: `platform-node.js:37-38` requires both, and group J's
  `storeCredential`/`describeCredential`/`unlockCredential` (`:1069`) and
  `migrateLegacyCredential` (`:1169`) are built on them. Deleting them was
  considered in 9b and rejected on that evidence. Leaving the renderer relocated
  them; it did not make them dead.

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
since the ipc backing passes them straight through — Phase 1 tidied one of them to
`file-opened-from-outside` and got it wrong, which a test now prevents by
cross-checking the list against `index.js`.

**(Phase 9a) All 36 cross the bridge, and the handler's shape changed.** A handler
is called with the event's **payload arguments only**. `preload.js` drops the
`IpcRendererEvent` that used to arrive first: its `sender` is a live handle back
into the ipc machinery, and forwarding it would hand the page exactly what not
exposing `ipcRenderer` took away. So `render.js`'s menu loop lost its
`function(e)` and its `slice(arguments, 1)`, and the file-open handler takes
`fPath` directly. Validation now happens twice — in `platform.js` at the facade
and again in `preload.js` before `ipcRenderer.on` — because preload is the guard
the renderer cannot get past, and the facade is the one that gives a caller a
`PlatformError` with a code instead of a bare throw.

---

## B. Project lifecycle

`components/models/project.js`

| Command | Replaces |
|---|---|
| `openProject(path)` | `readFileSync` + `JSON.parse` (`project.js:49`) |
| `saveProject(project)` | `writeFileSync` (`project.js:136`, `:251`) |
| `saveProjectAs(project, newDir, newFilename)` | the `mkdirSync`/`copyFileSync` sequence (`project.js:183-195`) |
| `verifyProjectFiles(project)` → missing chapter filenames | `existsSync` loop (`project.js:290`); also `missing-pups_display.js:189,222,289,322` |
| `materializeBundledProject(bundledDir, writableDir, filename)` → `{ path, writable }` | `copyExampleToUserData()` (`render.js:178-190` — **corrected in Phase 4**, was `:91-103`; Phase 2 moved it), called for the Frankenstein example only |

`saveProjectAs` is six filesystem operations that must succeed or fail together.
It is one command, not six bridge calls.

**(corrected in Phase 4)** Those six are the *path parse, the two mkdirs and the
copy loop* — not the `.woolf` write. The signature published in `platform.js`
took the project's `contents` as well, and it cannot, for an ordering reason
rather than a preference:

Save As has to write out every chapter with unsaved changes; those writes go
through group C; group C **allocates** the filename. So the filenames the
`.woolf` must list are not known until after those writes have run, and those
writes cannot run until the new chapters directory exists. The order is forced:

1. `saveProjectAs` — parse the target path, make the project and chapters
   directories, copy every chapter file that already exists across.
2. Group C — save the dirty chapters, into the new location.
3. `saveProject` — write the `.woolf`, now that every filename in it is final.

Passing `contents` into step 1 would mean writing a `.woolf` naming the
*pre-save* filenames and then rewriting it. A failed rewrite would leave a
project file pointing at chapter files whose names had since changed — worse
than no file at all, since `saveChapterAtomic` deletes the old one on success.

Nothing about the transaction is lost: the operations that must succeed or fail
together are still one command. `copyOnly` was dropped from the signature at the
same time, for a much simpler reason — Save a Copy does identical work on disk,
and differs only in whether the *renderer* repoints its own chapters afterward.

`saveProjectAs` returns `chapterFilenames` as an array parallel to the one it was
given, with a `null` holding the slot of anything not copied, plus `failed` for
the ones that were meant to copy and could not.

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
marked `isReadOnly` (`openHelpDoc()`, `render.js:1000-1014` as of Phase 4). That
flag is renderer-side policy, not a native command — `saveFile()` refuses to
write while it is set (`project.js:107-115` before the conversion), an explicit
save routes to Save As, and autosave skips. Nothing new crosses the boundary for
it.

**(Phase 4 decided where that guard lives, deliberately.)** It stays exactly
where it was: at the top of `project.saveFile()`, *above* the chapter saves
rather than merely above the project-file write. A project opened out of a
read-only install directory cannot have its chapter files written either, and
each of those would be a separate swallowed `EACCES`. `PERMISSION_DENIED` from
the platform is the backstop for when the flag is wrong, not a replacement for
it — the flag decides what the UI offers.

Two ordering bugs around it surfaced only when the tests for it were written,
both in the least obvious write path in this group — `convertLegacyProject()`,
which runs on every `setProject()` and ends in an unconditional
`project.saveFile()`:

- **`setProject()` takes the read-only flag as an argument now.** `loadFile()`
  clears the flag on every load, so a caller that opened a read-only copy and set
  the flag on the way back had already let `convertLegacyProject()` save over it.
  That is how the bundled example, opened out of the install directory when its
  copy to userData fails, was written to before anything knew it was read-only.
- **`convertLegacyProject()` returns early for a read-only project.** Its two
  conversions write through `chapter.js` rather than through
  `project.saveFile()`, so the guard above does not cover them: a legacy project
  opened read-only would attempt a write per legacy item, each one an `EACCES`
  swallowed into the log — and each one a write attempted against the installed
  application.

`openHelpDoc()` still loads and displays directly rather than going through
`setProject(path, true)`, even though that now takes the flag: `setProject()`
also runs the missing-chapters repair screen, which for a document the reader
cannot edit would mean offering to rewrite a file in the install directory.

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

**(Phase 4 went one step further than "reported".)** The old `saveFile()` cleared
`hasUnsavedChanges` *before* `saveNotesFile()` ran, so notes that never reached
disk left the chapter looking saved and were dropped on exit without a prompt.
A `notesError` now leaves the chapter dirty with the notes still in memory, so
the reader is asked about them and the next save retries. The retry converges:
the chapter's filename no longer changes, so no rename is attempted and the
second pass comes back clean.

**After the conversion, `chapter.js` knows nothing about how a chapter is laid
out on disk.** The extension, the `-notes_` prefix and the stash name all live in
the backing; a test asserts none of the three literals appears in the model any
more, and that neither model requires `fs`, `path`, `os`, `crypto`,
`child_process` or `electron`. Phase 9 turns that from a property into a build
error; until then this is what holds it.

---

## D. Settings, corkboard, error log

| Command | Replaces |
|---|---|
| `loadUserSettings()` / `saveUserSettings(obj)` | `user-settings.js:73`, `:83-84` |
| `loadCorkboard(chaptersDir)` / `saveCorkboard(chaptersDir, contents)` | `corkboard.js:46-47`, `:61` |
| `logError(text)` | append + size rotation, `error-log.js:43-46` |
| `readErrorLog()` / `clearErrorLog()` | `error-log.js:61-62`, `:76-77` |
| `readLicenses()` | `about_display.js:123-124` |

`logError` is called from nearly every module. Making it async is the widest
blast radius of any single item here — worth converting on its own commit.

**(corrected in Phase 5)** `loadCorkboard`/`saveCorkboard` were published taking
a project directory and parsed `card[]`. Both were wrong, for the same reason
Phase 4 corrected `saveChapterAtomic` and `saveProjectAs`: the signature here was
a hypothesis read off the call site, not a specification. The corkboard file
lives beside the chapters, not the `.woolf`, so the argument is `chaptersDir`.
And taking/returning `card[]` would have moved `parseCardsString`/
`generateCardsString` — the marker-escaping logic for labels that collide with
`# ` or `[x] `/`[<digit>] ` — into the backing, which is exactly the class of
format-parsing work groups B and C keep out of it (`loadChapter`/`saveChapter`
cross raw text, not a parsed chapter, for the same reason). Both commands cross
raw text instead; `corkboard.js` parses it exactly as before, behind an `await`.

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

**(Phase 5 note)** `backup-project.js`'s own `readdirSync`/`rmSync` calls
(`:130`, `:120-121`) are *not* converted by this phase, despite appearing in the
table above — they back group H's own `listBackups`/`pruneBackups` (Phase 6),
which happen to do similar filesystem work but are domain-level backup commands,
not the generic browser. Phase 5 converted `file-manager.js` (the keyboard-driven
browser proper) and `missing-pups_display.js`'s own direct `fs` calls, which are
the same generic browsing operation applied to the missing-chapters repair
screen.

**`isDirectory` crosses as a plain boolean**, not a dirent's `isDirectory()`
method — a function cannot survive IPC/Tauri serialization. Every caller of
`listDirectory` (via `file-manager.js`'s `getFileList()`) reads `.isDirectory`
as a property now, not a call.

**`moveEntry` implements only one collision policy: refuse.** The renderer used
to have *two* — renaming refused an existing destination
(`file-manager.js:54-56`), cutting and pasting silently uniquified onto one
(`makeFilenameUniqueIfExists`). A single generic command can only carry one
rule, so `moveEntry` keeps the stricter one and rejects `ALREADY_EXISTS`; the
auto-uniquify policy `moveFiles` (cut/paste) wants is computed in
`file-manager.js` from `pathExists`/`statEntry` before calling `moveEntry`, the
same way `copyFiles` already built its own uniquified name. The refuse guard
itself is verified by mutation: removing its `fs.existsSync` check in
`platform-node.js` fails exactly the test written for it
(`renameFiles regression: refuses to overwrite...`) and nothing else.

---

## F. Import — **implemented in Phase 6**

| Command | Replaces |
|---|---|
| `readTextFile(path)` | `import.js:94`, `:156` (already async — these ported cheaply) |
| `extractZip(zipPath, destPath?)` → `{ path }` | `file-manager.js:200-224` (`unzipper`) — line references drifted from the `:158-168` this table originally cited; the function (`unzipProject`) had moved and grown by the time Phase 5 deferred it |
| `importDocx(path)` → `{ documentXml, footnotesXml }` | `docx-import.js:8`, `:22`, `:30-38` (`tempUnzipDocx`) |

`unzipper` is Node-stream-only and has no browser path; under Tauri it becomes
the `zip` crate. `importDocx` returns the XML *text*, not a temp directory — the
XML parsing in `docx-import.js` is pure string work and stays in the webview.

**The temp directory itself changed shape, not just location.** The old
`tempUnzipDocx` unzipped every docx to the same fixed
`sysDirectories.temp + '/docxguts'` and never removed it — residue from one
import could bleed into the next, and the directory grew without bound over a
session. The native `importDocx` unzips into its own `fs.mkdtempSync()`
directory instead and removes it again before resolving, whether the import
succeeded or failed (`finally{ cleanup(); }`). `sysDirectories` is no longer a
parameter of `docx-import.js`'s `importDocx()` at all — the native command owns
picking a temp location start to finish, which is what "the unzip destination
must not leak across the boundary" means in practice, not just "don't return a
path in the response object."

---

## G. Export and compile — **implemented in Phase 6**

| Command | Replaces |
|---|---|
| `ensureDirectory(path)` | `export.js:47-48` (drifted from `:43-44` — Phase 4's async conversion of `getTotalWordCount` shifted four lines) |
| `writeTextFile(path, contents)` | `export.js:146,167,171,175` (drifted from `:136,157,161,165`); `compile.js:75,85,95,105` (drifted from `:70,80,90,100`) |
| `writeBinaryFile(path, bytes)` | `delta-to-docx.js:9` (drifted from `:10`) |
| `buildEpub(filepath, entries)` | `epub.js:21-85` (`archiver`), replacing the whole `htmlChaptersToEpub` write path |

`docx` (npm) has a browser build (`Packer.toBlob`), so the generation logic in
`delta-to-docx.js` stays in the webview and only the write crosses the boundary.
`archiver` does not — `buildEpub` zips natively.

**(corrected in Phase 6)** `buildEpub`'s signature is corrected from what this
table originally proposed. It read `buildEpub(filepath, htmlChapters, meta)`, on
the theory that
the OPF/NCX/TOC generation (`getContentOpf`/`getTocNcx`/`getTocXhtml`/
`getChapterXhtmlPages`/`escapeXmlText`/etc., all in `epub.js`) would move
natively alongside the zipping. It cannot, for the same reason Phase 5 corrected
`loadCorkboard`/`saveCorkboard`: that generation is pure string work with no OS
dependency, and moving it into `platform-node.js` would duplicate roughly 250
lines of format logic into the backing for no reason `archiver` actually
requires. The command's own note already said the right thing — "the assembled
HTML crosses and the zipping happens natively" — the correction is realizing
that means the *assembled* content, not the raw chapters. `buildEpub` now takes
`entries: { name, content }[]`, every one of them already-generated text, and
does exactly one native thing: write them into a zip at `filepath`. The entry
literally named `"mimetype"` is stored uncompressed (a zip-container detail the
EPUB spec requires); every other entry is deflated. `epub.js` keeps every
generation/escaping function unchanged and assembles `entries` itself before
calling this — the same shape `loadChapter`/`saveChapter` already established
for keeping format logic out of the backing.

**`buildEpub` must resolve only once the write stream's `'close'` fires, not
archiver's `'finish'`.** `'finish'` only means archiver pushed its last bytes
into the pipe, not that `fs` flushed them to disk — resolving on it risks
handing back a truncated `.epub` that looks successful until a reader (or
`email-doc.js`, which attaches the result) opens it. This is the single most
load-bearing line in the implementation; see the Phase 6 write-up in
`upgrade-and-isolation-plan.md` for why it could not be verified by mutation on
this codebase's fast local filesystem.

---

## H. Backup — **implemented in Phase 6**

| Command | Replaces |
|---|---|
| `archiveProject(projectDir, chapsDir, filename, destDir)` → `{ filename, path }` | `backup-project.js:71-101` (`archiver`) — drifted from `:66-79`, which was `createBackupsDirectory` plus the start of `archiveProject`, not the whole function |
| `listBackups(directory)` | `backup-project.js:128-135` (`getFileList`) — drifted from `:130` |
| `pruneBackups(paths)` | `backup-project.js:118-126` (`deleteFile`) — drifted from `:120-121` |

**`archiveProject` allocates the timestamped archive name itself and returns
it**, the same reason `saveChapterAtomic` allocates a chapter's filename rather
than taking one.

**A real bug found and fixed during the conversion, not carried over:** the
original `archiveProject` listened on `archive.on('finish', ...)` rather than
the output write stream's `'close'`, the exact mistake `buildEpub` above exists
to avoid. It risked handing back a backup archive name before `fs` had actually
flushed the file to disk — a truncated backup that looks successful. The native
`archiveProject` listens on `'close'`, matching `buildEpub`. `email-doc.js`
calls `backup-project.js`'s `archiveProject(project, archiveDir, callback)`
directly (group K, Phase 8) and is untouched — that function keeps its
callback-style signature and now delegates to the native command internally.

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

The biggest simplification available. Before Phase 7 `crypto.js` (scrypt,
AES-GCM) and `credential-store.js` ran key derivation and held key material **in
the renderer**, and applied `chmodSync(0o600)` from there too. As of Phase 7
neither file is reachable from the renderer at all: `platform-node.js` drives
both, behind the seven commands below.

**(corrected in Phase 1)** This document proposed four commands, one of them
`getCredential(service)` returning the plaintext. Both numbers were wrong, and the
`getCredential` entry was wrong in kind rather than in detail.

**`getCredential` does not exist.** Before Phase 7 the saved password *was* read
into the renderer — `credentialStore.getPassword()` in `email-doc_display.js` and
`error-log_display.js` — and written straight into an `<input type=password>`
value. Under `contextIsolation` that is a plaintext credential living in the DOM
of a webview, which is the single thing this exercise exists to prevent. Keeping
the command would have carried the leak across the boundary intact and called it
a fix.

It is not needed, because **the thing that consumes the password is also native.**
`sendEmail` (group K) takes either a literal the writer just typed or the sentinel
`platform.SAVED_SECRET`, and resolves the sentinel on the far side. The resolver
is deliberately not a command, so it is unreachable through the facade at all.

This makes the UI *simpler*. The "did the writer type a new password?" check
compared the field against a plaintext the dialog had to fetch first; it is now
`value !== SAVED_SECRET`, which needs nothing fetched.

**Done in Phase 7, with `sendEmail` still outstanding.** Both dialogs put the
sentinel in the password field today. It travels untouched to `emailFile()`
(`email-doc.js`), which resolves it on the last line before `nodemailer` through
an injected `backing.resolveSecret` — not a command, and not reachable from a
`platform` instance, so `render.js` has to hand it over on purpose. That is the
one rule-6 violation left standing, deliberately and temporarily; Phase 8 turns
`emailFile()` into `sendEmail()` and deletes the seam. The saved password no
longer reaches the DOM, which is the part that could be fixed without `sendEmail`
and was.

Seven commands, and the renderer never touches a key or a secret:

| Command | Replaces |
|---|---|
| `isSecureStorageAvailable()` | `secure-storage.js:14` (`sendSync`) |
| `describeCredential(service)` → `{hasPassword, backend, locked, secureStorageAvailable}` | `credential-store.js:41-51`; everything the dialogs draw from, and the only thing they learn |
| `storeCredential(service, secret, passphrase?)` → `{backend}` | `credential-store.js:72-125` + the `crypto.js` encrypt path. **(corrected in Phase 7)** `secret` may be `SAVED_SECRET`, not only a literal — see below |
| `unlockCredential(service, passphrase)` → boolean | `credential-store.js:128-148`. A wrong passphrase is an ordinary `false`, not an error |
| `lockCredential(service)` | nothing — see below |
| `clearCredentials(service)` | `credential-store.js:154-155` |
| `migrateLegacyCredential(service, legacyBlob)` → `{recognized, migrated}` | `credential-store.js`'s `migrateLegacyPassword` + `crypto.js:80-93`. **(corrected in Phase 7)** two flags, not one — see below |

Two of these have no equivalent today and are easy to miss:

- **`lockCredential`** exists because the passphrase-derived session key currently
  lives in a renderer closure (`credential-store.js:27`) that dies with the
  window. Once it lives natively, something has to end its life explicitly.
  (In the node backing it is exactly that: the store instance is discarded, and
  the key has nowhere else to be.)
- **`migrateLegacyCredential`** takes the blob and returns only what the caller
  needs. The decrypt-and-reseal happens entirely on the native side, so the
  recovered plaintext never crosses. Clearing `userSettings.senderPass`
  afterward stays with the caller, which owns `user-settings.json`.

**(corrected in Phase 7)** Two corrections came out of actually calling these.

**`storeCredential` takes `SAVED_SECRET` as well.** Phase 1 identified
`sendEmail` as the place the UI names a secret it must not hold and stopped
there; it is not the only one. Re-protecting an already-saved password — the
writer unticking "Protect With Passphrase" without retyping it — has to re-seal
a plaintext the dialog does not have and must not have. Passing the sentinel
means "re-seal what is already stored, under whatever protection this call asks
for", resolved inside the backing. Without it the sentinel string is stored *as*
the password, silently and reporting success. It is refused with
`INVALID_ARGUMENT` when nothing is stored, and with `LOCKED` when the credential
is locked.

**`migrateLegacyCredential` returns `{recognized, migrated}`.** A single flag
collapsed two outcomes, and the caller needs both because clearing the settings
field is the caller's job. `recognized` — the blob was in the pre-2.2.2 format,
so the settings field is dead and should be cleared; this is what the old
`migrateLegacyPassword` returned. `migrated` — a password was actually recovered
and re-sealed. They differ for a legacy-shaped blob that decrypts to nothing,
which is what a 2.2.1 writer who ticked "remember" with an empty password field
has in their settings file. The old code cleared the field for them too; one
flag would have left a dead blob there to be retried on every launch forever,
with nothing ever saying so.

The existing `secure-storage-encrypt` / `-decrypt` IPC pair (`index.js:545`,
`:554`) disappears into these — it is an implementation detail of the store, not
an API. Under Tauri this maps to `keyring-rs`, plus the availability-detection
logic already written at `index.js:517-539`, which is sound and should carry
over as-is. The `service` argument is in the contract for that port: `keyring-rs`
is service-keyed, and only `email` exists today.

---

## K. Network and hardware — **implemented in Phase 8**

Everything here was already out-of-process work stuck in the renderer. Unlike
every group before it, none of these eight commands existed in
`platform-node.js` when Phase 8 started — Phase 1 declared them, but building
the implementations (not just wiring call sites to an existing one) was this
phase's own work, the first time that was true since Phase 1 itself.

| Command | Replaces | Tauri target |
|---|---|---|
| `checkForUpdate()` | `https.request` (`updates.js:40`) | `tauri-plugin-updater`, or `reqwest` |
| `downloadUpdate(url)` | `updates.js:185-252` | same |
| `installUpdate(path, password)` | `spawn('sudo', ['-S','apt','install'])` (`updates.js:259`) | same |
| `sendEmail({service, sender, secret, receiver, attachments})` | `nodemailer` (`email-doc.js:190`) | `lettre` |
| `wifiListNetworks()` / `wifiConnect(ssid, psk)` / `wifiGetAddress()` | `nmcli` and `hostname -I` spawns (`wifi-manager.js:13,62,91`) | `Command` or D-Bus |
| `wifiGetConnectionState()` / `wifiGetStatus()` / `wifiEnable()` / `wifiDisable()` | `nmcli` spawns kept in `wifi-manager.js` itself until now (`getConnectionState`/`getWifiStatus`/`disableWifi`/`enableWifi`) — added after Phase 8, closing the gap that phase recorded rather than converted | `Command` or D-Bus, same as the three above |
| `getBatteryCapacity()` | `/sys/class/power_supply` reads + `cat` spawn (`battery-monitor.js:56,73`) | sysfs read, or the `battery` crate |

**Four corrections came out of actually building these, the same shape as every
prior phase's "the signature was a hypothesis, not a specification."**

**(corrected in Phase 8) `checkForUpdate()` returns the raw parsed GitHub
release JSON, not a packaged `{version, url}`.** The table's own placeholder
return shape assumed the matching logic — comparing the release tag against
the running version, then picking the asset whose filename contains this
platform/arch's substring — would move natively alongside the fetch. It
doesn't, for the reason group D and G corrections already established:
`packageReleaseData`/`isUpdateAvailable`/`extractUpdateDownloadInfo` are pure
data reshaping with no OS dependency, and moving them into `platform-node.js`
would duplicate logic into the backing for no reason the HTTPS request
actually requires. They stay in `updates.js`, unchanged except that
`extractUpdateDownloadInfo` now takes a `platformInfo` argument
(`platform.getPlatform()`'s own shape) instead of reading
`process.platform`/`process.arch` directly — which also closes the two group A
reads Phase 2 deferred here (`updates.js:117-130,179`) and the third at
`about_display.js:75` (now threaded a `platformInfo` argument from render.js,
the same way `settings_display.js` already receives one).

**(corrected in Phase 9c) `downloadUpdate` does not take `destPath`.** It
allocates the destination itself: on Linux a directory it creates with
`fs.mkdtempSync`, everywhere else the downloads directory the main process
already holds, with the filename taken off the URL's own last path segment. The
URL has to be a release asset on this repo (`https://github.com/brsloan/warewoolf/releases/download/…`),
checked before a socket is opened, and the filename has to match an allowlist —
so nothing about the destination is renderer-composed. This is the same call
Phase 8 made for `sendEmail`'s attachments ("a temp file `sendEmail` owns and
cleans up itself, never a renderer-named path") applied to the one command where
not making it was load-bearing: `downloadUpdate` is the only producer of
`installUpdate`'s vouches, so a renderer that chooses this path chooses what gets
installed as root. The one difference from `sendEmail`'s temp files is that this
one is *not* cleaned up before resolving — `installUpdate` reads it later, from a
separate click, so it has to outlive the call that made it.

The visible consequence, and the reason this is a contract change rather than an
implementation detail: `updates.js`'s own `downloadUpdate(sysDirectories,
downloadInfo, callback)` loses its first parameter, and with it
`about_display.js`'s `showAbout(sysDirectories, …)` — that argument had already
outlived its original purpose (Phase 9a took the licenses path off it) and
survived only because the update destination was still composed in the view.
Off Linux the writer is still told the file is in their downloads folder, because
it still is; that split moved to the far side of the boundary rather than
disappearing.

**(corrected in Phase 8) `downloadUpdate` resolves on the destination write
stream's `'close'`, not when the HTTPS response finishes piping into it.** The
original `updates.js` resolved on `'finish'` — the identical truncated-file
risk Phase 6 found and fixed in `buildEpub` and `archiveProject`. Corrected
the same way here rather than carried over; unlike those two, this one *is*
independently observable by mutation on this codebase's fixtures (swapping
`'close'` back to `'finish'` hangs the error-path tests outright, since
`file.destroy()` never emits `'finish'` at all — a stronger signal than the
close-enough-together non-result Phase 6 got for the success path).

**(corrected in Phase 8) `installUpdate`'s `path` is constrained to a path this
same backing instance produced.** This is the one command in the whole
contract that escalates privilege (`sudo apt install`), and `path` is
otherwise exactly as renderer-composed as `downloadUpdate`'s own `destPath` —
nothing about its *shape* distinguishes a legitimate downloaded installer from
an arbitrary string. A directory allowlist or filename-pattern check was
considered and rejected: both are properties a renderer-composed path could
satisfy by construction. Instead, `downloadUpdate` records every path it
successfully wrote to (or found already present) in a session-scoped set, and
`installUpdate` rejects `INVALID_ARGUMENT` for any path not in it, before
`sudo` is ever spawned. This is why `updates.js` holds one standing platform
instance shared by both its `downloadUpdate` and `installUpdate` exports
rather than a fresh one per call — the vouching only works if a download and
the install that follows it go through the same backing. `wifiConnect` gets
the smaller version of the same question — an SSID/passphrase the writer
typed, not a path — and the existing discipline (argv array, no shell) already
answers it; nothing new was needed there.

**(Phase 9b, found) That guard did not hold, and the flip is what made it
matter.** `/security-review` over the 9b diff found the vouch forgeable in one
extra call. `downloadUpdate` was the only producer of vouches and it took *both*
`url` and `destPath` from the renderer unvalidated; worse, its
already-downloaded shortcut vouched `destPath` on nothing but `fs.existsSync`,
with no HTTP request at all. So a renderer holding group G's conceded arbitrary
write could `writeBinaryFile` a `.deb`, call `downloadUpdate` on that path to have
it vouched, and then `installUpdate` it as root. The paragraph above rejects a
directory allowlist because "a renderer-composed path could satisfy [it] by
construction" — the vouch turned out to be satisfiable by construction too, for
the same reason: the backing did not choose the path, the renderer did. Before
Phase 9b the renderer had `child_process` and could spawn `sudo` itself, so there
was no boundary here to fail; after it, this is the only remaining
renderer-to-root path.

**(corrected in Phase 9c) The vouch records the bytes, not the path.**
`vouchedUpdatePaths` is a `Map` now, not a `Set`: `downloadUpdate` records the
sha256 of what it actually downloaded, against a path it allocated itself (see
its own correction above), and `installUpdate` re-reads and re-hashes the file
immediately before spawning. Both halves are needed and neither is sufficient
alone. A backing-allocated path stops the chain above, because there is no
argument that points `downloadUpdate` at a file the renderer wrote. The digest
stops the variant that a backing-allocated path opens up instead: the path comes
back to the renderer — it has to, `installUpdate` takes it — and `writeBinaryFile`
can still write to it, so the vouch cannot be about a name. Read, hash, compare
and spawn run in one synchronous block, which is what keeps another command from
being serviced in between; the main process is single-threaded.

The secondary finding is fixed too: `installUpdate` spawns
`sudo -S apt install -- <path>`, so a path cannot be read as an `apt` option.
With the filename now coming from an allowlist that forbids a leading `-`, that
is belt and braces, which is the point of having it.

`writeBinaryFile` was re-examined here and deliberately left alone. It is group
G's conceded arbitrary write, and the concession is real: it writes wherever the
export dialog's file picker put the user. Scoping it to some directory set would
be the same mistake as scoping `installUpdate`'s path — a property a
renderer-composed path satisfies by construction — and it would break exporting
to a chosen location, which is the feature. The right response is that nothing
downstream may treat a written file as trustworthy, which is what the digest
does.

**`sendEmail`'s `attachments` shape needed the same kind of correction group
G's `buildEpub` did, for the same reason.** The inventory's own row already
named the temp-file absorption (below) but not what that implies for the
shape: an attachment that has to be *built* (a project zip, an epub) cannot
cross as `{filename, content, encoding}` the way a literal one (a generated
`.docx`/`.md`/`.html`/`.mdfc`/`.txt` string) can, because building either one
means zipping, and zipping means a real file on disk somewhere, however
briefly. `attachments[]` entries are now one of three shapes:

- `{filename, content, encoding?}` — literal bytes/text, unchanged from the
  original nodemailer attachment shape
- `{filename?, projectArchive: {projectDir, chapsDir?, sourceFilename}}` —
  built by calling `archiveProject` (group H) into a temp file this command
  owns; `filename` defaults to whatever `archiveProject` allocates
- `{filename, epubEntries}` — `epubEntries` is exactly the `{name, content}[]`
  shape `buildEpub` (group G) already takes, built into a temp file the same
  way

Both of the zip-shaped kinds are built with `fs.mkdtempSync()`, read back as a
`Buffer`, and the temp directory is removed before `sendEmail` resolves or
rejects — the same "own the temp directory start to finish" shape `importDocx`
(group F) already established. **This is the design constraint the inventory's
own temp-file note was gesturing at without spelling out**: a `path` field on
an attachment would have been exactly the arbitrary-file-read primitive Phase
7 declined to pull `sendEmail` forward to close — any string the renderer
names, read and attached. Absorbing the zipping natively is what avoids ever
needing one.

`sendEmail`'s `secret` is either a literal the writer just typed or
`platform.SAVED_SECRET`, resolved natively — see group J. A typed password
still crosses, outbound, once; that is unavoidable, since they typed it into
the DOM. Nothing ever crosses inbound. This closes Phase 7's one standing
rule-6 exception: `emailFile()` (`email-doc.js`) no longer resolves the
sentinel itself through an injected `backing.resolveSecret` — it just forwards
`secret` to `platform.sendEmail()`, which resolves it on the far side exactly
like `storeCredential` already did. `setSecretResolver`/`readSavedSecret` and
the module-level resolver they set are gone from `email-doc.js` entirely, and
`render.js` no longer holds the raw node backing at all (only the wrapped
`platform` it already used everywhere else) — see the Phase 8 write-up in
`upgrade-and-isolation-plan.md`.

**Closed after Phase 8, before Phase 9.** Two of `wifi-manager.js`'s seven
functions stayed unconverted when Phase 8 shipped, deliberately out of that
phase's scope: `getWifiNetworks`, `connectToNewWifi` and `getIpAddress` routed
through `wifiListNetworks`/`wifiConnect`/`wifiGetAddress`, but
`getConnectionState`, `getWifiStatus`, `enableWifi` and `disableWifi` had no
group K command behind them — never declared in `platform.js`'s `COMMANDS`
table, and extending the contract to cover Wi-Fi radio enable/disable and
device connection-state polling was not part of that phase's mandate. They
kept spawning `nmcli` directly. This was the same "owned by no phase"
situation Phase 2 recorded for three stray `process.platform` reads (closed in
Phase 3) — recorded there rather than quietly left for Phase 9's audit to
discover, since these four calls would have broken outright once
`nodeIntegration` goes away: `child_process` stops being reachable from the
renderer at all.

Rather than let Phase 9 either extend group K first or budget time to do it as
part of the flip, it was closed as its own step in between: `wifiGetConnectionState`,
`wifiGetStatus`, `wifiEnable` and `wifiDisable` were added to `COMMANDS` (group
K is 12 commands now, not 8) and implemented in `platform-node.js`, reusing the
same `splitNmcliFields`/`unavailableOrIoError` helpers the first three wifi
commands already had — `wifi-manager.js` no longer keeps its own copy of
either, ending the duplication `platform-node.js`'s own comment used to flag.
`wifi-manager.js`'s remaining four functions now route through the platform
the same way the first three already did, which makes the whole module (and,
downstream, `wifi-manager_display.js`) async throughout rather than
callback-style in parts. `enableWifi`/`wifiEnable` and `disableWifi`/
`wifiDisable` take no arguments at all — declared with an explicit empty
`params: []` rather than left implicit, since these were the last two commands
added to the table.

The one design question this raised that group K's first three commands
didn't: `wifi-manager_display.js`'s `updateStateUntilConnected()` polls
`getConnectionState` every 250ms until the radio reports `connected`, recursing
via `setTimeout`. Converting `getConnectionState` to a promise turned that
recursion into an async loop, which reopened a question a timer-based
implementation doesn't have to answer — nothing external can cancel a promise
the way `clearTimeout` cancels a timer. The existing `wifiManagerGeneration`/
`isCurrent()` guard (already in place to stop the old timer chain once the
dialog closed) still does the job, but now every continuation — not just the
recursive call site — has to check it before touching the DOM. Phase 5 hit the
general shape of this exact hazard in `missing-pups_display.test.js`: async
work that outlives the DOM it was scheduled against surfaces as an
unhandled-rejection crash rather than a clean test failure. `wifi-manager.js`'s
functions are designed so none of them ever reject (each catches internally
and resolves a fallback value, matching the pre-existing
`reportUnlessUnavailable` convention), which forecloses that specific crash
shape here; the cancellation itself is mutation-tested in
`test/wifi-manager_display.test.js` — removing either the loop's own
`isCurrent()` check or the one right after its `await` fails a test written
for exactly that line, and nothing else.

`getBatteryCapacity()` folds `battery-monitor.js`'s old two-step
`getBatteryName()` + `queryKernel()` into one native call, and both functions
— along with `getBatteryPercent` — are gone from that file entirely; nothing
outside it called them directly. It rejects `UNAVAILABLE` rather than
resolving `null` for "no battery," matching `CODES.UNAVAILABLE`'s own doc
comment (`platform.js`), which already names "no battery" as its third
example — this is the everyday result on every machine that is not a
writerDeck, not a failure worth writing to the error log once a minute for as
long as the app runs. A battery that exists but cannot be read (a spawn
failure, non-numeric sysfs output) is `IO_ERROR` instead, so a caller can
still tell "nothing to report" apart from "something is actually wrong" —
`wifi-manager.js`'s seven wrappers all apply the same distinction, logging a real failure
but not the ordinary absence of `nmcli`/a battery off a Pi.

---

## Summary

**65 commands and 36 events**, as declared in `platform.js`. This document
originally estimated "~47" from its own tables; the real count came out of writing
the contract down, mostly from group J growing and from load/save pairs listed on
one row being two commands each. Per group: A 7, B 5, C 6, D 8, E 7, F 3, G 4,
H 3, I 3, J 7, K 12. K grew from 8 to 12 after Phase 8 shipped, closing the
`wifi-manager.js` gap that phase's own write-up recorded rather than converted
(`wifiGetConnectionState`, `wifiGetStatus`, `wifiEnable`, `wifiDisable`) —
recorded in group K above, not folded into the Phase 8 write-up itself since it
was done as a separate step ahead of Phase 9.

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
   1,104 lines). Highest value, green tests the whole way. *Done in Phase 4.*
   "Green tests the whole way" turned out to be the wrong expectation: making
   the two models async broke 115 tests at once, because everything that reads a
   chapter reads it through them. Almost all of that churn was `await` in test
   bodies rather than production logic, but it cannot be staged — the models are
   one boundary and both halves have to cross it together.
4. **Rest of D, then I and E** — settings, spellcheck, file browser.
5. **Groups F, G, H** — import, export, backup. *Done in Phase 6.*
6. **Group J** — credentials, with the collapse described above. *Done in
   Phase 7.* The commands already existed from Phase 1; the work was the renderer
   side, and the deliverable was a removal — no key derivation, no session key
   and no `credentials.json` write happens in the renderer any more. Two
   corrections came out of it, both marked above.
7. **Group K** — updates, email, wifi, battery. *Done in Phase 8.* Unlike every
   group before it, the eight commands did not already exist in
   `platform-node.js` — Phase 1 declared them, but Phase 8 was the first phase
   since Phase 1 itself to have to build implementations rather than wire
   call sites to ones already written. Four corrections came out of it, all
   marked above. Two of `wifi-manager.js`'s seven functions
   (`getConnectionState`/`getWifiStatus`/`enableWifi`/`disableWifi` — radio
   toggle and connection-state polling) stayed unconverted at the time,
   deliberately out of scope: they had no group K command behind them and were
   never part of the declared contract. *Closed afterward, before Phase 9*: see
   the note above the Summary. The remaining gap Phase 9 inherits is the flag
   flip itself, not any interface design work on top of it.
8. **Build the bridge, flags untouched.** *Done in Phase 9a.* `preload.js`,
   `platform-host.js`, `platform-ipc.js` grown from 9 commands to all 65, 65
   `ipcMain.handle` registrations generated from `COMMANDS`, all 36 events across
   the bridge, and the node backing moved out of the renderer into the main
   process. Split out from step 9 deliberately: a failure with the bridge and the
   flags landing together is ambiguous between "the bridge is wrong" and "the flag
   broke something."

   The work that had to come first was not a command at all. `test/platform.test.js`
   built `createPlatform(createNodeBacking(...))` at all 59 of its construction
   sites, so nothing in the suite said the two backings behave alike — the stated
   purpose of the Phase 5 backfill, unfulfillable as written. `platformIn` is
   parameterized over a transport now and the whole contract suite runs twice, the
   second pass through a fake bridge that serializes with `structuredClone` and
   reconstitutes errors the way the real boundary does. Both halves of that bridge
   are the shipped code; only the process hop is faked. See the Phase 9a write-up
   in `upgrade-and-isolation-plan.md` for the two real bugs it found, and for the
   third — `index.js` failing to parse — that only a packaged build could find.

9. Flip `contextIsolation: true` and drop `nodeIntegration` once nothing
   `require`s `fs`. *Done in Phase 9b.* The two inherited items were as small as
   9a predicted — `pathExists` for `render.js`'s four `existsSync` calls, local
   helpers for `path` — and the phase's real content was elsewhere: the bundle's
   own output format, which under `--platform=node` left a bare top-level
   `module.exports` that only worked because `nodeIntegration` put a `module` in
   the page, and which `render-bundle.test.js` could not see because it loaded the
   bundle with `require()` rather than the way `index.html` does. Removing
   `nodeIntegration` would also have enabled the OS sandbox by itself, since
   Electron's `sandbox` default is `true` and only `nodeIntegration: true` was
   holding it off; `sandbox: false` is written out explicitly so the flip stayed
   one variable. Verified on a packaged Windows build over CDP, 29 checks. The Pi
   pass is still owed, and `/security-review` left one open finding against
   `installUpdate` — both recorded in the Phase 9b write-up.

10. **Close the `installUpdate` finding.** *Done in Phase 9c.* The contract
    change group K records above: `downloadUpdate` allocates its own destination
    and validates the URL, the vouch becomes a content digest re-checked at
    install time, and `apt` gets a `--`. Kept out of 9b deliberately, for the same
    reason 9a and 9b were split — a contract change and a flag flip landing
    together is ambiguous when something breaks. Verified on a packaged Windows
    build, 31 checks now; the Linux half of `installUpdate` (the `sudo` spawn
    itself) still waits on the Pi pass, which is why the seams are injected rather
    than live.
