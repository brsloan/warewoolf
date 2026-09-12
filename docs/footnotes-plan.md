# Plan: First-Class Footnotes

Footnotes today are literal MarkdownFic text in the editor: a writer types `[^1]`
in the prose and `[^1]: the note` in a paragraph at the bottom. Nothing in the
app knows the two are related. This plan replaces that with a real
representation — an atomic superscript marker, note bodies the app can find and
move — while keeping the `.mdfc` file format byte-identical to what it writes
today.

Baseline: Quill 1.3.7, `formats` whitelist at `src/render.js:44` (editor) and
`:57` (notes).

## Why this is worth doing beyond the UI

The current pass-through is not merely plain, it is lossy.
`escapeAnyMarkers` (`src/components/controllers/markdownFic.js:381`) escapes
`[^` in every run, so a footnote typed in the editor saves as `\[^1]`. Verified
against the real converters:

```
delta:  "See note[^1] here."  /  "[^1]: The note."
mdfc:   "See note\[^1] here.\r\n\[^1]: The note.\r\n"
html:   <p>See note\<sup><a href="#fnote_1" id="fnoteRef_1">1</a></sup> here.</p>
        <p>\<sup><a href="#fnoteRef_1">1</a></sup>: The note.</p>
```

The backslash leaks into the output and the body paragraph never becomes a
`div.footnote`, because `convertFootnotes` (`mdfc-to-html.js:205`) anchors on an
*unescaped* `^\[\^\d+\]:`. So HTML, EPUB and Markdown export of any footnote
authored in WareWoolf is wrong today. Only `.docx` is correct, because
`delta-to-docx.js:55` regex-scans the delta directly and never sees the
escaping. Phase 4 fixes this as a side effect of doing the round-trip properly.

A second, related defect: whole-project compile concatenates every chapter into
one delta (`compile.js:22`, consumed at `:79`, `:89`, `:99` and by the docx
path). With per-chapter numbering, a five-chapter book emits five notes numbered
`1` — duplicate `id="fnote_1"` anchors in the HTML page, wrong backlinks, and
`delta-to-docx` resolving every `[^1]` to the first chapter's body. EPUB escapes
it only because that path converts each chapter separately. Phase 5 fixes it.

## Representation

**Marker: an inline embed.** `{insert: {footnote: {n: '3'}}}`, a blot extending
`blots/embed` rendered as `<sup class="ww-fnref" data-n="3">`. Quill 1.3.7 ships
that base class with the U+FEFF guard nodes that make typing either side of an
embed behave. It is length-1 and atomic: one caret stop, no way to half-delete
it or mangle the number, which is what makes "the caret is just before the
marker" a well-defined state for the keyboard model.

**Body: a block attributor.** `{insert: '\n', attributes: {footnote: '3'}}`, the
same shape as blockquote. A multi-paragraph note is consecutive paragraphs
carrying the same id — already the documented MarkdownFic convention, and
already what `delta-to-docx` groups on. Bodies stay in the one document, so
find/replace, spellcheck, word count, split-chapter and undo keep working
without special cases. A second Quill instance for the note region would cost
all of that.

Both names must be added to the `formats` arrays in `render.js`. `scroll.insertAt`
and `scroll.formatAt` (`node_modules/quill/blots/scroll.js:75`, `:81`) silently
return for anything not whitelisted, so the symptom of forgetting is an insert
that no-ops with no error.

**Numbering lives in the delta**, not in opaque ids with CSS counters. An
idempotent renumber pass rewrites numbers when the structure changes. That keeps
the `.mdfc` format unchanged, keeps `delta-to-docx` reading numbers straight off
the delta, and avoids counters that silently go wrong when body order diverges
from marker order.

## Decisions taken

| Question | Decision |
| --- | --- |
| Deleting a marker | Deletes its body, as one undo entry |
| Cut/paste a marker | Body travels with it, across chapters too (Phase 7) |
| Marker/body order divergence | Auto-reorder bodies to marker order, deferred to save only while the caret is in a note |
| `.mdfc` line-marker order | alignment > footnote > list/blockquote/header |
| Existing projects | Migrate on load, by teaching `parseMDF` the markers |
| Caret inside a note when splitting | Refuse the split, say why |
| One note referenced twice | Not allowed — markers are one-to-one with bodies |
| Pre-existing orphans | Left alone; never invent a partner |
| Undo across all of the above | One entry per user action |

## The reconcile pass

Everything converges on one pure function. Given a delta, `reconcileFootnotes`:

1. Assigns numbers 1..n in marker document order.
2. Reorders body groups to match marker order (multi-paragraph notes move as one
   unit).
3. Materializes bodies from paste payloads (Phase 7) and strips the payload.
4. Deletes bodies whose marker is gone.
5. Leaves pre-existing orphans — a marker with no body, a body with no marker —
   exactly where they are.

Pure delta in, pure delta out. No Quill instance, no DOM; unit-testable with
`node --test` the way `test/delta-to-docx.test.js` already tests delta
transforms. It is called from the live editor, from save, from split, from
import and from compile, which is what keeps those five paths from each growing
their own half-correct copy of the rules.

**Source discipline when applying it to the live editor.** Two categories, and
they must not be confused:

- *Structural* changes — deleting an orphaned body, materializing a pasted one —
  apply with source `'user'` in the same tick as the edit that triggered them.
  Quill's History merges a change into the previous entry when it lands within
  `options.delay` of it (`node_modules/quill/modules/history.js:51`), so this is
  what makes "delete marker, delete body" a single undo.
- *Cosmetic* renumbering applies with source `'silent'`. Silent changes do not
  emit `text-change` (`core/quill.js:450`), so they neither re-enter the
  reconcile pass nor mark the chapter dirty — but they *do* emit
  `editor-change`, which is what History listens on
  (`modules/history.js:12`), and with `userOnly: true` set in `render.js` a
  non-user source takes the `transform` branch. The undo stack stays
  index-correct across a renumber. This was verified in the installed Quill, not
  assumed; it is the reason `'silent'` is safe here and `'api'` is unnecessary.

Renumbering must therefore be length-neutral in the delta (delete 1 + insert 1
for an embed whose value changed), so the stack's indices hold even where
`transform` is a no-op.

**When it runs on the live editor:** debounced after a user `text-change`
(`render.js`'s `scheduleFootnoteRenumber`), and synchronously before
serialization. Two edits do not wait for the debounce, because in both of them
the delay is on screen — a marker and a body are already rendering whatever
number they were built with, straight from their id:

- A *structural* change renumbers immediately after applying, in the same
  `text-change`, so the browser paints once with the right number in it. That is
  what a paste is.
- *Inserting* a note renumbers as part of its own delta, before it is applied
  (`footnote-navigation.js`'s `insertNewFootnote`). It cannot rely on either
  path above: it is not a structural change, and the caret it leaves in the new
  body is exactly what the guard below holds the debounce back for. The new
  marker is built as `highest + 1`, so without this a note inserted between
  notes 1 and 2 reads "3", with its body at the bottom of the region, until the
  writer typed outside the note or saved. Renumbering inside the insertion's own
  delta also makes it one undo entry rather than an undoable cosmetic sweep of
  its own — this is the one place a renumber is not cosmetic.

While the caret sits inside the footnote region, only **step 2 (reorder)** is
held back, and deferred to save, so it can never yank the ground out from under
someone editing a note. Step 1 still applies, through
`renumberFootnotesInPlace`: it moves no line, so there is nothing to yank, and
holding it back too meant a second paragraph of a note — which is a
continuation, and step 1 is what marks it as one — printed a number of its own
for as long as the writer stayed in the note.

---

## Phase 0 — Groundwork

No visible change. Nothing in the later phases works until these two land.

**`flattenInserts` throws on object inserts.** `quill-utils.js:77` does
`ops[i].insert.split('\n')`. Everything funnels through it — `parseDelta`, and
through that `convertDeltaToMDF`, `delta-to-docx`, compile, epub. Teach it to
pass a non-string insert through as its own op.

**`quill.getText()` drops embeds.** `core/editor.js:144` filters to string
inserts, so every index after the first marker is off by one against Quill's own
index space. `findreplace.js:7` and `spellcheck.js:38` both compute offsets from
`getText()` and hand them to `setSelection`. Add one helper to `quill-utils`
that builds the text from `getContents()` with a single U+FFFC (object replacement) character per embed:
indices line up exactly, and a non-letter placeholder breaks words correctly for
the spellchecker. Point both callers at it.

`wordcount.js`'s `convertToPlainText` already guards `typeof insert === 'string'`
and needs no change. Decide whether footnote body text counts toward the word
count — currently it would, since bodies are ordinary paragraphs.

Tests: `parseDelta` over a delta containing an embed; the placeholder helper's
indices against `quill.getLength()`.

## Phase 1 — The blots

Register `FootnoteRef` (inline embed) and `FootnoteBody` (block attributor),
add both to the two `formats` arrays, style them in `src/css`.

`FootnoteRef` needs `static value(node)` reading `data-n` — that is what
`matchBlot` (`modules/clipboard.js:247`) calls to reconstruct an embed on paste,
and Phase 7 depends on it.

Body rendering: the number via a `::before` pseudo-element from `data-n`, and a
separator rule above the first body paragraph. Both are presentational; nothing
reads them back.

## Phase 2 — The reconcile pass

`reconcileFootnotes` as described above, plus its unit tests, with no caller yet
beyond a debounced hook on the editor's `text-change`. Landing it alone keeps
its test suite honest — every later phase is then a caller, not a rewrite.

## Phase 3 — Keyboard

**Insert.** New `SHORTCUT_DEFS` entry (`shortcuts.js:167`), `target: 'quill'`,
so it is rebindable and appears in the Shortcuts popup like every other
formatting shortcut. Default **Ctrl+Alt+F**, not Ctrl+Shift+F: that is already
File Manager (`shortcuts.js:125`). Ctrl+Alt+T (typewriter mode, `:210`) is the
precedent for the Ctrl+Alt row.

Behaviour is context-sensitive, which gives the back-jump a home without
overloading a key that already means something:

- caret immediately before a marker → jump to that note's body
- caret inside a note body → jump back to its marker
- otherwise → insert a marker, append an empty body, put the caret in it

The insertion renumbers the whole document inside its own delta before applying
it, so a note created between two others is numbered and its body is in place
from the first paint — see "When it runs on the live editor" above. The caret
is then placed by looking the new body up by id, since the reorder has very
likely moved it up past the notes that now follow it.

**Enter to jump forward.** Quill's default Enter handler is added
unconditionally in the Keyboard constructor (`modules/keyboard.js:40`), *after*
the named `options.bindings` loop — so the `quillBindingsToDisable()` trick at
`render.js:66` cannot reach it. And `listen()` stops at the first handler
returning non-`true` (`modules/keyboard.js:120`) while `handleEnter` returns
`undefined`. So the footnote binding must be `unshift`ed onto
`quill.keyboard.bindings[13]` and return `true` to fall through when the caret
is not before a marker. `removeAppliedBindings` (`quill-utils.js:340`) already
manipulates those arrays directly, so this is in-idiom rather than a hack.

Detection is `quill.getContents(range.index, 1)` and a check for an object
insert — no leaf walking.

**Highlight.** On `selection-change`, set `data-active-footnote="3"` on
`#editor-container` and style with a descendant selector. That element is the
one Quill was constructed on, *outside* `.ql-editor` — which is what
`scroll` observes — so the highlight never enters Quill's MutationObserver.

Jumping is `setSelection` plus a scroll into view; typewriter mode already
follows the caret, so it needs nothing.

## Phase 4 — MarkdownFic round-trip and migration

`parseLine` (`markdownFic.js:208`) reads markers in the order alignment,
footnote, list, blockquote, header; `getLineMarker` (`:351`) writes them in the
same order, so a centered note that is also a list item spells as
`[>c] [^1]: - item`. Symmetric by construction, which is what keeps a
hand-edited file meaning the same thing after a save.

`tokenizeInline` gains a case for an unescaped `[^N]` in body text → a marker
embed. `escapeAnyMarkers` (`:381`) keeps escaping literal `[^` typed as prose,
so a writer who genuinely wants the characters still gets them back. `[^` stays
in `ESCAPABLE_ANYWHERE` (`:8`) for the same reason.

Migration falls out of this for free: existing chapters gain real footnotes the
first time they are opened, and nothing needs a conversion step or a version
bump.

Tests: round-trip a delta with markers, multi-paragraph bodies, a note that is
also a list item, an aligned note, and a literal `[^` in prose.

## Phase 5 — Exporters

With Phase 4 correct, the HTML/EPUB/Markdown paths largely fix themselves — they
consume `.mdfc`, and the markers reaching them are finally unescaped. Add a
regression test for the exact case at the top of this document.

`delta-to-docx.js` moves off `fnoteParRegx` string-matching onto the block
attribute. Its existing behaviour is preserved: bodies grouped by id, list
numbers in a footnote rendered as plain text (`:93` explains why Word requires
that), a marker with no body kept as literal text rather than referencing a
footnote that does not exist.

Whole-project compile runs `reconcileFootnotes` over the concatenated delta
before conversion, which renumbers globally and fixes the duplicate-anchor bug.
Because the pass is pure, this is one call on a compile-time copy — the writer's
chapters are not touched.

## Phase 6 — Split and import redistribution

Splitting a chapter between a marker and its body must move the note to whichever
side its marker landed on, in both directions at once.

One shared function, `redistributeFootnotes(deltas) -> deltas`, taking the array
of fragments a split produced:

1. Per fragment, collect marker ids in document order and body groups.
2. Send each body group to the fragment whose marker set contains its id,
   appended after that fragment's existing bodies in marker order.
3. Run `reconcileFootnotes` on each fragment, so each chapter numbers from 1.

"Footnotes on both sides" needs no special case: bodies all start on the far
side of the caret, step 2 pulls back the ones whose markers stayed behind.

Two callers: `splitChapter` (`render.js:1066`) passes two fragments,
`splitDeltaAtIndices` (`quill-utils.js:14`, used by import to break a file at N
chapter markers) passes N. The import path has always had this bug too.

`splitChapter` currently truncates with `deleteText(..., 'user')`, which is one
undoable step. Once bodies migrate *into* the first fragment it is no longer a
truncation. Do not `setContents` — that discards history. Compute the reconciled
fragment and apply `editorQuill.updateContents(current.diff(reconciled), 'user')`
using `Quill.import('delta')`: precise, and a single undo entry.

If the caret is inside a footnote body, refuse the split and say why. Any
snapping rule produces either an empty chapter or a silently moved split point.

## Phase 7 — Cut, copy and paste

The body must survive a cut and come back on paste, including into a different
chapter. It cannot ride along in the DOM: the body lives elsewhere in the
document, or in a document that is not open. So the payload is attached to the
clipboard at copy time.

**Copy and cut** are intercepted on `quill.root`. Take the selected range's DOM
(`window.getSelection().getRangeAt(0).cloneContents()` into a detached div),
stamp each marker in *that copy* with a `data-fn-body` payload holding its body
as delta JSON, and write both `text/html` and a `text/plain` flavour with
markers spelled `[^N]`. Nothing in the live editor is mutated, so Quill's
MutationObserver never sees any of it, and pasting into Word or a browser still
behaves as it does today (the attribute is inert there).

Cut then performs its own `deleteText(range.index, range.length, 'user')`,
having already secured the payload — which is the whole reason interception is
required rather than optional. Ordering matters and is load-bearing: the cut
handler writes the clipboard, the deletion applies, and only then does the
reconcile pass delete the now-orphaned body.

**Paste** needs no new event handler. Quill's `onPaste`
(`modules/clipboard.js:108`) lets the browser drop the HTML into its own hidden
container and converts it a tick later with source `'user'`; `matchBlot`
(`:247`) queries Parchment by tag and class and calls `static value(node)`, so a
marker carrying a payload arrives as an embed whose value holds it. The reconcile
pass then materializes the body, appends it at the bottom of the target chapter,
allocates a number and strips the payload — landing ~1ms after the paste, well
inside History's merge window, so it is one undo entry.

Two consequences worth stating rather than discovering:

- Copying a sentence containing a marker and pasting it into the same chapter
  produces a *second, independent* note with a duplicate body — not two markers
  sharing one. That is what one-to-one requires, and it falls out of the payload
  always materializing a fresh body.
- Pasting from outside WareWoolf carries no payload and no matching class, so a
  `<sup>` arrives as plain text, exactly as today. Recognising `[^N]` in pasted
  text is a non-goal.

**The notes editor** should not gain footnotes. Give `notesQuill` a paste
matcher that degrades a marker to literal `[^N]` text; without one the
whitelist check in `scroll.insertAt` drops it silently and the writer loses
characters with no indication.

## Phase 8 — Documentation

The Shortcuts popup picks up the new entry automatically from `SHORTCUT_DEFS`.
The Help doc's MarkdownFic page
(`src/examples/HelpDoc/HelpDoc_chapters/MarkdownFic.txt:19`) currently documents
footnotes as hand-typed escaped markers and needs rewriting for the real
feature, including the multi-paragraph convention it already describes at `:33`.

## Open questions

- Does footnote body text count toward the word count? Currently it would.
- Should an orphaned marker (pasted from an old chapter with no payload, or left
  by a hand-edited file) render distinctly, and should there be a "tidy
  footnotes" command to sweep them up?
- Where does a new body land when a chapter has no footnote region yet — end of
  document, always?

## Test plan

The pure functions carry the weight: `reconcileFootnotes`,
`redistributeFootnotes`, the MarkdownFic round-trip, and the placeholder text
helper are all delta-in/delta-out and test without a DOM, matching the existing
suite's shape. The parts that genuinely need a live Quill — Enter fall-through,
the highlight, clipboard interception — are thin by design, because everything
they compute is delegated to a function that is already covered.
