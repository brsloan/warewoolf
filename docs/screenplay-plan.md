# Plan: Screenplay Mode

A project is either a novel or a screenplay. A screenplay project holds one
script, written in [Fountain](https://fountain.io) syntax and saved as a single
`.fountain` file, edited all at once in the manuscript editor. The Chapters
sidebar becomes a Scenes list built from the script's scene headings, and the
chapter shortcuts become scene shortcuts. Enter and Tab move between screenplay
elements the way Final Draft does, so a writer never types markup.

This replaces the abandoned `screenplay` branch (40 commits, diverged from main
at `ba9c0be` in October 2025). That branch proved the workflow and is the
reference for the UX. None of its code should be merged: main has since moved
through the platform facade, async chapter I/O, the keybinding dispatcher and
the footnote blots, and every file the branch touched has been rewritten
underneath it. What it got right and wrong is recorded below so the second
attempt does not rediscover either.

Baseline: Quill 1.3.7. One editor instance built at `src/render.js:56` with a
`formats` whitelist; chapter text goes through `parseMDF`/`convertDeltaToMDF`
in `src/components/models/chapter.js`; the chapter file extension is chosen
natively at `src/components/controllers/platform-node.js:68` (`CHAPTER_EXT`).

## What the old branch taught

**The UX was right.** Element types on Ctrl+1..6, Enter and Tab advancing the
element type, a Scenes sidebar with jump and reorder, character and location
autocomplete, a title page in Properties, page count in Word Count. All of that
carries over.

**Two Quill mistakes made it slow and fragile.** Measured in jsdom against the
whole of Big Fish (2,767 blocks), which exaggerates absolute times but not the
ratios:

| Load method | Time |
| --- | --- |
| `setContents`, six `Block` subclasses (the old branch's blots) | 3478 ms |
| `setContents`, one block-level class attributor | 1525 ms |
| `setContents`, plain paragraphs | 475 ms |
| `root.innerHTML` then `quill.update()` (the old branch's workaround) | 534 ms |

1. *A `Block` subclass per element type.* Changing a line's type is a blot
   replacement rather than a class change, and Quill's own Backspace handler
   (`node_modules/quill/modules/keyboard.js:338`) diffs `line.formats()`
   against the previous line's, which for two different subclasses yields
   `{ 'character-cue': null, 'dialog-block': true }` and nonsense follows. That
   is the "default is opposite for custom block types" bug the branch worked
   around by hand. One class attributor named `element` makes it a single
   format, one `formatLine` call to change, and Quill's merge and split logic
   correct with no override.
2. *`setContents` is quadratic in line count.* `applyDelta`
   (`node_modules/quill/core/editor.js:22`) calls `scroll.formatAt` once per
   formatted line, and every one of those finds its line by walking the
   scroll's children from the head (`parchment.js:1197`, `LinkedList.find`).
   Building the HTML from the tokenizer's own output and letting Parchment read
   it in one linear pass is the same path a native paste takes, and is what the
   branch fell back to. It stays, wrapped in one function with one invariant:
   the HTML only ever comes from our own element list, never from a file or the
   clipboard.

**The mode switch fought render.js.** Two Quill instances, a hidden container,
`project.screenplay` checks scattered through `render.js`, menu listeners torn
down and re-registered per mode, and scene moves done by shuffling `domNode`s
behind Quill's back with no undo entry. Every one of those is replaced below by
a decision that keeps a single editor and asks the document what it is.

**Why not a custom editor.** Every tool that edits text takes a Quill instance
(`showFindReplace`, `showSpellcheck`, `attachAutocorrect`, typewriter mode,
`goPageDown`, the footnote machinery, the ARIA labelling). A contenteditable
built from scratch would need its own selection model, undo stack, IME
handling, clipboard normalisation and screen-reader semantics before it reached
where Quill already is, and would then need every one of those tools ported.
The two problems above are the whole reason the branch felt like it was fighting
Quill, and both have direct fixes.

## Representation

**Element type: a block-level class attributor.**

```
new Parchment.Attributor.Class('element', 'sp', {
  scope: Parchment.Scope.BLOCK,
  whitelist: ['scene', 'action', 'character', 'parenthetical', 'dialogue',
              'transition', 'centered', 'section', 'synopsis', 'note',
              'boneyard', 'lyric', 'pagebreak']
});
```

A line of dialogue is `{ insert: '\n', attributes: { element: 'dialogue' } }`,
the same shape as `align`. Registered once at startup beside
`registerFootnoteBlots()` (`render.js:54`), named in the editor's `formats`
list at `render.js:69`, and rendered by CSS on `.sp-scene`, `.sp-character`
and so on. A line with no `element` attribute is action, which is also
Fountain's own default, so a plain paragraph pasted in is already right.

Two more attributors ride alongside it, both block-scoped and both rare:

- `tight` (class `sp-tight`): this line followed the previous one with no
  blank line between them in the file. Fountain treats consecutive lines as
  one multi-line element; Quill has no soft line break, so each line is its own
  block and this flag is what lets the serializer put them back without a blank
  line. Shift+Enter creates one. Rendered with no top margin.
- `dual` (class `sp-dual`): the `^` dual-dialogue marker on a character cue.
  Preserved and rendered with a marker; not laid out side by side. That is a
  print concern, and the PDF phase can do it.

**Inline formatting** reuses `bold`, `italic` and `underline`, which the
editor already whitelists. Fountain writes them as `**`, `*` and `_`.

**Scene numbers** (`INT. HOUSE #12#`) stay in the line's text. They are the
writer's, and the serializer has nothing to do with them.

**The title page** is not part of the editor's delta. It is an ordered list of
`{ key, values[] }` kept on the project as `project.titlePage`, written into
the `.woolf` like any other field, edited in Properties, and written back to
the head of the `.fountain` on every save so the file stays self-contained. On
load the file wins: whatever title page the `.fountain` carries replaces the
project's copy. `project.title` and `project.author` mirror the `Title` and
`Author` keys so the title bar and every export that reads them keep working.

**Text case.** Scene headings, character cues and transitions display in
capitals through CSS, and the editor upper-cases a line's text when it becomes
one of those types (Phase 4). The serializer never changes case: a cue or
heading whose case would not read back is written forced (`@McCLANE`,
`.sniper scope pov`), which is what the force markers are for and is lossless
where upper-casing is not. Big Fish itself carries `@McCLANE` for exactly this
reason. Because the editor upper-cases on the way in, forced forms stay rare.

## Decisions taken

| Question | Decision |
| --- | --- |
| Where does mode live | On the document: a `.fountain` chapter puts the editor in screenplay mode, a `.txt` chapter in prose mode. `project.type` is policy only: what New Project creates, what the sidebar's top section is, which tools the menus offer |
| Reference and Trash in a screenplay project | Kept, as prose documents. A character bible or a notes file next to a script costs nothing once mode follows the document |
| How many Quill instances | One. Screenplay handlers are installed once and fall through in prose mode |
| Element type storage | One class attributor, value is the type; no per-type blots |
| Loading a script into the editor | HTML built from the element list, `root.innerHTML`, `quill.update('silent')`, `history.clear()`; one function, one invariant |
| Scene list source | The delta, walked once per debounced text-change; never the DOM |
| Moving a scene | A delta splice applied with `updateContents(diff, 'user')`; one undo entry |
| Current scene in the sidebar | The scene containing the caret, as Chapters already does; not the scroll position |
| Multi-line elements | One block per line, `tight` attributor on continuation lines; Shift+Enter makes one |
| Title page | Structured, on the project, round-tripped through the file; the file wins on load |
| Case of cues and headings | Written as typed; forced with `@`/`.`/`>` when the text would not read back as its type. The editor upper-cases on the way in |
| Literal `*`, `_`, `[[`, leading `.`/`!`/`@`/`>`/`~`/`=`/`#` in text | Escaped with a backslash on save, exactly as `convertDeltaToMDF` escapes MarkdownFic markers |
| Enter after Dialogue | Character, as Final Draft does. The old branch went to Action; a second Enter on the empty cue gets there. **Confirm before Phase 4** |
| Element shortcuts | Ctrl+1..6 as before. Definitions carry a `mode`, and conflicts are checked within a mode, so Ctrl+1 can mean Heading 1 in prose and Scene Heading in a script |
| Footnotes in a script | Inert: the Enter binding and the insert shortcut both return early in screenplay mode |
| Big Fish as a test fixture | Read from `screenplay/` when present and skipped when not; the folder is gitignored, and the script is John August's, not ours to commit |
| Quill 2 | Out of scope, same as everywhere else in this app |

## The codec

One new controller, `src/components/controllers/fountain.js`, shaped like
`markdownFic.js`: a pure-text parser and a pure-delta serializer, no Quill, no
DOM, unit-tested with `node --test`.

```
parseFountain(text)            -> { titlePage: [{key, values}], elements: [Element] }
elementsToDelta(elements)      -> delta
deltaToElements(delta)         -> [Element]
serializeFountain(titlePage, elements) -> text
```

`Element` is `{ type, text, tight, dual, runs }` where `runs` is the inline
tokenisation (`[{ text, bold, italic, underline }]`), and `text` is the plain
concatenation for the sidebar and word count.

**The line classifier** is a state machine over lines, modelled on
`screenplay/fountain/Fountain/FastFountainParser.m` rather than on the regex
file next to it. That parser is the reference implementation's own second
attempt, written because the regex one could not be made correct, which is the
same lesson the old branch's controller learned. State is three things: how
many blank lines precede this line, whether we are inside a dialogue group, and
whether we are inside a boneyard. The rules, in the order they are tried:

| Type | Rule | Forced by |
| --- | --- | --- |
| boneyard | between `/*` and `*/`, possibly spanning lines | |
| pagebreak | `===` or longer, alone on the line | |
| section | starts with `#`; depth is the count | |
| synopsis | starts with `=` (a single one) | |
| note | `[[ ... ]]` alone on the line | |
| lyric | starts with `~` | |
| centered | `>text<` | |
| scene | blank line before, starts with `INT`, `EXT`, `EST`, `INT./EXT`, `I/E` followed by `.`, space or `-`, case-insensitive; or `.` then text | `.` |
| transition | blank before and after, all caps, ends in `TO:`; or `>` then text | `>` |
| character | blank before, non-blank after, all caps with at least one letter, optional `(extension)`, optional trailing `^`; or `@` then text | `@` |
| parenthetical | inside a dialogue group, `(...)` | |
| dialogue | inside a dialogue group, anything else; a line of two spaces is an empty dialogue line | |
| action | everything else; `!` then text forces it | `!` |

A line that follows another with no blank between them and would classify the
same way carries `tight`. Inside a dialogue group that is the normal case, so
`tight` is only recorded there for a dialogue line following a dialogue line,
which is the only place it changes the output.

**Inline tokenisation** handles `***`, `**`, `*`, `_`, and backslash escapes,
one character per escape, with the same reasoning `markdownFic.js`'s header
comment gives for MarkdownFic. `[[notes]]` inside a line stay as literal text;
nothing interprets them, so nothing has to escape them.

**The serializer** walks elements and emits: title page as `Key: value` lines
with multi-value keys indented by a tab; a blank line between elements except
inside a dialogue group and before a `tight` line; the force marker when the
text would classify as something else on re-read; upper-casing for scene,
character and transition; inline markers around runs; and a backslash before
any character in a run that the classifier or the inline tokeniser would
otherwise read as a marker at that position. The escape rules are the same
shape as `escapeAnyMarkers`, `escapeBlockMarker` and `escapeBackslashes` in
`markdownFic.js`, and should be written the same way: decide by re-running the
classifier on the candidate line, not by pattern-matching what looks risky.

**Tests.** `test/fountain.test.js`:

- One assertion per rule in the table above, with the smallest input that
  exercises it, including the negatives the spec calls out: a caps line with a
  blank line after it is action, not a cue; `INT` with nothing after it is
  action; `..` does not force a heading.
- Round trip: `parse(serialize(parse(x)))` deep-equals `parse(x)` for every
  fixture. Serialise-then-parse is the invariant, not byte identity: Fountain
  files carry indentation and case the spec ignores, and the reference file
  itself has tabs before title-page values.
- Escaping: a delta containing every marker character in every position comes
  back from a round trip unchanged.
- Big Fish, when `screenplay/Big-Fish.fountain` is present: element counts by
  type against the FDX in the same folder, which types every paragraph
  explicitly. The FDX has 203 scene headings, 768 characters, 813 dialogue, 97
  parentheticals, 36 transitions and 850 action. Exact agreement is not
  expected on the first pass, because the two files were prepared separately
  and Fountain reads some of the FDX's action lines differently, but every
  disagreement should be explained by inspection before the count is pinned.
  The file is 4,634 lines, so this doubles as the parser's performance check.

## The editor

**Registration and CSS** (`src/components/blots/screenplay.js`, new). The
three attributors, a `registerScreenplayFormats()` beside
`registerFootnoteBlots()`, and their names added to the editor's `formats`.
Not the notes editor's: a script pasted into notes degrades to plain
paragraphs, the same way a footnote does at `render.js:114`.

Styling in `src/css/index.css`, gated on a `screenplay` class on
`#editor-container`, so prose chapters are untouched and the rules stay
together:

```
#editor-container.screenplay .ql-editor { font-family: <typewriter stack>; line-height: 1; }
.sp-scene       { text-transform: uppercase; margin-top: 2em; }
.sp-character   { text-transform: uppercase; margin-left: 40%; }
.sp-parenthetical { margin-left: 30%; margin-right: 25%; }
.sp-dialogue    { margin-left: 20%; margin-right: 20%; }
.sp-transition  { text-transform: uppercase; text-align: right; }
.sp-centered    { text-align: center; }
.sp-section, .sp-synopsis, .sp-note, .sp-boneyard { color: var(--text-muted); }
.sp-tight       { margin-top: 0; }
```

Dialogue is indented, not centred: the old branch centred cues and padded
dialogue symmetrically, which reads well enough on screen but is not how a
script is laid out, and the PDF phase needs the real margins anyway. The
typewriter stack is the one `fonts.js:46` already carries; the manuscript font
setting keeps applying to prose documents and is ignored for a script.

**Mode** is a function of the active chapter, not a flag:

```
function editorMode(){
  var chap = project.getActiveChapter();
  return chap && isFountainFile(chap.filename) ? 'screenplay' : 'prose';
}
```

`displayChapterByIndex()` (`render.js:666`) is the one place a document is put
into the editor, and it becomes the one place mode is applied: toggle the
container class, choose the load path, and re-apply the Quill shortcuts for the
mode (below). Nothing else in `render.js` checks the mode; the handlers that
need it read `editorMode()` when they fire.

**Loading.** `loadScreenplayIntoEditor(quill, elements)` in
`src/components/controllers/screenplay-editor.js` (new): build the HTML with
`escapeHtml` per run, assign `quill.root.innerHTML`, `quill.update('silent')`,
`quill.history.clear()`. The `text-change` handler at `render.js:1073` only
acts on `'user'`, so a silent update marks nothing dirty. Prose chapters keep
`setContents`.

A chapter's `contents` stays a delta in both modes, so `chap.contents =
editorQuill.getContents()` on every keystroke (`render.js:1082`) is unchanged,
and so is everything downstream that reads `getContentsOrFile()`: word count,
compile, email, find and replace, spellcheck, backup.

**Saving** goes through `chapter.js` exactly as today, with the codec chosen by
filename. `saveFile()` and `saveCopy()` hand the platform the serialised text
and the extension; `getFile()` picks the parser by the extension it was handed
back. `isFountainFile` is one helper in `chapter.js`, so the extension test
lives in one place.

## Keyboard

All screenplay key handling lives in `screenplay-editor.js` and is attached
once, in `setUpQuills()`. Each handler starts with
`if(editorMode() !== 'screenplay') return true;`, which is Quill's "not mine,
carry on" (`keyboard.js` `listen()` stops at the first handler that returns
anything but literal `true`).

**Enter and Tab** are added the way `footnoteEnterBinding` is
(`render.js:77`): unshifted onto `keyboard.bindings[13]` and `[9]` so they run
before Quill's own, which for Enter would copy the current line's `element`
onto the new line (`keyboard.js:400`), the one thing a script must not do. The
element cycle, applied when the caret is at the end of the line:

| On | Enter, line has text | Enter, line empty | Tab |
| --- | --- | --- | --- |
| scene | new action | becomes action | fills `INT. ` if empty |
| action | new action; if the line reads as a scene heading or transition, convert it first | new action | becomes character |
| character | new dialogue | becomes action | new parenthetical `()` with the caret inside |
| parenthetical | new dialogue | becomes action | new dialogue |
| dialogue | new character | becomes action | new parenthetical `()` |
| transition | new scene | becomes action | becomes scene |
| anything else | new action | becomes action | becomes action |

Enter on an empty line of any type but action makes it action: the way out of
a type chosen by mistake, and the double-Enter after a speech that gets from
the next cue to action. Enter with the caret at the start of a non-empty line
pushes the line down and leaves an empty action line above it. Enter mid-line
splits the line into two of the same type, with the dual and tight marks
cleared on the second. A selection falls through to Quill. Shift+Enter inserts
a new line of the same type with `tight` set. A line that becomes a heading,
cue or transition has its text upper-cased, so the file needs no force marker.

The auto-detection on Enter after an action line reuses the codec's classifier
on that one line, so "CUT TO:" and "INT. KITCHEN - DAY" typed as plain action
become what they are without a shortcut. It is the only place the editor
classifies text; everything else is explicit.

**Backspace and Delete** need no handler. With the type as an attributor,
Quill's own merge (`keyboard.js:338`) gives the joined line the previous
line's type, which is what a writer expects.

**Element shortcuts.** Seven new entries in `SHORTCUT_DEFS`
(`shortcuts.js:333`), section `Screenplay`, target `quill`, plus a `mode`
field new to every definition: `'prose'` on the heading, list, blockquote,
footnote and alignment shortcuts, `'screenplay'` on these, absent on the rest.

| Id | Default |
| --- | --- |
| elementScene | Ctrl+1 |
| elementAction | Ctrl+2 |
| elementCharacter | Ctrl+3 |
| elementParenthetical | Ctrl+4 |
| elementDialogue | Ctrl+5 |
| elementTransition | Ctrl+6 |
| elementCentered | Ctrl+E |

`findConflict` (`shortcuts.js:828`) skips a pair whose modes differ and are
both set. `applyQuillShortcuts` (`quill-utils.js:330`) takes the mode and
applies only the handlers whose definition allows it; `displayChapterByIndex`
calls it on a mode change, which the tagging-and-stripping it already does
makes cheap. The Shortcuts popup groups the new section like the others and
shows both modes' entries; that a script and a novel share Ctrl+1 is something
the popup should say in a line rather than hide.

**Navigation shortcuts** keep their ids. `previousChapter`/`nextChapter`
(`shortcuts.js:334`) become previous/next scene when the active document is a
script, and `moveChapterUp`/`moveChapterDown` move the scene. The dispatch in
`keybindings.js` does not change; the `render.js` actions it calls branch on
`editorMode()`. The labels in the popup read "Previous Chapter / Scene".

## The Scenes sidebar

`chapter-list_display.js` renders three sections from three lists. A
screenplay project has a fourth thing to show, and it is not a list of
chapters: scenes are positions in one document. So the top section's rows come
from a different source while Reference and Trash render as they do now.

`renderChapterList` gains a `scenes` option: `[{ title, index }]` built by
`sceneIndex(delta)` in `screenplay-editor.js`, one walk of the ops collecting
lines whose `element` is `scene`. When it is passed, the top section renders
those rows with `data-scene-index` instead of chapter rows, the header reads
"Scenes", and the active row is the last scene whose index is at or before the
caret. A screenplay project with no scene headings yet shows one row for the
script itself, so there is always something to select and rename.

Rebuilt from `text-change` on a 300 ms debounce, and only when the list of
titles differs from the last render, so typing inside a scene never re-renders
the sidebar. The active row follows `selection-change`, which is a class
toggle on two rows, not a rebuild. Clicking a row is `setSelection(index)` and
a scroll into view.

Renaming a row (`changeChapterLabel`) edits the heading line's text in place
through `deleteText`/`insertText` with source `'user'`, so it is undoable and
the sidebar updates through the ordinary path.

**Moving a scene.** `sceneRange(delta, index)` gives the op span from a
heading to the next heading or the end. `moveScene(delta, from, direction)`
splices the two ranges and returns the new delta; the caller applies
`new Delta(current).diff(new Delta(moved))` with `updateContents(diff,
'user')`, then places the caret where the scene landed. Both are pure
functions on a delta and are tested without Quill. Text before the first
heading (a `FADE IN:`, an opening action) is not part of any scene and never
moves.

## Autocomplete, word count, title page

**Autocomplete** for cues and locations is the old branch's feature with the
DOM scans replaced. `characterNames(delta)` and `locations(delta)` walk the
ops once, strip extensions like `(V.O.)` and `(CONT'D)` from cues and the
`INT./EXT.` prefix and ` - TIME` suffix from headings, and are cached until the
next text-change. The suggestion box is a popup positioned from
`quill.getBounds`, and its keys go through Quill bindings that check
`suggestionBoxOpen()` rather than the one-shot `keydown` listeners the branch
used, which raced each other. Suggestions appear on a character or scene line
once two characters are typed; Enter or Tab accepts, Escape dismisses, Up and
Down move within the list, anything else keeps typing.

**Page count.** `estimatePages(elements)` in `fountain.js`, from the old
branch's line model: 55 lines a page, 61 characters across an action line, 35
across dialogue, fixed line costs for cues, parentheticals, headings and
transitions. Word Count (`wordcount_display.js`) shows "Pages: 112 (112 3/8)"
above the word counts when the active document is a script. It is an
estimate, and the label should say so; the PDF phase gives the real count.

**Title page.** Properties (`properties_display.js`) shows the Fountain keys
(Title, Credit, Author, Source, Draft date, Contact, Copyright, Notes) for a
screenplay project, each a text input except Notes and Contact, which are
textareas. Apply writes `project.titlePage` and mirrors title and author. New
Project (`new-project_display.js`) gains a Novel / Screenplay radio, defaulting
to Novel, and a screenplay project is created with one chapter titled after
the project, filename allocated with the `.fountain` extension on first save,
and a title page carrying the title and the default author.

## What the menus offer

Mode-aware in `render.js`'s `menuCommands` table (`render.js:1607`) by one
new flag per entry, `prose: true`, checked beside `requiresFocus`. The main
process is not told; an item that does not apply says so with the existing
`showBlockedActionAlert` rather than greying out, which keeps `index.js` and
the 37-channel contract untouched.

| Works as-is | Needs a screenplay branch | Prose only |
| --- | --- | --- |
| Save, Save As, Save Copy, Backup, Open, New | Word Count (pages) | Split Chapter |
| Find/Replace, Spell Check | Properties (title page) | Add/Delete/Restore Chapter (script row); allowed on Reference |
| Send via Email (sends the script as `.fountain`) | Export (Fountain, FDX, PDF) | Renumber Chapters |
| Settings, Dictionaries, File Manager, Wi-Fi | Compile (one document: Export instead) | Convert First Lines, Marked Italics, Marked Tabs |
| Corkboard, Outliner (project-level notes) | | Break Headings Into Chapters |
| Convert Straight Quotes (still wanted in dialogue) | | Tab-Indent Paragraphs, Center All Headings |

`insertFootnote` and `footnoteEnterBinding` return early in screenplay mode.
`applyFootnoteStructuralChanges` already returns when `containsFootnotes` is
false, so a script costs nothing there.

## Phases

Each phase is shippable on its own and has its own tests. Nothing visible
changes until Phase 3, which is deliberate: the codec is where the correctness
risk is, and it is the part that can be finished and pinned without touching
the editor.

### Phase 1: The codec

`fountain.js` and `test/fountain.test.js` as described in "The codec". No
caller. Includes `estimatePages`. Lands with the Big Fish comparison explained
line by line where it disagrees.

### Phase 2: Groundwork

- `platform.js`: `saveChapter` and `saveChapterAtomic` take an optional
  `extension` (`.txt` when absent). `allocateChapterFilename`
  (`platform-node.js:677`) takes it too. `loadChapter` is unchanged; it
  returns text. Contract note and `native-command-inventory.md` updated.
- `chapter.js`: `isFountainFile(filename)`, and the two codecs chosen by it
  in `getFile`, `saveFile`, `saveCopy`. The `mdfc` parameter name on the
  commands stays; it is text either way, and renaming it across the contract
  buys nothing.
- `project.js`: `type` (`'novel'` default) and `titlePage` (`[]`), both
  written by `stringifyProject` and read back by `Object.assign`, with a
  sanitiser for `titlePage` beside `sanitizeWordList`. An older build opening
  a screenplay `.woolf` would show the script as prose with Fountain markup
  visible, which is readable and loses nothing; that is the archival promise
  the format was chosen for.
- `new-project_display.js`: the radio; `createNewProject` (`render.js:888`)
  passes the type through and, for a screenplay, sets the title page.

Tests: chapter round trip through a temp directory for a `.fountain` file;
project save and load with `type` and `titlePage`; the sanitiser.

### Phase 3: The editor

Attributors, CSS, `editorMode()`, the load path, the container class. A
screenplay project now opens as a formatted script and saves back as Fountain,
with no special keys yet: elements are set by pasting or by the next phase.

Tests: `loadScreenplayIntoEditor` in jsdom asserting `getContents()` equals
`elementsToDelta` for the same elements; a load followed by `getContents()`
followed by `deltaToElements` is the identity; a load marks nothing dirty and
leaves the history empty.

### Phase 4: Keyboard

Enter, Tab, Shift+Enter, the element shortcuts, the `mode` field and
conflict rule in `shortcuts.js`, the popup section. Confirm the Enter-after-
Dialogue decision first.

Tests: the cycle table, one case per cell, by calling each binding's handler
directly with a range and context the way `footnote-navigation.test.js`'s
`pressEnterAt` does, and asserting on the delta afterwards; shortcut conflicts
across modes; `applyQuillShortcuts` with each mode.

### Phase 5: Scenes

`sceneIndex`, `sceneRange`, `moveScene`, the sidebar's `scenes` option, the
debounced rebuild, caret tracking, rename, and the four navigation actions
branching on mode.

Tests: the three pure functions on deltas including the no-heading and
text-before-first-heading cases; the sidebar render from a `scenes` list in
jsdom.

### Phase 6: Autocomplete, Word Count, Properties

The suggestion box, `characterNames`/`locations`, pages in Word Count, the
title page in Properties.

Tests: the two extractors on Big Fish when present (Edward, Will, Sandra, and
`WILL'S BEDROOM` with its prefix and time stripped); the estimate against the
old branch's numbers for the same input.

### Phase 7: Menus, export, import

The `prose` flag in `menuCommands`, the blocked-action messages, and Export
gaining three formats for a screenplay project: Fountain (the file itself,
copied), FDX (a small XML writer over the element list; `screenplay/Big-Fish.fdx`
is the shape to match), and PDF through `webContents.printToPDF` against a
print stylesheet with the real margins (1.5 in left, 1 in elsewhere, Courier
12, dialogue at 2.5 in, cues at 3.7 in, parentheticals at 3.1 in, transitions
right-aligned). Import gains FDX, which is a paragraph list with a type on
each and maps onto elements directly.

Tests: FDX writer output parsed back with `DOMParser` and compared to the
element list; the same for the reader; a PDF page count against the estimate
on Big Fish, loosely.

## Status

All seven phases are implemented, on the `screenplay-new` branch, one commit
per phase. Where the implementation departed from the plan above:

- The codec never upper-cases; the editor does, when a line becomes a heading,
  cue or transition (see "Text case"). Big Fish's own `@McCLANE` is the reason.
- Enter on an empty line of any type makes it action, rather than leaving a
  heading as it was: the keyboard table above was corrected to match.
- The Scenes rows come from the editor's delta, so they show while the script
  is the active document; with a Reference document active the sidebar shows
  chapters, with the script as one row. A screenplay project's reference
  documents are prose, as intended.
- Export offers a screenplay project PDF, FDX, Fountain and plain text and
  hides the manuscript formats; a novel project's list is unchanged. The PDF
  goes through a new `printToPdf` platform command (a hidden window and
  `webContents.printToPDF` in `index.js`), which only a running Electron can
  exercise - the node backing rejects it UNAVAILABLE, and that path is what
  the tests cover. The title page is numbered like every other page.
- FDX in and out covers what both formats share. Sections, synopses, notes
  and boneyards do not go to FDX; Final Draft's empty action paragraphs and a
  speech with no cue over it do not survive the trip to Fountain.
- Menu gating is by a table in `render.js` rather than a flag per command
  entry, and comes in two kinds: the chapter tools need a prose document in
  the editor, the manuscript conversions need a novel project.

## Open findings to carry

- A `.fountain` chapter in a novel project, or a `.txt` in a screenplay one,
  works, because mode follows the file. Whether Import should be allowed to
  create one in the wrong project type is a product question; the plan leaves
  it allowed.
- Dual dialogue renders as a marker only. Side-by-side layout is a print
  feature and belongs with the PDF stylesheet.
- Sections and synopses are preserved and shown dimmed. An outline view built
  from sections is a natural later feature and a reason the Outliner is left
  enabled rather than blocked.
- The old branch's `estimateScreenplayPageLength` used 53 lines a page; the
  spec-derived figure is 55. Phase 6 should pick one against the Big Fish PDF's
  actual page count rather than trust either.
