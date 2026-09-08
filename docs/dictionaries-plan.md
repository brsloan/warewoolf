# Plan: Dictionaries Tool

A new `File > Dictionaries` dialog with three halves — three thirds, then:

1. **Spellcheck dictionaries** — list every dictionary available to the app,
   tick which ones spellcheck uses (any number of them at once), import new
   ones, remove imported ones.
2. **Personal dictionary** — see, add, edit and delete the words in
   `personal.dic`, with a single text input that filters the list as the writer
   types.
3. **Project dictionary** — the same word-list editor over a list of words
   stored in the `.woolf` itself, so a manuscript's character and place names
   travel with the manuscript instead of leaking into every other project.

Baseline: Phase 9b is done — the renderer holds no `fs`, and everything native
crosses the contract in `src/components/controllers/platform.js`. Group I
(spellcheck) currently declares three commands and hardcodes one dictionary.

## What exists today

`loadDictionary` is hardcoded to a single basename:

```js
const SHARED_DICT_BASENAME = 'en_US-large';                 // platform-node.js:66
var base = normalizePath(paths.app, 'app') + '/' + DICTIONARIES_DIR
  + '/' + SHARED_DICT_BASENAME;                             // platform-node.js:1059
```

`src/dictionaries/` already ships **two** complete pairs — `en_US-large.aff/.dic`
and `en_us.aff/.dic` — plus `personal.dic` and a `license` file. The smaller
`en_us` pair is dead weight today: nothing can select it. The first thing this
feature does is make it reachable, which is a real user-facing win on a
writerDeck (the large dictionary is 946KB and nspell reparses it constantly —
see below).

The personal dictionary lives per-user under `userData/dictionaries/personal.dic`,
seeded with `WareWoolf\n` on first read
([platform-node.js:1069](../src/components/controllers/platform-node.js#L1069)),
and is read/written whole (`loadPersonalDictionary` / `savePersonalDictionary`).
`savePersonalDictionary` already replaces the entire word list, so the editing
half of this feature needs **no new native command at all** — only a UI.

### The reparse

`spellcheck.js` builds a brand new nspell instance on every `runSpellcheck()`
call ([spellcheck.js:20-34](../src/components/controllers/spellcheck.js#L20)),
and `showSpellcheck` calls it again on every Ignore, Ignore All, Change, Change
All and Add To Dictionary click — each of those handlers ends in
`ignoreBtn.onclick()`, which re-enters `showSpellcheck`
([spellcheck_display.js:74-136](../src/components/views/spellcheck_display.js#L74)).
So a pass over a chapter with twenty typos parses 946KB of dictionary twenty
times.

That is a pre-existing performance bug, and it is also the thing that decides
whether multiple simultaneous dictionaries are affordable. Fixing it is part of
this plan (see [Caching](#caching-the-spellchecker)), and it turns N
dictionaries into N parses per *pass* rather than N parses per *click*.

## Multiple simultaneous dictionaries

### Why not nspell's own multi-dictionary support

nspell's constructor accepts an array — but only the **first** entry's `aff` is
used, and every subsequent `.dic` is parsed against that first affix file's
rules and flag table
([nspell/lib/index.js:31-38](../node_modules/nspell/lib/index.js), and the
readme's own "other `aff` keys are ignored"). For two dictionaries of the same
language that is usually harmless. Across languages it is wrong in a way that
produces confidently incorrect results rather than an error: a French `.dic`
line like `parler/a` has its `/a` flag looked up in the English affix table, so
the checker generates English-shaped inflections of French stems and accepts
words that exist in neither language. `suggest()` is worse — the replacement
table and the character conversions all come from the first `aff` too, so
suggestions for a misspelled French word are ranked by English orthography.

**So: one nspell instance per selected dictionary.** A word is correct if *any*
instance calls it correct; suggestions are merged. This is strictly more correct
than the array form, and it subsumes it — the "base language plus a supplementary
word list" case works either way, and the bilingual case only works this way.

The cost is N parses and N resident dictionaries, which is exactly what the
caching fix below pays for.

### Merging

```js
function correct(word){
  return instances.some(function(sp){ return sp.correct(word); });
}
```

Suggestions are **round-robin interleaved**, not concatenated: take each
instance's first suggestion, then each instance's second, and so on, dropping
duplicates and capping the result (10). Concatenating would let the primary
dictionary's tenth-best suggestion outrank a second dictionary's best, which for
a bilingual writer means the right word is never in the list. Interleaving needs
no notion of a "primary" dictionary at all, which is what lets the selection be
an unordered set and keeps Move Up/Move Down buttons out of the UI.

The personal and project word lists are applied to **every** instance via
`nspell#personal()`, not just the first. They are a few hundred words against a
50,000-word dictionary, so the duplication is free, and it is what removes the
last reason to care which dictionary is "first".

### Caching the spellchecker

`spellcheck.js` gains a cached instance list plus an explicit release:

```js
var cached = null;                  // { signature, instances }

async function getSpellchecker(){ ... }        // was loadDictionaries()
function releaseSpellchecker(){ cached = null; }
```

The signature is the selected ids joined, so a change of selection rebuilds on
its own. `releaseSpellchecker()` is called from `closePopups()`'s path out of
the spellcheck dialog and from the Dictionaries dialog's Save — the dictionaries
are held for the duration of one spellcheck pass and dropped afterward, rather
than resident for the life of the app. That matters on a writerDeck: a parsed
`en_US-large` is tens of megabytes, and holding two or three of those forever to
save a parse the writer takes minutes to trigger again is the wrong trade.

Add To Dictionary / Add To Project do **not** invalidate — they call
`nspell#add(word)` on each live instance, so the word is accepted immediately
and the pass continues without a reparse.

Renaming the internal `loadDictionaries()` to `getSpellchecker()` is not
cosmetic: the platform command it calls becomes `loadDictionaries` too, and two
things a line apart with the same name and different meanings is how the wrong
one gets called.

## Where imported dictionaries go

`paths.app` is `__dirname` of the packaged app ([index.js:550](../src/index.js#L550)).
On Windows and macOS that is under `Program Files` / the app bundle — often not
writable, and wiped by the next update. So:

- **bundled** dictionaries are read from `paths.app/dictionaries/`
- **imported** dictionaries are written to and read from `paths.userData/dictionaries/`,
  the directory `personal.dic` already lives in

A dictionary is a `.aff`/`.dic` pair sharing a basename. The basename is its id.
`personal.dic` is excluded from the listing by that rule alone — it has no
`.aff` — but the exclusion is asserted explicitly in a test anyway, because "the
writer's word list appeared as a selectable language" is the kind of bug that
only shows up on someone else's machine.

**Ids are unique across both directories.** An import whose basename collides
with anything already listed is refused with a message naming the conflict,
rather than shadowing it. Shadowing would mean removing an imported dictionary
silently changes which words are correct, and there is no way to show that in a
list. Refusing is one sentence to explain and has no hidden state.

## Contract changes (Group I)

Four commands, one of them a replacement. All follow the existing rules: one
object argument, domain level, and nothing that hands the renderer an arbitrary
read or write primitive.

```js
// --- I. Spellcheck ----------------------------------------------------------
loadDictionaries: { group: 'I', params: ['ids'], returns: '{ id, aff, dic }[]' },
listDictionaries: { group: 'I', params: [],
  returns: '{ id, source: "bundled"|"imported", removable }[]' },
readDictionaryFiles: { group: 'I', params: ['affPath'], optional: ['dicPath'],
  returns: '{ id, aff, dic }' },
importDictionary: { group: 'I', params: ['id', 'aff', 'dic'], returns: 'void' },
removeDictionary: { group: 'I', params: ['id'], returns: 'void' },
```

**`loadDictionary` becomes `loadDictionaries({ ids })`**, returning one entry per
dictionary it actually loaded. One round trip rather than N: each pair is around
a megabyte of text crossing the bridge, and three sequential invokes to fetch
what is always fetched together is three chances to be half-loaded.

Ids that are not on disk are skipped, and an `ids` that resolves to **nothing**
— empty, absent, or every entry missing — falls back to `SHARED_DICT_BASENAME`.
The fallback is not defensiveness; it is the behaviour when a writer removes a
dictionary they had selected, unticks everything, or copies their
`user-settings.json` to a machine where an import does not exist. Spellcheck must
not break because a setting points at nothing. The returned ids are what let the
dialog say which dictionaries are genuinely in use rather than which ones were
asked for.

**`readDictionaryFiles` is separate from `importDictionary` on purpose.**
Import is validate-then-commit: the renderer reads the pair, hands the text to
nspell, and only calls `importDictionary` once nspell has parsed it. Nothing is
ever written that spellcheck cannot then load. Doing the copy natively in one
step would mean discovering a bad file only on the next spellcheck run, with a
broken entry already sitting in the list.

It is also the one piece that genuinely has to be native, and not because of
file access. Hunspell `.aff` files declare their own encoding on a `SET` line,
and a good number of dictionaries in circulation are `ISO8859-1` or
`ISO8859-15`, not UTF-8. `readTextFile` (group F) decodes as UTF-8
unconditionally, so importing one through it would mangle every accented word in
the file into replacement characters — and nspell would accept it, because
mojibake is still valid text. `readDictionaryFiles` reads bytes, decodes per the
`SET` line, and returns UTF-8 strings; `importDictionary` writes them out with
the stored `.aff`'s `SET` line rewritten to `UTF-8` so it matches its own
contents. That is byte decoding, which is an OS-level job, and it is the only
part of this that is.

`dicPath` is optional so that a **bare word list** can be imported — a `.txt` or
`.dic` of names with no affix file at all, which is what a writer importing
"every character in my series" actually has. With no `.aff`, `SET UTF-8\n` is
generated as one. This is the same mechanism the project dictionary uses and
costs nothing extra.

`removeDictionary` refuses anything under `paths.app` with `INVALID_ARGUMENT` —
bundled dictionaries are not the writer's to delete, and the removable flag in
the listing is a UI hint, not the guard.

### Files touched

| File | Change |
| --- | --- |
| `src/components/controllers/platform.js` | four Group I entries; `'dictionaries-clicked'` in `EVENTS` |
| `src/components/controllers/platform-node.js` | the four implementations; `SHARED_DICT_BASENAME` becomes the fallback rather than the only option |
| `docs/native-command-inventory.md` | Group I table (currently lines 495-497) |

`platform-ipc.js`, `platform-host.js` and `preload.js` need **no change** —
all three iterate `COMMANDS`/`EVENTS` rather than holding their own list, which
is exactly the property Phase 9a bought.

## Per-project dictionaries

### The recommendation: a field in the `.woolf`

`projectDictionary: []` on the object `newProject()` returns
([project.js:17-42](../src/components/models/project.js#L17)). That is the whole
storage design, and it works because of two properties the project format
already has:

- `stringifyProject` is a **denylist**, not an allowlist
  ([project.js:173-192](../src/components/models/project.js#L173)) — it names the
  keys to drop and passes everything else through. A new field is written to the
  `.woolf` with no change to the serializer.
- `loadFile` restores with `Object.assign(this, opened.project)`
  ([project.js:64](../src/components/models/project.js#L64)) — a key absent from
  an older `.woolf` leaves the `newProject()` default in place, so every existing
  project opens with an empty list and nothing to migrate.

Together those give something better than compatibility in one direction: a
`.woolf` carrying `projectDictionary` opened by **WareWoolf 2.5 and earlier**
has the unknown key copied onto the project by `Object.assign` and written back
out by `stringifyProject` untouched. An older build cannot use the list, but it
cannot destroy it either — a writer moving a project between machines running
different versions does not lose their character names.

It also inherits the whole file-handling surface for free, which is the part
that would otherwise be most of the work:

| | why it works |
| --- | --- |
| Save As / Save a Copy | the `.woolf` is re-serialized from the live object at step 3 ([project.js:207](../src/components/models/project.js#L207)) |
| Backup / archive | `archiveProject` zips the project directory, `.woolf` included |
| Send via Email | the `projectArchive` attachment form is the same zip |
| Corkboard, compile, export | untouched — they never see it |

### The two alternatives, and why not

**A sibling file** (`<project>_chapters/project.dic`). Plain text, editable
outside WareWoolf, and it *would* be copied by Save As, since `saveProjectAs`
copies the chapters directory wholesale. But it is a second file that can go
missing independently of the project that describes it, it needs its own load
path, its own error handling when it is unreadable, and its own answer to "the
writer renamed the chapters directory". None of that buys anything over a field
in a file that is already loaded and saved atomically with the project.

**A reference chapter.** The project already carries `reference: []`. Storing
the word list as one would make it editable in the main editor for free — and
would also put a document called "Dictionary" in the writer's sidebar, inside
their manuscript, exportable and compilable by accident. The mechanism is not
the point; the word list is not a document.

### Optional: a per-project dictionary *selection*

The same field pattern extends to the other axis, for a writer whose next book
is in another language:

```js
projectDictionaries: null,   // string[] | null; null = use the global selection
```

Resolution is one line at the point the ids are chosen — the project's value
when it is non-null, the global setting otherwise — and everything downstream is
unchanged. Worth including if the multi-language case is real; it is the only
piece of this plan that is genuinely optional, since the word list above is
what "per-project dictionary" means to most writers.

### Sanitizing

`Object.assign` copies whatever is in the file, and nothing validates it — the
same hole the `isReadOnly` comment at
[project.js:92-95](../src/components/models/project.js#L92) documents for a
hand-edited `.woolf`. So immediately after the assign, `projectDictionary` is
normalised to an array of non-empty strings (anything else becomes `[]`), the
same discipline `SETTINGS_SCHEMA`'s `sanitize` functions apply to
`user-settings.json`. A `.woolf` with `"projectDictionary": "Aurelion"` must not
turn into a spellchecker that accepts every single letter of it.

### Three tiers, one checker

| tier | lives in | scope |
| --- | --- | --- |
| dictionaries | `app/` and `userData/dictionaries/` | the languages |
| personal | `userData/dictionaries/personal.dic` | this writer, every project |
| project | the `.woolf` | this manuscript |

Personal and project are concatenated and handed to `nspell#personal()` on each
instance, so nothing downstream of `getSpellchecker()` knows there are two of
them.

### What this does to Add To Dictionary

The spellcheck popup's one `Add To Dictionary` button
([spellcheck_display.js:127-135](../src/components/views/spellcheck_display.js#L127))
becomes two, because the answer for a character name and the answer for a word
the writer will use in every book are different, and only the writer knows
which they are looking at:

```
[ Add To <D>ictionary ]   -> personal.dic, accessKey 'a' as today
[ Add To <P>roject ]      -> project.projectDictionary, accessKey 'p'
```

Add To Project is disabled with no project open (the Help doc, a fresh window),
which is the only state it has to handle. It sets `project.hasUnsavedChanges = true`
rather than writing — the same thing `convert-italics.js:19` and every other
project-wide edit does, so the word is saved by the next Ctrl+S or autosave and
is covered by the existing unsaved-changes guard on exit.

**A judgement call worth flagging:** for a novelist, Add To Project is the more
common action, so it has the better claim on the existing `a` key. Keeping `a`
on the personal dictionary is what is planned here, purely because silently
repointing a key a writer already has in their fingers is worse than a
suboptimal default. Swapping the two access keys is a two-line change if you
disagree.

## The selected dictionaries setting

One new field in `SETTINGS_SCHEMA`
([user-settings.js:27](../src/components/models/user-settings.js#L27)):

```js
spellcheckDictionaries: { type: 'object', sanitize: sanitizeDictionaryIds },
```

An array of ids, defaulting to `[]`, which means "whatever the app ships as
default" — so a writer who never opens this dialog keeps working after an update
that changes the bundled default. It takes a `sanitize` rather than a type for
the reason the schema's own comment gives: `type: 'object'` waves through
anything, and this has to be an array of strings entry by entry. `sanitizeDictionaryIds`
returns `[]` for anything it cannot make sense of, matching `sanitizeOverrides`
and `sanitizeAutocorrect`.

Threading it into `spellcheck.js` is the one place with a real design choice.
`runSpellcheck` is called from `showSpellcheck`, which recurses through its own
Ignore/Change buttons, so a fifth positional parameter would have to be carried
through every one of those call sites and would be dropped by whichever one was
forgotten. Instead `spellcheck.js` grows module-level setters, matching
`setPlatform` in `error-log.js` and `user-settings.js`:

```js
var selectedDictionaries = [];
var extraWords = [];                        // personal + project, merged by the caller
function setSelectedDictionaries(ids){ ... } // both invalidate the cache
function setProjectWords(words){ ... }
```

`setSelectedDictionaries` is called once from `loadPlatformState()`
([render.js:201](../src/render.js#L201)) right after `userSettings` lands, and
again from the dialog's Save. `setProjectWords` is called there too, and from
`displayProject()`/`setProject` whenever a project is opened or created — the
one place that already knows the project changed. No caller of `runSpellcheck`
changes at all.

## Menu wiring

`File > Dictionaries`, placed directly after `Settings`
([index.js:252-256](../src/index.js#L252)) and before the separator above
`File Manager` — it belongs with the other configuration items, not with the
document commands. **No accelerator.** Every menu accelerator is handled
natively before the page sees the keydown, which is the trap `Backup` documents
at [index.js:203](../src/index.js#L203); this is a dialog opened rarely and does
not need to spend a chord.

```js
{
  label: 'Dictionaries',
  click(item, focusWindow){
    mainWindow.webContents.send('dictionaries-clicked');
  }
},
```

Then `'dictionaries-clicked'` in `EVENTS` and one entry in `menuCommands`
([render.js:1531](../src/render.js#L1531)), alongside `settings-clicked`:

```js
'dictionaries-clicked': { run: function(){
  const showDictionaries = require('./components/views/dictionaries_display');
  return showDictionaries(userSettings, project, function(){
    setSelectedDictionaries(userSettings.spellcheckDictionaries);
    setProjectWords(project.projectDictionary);
    releaseSpellchecker();
  });
} },
```

No `requiresFocus` — like Settings and File Manager, it is reachable with no
project open.

The EVENTS count assertions move 37 → 38 in three places:
[platform.test.js:402](../test/platform.test.js#L402),
[platform-ipc.test.js:161](../test/platform-ipc.test.js#L161),
[preload.test.js:208](../test/preload.test.js#L208). The
"every menu channel is registered exactly once"
test ([render.test.js:806](../test/render.test.js#L806)) and the
EVENTS-vs-`index.js` cross-check ([platform.test.js:419-431](../test/platform.test.js#L419))
then cover the wiring for free — a channel added to one side and not the other
fails the suite rather than becoming a menu item that does nothing.

## The dialog — `src/components/views/dictionaries_display.js`

Standard popup: `removeElementsByClass('popup')`, a `div.popup`, an `h1`, three
`fieldset`s, buttons built with `createButton` so the `<span class='access-key'>`
pattern works, `closePopups()` on Cancel. Follows `settings_display.js`
throughout, including its edits-in-memory-until-Save model — Cancel has to mean
something, and a word list that saved on every keystroke would rewrite the file
dozens of times while a writer is just looking.

### Fieldset 1 — Spellcheck Dictionaries

```
+-- Spellcheck Dictionaries ---------------------------+
|  [x] en_US-large                        (bundled)    |
|  [ ] en_us                              (bundled)    |
|  [x] fr_FR                              (imported)   |
|  [ ] tolkien-names                      (imported)   |
|                                                      |
|  [ Import... ]  [ Remove ]                           |
+------------------------------------------------------+
```

Checkboxes rather than a `<select multiple>`. Multi-selecting in a listbox needs
Ctrl+arrow, which is a poor fit for an app whose stated goal is being usable
without a mouse; a checkbox takes Space, and each one carries a real `<label>`.
The list is short by nature — this is not the word list.

Populated from `listDictionaries()`, ticked from
`userSettings.spellcheckDictionaries`. When that resolves to nothing, the
default is shown ticked with a line underneath saying it is the fallback, rather
than showing an empty selection that is not what spellcheck will actually do.

`Remove` acts on the highlighted row and is disabled unless it is `removable`;
it routes through the existing `delete-confirmation_display.js`. Unlike the word
lists, remove writes through immediately — it is a file operation, not a pending
edit, and pretending otherwise would mean holding a deletion across a Cancel.

**Import** opens the in-app `showFileDialog` (`dialogType: 'open'`, filters for
`.dic`/`.aff`/`.txt`) — the same picker Import and Export already use, so it
works without a mouse. From the file the writer picks, the sibling with the
other extension and the same basename is inferred; a missing `.aff` means a bare
word list (fine, one is generated), a missing `.dic` is reported by name. Then:

1. `readDictionaryFiles({ affPath, dicPath })`
2. construct `nspell({ aff, dic })` in the renderer and check a known word from
   the `.dic` comes back correct — a `.dic` that parses to zero usable words is
   the common failure for a file that is actually an `.oxt` or an HTML error page
3. `importDictionary({ id, aff, dic })`
4. refresh the list, tick the new entry

A failure at any step reports the reason and writes nothing.

### Fieldsets 2 and 3 — Personal and Project word lists

The same widget twice. Factored into one local `wordListEditor({ legend, words,
emptyNote })` returning `{ element, getWords }`, because two hand-written copies
of a filter-and-edit list is two places for the filtering to drift:

```
+-- Personal Dictionary -------------------------------+
|  Filter/Word: [ dor                             ]    |
|                                                      |
|  Dorrigo                                             |
|  Dorset                                              |
|                                        (2 of 214)    |
|                                                      |
|  [ Add ]  [ Edit ]  [ Delete ]                       |
+------------------------------------------------------+
```

One text input, doing the two jobs the same string is good for:

- **as a filter** — every keystroke re-renders the list to words containing the
  typed text, case-insensitively. The count line shows `N of M`, so an empty
  list reads as "nothing matched" and not "your dictionary is empty".
- **as the value for Add** — `Add` is enabled when the input is non-empty and no
  word matches it exactly, and appends it to the list. Typing a word to check
  whether it is already there and then adding it is one gesture, not two.

`Edit` puts the highlighted word into the input and switches it to editing mode
(the button row becomes `Save Word` / `Cancel Edit`, and filtering pauses so the
list does not shift under the writer while they retype). `Delete` removes the
highlighted words — `multiple` is on, so a writer can clear out a run of typos
from an over-eager Add To Dictionary in one go. Here a listbox *is* right: this
list runs to hundreds of entries and wants arrow keys and type-ahead.

The project fieldset is identical but reads and writes `project.projectDictionary`,
is replaced by a single explanatory line when no project is open, and carries one
extra button — `Import Word List...`, which reads a `.txt` through `readTextFile`
and merges its non-empty lines. Bulk-adding two hundred names from a series bible
one at a time through this UI is not a thing anyone would do.

Words are normalised through `spellcheck.js`'s existing `forDictionary()` on the
way into either list, flattening a curly apostrophe to a straight one. This is
not cosmetic: the whole mechanism depends on it, since every *lookup* in
`findInvalidWord` flattens too, so an entry stored as `don’t` could never be
found again ([spellcheck.js:98-108](../src/components/controllers/spellcheck.js#L98)).
`addWordToPersonalDictFile` already does this; a hand-typed entry must not be
able to sidestep it. `forDictionary` moves into the module's exports for this.

### Save

`savePersonalDictionary({ words })` writes the personal list whole;
`project.projectDictionary` is assigned and `project.hasUnsavedChanges` set;
`userSettings.spellcheckDictionaries` is assigned and `userSettings.save()`
called. Then the callback re-points `spellcheck.js` and releases the cache.

### CSS

Two new rules in `src/css/index.css`, near the existing `.file-manager-list`
block (line 370): a `.word-list` height/width for the two listboxes, and a
`.dictionary-checklist` max-height with `overflow-y: auto` so a writer with a
dozen imports does not get a popup taller than the screen. The popup, fieldset,
label and button styling all already apply.

## Tests

| File | Adds |
| --- | --- |
| `test/platform.test.js` | `listDictionaries` finds both bundled pairs and excludes `personal.dic` and `license`; an `.aff` with no `.dic` is not listed; imported entries are `removable`, bundled are not; `loadDictionaries({ids})` returns them in order and skips missing ids; empty/all-missing falls back to the default and reports the id it loaded; `importDictionary` refuses a colliding id; `importDictionary` with no `.aff` generates one; `readDictionaryFiles` decodes an `ISO8859-1` pair correctly and rewrites the stored `SET` line; `removeDictionary` refuses a bundled id with `INVALID_ARGUMENT`; EVENTS 37 → 38 |
| `test/platform-ipc.test.js`, `test/preload.test.js` | EVENTS 37 → 38 |
| `test/spellcheck.test.js` | a word in the *second* selected dictionary is accepted; a word in neither is not; suggestions from two dictionaries are interleaved and deduped; project words are accepted and personal words still are; the instance list is built once across a multi-word pass and rebuilt after `releaseSpellchecker()`; `nspell#add` via Add To Project takes effect without a rebuild; an unknown id is skipped and an all-unknown selection falls back |
| `test/project.test.js` | `projectDictionary` round-trips through save/load; absent from an older `.woolf` it defaults to `[]`; a non-array value is sanitized to `[]`; it survives Save As and Save a Copy |
| `test/spellcheck_display.test.js` | Add To Project is disabled with no project open, sets `hasUnsavedChanges` when it is, and does not write the personal file |
| `test/dictionaries_display.test.js` (new) | list renders with source tags and ticks the saved selection; ticking and saving writes the array; the filter narrows each word list and updates its count; Add/Edit/Delete mutate the pending list; Save calls `savePersonalDictionary` with exactly the resulting words and assigns the project list; Cancel calls nothing and leaves the project clean; the project fieldset is replaced by a note with no project; import failure at each of the three steps writes nothing |
| `test/render.test.js` | `'dictionaries-clicked'` registered exactly once (covered by the existing table test once the channel exists) |

The display tests follow `settings_display.test.js` and
`file-dialog_display.test.js` — jsdom plus the fake bridge, no mocked fs.

## Order of work

1. **Contract + backing.** The four Group I commands and their tests. Nothing
   user-visible; the suite proves the whole native half before any UI exists.
2. **Multi-instance checker + cache.** `getSpellchecker()`, the `some()`/
   interleave merge, `releaseSpellchecker()`, the module-level setters. Shipped
   on its own this is already a fix: the per-click reparse goes away.
3. **Settings + project field.** `spellcheckDictionaries` in the schema with its
   sanitizer, `projectDictionary` on the project with its normalisation, both
   wired from `loadPlatformState`/`setProject`. Still nothing user-visible — but
   hand-editing `user-settings.json` and a `.woolf` now selects dictionaries and
   project words, which is the whole feature working headless.
4. **Menu channel.** Menu item, `EVENTS`, `menuCommands`, count assertions.
   Opens an empty popup.
5. **The dialog.** The shared word-list editor first (it needs no new commands
   and is the half a writer touches most), then the two fieldsets built on it,
   then the dictionary checklist, then Import.
6. **Add To Project** in the spellcheck popup.
7. **Docs.** Help doc chapter, README line, inventory table.

Steps 1-4 are independently shippable and leave the app strictly working; step 5
is the only one that can be half-done, which is why the pieces inside it are
ordered rather than built together.

## Help doc

`src/examples/HelpDoc/HelpDoc_chapters/Dictionaries.txt`, plus its entry in
`HelpDoc.woolf`'s `chapters` array (alphabetical, between `Corkboard` and
`Exporting and Compiling`). Worth writing at the same time as the feature rather
than after. Three things in it are not discoverable from the UI: where imported
dictionaries are stored and that they survive an update while bundled ones are
replaced by it; that ticking two dictionaries means a word is accepted if either
one knows it, which is looser than most writers expect; and the difference
between the personal and project lists, which is the whole reason there are two.

`README.md`'s feature list gets a line as well.

## Deliberately not in scope

- **`.oxt` / `.zip` import.** LibreOffice distributes dictionaries as `.oxt`,
  which is a zip. `extractZip` already exists in group F, so this is a small
  addition later — but it needs its own decisions about which pair inside an
  archive to take when there are several, and that is a second feature, not a
  detail of this one.
- **Downloading dictionaries.** Reaching the network for a word list is a
  different trust question, and WareWoolf is built to work on a machine with the
  Wi-Fi off.
- **Per-dictionary suggestion weighting.** Round-robin treats every selected
  dictionary as equally likely to hold the intended word. A writer whose second
  dictionary is a 200-name list will see those names ranked alongside real
  suggestions. Fixable later by ranking on edit distance across the merged set
  rather than by position; not worth the complexity until someone hits it.
- **Language detection per paragraph.** The thing that would make a bilingual
  manuscript check *properly* rather than permissively. A long way outside this.
