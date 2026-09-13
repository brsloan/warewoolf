# Plan: Screenplay Mode

A project is either a novel or a screenplay. A screenplay project holds one
script, written in [Fountain](https://fountain.io) syntax and saved as a single
`.fountain` file, edited all at once in the manuscript editor. The Chapters
sidebar becomes a Scenes list built from the script's scene headings, and the
chapter shortcuts become scene shortcuts. Enter and Tab move between screenplay
elements, so a writer never types markup.

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
| Enter after Dialogue | Character. The old branch went to Action; a second Enter on the empty cue gets there. **Confirm before Phase 4** |
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
setting keeps applying to prose documents and is ignored for a script. Courier
Prime, the stack's first name, is bundled (`src/assets/fonts`, declared by
`@font-face` in index.css and inlined into the print page by index.js) so the
script and its PDF are the same face on every machine.

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
| scene | new action | becomes action | fills `INT. ` if empty; after the place, puts in ` - ` and offers the times |
| action | new action; if the line reads as a transition, convert it first | new action | becomes character |
| character | new dialogue, with `(CONT'D)` added when the same character spoke last in the scene before something other than speech | becomes action | new parenthetical `()` with the caret inside; an empty cue becomes the parenthetical |
| parenthetical | new dialogue | becomes action | new dialogue |
| dialogue | new character | becomes action | new parenthetical `()`; an empty speech becomes the parenthetical |
| transition | new scene | becomes action | nothing at the start of the line; new action after it |
| anything else | new action | becomes action | becomes action |

Enter on an empty line of any type but action makes it action: the way out of
a type chosen by mistake, and the double-Enter after a speech that gets from
the next cue to action. Enter with the caret at the start of a non-empty line
pushes the line down and leaves an empty line of the same type above it, as
a word processor would. Enter mid-line
splits the line into two of the same type, with the dual and tight marks
cleared on the second. A caret before nothing but trailing spaces counts as at
the end of the line, for Enter and Tab both. A selection falls through to
Quill. Shift+Enter inserts a new line of the same type with `tight` set. Two
more fixed bindings, fixed because Enter is reserved from the customizable
shortcuts: Ctrl+Enter opens a new heading, with the intros offered, and
Ctrl+Shift+Enter opens the Insert/Convert Menu (`element-picker_display.js`),
every type a line can be in one list, Enter inserting and Shift+Enter
reformatting.

**Typing** (`attachScreenplayTyping`) does two things on every user change.
An action line typed as `INT. ` (or `EXT. `, `EST. `, `INT./EXT. `) becomes a
heading on that space, so the heading style shows while the
place is typed and the location list can open on it. And every line the change
touched whose type takes capitals - heading, cue, transition - has its text
upper-cased, with the caret put back, so the file carries `BOB` and never a
forced `@bob`. Both go in within Quill's history delay, so Ctrl+Z takes the
typed character and its consequence off together; nothing is done during an
IME composition.

The auto-detection on Enter after an action line reuses the codec's classifier
on that one line, so "CUT TO:" typed as plain action becomes the transition
it is without a shortcut (a heading was already made one on its space). That
and the `INT. ` check are the only places the editor classifies text;
everything else is explicit.

**(CONT'D)** is added by Enter at the end of a cue (`continuedCue`), reading
back over the lines above: past the previous speech to its cue, noting whether
action or a transition stood between. Same name and something between: the
cue gets ` (CONT'D)`. A heading, section or page break between ends the search
with no; notes, synopses and blank lines count for nothing; a cue that already
has an extension is left to the writer. It is text in the file, as a writer
would type it, so every Fountain reader sees it; the cost is that deleting the
action between two speeches later leaves the mark to be removed by hand. Page
break `(MORE)`/`(CONT'D)` is not done: the PDF is paginated by Chromium, and
the editor has no page model to hang it on.

**Backspace and Delete** need no handler. With the type as an attributor,
Quill's own merge (`keyboard.js:338`) gives the joined line the previous
line's type, which is what a writer expects.

**Element shortcuts.** Fifteen new entries in `SHORTCUT_DEFS`
(`shortcuts.js:333`), section `Screenplay`, target `quill`, plus a `mode`
field new to every definition: `'prose'` on the heading, list, blockquote,
footnote and alignment shortcuts, `'screenplay'` on these, absent on the rest.
Ctrl+digit (`insertElement`) opens a
new, empty line of the type when the line has text - above it with the caret
at the start, below it with the caret at the end, between the two halves
otherwise - and sets the type of an empty line or of every line in a
selection. Ctrl+Alt+digit (`setElement`) sets the type of the current line
whatever it holds, which is what a writer who chose the wrong type wants.
Centered stays on Ctrl+E and is a reformat.

| Id | Default | Id | Default |
| --- | --- | --- | --- |
| elementScene | Ctrl+1 | reformatScene | Ctrl+Alt+1 |
| elementAction | Ctrl+2 | reformatAction | Ctrl+Alt+2 |
| elementCharacter | Ctrl+3 | reformatCharacter | Ctrl+Alt+3 |
| elementParenthetical | Ctrl+4 | reformatParenthetical | Ctrl+Alt+4 |
| elementDialogue | Ctrl+5 | reformatDialogue | Ctrl+Alt+5 |
| elementTransition | Ctrl+6 | reformatTransition | Ctrl+Alt+6 |
| elementCentered | Ctrl+E | toggleDualDialogue | Ctrl+D |
| cycleCase (both modes, section Formatting) | Ctrl+Shift+K | | |

`toggleDualDialogue`, Ctrl+D: the dual mark goes on or off the cue
the caret is on or under, which in Fountain is the second speaker's.
`cycleCase` is its Upper/Lower/Title Case, on Ctrl+Shift+K because Ctrl+K is
Strikethrough here in both modes: the selection, or the word at the caret,
goes to capitals, capitals to lower case, lower case to Title Case, keeping
the selection so the key can be pressed again.

`findConflict` (`shortcuts.js:828`) skips a pair whose modes differ and are
both set. `applyQuillShortcuts` (`quill-utils.js:330`) takes the mode and
applies only the handlers whose definition allows it; `displayChapterByIndex`
calls it on a mode change, which the tagging-and-stripping it already does
makes cheap. The Shortcuts popup groups the new section like the others and
shows both modes' entries; that a script and a novel share Ctrl+1 is something
the popup should say in a line rather than hide.

**Navigation shortcuts** keep their ids. `previousChapter`/`nextChapter`
(`shortcuts.js:334`) become previous/next scene when the active document is a
script the writer is working in - `editingScript()`, which is `editorMode()`
plus "in the Chapters list", since a `.fountain` in Reference or Trash is a
stashed or thrown-away block of scenes and not what the keys are for (see "One
script" below) - and
`moveChapterUp`/`moveChapterDown` move the scene. The dispatch in
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

## The Format block

A script's element types are invisible in the way a heading level is not. The
layout is all that distinguishes one from another, and two types can be laid
out alike - a section from a synopsis, an action line from a centered one - so
a writer who has just pressed Tab twice has nothing on screen that names what
they landed on.

So the foot of the notes panel carries a Format block: a heading reading
"Format" and, under it, the name of the element the caret's line is
(`views/format_display.js`, `showElementFormat(type)`). Hidden entirely while
the editor shows prose, which has no element to name.

It is inside `#project-notes` rather than beside it, which is the whole of
"it toggles with the notes": showing and hiding a panel is a class on that
element, so a writer who has hidden the notes to get the manuscript alone gets
this away with them. The panel lays its children out in a column for it - the
notes editor takes the height that is left, the block keeps its own.

The names come from `ELEMENT_NAMES` in `blots/screenplay.js`, beside the types
themselves, so the block and the Insert/Convert Menu call the same type the
same thing. `refreshFormatBlock()` in `render.js` is what feeds it, from
`selection-change` (the caret moved), from a user `text-change` (Tab
reformatted the line the caret is already on, so no selection-change follows -
and this is not on the Scenes list's debounce for that reason), and from
`applyEditorMode()` and the chapter load. With no selection - focus in the
notes or the sidebar - it reads the remembered caret, so the block says what
the writer was last on rather than going blank.

Deliberately not a live region. It changes because the caret moved, and a
screen reader has just read the line it moved to; announcing the type on top of
that would be a second voice on every arrow key. The block is named by its
heading for a reader that wants to navigate to it.

## Autocomplete, word count, title page

**Autocomplete** is the old branch's feature with the DOM scans replaced and
the lists every script shares added.
`characterNames(delta)` and `locations(delta)` walk the ops once, stripping
extensions like `(V.O.)` and `(CONT'D)` from cues and the `INT./EXT.` prefix
and ` - TIME` suffix from headings. `suggestionsFor(delta, type, lineText,
lineStart)` decides what a line gets, and how an accepted suggestion goes in
(`prefix`, `suffix`, and the offsets `from`/`to` it replaces):

| On | Typed | Offered |
| --- | --- | --- |
| cue | nothing | the speakers, next-speaker first (`speakersFor`: whoever spoke before the last speaker, then the scene's speakers by recency, then earlier scenes', then the rest of the cast) |
| cue | `B` | the names starting with it, from one character |
| cue | `BOB (` or `BOB (V` | the extensions, `(V.O.)` `(O.S.)` `(O.C.)` `(CONT'D)`, put in after the name with a space |
| heading | nothing, or `IN` | `INT.` `EXT.` `INT./EXT.` `EST.`, with a space after; Enter stays on the line |
| heading | `INT. ` or `INT. KI` | the places |
| heading | `INT. KITCHEN - ` | the times of day |
| transition | anything | the usual transitions and the script's own |

A list is offered before anything is typed too - the next speaker, the
intros, the times after Tab's ` - ` - and Enter or Tab takes its first entry
like any other, so a guessed speaker is one keypress; Escape is the way past
it, after which Enter on the empty cue makes it action as before. Enter, Tab,
the right arrow or a click accepts, the first entry unless the arrows chose
another; Enter and Tab then do what they do on the line once the text
is in, so a name is one keypress from its speech and Tab after a location puts
in the ` - ` and offers the times. Escape dismisses, and Escape again brings
the list back. Up and Down move within it, wrapping. The box is a popup
positioned from `quill.getBounds`, and its keys go through Quill bindings
guarded on the box being open rather than the one-shot `keydown` listeners the
branch used, which raced each other. The whole thing is a Settings switch
(`screenplayAutocomplete`), read on every refresh. The lists are computed
from the script on every keystroke, and a project can add names of its own to
them - see "Characters and locations" below.

**Page count.** `estimatePages(elements)` in `fountain.js`, from the old
branch's line model: 55 lines a page, 61 characters across an action line, 35
across dialogue, fixed line costs for cues, parentheticals, headings and
transitions. The elements a script is written with but not printed with -
sections, synopses, notes, boneyards, the `NON_PRINTING` list, and the same four
`screenplay-export.js`'s `PRINTED` leaves out of the PDF - take no lines at all,
and are not a gap between the elements around them either: the estimate counts
the page, not the screen, so a scene full of the writer's own notes is not
estimated longer than it prints. They still take a line in the editor, which is
why the page marks are drawn at an element rather than at a line number. Word Count (`wordcount_display.js`) becomes a Page Count when the
active document is a script: "Script pages (estimate): 112 (111 3/8)", the
session's change in pages (against the estimate the script had when it first
came into the editor, kept per script in render.js's `scriptPagesOnOpen`, since
a project can hold more than one `.fountain`), and a goal in pages (`project.pageGoal`, kept
apart from a novel's `wordGoal`) with the progress bar filling towards it. No
word rows, no project line and no words-per-page, which are prose figures. It
is an estimate, and the labels say so; the PDF phase gives the real count.

The same walk (`layoutPages`, behind `estimatePageStarts`) says which
element begins each page after the first, and the editor draws those turns:
`markEstimatedPages` in `screenplay-editor.js` puts `data-sp-page`, the page
number, on the first paragraph of each page, and the CSS draws a dotted rule
across the page with the number at its right in the widened gap above it. The
mark is an attribute on the paragraph's node and not a format, so it is not
content: Parchment reads back only the attributors it knows, the mutation
emits no text-change, nothing is saved and nothing is undoable. A page turn
inside a long element is marked on the element after it, since a line has no
place in the editor for a rule to sit; a forced page break marks the element
after the break. A heading, a cue or a parenthetical is never left at the foot
of a page with what it introduces on the next: when the page would turn after
one, the run of them moves over whole and its first element begins the page,
lengthening the estimate by the lines left blank - the same keep-with-next the
PDF stylesheet applies, so the two agree. A run longer than a page cannot
move and the turn falls where the count puts it. Redrawn after a load and on the Scenes list's debounce after
a keystroke; a Settings switch (`screenplayPageMarks`, on by default) turns
them off.

**Title page.** Properties (`properties_display.js`) shows the Fountain keys
(Title, Credit, Author, Source, Draft date, Contact, Copyright, Notes) for a
screenplay project, each a text input except Notes and Contact, which are
textareas. Apply writes `project.titlePage` and mirrors title and author. New
Project (`new-project_display.js`) gains a Novel / Screenplay radio, defaulting
to Novel, and a screenplay project is created with one chapter titled after
the project, filename allocated with the `.fountain` extension on first save,
and a title page carrying the title and the default author.

## Characters and locations

Tools > Characters/Locations, for a screenplay project only: the two lists
autocomplete completes a cue and a scene heading from, shown as one dialog with
a list each, editable.

The lists are not a store the script is copied into. What a list shows is the
names the script itself is written with - every cue, every heading - together
with the project's own two changes to that list, which live in
`project.screenplayNames` as `{ added, removed }` per list and travel with the
`.woolf` the way `projectDictionary` does:

```
screenplayNames: {
  characters: { added: [], removed: [] },
  locations:  { added: [], removed: [] }
}
```

`added` is a name the script has not reached yet - a character due in act three.
`removed` is a name it *is* written with that is not to be offered. So a name
typed into a cue is offered on the next cue with nothing to rebuild, and what is
written beside each name is the whole story of why it is there: the lines of the
script it is in, or "added", and "removed" when it is not being offered.

**Why removals exist.** A one-off DAN in scene one is in the script for good, and
while every name in the script is offered, every attempt at DANIELLE is met with
DAN first. Removing DAN changes no line of the script - his cue in scene one
stays exactly as it was written - it only takes the name out of the list. That
is a list a writer can keep rather than only read, and it is the reason the tool
is worth opening twice.

| Button | What it does |
| --- | --- |
| Add | Puts a name the script has not reached yet into `added`, in capitals, so it completes from the first cue typed for it. |
| Rename | Rewrites every use of the name in the script - see "Renaming" below - and carries the project's own entry across with it, in whichever of the two lists it is in. |
| Remove | Takes the name out of the list. A name the script uses goes into `removed` and the script is untouched; one that was only ever `added` is simply dropped, since a removal for a name nothing can produce would be a note about nothing. |
| Restore | The same button, when everything selected has already been removed: it takes them out of `removed` and they are offered again. |
| Refresh | Empties both `added` and `removed`, leaving the list as the script itself writes it. Disabled when there is nothing to undo. |

A removed name keeps its row in the dialog, marked `DAN  (1, removed)` and drawn
muted, because a row the writer cannot see is a row they cannot put back - the
marking is in the row's own text as well as in its colour. It is offered from
nowhere while it is there, the next-speaker guess on an empty cue included: a
name taken out of the list is out of every place the list is offered from, which
is the whole of what taking it out is for.

Every change is made as it is asked for rather than gathered behind a Save,
because a rename is an edit to the script and belongs in the editor's history
beside the writer's own: with the script in the editor it is applied as a
`'user'` change, so Ctrl+Z takes the whole rename back. With the script out of
the editor (the caret in a Reference note) there is no history to put it in, so
its contents are replaced and it is marked unsaved, as a scene merged back into
it is. `render.js`'s `screenplayNamesView()` hands the dialog whichever copy is
the live one and reads the script's file once, up front, for a project opened
onto another document.

### Renaming

A character's name is not only in his cues, so a rename is two passes over the
lines:

- The **name line** - a cue for a character, a heading for a place - carries the
  name as its whole subject, in the span `cueNameSpan`/`headingNameSpan` marks
  out. It is matched whole and without regard to case, since a cue is the
  character's own line and "dan" there is DAN and nothing else. Everything around
  the name stays: a cue's extension, a heading's prefix, time of day and scene
  number.
- **Every other line** - action, dialogue, a parenthetical, a synopsis, and a
  heading too, since `INT. DAN'S BEDROOM - NIGHT` is where a character's name
  most often turns up outside his cues - carries the name as one word among
  others. It is matched on word boundaries and put back in the case it was
  written in: `DAN` becomes `BEN` and `Dan` becomes `Ben`. An all-lower-case
  "dan" is left alone, because a name is also a word - will, mark, rose, sue -
  and a script is full of them. The cue is the one line with no such doubt, which
  is why the pass above reads it instead.

The second pass is **for a character only**. A place is renamed in its headings
and nowhere else: a location's name is far more often an ordinary phrase (THE
CAR, OUTSIDE, THE HOUSE) than a character's is, so the same rule there would
rewrite lines nobody meant, and a heading is a line a writer can watch change in
the Scenes list.

The lower-case rule cannot catch a sentence that *begins* with a name that is
also a word: a character called WILL turns "Will you come?" into "Ben you come?",
and nothing short of reading the sentence can tell that from "Will crosses the
room." That is the one thing the rules do not settle, and it is **declared rather
than fixed**.

So a rename that reaches the script is **asked about before it is made**
(`rename-confirmation_display.js`). `renameName` is run once for what it
describes: the writer is told how far it goes - "This rewrites 1 cue and 5 other
lines of the script" - and, when it reaches past the name's own lines, that a
word spelled like the name may be replaced by mistake where a sentence begins
with it, and that Ctrl+Z takes the whole rename back. On Rename it runs again and
the change is written; Cancel leaves the name and the script as they were. A
rename that no line of the script uses - a name only ever in `added` - has
nothing to warn about and is simply made.

Listing those doubtful lines for approval, one to a row behind a tick, was built
and then taken out again. On a feature script there are far more of them than
anyone would read through, and a list too long to be read is a worse warning than
a sentence, not a better one. Undo is the answer when the rename does get one
wrong, which is why the dialog names it.

**The pure part**, in `screenplay-editor.js`:

```
cueNameSpan(text) / headingNameSpan(text)  -> { from, to } within the line
nameCounts(delta)          -> { characters: {NAME: n}, locations: {...} }
mergeNames(derived, added, removed)        -> the list, capitalised, once each
namesList(screenplayNames, key)            -> { added, removed }, defensively
renameName(delta, type, from, to)          -> { ops, count, nameLines,
                                                otherLines }, or null
```

The two spans are the single definition of what a name is: `cueName` and
`headingName` read a name out of a line with them, so the lists autocomplete
offers are built from them, and `renameName` rewrites exactly the same
characters. A name that can be collected can therefore be renamed, and a rename
leaves everything around the name - a cue's `(V.O.)` and its dual marker, a
heading's `INT.`, its ` - DAY` and its `#12#` - exactly where the writer put it.
Renaming a name onto one the script already uses merges the two characters or
places, which is the same thing a writer would mean by it.

The item is absent from a novel's Tools menu rather than greyed out in it, which
is the only place in the menus that departs from "disable, do not remove": the
other screenplay differences are the same tool in a different shape (Page Count,
the Outliner by scene), and a novel has no cues and no headings for this one to
be disabled *about*. `render.js` refuses the channel too, for an accelerator on
a menu built before the project changed.

## What the menus offer

Two lists of channels, `NOVEL_PROJECT_ONLY` and `PROSE_DOCUMENT_ONLY`, kept
in both `app-menu.js` (the menu template, which `index.js` builds the real
menu from) and `render.js` (a message each), with a test holding them to each
other. The renderer tells the host the project and document through the
`setMenuMode` command whenever either changes, and the host rebuilds the menu:
the items in the lists are greyed out, and Word Count reads Page Count for a
screenplay project. A command that reaches `render.js` anyway - a shortcut, an
accelerator on a menu built before the mode arrived - gets the message from
`showBlockedActionAlert`.

| Works as-is | Needs a screenplay branch | Prose only |
| --- | --- | --- |
| Save, Save As, Save Copy, Backup, Open, New | Word Count (pages) | Split Chapter |
| | Characters/Locations (a screenplay's alone: absent from a novel's menu) | |
| Find/Replace, Spell Check | Properties (title page) | |
| | Delete/Restore Chapter (a scene block in the script; see "One script") | |
| Send via Email (sends the script as `.fountain`) | Export (one file, Save As: PDF, FDX, Fountain, text) | Renumber Chapters |
| Add New Chapter (makes a Reference document while the script is active) | | |
| Settings, Dictionaries, File Manager, Wi-Fi | Compile (one document: Export instead) | Convert First Lines, Marked Italics, Marked Tabs |
| Corkboard (project-level notes) | Outliner (by scene, in pages) | Break Headings Into Chapters |
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

## One script: scenes as the unit of Trash and Reference

A screenplay project's Chapters list holds exactly one document, the script,
and it never leaves. Everything the chapter keys do to a chapter in a novel
they do to a *scene block* in the script: Delete Chapter takes a block out of
the script and into Trash, the reorder keys move a block within the script or
out the bottom of it into Reference, and Restore puts a trashed block back.
Blocks outside the script are ordinary `.fountain` documents.

This replaces the swap that `installScript` and `restoreFromTrash` used to do
for a restored script. It is the simpler model: the code no longer has to
decide which `.fountain` is the script, since the one in Chapters always is,
and every consumer that asks for the script (Export, Page Count, the Scenes
list, the title page) keeps working untouched.

**A block** is one or more consecutive scenes: from a heading down to the next
heading or the end. The block a key acts on is the one the selection covers:
the scene the caret is in, or with a range selected, every scene the range
touches, a partly selected scene included. A selection that ends exactly where
a heading begins does not take that scene. The text before the first heading
(a `FADE IN:`) belongs to no scene, so a caret up there gives the keys nothing
to act on; a range that starts there and reaches a heading covers from the
first scene. A script with no headings has no blocks, and Delete Chapter on it
does nothing: the script itself is never trashed.

**Out of the script.** Delete Chapter (`moveToTrash`) with the script active
cuts the block out of the editor and makes a new `.fountain` document of it,
titled by its first heading, stamped as trashed from Chapters, and appended to
Trash. The script stays in the editor with the caret where the block was.
Moving the last block down (`moveChapDown` with nowhere below) does the same
into the top of Reference, the way the last chapter of a novel moves into
Reference. Moving the first block up does nothing, as it does now.

**Back into the script.** Restore on a trashed block appends its scenes to the
end of the script, shows the script and lands the caret on the first restored
heading, from where the reorder keys carry it up to where it belongs. Moving
the first Reference document up does the same when it is a `.fountain`; a
prose document there stays put, since a screenplay's Chapters list has no room
for prose. The merged document's file is deleted once the script holds its
scenes: the script is saved first when the project has a directory, so no
moment exists in which the scenes are in neither file. Restore of a prose
document trashed from Chapters lands in Reference for the same reason. A
trashed document that came from Reference goes back to Reference whatever it
is, as a block, and is not merged.

**Blocks are documents, not scripts.** A `.fountain` document in Reference or
Trash edits as a script (rendering, element keys, page marks, Page Count) but
the navigation, reorder, delete and rename keys treat it as one document, as
the last commit made them treat a trashed script. It shows as one row, under
its own title, however many scenes it holds, so a writer can grow a stashed
scene into several and the whole file still moves as one. `editingScript()`
becomes "a `.fountain` in the Chapters list is active": the Scenes rows are
only ever the script's, and typing in a stashed block cannot change them.

**Import** still replaces the script (`installScript`) and trashes the one it
replaced as a block. Restoring that block now appends it to the imported
script rather than swapping the two.

**Undo.** Cutting a block out of the editor, or appending one, is applied with
source `'api'`, which the editor's history (`userOnly: true`) does not record:
an undo entry that put the text back would leave the block in Trash as well,
and the mirror for a merge would resurrect a document whose file is gone.
Restore is the undo of a delete, and Delete the undo of a restore. Moving a
block within the script stays a `'user'` change and one undo entry, as a
single scene's move is now. Because the editor's own text-change handler only
records a `'user'` change on the chapter, the cut sets the chapter's contents
and unsaved flags itself.

**Unloaded contents.** A block not in the editor may hold `contents: null`
(`clearCurrentChapterIfUnchanged`), so a merge reads its file first, with
`keepProjectTitlePage`, since a fragment's file carries the project's title
page at its head on every save and that page is not the fragment's to
restore. Merging works from deltas, never from file text.

**The pure part**, in `screenplay-editor.js` and tested without Quill:

```
sceneBlock(scenes, range)          -> { from, to } scene numbers, or null
splitScenes(delta, from, to)       -> { start, length, extracted }, or null
moveScenes(delta, from, to, dir)   -> { ops, start, length }, or null
appendScenes(delta, extra)         -> { ops, start }
```

`moveScene(delta, k, dir)` stays as `moveScenes(delta, k, k, dir)`. After a
move the selection covers the moved block again when it was a range before, so
holding the key walks the block; a collapsed caret lands on the block's first
heading as it does today. `appendScenes` drops the single empty line a new
script is, so a block restored into an empty script does not sit under a blank.

## Status

All seven phases are implemented, on the `screenplay-new` branch, one commit
per phase. Where the implementation departed from the plan above:

- The codec never upper-cases; the editor does, when a line becomes a heading,
  cue or transition (see "Text case"). Big Fish's own `@McCLANE` is the reason.
- Enter on an empty line of any type makes it action, rather than leaving a
  heading as it was: the keyboard table above was corrected to match.
- Next Scene past the last scene moves on to the first Reference document,
  rather than stopping: the key walks off the end of the script the way it
  walks off the end of a chapter, and Previous Chapter from that document
  comes back to the script's last scene - the return trip of that walk, rather
  than the top of a document just come down the length of.
- The Scenes rows come from the script wherever the caret is, not only while
  the script is the active document: with a Reference or trashed document in
  the editor the top section still lists the script's scenes, with no row
  active, and clicking one goes back to the script and lands on that scene. A
  writer in a Reference document is still working on the same screenplay, and
  the scene list is how a screenplay is navigated. The rows come from the
  editor's delta while the script is being edited, from the script's own
  contents while it holds unsaved ones, and otherwise from the last list read
  off it - or from its file, once, for a project opened onto a Reference
  document. A screenplay project's reference documents are themselves prose,
  as intended.
- A screenplay project's Export is a format and a Save As: one file, at the
  path and name the writer chooses, rather than the novel's folder of numbered
  chapter files (`exportScreenplayFile` in `export.js`). A novel project's
  dialog is unchanged. Ctrl+N with the script active makes a Reference
  document, since that is the only kind of document there is to add beside a
  script; with a Reference document active it joins Reference after it. The PDF
  goes through a new `printToPdf` platform command (a hidden window and
  `webContents.printToPDF` in `index.js`), which only a running Electron can
  exercise - the node backing rejects it UNAVAILABLE, and that path is what
  the tests cover. The title page is numbered like every other page.
- Import also reads Fade In's `.fadein` (`parseFadeIn` in `screenplay-export.js`,
  with `screenplay/Big-Fish.fadein` as the shape to match): a zip around one
  Open Screenplay Format `document.xml`, opened through the platform's
  `importEpub` command since that is already "the text entries of a zip". Its
  element styles are Final Draft's names plus Normal Text and Singing, so the
  FDX table reads them. `screenplay/dual.fadein` pins the marks Big Fish never
  uses: `pagebreakbefore="1"` and `dualdialogue="1"` on the paragraph's style,
  the dual mark on the first cue of the pair where Fountain's goes on the
  second. A soft return inside a paragraph is a literal newline in its text and
  becomes a `tight` line. Fade In's own title page names its paragraphs
  (`bookmark="Title"`, Author, Copyright, Draft, Contact), which go straight to
  keys; a title page pasted in as free text (Big Fish's) is read by its lines,
  which now also yields Source and Copyright, from lines beginning "based on"
  and "copyright", for FDX too. There is no Fade In export.
- FDX in and out covers what both formats share. Sections, synopses, notes
  and boneyards do not go to FDX; Final Draft's empty action paragraphs and a
  speech with no cue over it do not survive the trip to Fountain.
- Menu gating is by a table in `render.js` rather than a flag per command
  entry, and comes in two kinds: the chapter tools need a prose document in
  the editor, the manuscript conversions need a novel project.
- The autocomplete lists became editable, in Tools > Characters/Locations - see
  "Characters and locations". Phase 6 built them as read-only lists computed
  from the script; they are still computed from the script, with a project's own
  added names offered alongside and its removed ones offered nowhere.

## Open findings to carry

- A `.fountain` chapter in a novel project works, because mode follows the
  file, and Import allows it. A screenplay project is one script and any
  number of Reference documents: a script imported into one takes the script's
  place and the displaced script goes to Trash (`installScript` in
  `render.js`), Restore of a trashed script appends it to the script as a
  block (see "One script"), and a prose import lands in Reference. The
  imported script's title page becomes the project's, as a `.fountain`'s own
  title page does on load.
- Dual dialogue renders as a marker only. Side-by-side layout is a print
  feature and belongs with the PDF stylesheet.
- Sections and synopses are preserved, shown dimmed, and cost nothing in the
  page estimate (see "Page count"). The Outliner is by
  scene for a screenplay project - a row per heading, the page the scene begins
  on ("Page") and the scene's share of the page estimate ("Pgs"), both from
  `estimateScenePages` in `fountain.js`, and its synopsis lines as the summary,
  read from the script rather than kept beside it the way a chapter's summary
  is. A summary editable there would have to write a synopsis
  line back into the script, which is why it is text. An outline built from
  sections, rather than from headings, is a natural later feature.
- The old branch's `estimateScreenplayPageLength` used 53 lines a page; the
  spec-derived figure is 55. Phase 6 should pick one against the Big Fish PDF's
  actual page count rather than trust either.
