# Plan: A "Use Regex" Option in Find/Replace

Find/Replace today searches for a literal string, with two modifiers — Case
Sensitive and Whole Word Only — plus In All Chapters. This plan adds a third
modifier, Use Regex, which reads the Find box as a JavaScript regular expression
and lets the Replace box refer back to its capture groups.

Baseline: `src/components/controllers/findreplace.js` (the search itself),
`src/components/views/findreplace_display.js` (the popup), with
`src/components/controllers/convert-tabs.js` and
`src/components/views/spellcheck_display.js` as the two other callers of the
controller.

## The one assumption that has to go

Every index this module produces is paired, by the caller, with the length of
the search term. That pairing is the whole reason a regex cannot simply be
dropped into `getNextIndex`:

- `find` (`findreplace.js:17`) selects the match as `setSelection(index, str.length)`.
- `replaceAllInDelta` (`:172`) cuts it as `deleteText(foundIndex, oldStr.length)`.
- The Replace button (`findreplace_display.js:91`) decides the selection is
  still the match by comparing the selected text to `findIn.value`.

A regex match has a length of its own, known only to the matcher. So the
central change is that the search returns a **match** — `{index, length}` —
rather than a bare index, and the three call sites above use `match.length`
instead of `str.length`. Everything else in this plan follows from that.

Two invariants survive the change unaltered, and both are load-bearing:

- **Quote folding is length-preserving** (`:88`, and the comment above it). The
  index and length a match reports still describe the untouched text, so
  folding needs no regex-specific handling at all — a `"` in a pattern still
  folds the text the same way, and `.` still matches one character either way.
- **`getIndexableText` counts embeds** (`quill-utils.js`), so indices remain in
  Quill's own index space with footnote markers present. Unchanged.

## Behaviour of the three modifiers together

**Case Sensitive.** Currently implemented by lowercasing both sides (`:9-12`,
`:51-55`). That must not happen in regex mode: lowercasing a pattern turns `\S`
into `\s` and `\W` into `\w`, silently inverting it. In regex mode,
case-insensitivity is the `i` flag instead, and the pattern text is never
touched.

**Whole Word Only.** `getWholeWordPattern` (`:101`) chooses `\b` or a lookaround
per side by inspecting the term's first and last character — which cannot be
done for a pattern like `\w+`. In regex mode, wrap unconditionally:
`(?<!\w)(?:` + pattern + `)(?!\w)`. The non-capturing group matters: without it
`cat|dog` binds the lookarounds to only one alternative. Lookbehind is already
relied on at `:103`, so there is no new engine requirement. (The alternative —
greying the checkbox out in regex mode, as some editors do — is cheaper but
worse; a writer ticking both means the obvious thing, and the wrapping gives it
to them.)

**Flags.** `g` (the scan needs `lastIndex`), `m` so `^` and `$` mean line start
and end rather than chapter start and end, and `i` when Case Sensitive is off.
Deliberately *not* `s`, so `.` does not run across a paragraph break — the same
default every other editor uses. A pattern *can* still match across paragraphs
via `\n` or `[\s\S]`; Quill handles the resulting `deleteText` fine, and the
merged paragraph keeps the first one's block attributes. Worth a line in the
Help doc, not worth blocking.

## Threading the flag

The controller's search functions already carry `caseSensitive` and
`wholeWordOnly` as trailing positional booleans; `find` takes eight parameters
as it stands. A third boolean of the same kind would make
`find(q, p, str, true, 0, false, fn, false, true)` unreadable and easy to
mis-order.

The three flags always travel together, so replace them with one options object
threaded through unchanged:

```js
{ caseSensitive: true, wholeWordOnly: false, useRegex: false }
```

`find`, `findInText`, `getNextMatch`, `replaceAllInDelta`,
`replaceAllInChapter` and `replaceAllInAllChapters` each take it in place of the
two booleans. Both outside callers are trivial to update:
`convert-tabs.js:4` passes `{caseSensitive: true}` and
`spellcheck_display.js:121` passes its two existing flags. Defaults stay where
they are, so an omitted object behaves as today.

`getNextIndex` and `findInText` keep their current index-returning signatures as
thin wrappers over the new match-returning function, which is what the ~25
existing `strictEqual(getNextIndex(...), n)` assertions in
`test/findreplace.test.js` exercise. Those tests stay green as written; new
behaviour is tested through `getNextMatch`.

## Phases

### 1. Match objects in the controller

Add `getNextMatch(str, text, startingIndex, options)` returning
`{index, length, groups}` or `null`, built from the existing `getNextIndex`
body: literal `indexOf` when neither regex nor whole-word is on, otherwise a
compiled `RegExp`. Reimplement `getNextIndex` and `findInText` as wrappers that
return `.index` (or `-1`).

Switch `find` to use it and select `match.length` (`:17`), and
`replaceAllInDelta` to delete `match.length` (`:172`). Both are pure refactors
at this stage — no regex yet, and the existing tests are the check.

### 2. Compiling the pattern, and failing safely

*Done.* `compileSearch(str, options)` returns either `{findFrom}` or
`{error}`, never both and never throwing. `new RegExp` throws on a half-typed
pattern (`(`, `[a-`, `*`), which a writer will produce constantly while typing
into the Find box, so it is compiled once — at the top of `find`, which also
stops the recompile-per-chapter an In All Chapters search used to do, and at the
top of `replaceAllInDelta`, before anything is edited. `replaceAllInDelta`
returns `{changed: 0, delta, error}` for a pattern that will not compile, so
Replace All can never abort halfway through a project.

Flags are `gm`, plus `i` when Case Sensitive is off; case-insensitivity outside
regex mode still lowercases both sides, exactly as it always did.

Two things landed differently from what was written here:

- **`find` still returns an index.** The plan had it returning `{index, error}`,
  but the popup is the only consumer and the only place a human sees the error,
  so it validates once per click with the exported `compileSearch` instead
  (phase 4). That keeps `find`'s signature and its tests untouched. Inside
  `find`, an uncompilable pattern simply finds nothing.
- **Zero-length matches are skipped, not replaced.** The plan advanced past them
  by one and replaced them, which is JavaScript's own `replace(/x*/g, …)`
  semantics — `x*` over "the cat" would become "-t-h-e- -c-a-t-". In a
  manuscript-wide Replace All with no per-chapter undo that is a mess, and
  because each replacement rebuilds the chapter text it is also O(n²) over the
  whole chapter, which would hang the app for minutes with no way out. So
  `matcher()` steps over empty matches and never returns one: `x*` replaces runs
  of x, `\s+$` strips real trailing whitespace, and Find never highlights a span
  of nothing. Say so if you would rather have the JS semantics.

**A second way the loop could stand still,** found while testing: Quill keeps a
newline at the end of every document and will not delete it, so `\s+$` with an
empty replacement met that same newline forever — the text never changed and the
index never moved. `replaceAllInDelta` now treats "text unchanged *and* index
unchanged" as the edit not having taken, steps past the match and does not count
it. The condition is exact rather than approximate: an identity replacement
("cat" for "cat") leaves the text alone too, but always advances the index, so
it still counts as it did before.

### 3. Capture groups in the replacement

*Done.* A match now carries `captures` (the exec array) alongside its index and
length, and `expandReplacement(match, newStr, options)` expands `$1`–`$9`, `$&`
and `$$` from it — in regex mode only, so that outside it a `$` a writer typed
stays a dollar sign, which is the commoner thing to want in prose. A group
number the pattern does not have is left as typed, and a group that took no part
in the match expands to nothing rather than to the word "undefined"; both follow
JavaScript's own `replace`. `replaceAllInDelta` expands per match and resumes
past the *expanded* text, not past the `$1` that was typed.

`replace` takes the match and the options so single Replace expands groups the
same way Replace All does. `spellcheck_display.js` passes neither, and gets its
replacement through untouched.

Two things landed differently from what was written here:

- **`matchesEntireText` is `matchEntireText`, and returns the match** (or null)
  rather than a boolean — the Replace button needs the captures, not just the
  fact of a match.
- **It answers by running the search itself** over the selected text and asking
  whether the match starts at 0 and covers all of it, rather than compiling a
  second `^(?:…)$` pattern. Anchoring would have fought the `m` flag, which
  makes `^` and `$` line boundaries — a multi-line selection could have matched
  on its first line alone. Reusing the compiled search keeps the flags, the
  quote folding and the Whole Word wrapping identical to the search that found
  the match in the first place.

**A bug fixed on the way through.** The old guard compared the selected text to
what was typed in the Find box (`findreplace_display.js:88-93`), so the
straight-quote-finds-curly-quote feature was half broken: Find highlighted the
curly `don’t` for a typed `don't`, and then Replace refused to replace the very
match it had just made, because `'don’t' !== "don't"`. Replace All went through
`findInText` and was never affected, which is what hid it. Asking the search
rather than comparing strings fixes it, and there is a regression test at each
level.

### 4. The checkbox

*Done.* A `#use-regex-check` checkbox labelled "Use Regex" sits directly after
Whole Word Only, and `searchOptions()` carries its state to all three buttons —
so everything phases 1 to 3 built is now reachable.

Error reporting reuses the existing `replacementCount` label, which already
carries "None Found." and the replacement count: `"Invalid pattern: " + reason`.
No new UI element, and it is where the writer is already looking. A single
`patternIsBroken()` calls the exported `compileSearch` and is the first thing
each of the three handlers does, so half a pattern gets a straight answer rather
than a silent "None Found.", a Find that flickers through every chapter to no
purpose, or a Replace All whose closing count would paper over the reason.

The popup's CSS is a plain flow with no id or nth-child rules
(`src/css/index.css:143`), so the extra row needed no style changes.

Checkbox states are rebuilt each time the popup opens and are not persisted
today; regex is not the exception. Out of scope.

### 5. Tests

`test/findreplace.test.js` — everything below except the `$1` line landed with
phase 2, since the behaviour is only worth writing once it exists:
- ✔ `getNextMatch` reports the length of a variable-length match (`c.t`, `a+`).
- ✔ Case-insensitive regex uses the flag, not lowercasing — `\S+` still matches
  with Case Sensitive off (the regression the `i`-flag decision prevents).
- ✔ Whole Word plus regex: `cat|dog` matches in "the dog sat", not in "dogged".
- ✔ `^`/`$` are per-line under `m`, and `.` does not cross a line.
- ✔ Invalid patterns find nothing instead of throwing, `compileSearch` says why,
  and `replaceAllInDelta` leaves the delta untouched and reports the error.
- ✔ Empty matches are stepped over, and Replace All terminates on `x*` and on
  `\s+$` with an empty replacement.
- ✔ `$1` expansion in Replace All; a literal `$1` in non-regex mode; `$$`, `$&`,
  an out-of-range group, and a group that took no part in the match.
- ✔ `matchEntireText` accepts only a whole-text match, carries the captures, and
  accepts the folded-quote selection Find highlighted.
- ✔ Regex mode still finds curly quotes for a straight-quote pattern (the
  folding invariant).

✔ `test/findreplace_display.test.js`: the checkbox exists, its state reaches the
mocked controller in the options object, an invalid pattern puts the message in
the status label, and the Replace guard uses the pattern rather than string
equality when regex is on.

### 6. Documentation

*Done.*

- Two README "Unreleased" bullets: what regex mode does, `$1` in the Replace
  box, that Case Sensitive and Whole Word still apply, that an unfinished
  pattern says so — and separately the Replace/curly-quote bug phase 3 fixed,
  which is user-visible and predates this work.
- A new `Find and Replace` chapter in the bundled Help doc, plus its entry in
  `HelpDoc.woolf` between "File Structure" and "Footnotes". There had never been
  a Find/Replace chapter, which was a gap regardless; it covers the whole dialog
  — the two boxes, the three buttons, the four checkboxes, the quote folding —
  before the pattern syntax, `$1`, and the caveats.

**Checking a chapter that is mostly metacharacters.** `.mdfc` treats `*`, `_`
and `~` as style markers and `#`, `>`, `[>`, `[^` as line-opening ones, so a
page documenting regex syntax is the worst case for the escaping rules — an
unescaped `*` would silently italicize half a paragraph. Rather than reason it
out, the file was run through the real `parseMDF` and `convertDeltaToMDF`
(scratch script, not committed) to confirm two things: that every construct
shows in the editor as written with no inline styles anywhere, and that
`convertDeltaToMDF` writes the file back byte for byte, so WareWoolf will not
rewrite it on first save. That caught one over-escape — `\\.` for `\.`, where
`.` is not a marker and needs no doubled backslash. Worth repeating for any
future chapter with markup in it.

## Order and risk

All six phases are done, on `dev`, uncommitted. The suite is at 2003 passing,
0 failing, with the 2 pre-existing Windows chmod skips.

Phase 1 was the risky one — it touched every path in the module while changing
no behaviour, so the existing suite was the safety net. Phases 2–4 were additive
and unreachable until the checkbox landed.

Two things turned up that the plan had not foreseen, both now fixed and both
with regression tests: `replaceAllInDelta` could loop forever on the newline
Quill keeps at the end of every document (phase 2), and single Replace refused
to replace a match Find had reached through a folded quote (phase 3). The second
predates this work and was shipped.

`src/render.bundle.js` is a build artifact and is gitignored; `npm test`
regenerates it via `pretest`, so nothing has to be rebuilt by hand.

## Deliberately not in scope

- Persisting the checkbox states between sessions.
- Match count / "3 of 12" reporting.
- A regex-aware spellcheck path — `spellcheck_display.js` passes literal words
  and keeps `useRegex: false`.
