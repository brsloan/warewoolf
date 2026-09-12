# Changelog

All notable changes to WareWoolf are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before v0.9.0 were never tagged or published; the work from that period is summarized under [Pre-release development](#pre-release-development) at the end of this file. Dates are the release dates announced by the author, which may differ by a few hours from the UTC timestamps on the GitHub releases.

## [Unreleased]

## [3.0.0] - 2026-09-12

### Added

- **Customizable keyboard shortcuts.** Open the Shortcut Helper (`Ctrl+H`, `Cmd+Shift+H` on Mac), pick a shortcut, and press the keys you want. Backspace clears one; Restore Defaults puts them all back; changes persist between sessions. Keys the app cannot give up are refused rather than silently broken. A writerdeck's own special keys can be bound too — by name, by physical code, or by keycode, whichever the key reports.
- **Automatic substitutions as you type.** Straight quotes become curly (opening or closing to suit), two hyphens become an em dash, three periods become an ellipsis. `Ctrl+Z` undoes just the substitution and leaves what you typed. Switchable off in whole or rule by rule in File > Settings.
- **Tools > Convert Straight Quotes Etc.**, applying those same substitutions to a whole manuscript at once, for work written before the feature existed or imported from elsewhere.
- **Blockquotes.** `Ctrl/Cmd+Shift+Q` in the editor, the `>` marker in MarkdownFic, and a real Word blockquote style on .docx export. An alignment marker can now be combined with a blockquote or list marker, so a centered quotation or bullet round-trips.
- **First-class footnotes.** `Ctrl/Cmd+Alt+F` inserts a numbered marker and opens its note at the foot of the chapter; the same keys jump between the two afterwards. Numbering is automatic and renumbers as you add, delete, or reorder; deleting a marker takes its note with it; copying one carries its note along. Notes export as real Word footnotes in .docx, linked notes in HTML and EPUB, and `[^1]` markers in Markdown — and compiling a whole project numbers every chapter's notes into one sequence.
- **File > Dictionaries.** Tick any number of dictionaries at once, import your own (a Hunspell .aff/.dic pair, or a bare word list), and edit your personal dictionary directly instead of only adding to it from the spellcheck popup. Projects now carry their own word list for character and place names that shouldn't leak into other manuscripts, with a new **Add To Project** button beside Add To Dictionary in the spellcheck popup. The word-list editor is fully keyboard-driven.
- **HTML and EPUB import** (`.html`, `.htm`, `.xhtml`, `.epub`). Both can be split into chapters as they are read: HTML at a chosen heading level and/or at horizontal rules, EPUB by the book's own table of contents, so Moby-Dick arrives as 141 chapters rather than the eleven files it is packed into. Italics marked by a stylesheet rather than a tag are still read as italics, tables come in as Markdown-style pipe rows, and Project Gutenberg's license header and footer can be stripped on the way in.
- **Use Regex option in Find/Replace**, for searches that are about a shape rather than a word. In the Replace box, `$1` stands for whatever the first bracketed group matched, so finding `(\w+), (\w+)` and replacing with `$2 $1` turns every "Smith, John" into "John Smith". Case Sensitive and Whole Word Only still apply; with the box unticked, the Find box is ordinary text exactly as before. While a pattern is still half-typed, the line under the buttons says which part is unfinished rather than reporting nothing found.
- **Page estimates.** Every word count now reads like `1000 wds / ~4 pgs`, in the Word Count window and beside the Outliner's per-chapter counts. A new Words Per Page field under the Goal is what that divides by — it starts at 300, the traditional double-spaced manuscript page, and is remembered for every project opened afterwards.
- **Mark scene breaks with a centered `#`**, a new box in both Compile and Export for standard manuscript format. Only a blank line with an ordinary paragraph on both sides is marked, which leaves the gap under a chapter heading, the blank lines trailing at the end of a chapter, and anything beside a list, quotation, or footnote exactly as they were. Your own chapters are untouched; the mark is added to the copy on its way into the file. The setting is remembered.
- **Windows in-app updates.** Check For Updates can now download and install the update: click Install, wait (it can take a few minutes on a slow connection), then Restart To Finish — no more finding the download yourself and clicking past "Windows protected your PC". Downloading and running the installer by hand still works. Linux and Mac are unchanged.
- **A portable Windows build** (`warewoolf_<version>_Windows_Portable_x64.zip`), alongside the installer. Unzip it and run WareWoolf out of the folder: nothing is installed, nothing is added to the Start Menu or Add or Remove Programs, and deleting the folder removes it. For a USB stick, a machine you are not allowed to install software on, or a look at WareWoolf without committing to it. Check For Updates knows which of the two you are running and offers the matching download — the next portable zip for a portable copy, which you unzip and swap for your folder, rather than an installer that would leave it behind. Your projects and settings live outside the folder either way, so replacing it loses nothing.
- **Font settings** in File > Settings, under Appearance: one for the manuscript and one for the sidebars, chosen separately so the chapter list can stay plain while you draft in Courier. Eight choices, including Times and Garamond, a typewriter face, and Atkinson Hyperlegible and OpenDyslexic. WareWoolf ships no fonts of its own, so each choice uses the best face of its kind you already have installed — which is why a sample line under each dropdown shows what you will actually get.
- **A line spacing setting** for the manuscript, in the same place: Single, One and a Half, Double, or Two and a Half. Only the middle panel moves; it starts on Double, which is what WareWoolf has always used.
- **Two more options in the Tab-Indent Paragraphs dialog.** "Correct Current Tabs" (on by default) takes the tab off any paragraph that should not have one, so a manuscript indented by the old tool or by hand is put right rather than only added to; it also reads a line holding nothing but tabs or spaces as the blank line it looks like. "Remove Blank Lines Between Paragraphs" (off by default) closes up the blank line between paragraphs and condenses longer gaps to a single line — the quickest way to turn a blog-styled document into a book-styled one, since the closed-up paragraphs are then indented in the same pass. Blank lines under a heading, around a quotation or list, and at the top or bottom of a chapter are left where they are.
- **File > Reboot, on Linux only**, which restarts the machine from inside WareWoolf — otherwise a trip to a terminal on a writerDeck that boots straight into the app. It goes out the same way Exit does: unsaved changes are checked and an auto-backup still runs first, so it is a safer restart than the command-line one as well as a quicker one. It uses `systemctl`, and says so if the system refuses the reboot.
- **A legacy macOS build** (`warewoolf_<version>_MacOS_Legacy.dmg`) for macOS 10.15 "Catalina" through 12 "Monterey", which the Electron 44 mainline builds no longer support. Same source, packaged against Electron 32; Intel-only, so it runs under Rosetta on Apple Silicon. CI produces it on every tagged release and routes its update checks separately. Electron 32 no longer receives Chromium security updates, so prefer a mainline build if your Mac can run one.
- **Accessibility work:** every popup, region, editor, and field is now named for assistive technology, and the app has been given a classic paper-and-ink design that meets WCAG 2.1 AA contrast in both light and dark themes. The chapter list is a proper list box, so a screen reader announces the chapter the arrow keys land on, and a chapter opened from inside the editor is announced by title. On the corkboard, a card's finished mark and colour are read out with its fields, and every shortcut says what it did — finished, coloured, moved, inserted, deleted.

### Changed

- **Tools > Indent All Paragraphs is now Tab-Indent Paragraphs**, and opens a dialog rather than running the moment you click it. It follows the usual typographic rule for the indent: the tab marks the break between one paragraph and the next, so a paragraph with nothing above it to be separated from is left flush at the margin. "Do Not Indent After" is where you say which those are — New Chapter, Headings, Blank Lines, Blockquotes, and Lists, all ticked to begin with. Headings, list items, and block quotations are still never indented themselves.
- **MarkdownFic reads four spaces as a tab when nesting list items**, matching how most Markdown editors indent a sub-list. Spaces only nest an item that directly follows another list item, so an indented paragraph of prose that happens to begin with a hyphen is still prose. WareWoolf still writes tabs, so a space-indented list is normalized on the first save.
- **MarkdownFic treats `#`, `>` and `[>` as ordinary characters everywhere except the start of a line**, which is the only place any of them was ever read as a marker. A manuscript mentioning "File > Dictionaries" or "C#" is no longer written to disk as `File \> Dictionaries` and `C\#`, and a backslash typed mid-sentence stays a backslash instead of quietly disappearing. Where a line really does begin with one of those characters it is still escaped, and the escape still honoured, so a paragraph opening `> ` stays prose rather than turning into a quotation. HTML and EPUB export follow the same rule, so the file, the editor, and the export all agree.
- **Escaping narrowed further:** `#` and `[>` are escaped only where a marker could actually be read, not merely where one begins. A heading needs one to four hashes and a space, and an alignment marker needs one of its four letters and `] `, so a paragraph opening `#hashtag`, `##### deep`, or `[>x] ` is now written as typed instead of carrying a backslash it never needed. A footnote reference is `[^`, digits, and `]`, so a `[^` that could never be one is left as typed too.
- **A backslash of your own is now doubled wherever the reader would otherwise take it for an escape**, and `\\` reads back as the one backslash you typed. A paragraph beginning `\#` or `\-`, or ending in a backslash right before a styled word, used to lose it silently on every save. Anywhere else a backslash is still written as itself, so `a \ b` and `C:\Users` are untouched. HTML and EPUB export take the escapes off in the same order the editor does.
- **The Windows download is an installer again.** Releases from v0.9.0 to v2.2.1 were built by hand and shipped a Setup.exe; when release builds moved to CI for v2.3.0 the Windows job was pointed at the wrong maker, and v2.3.0 through v2.5.0 shipped a bare application folder under the same filename — no install step, and no entry in Add or Remove Programs. If you installed one of those four, run the new installer and then delete the folder you unzipped; it will not remove it for you, and a copy of WareWoolf left lying around is only wasted disk space, not a problem for the installed one. Your projects and settings are untouched either way, since neither version keeps them beside the program.
- Help doc updates: a new Find and Replace page covering the whole dialog and the pattern syntax, a chapter of its own for footnotes, documentation for the Dictionaries tool and for HTML/EPUB import, and — on the MarkdownFic page, which had never mentioned any of them — underline, lettered list markers (`a. item`), and the escaping rules.
- The project, settings, and corkboard files are now written atomically, so an interrupted save cannot leave a truncated file.
- The zip and mail modules are loaded on first use rather than at startup, shortening launch time.
- The sidebars start in a sans face rather than the manuscript's serif, and the chapter list's row spacing is tighter.
- Development files are no longer included in the packaged app.
- v2.4.0's stated minimum OS requirements were corrected: 64-bit Windows 10 or newer and macOS 13 "Ventura" or newer (not 10.15). Electron 44 no longer builds for 32-bit Windows or 32-bit (armv7l) Raspberry Pi OS.

### Fixed

- The Bullets/Numbered List shortcut (`Ctrl/Cmd+Shift+B`) never worked, because the File > Backup menu item claimed the same keys. Backup is still on the File menu, without a shortcut.
- A project shipped with the app — the Help doc, or the bundled example — could be opened writable and edited in place. Anything inside the install directory now opens read-only, and `Ctrl/Cmd+S` on it offers Save As so your annotated copy gets a home of its own.
- An italicized phrase beginning with a space turned its paragraph into a bullet: `* ` at the start of a line is a list marker, and such a run was written as exactly that, so the paragraph came back a list item having lost both its italics and its space. The space is now written in front of the marker, where it reads as indenting — which is also the rule CommonMark uses, so the Markdown export of such a phrase renders as emphasis now too. A space in the middle of a styled span is untouched.
- A marker spelled across two runs is now escaped properly. `1.` followed by ` item` is a numbered list marker once written out, though neither half is one on its own, and a paragraph beginning that way came back a list item with its first characters eaten. The same went for `[>c]` plus ` centered`, `##` plus ` heading`, and a `~` or `_` meeting its pair at a run boundary.
- Spellcheck now understands contractions written with a curly apostrophe, instead of stopping on both halves of "don't".
- A straight quote typed into Find/Replace now finds curly ones too, so searching for a line of dialogue still works. Searching for a specific curly quote still finds only that one.
- Replace refused to replace the match Find had just highlighted, if it had been found through a straight quote matching a curly one. Find would highlight "don’t" for a typed "don't" and then Replace did nothing, because it compared the highlighted text with what you had typed instead of asking the search. Replace All was never affected, which is what hid it.
- An all-chapters search now waits for each chapter to load before searching it, and includes the Reference documents.
- PageDown could freeze the app at the bottom of a chapter.
- A new chapter no longer prompts for the notes file it does not have yet.
- Typewriter mode scrolled to the anchor end of a selection instead of the caret end.
- The caret is put back on the em dash a substitution just made.
- A long chapter title wraps instead of being cut off, and a double-clicked chapter keeps the rename box it opens.
- The sidebar scrolls to the active row after the list is rebuilt, in any section rather than only in Chapters.
- A line holding nothing but whitespace is read as the blank line it looks like.
- Several footnote defects: a footnote is numbered as it is created rather than when the chapter is saved, a pasted footnote is numbered in the same turn it lands, every footnote body gets its number rather than only the first, the footnote passes no longer rewrite the delta they were handed, the reconcile pass is skipped on chapters with no footnotes, and an escaped footnote reference is honored in HTML and EPUB export.
- The back-jump shortcut lands before the marker, so it round-trips.

### Security

- nodemailer upgraded to 10.0.7, pinned, shipping only its CommonJS build.
- `npm audit` fixes taken for brace-expansion and nanoid.

### Breaking

- **The MarkdownFic file format: an escape now covers one character instead of a two-character marker.** A literal pair of asterisks is written `\*\*` where it used to be `\**`, and the same goes for `\_\_` and `\~\~`. This fixes a flaw in the format rather than a bug in one program: `\**` meant two different things — an escaped `**`, and an escaped `*` with a style marker behind it — and nothing, no reader and no person, could tell which was which. A writer's own asterisk at the edge of an italicized phrase came back doubled with the phrase's marker eaten, an underlined `_` came back as a plain one, and `file_` next to an underlined word moved a character into the underline. All of that is fixed, and .mdfc now has one reading.
  - **What this breaks:** a chapter written by an earlier version that contains a literal `**`, `~~`, or `__` typed as prose. Those are the only sequences affected, they are rare in fiction, and the fix is to retype the pair and save. Everything else — all your formatting, and any single escaped `\*` — reads exactly as before. The bundled example projects and Help doc ship already converted.
- **One consequence of the narrowed escaping, for older projects:** a file saved by an earlier version escaped `#`, `>`, and `[>` everywhere, so a `\>` it wrote in the middle of a sentence now shows its backslash where it used to hide it. Delete the stray backslash and save, and that chapter is right from then on. This is the trade for `a \> b` meaning what it says.

## [2.5.0] - 2026-09-07

### Fixed

- The Wi-Fi Manager did not show network names.

### Security

- General security improvements.

## [2.4.0] - 2026-09-06

### Changed

- **Upgraded Electron from 18.2.3 to the latest stable (44.2.0)** for security and performance.
  - **This raises the minimum OS requirements.** This release needs Debian 11 "Bullseye" or newer (including Raspberry Pi OS Bullseye/Bookworm), 64-bit Windows 10 or newer, and macOS 13 "Ventura" or newer. Electron 44 no longer builds for 32-bit Windows or 32-bit (armv7l) Raspberry Pi OS. If you are on an older system, stay on v2.3.1.
- Updated the in-app Help doc for EPUB export, .docx import, bullet/numbered lists, corkboard shortcuts, and the secure email credential storage added in v2.3.0.
- The Help doc now opens read-only so it always reflects the installed version; use Save As if you want to keep your own annotated copy.

### Fixed

- Opening a damaged or corrupted .woolf file could leave you stuck with a frozen window that only Task Manager could close.
- Restoring a chapter from Trash didn't update which chapter was open in the editor, so your next edits saved over the wrong file.
- Restoring a Reference document from Trash sent it back to Chapters instead of Reference.
- Missing chapter, reference, and trash files weren't always caught by the project repair screen.
- Deleting every chapter and reopening a project could leave the editor locked.
- .docx export falsely reported errors on projects with no corkboard.
- `Ctrl/Cmd+Shift+Left` while renaming a chapter could restart the rename and discard what you'd typed.
- Editing the bundled Frankenstein example silently failed to save; it is now copied to your own project folder on first open.

## [2.3.1] - 2026-09-05

Recommended immediate upgrade.

### Changed

- Replaced the regex-based MarkdownFic parsing with a tokenizer.

### Fixed

- A large refactor fixed bugs in virtually every feature.

## [2.3.0] - 2026-09-03

### Added

- Bullets and numbered lists.
- An Indent All Paragraphs tool.
- A Center All Headings tool.
- An import option to generate chapter labels from the filename or the first line of each file.
- A Whole Word Only option in Find/Replace.
- An "Exit Without Backup" button on the backup dialog shown when quitting.

### Security

- A saved email password is now protected by the OS keystore (Windows DPAPI / macOS Keychain / Linux libsecret) or an opt-in passphrase, instead of a hardcoded encryption key.

### Fixed

- Centered blank lines were not parsed properly.
- Spellcheck's Change All did not limit itself to whole words.
- Numbered lists in exported .docx files renumbered incorrectly, or merged with the previous list's sequence.
- The "Exit Without Backup" button wrongly appeared during manual, menu-triggered backups, skipping the unsaved-work check.
- Single-paragraph footnotes lost their anchor link, or produced duplicate IDs, on export.
- The first paragraph of a chapter kept a stray indent tab in exports.
- HTML export could swallow list-item text containing dialogue, and blank centered or aligned lines leaked stray markers into HTML export.

## [2.2.1] - 2025-10-09

A patch for bugs introduced or missed in v2.2.0.

### Added

- A progress alert while files are backed up on close, so it no longer seems to freeze momentarily.

### Changed

- Refactored code for readability.

### Fixed

- Restoring chapters from Trash was broken.
- Creating new projects was broken.

## [2.2.0] - 2025-10-07

### Added

- **.epub export and compile**, meant for quickly generating ebook files to share with first readers.
- **Reference documents**, for non-compiling material like planning and notes. Move a chapter to the end of the chapter list, then down one more space, and it shifts into the Reference section, where it no longer counts toward the word count or appears in a compile. Move it up the same way to bring it back.
- **Chapter Notes.** The Notes panel can be toggled between the existing Project Notes, which stay put as you change chapters, and Chapter Notes, which are attached to each chapter and follow as you cycle through them.

### Changed

- Project and Chapter Notes now save as separate .txt files, just like chapters.
- The corkboard is included when the rest of the project is exported.

### Fixed

- The corkboard feature was broken on Windows, and now works.
- Various other bug fixes.

## [2.1.0] - 2025-09-28

### Added

- **Corkboard**, for pre-planning and outlining. Displays as color-coded digital index cards but saves as a plain text `project_corkboard.txt` markdown document, so it can be edited or pre-written in other apps.
- Export and compile as standard Markdown or HTML.
- .woolf files can be opened directly (automatic on macOS; on Windows you must set WareWoolf as the default program).
- A Battery Charge Display option (Linux only, for writerdecks).
- **Custom PageDown behavior.** Page Down now scrolls in exact intervals, so the line after the last visible line lands at the top of the editor. The default behavior only scrolled far enough to move the next line a third of the way down, breaking reading flow because you had to re-find your place each time.

### Fixed

- Various bug fixes.

## [2.0.0] - 2024-03-30

A quick version jump, but with fundamental changes — primarily the switch to saving chapters as plain text .txt files with MarkdownFic markup for formatting. This is better than the previous `.pup` JSON files because the .txt chapter files of your manuscript can be opened and published by anyone, with or without WareWoolf. You can also edit them in any other text editor, and as long as you don't change the filename WareWoolf will load them as normal.

### Added

- macOS support.
- Full screen can now be toggled on Windows and Mac.
- Export a single chapter or all of them.

### Changed

- **Chapters are saved as plain text .txt files with MarkdownFic markup** rather than Delta `.pup` JSON files. Legacy files still open; they are silently saved over in the new format at open.
- A completely new MarkdownFic parsing algorithm, about 1000x faster.
- The autogenerated subdirectory for chapter files is named `[filename]_chapters` instead of `[filename]_pups`.
- Chapter files are saved as `[title].txt` rather than arbitrary numbers, and the filename updates when you change a chapter title in WareWoolf.
- The Missing Chapters tool was rewritten and expanded.

### Fixed

- Bug fixes.

## [1.1.0] - 2024-03-16

### Added

- Download and install updates in-app through the About screen. Updates are only checked for on request.
- The Wi-Fi Manager now shows the IP address.

### Changed

- Refactored the entire codebase to use properly isolated modules for maintainability.
- The File Manager filters out hidden files and directories.

### Fixed

- Bug fixes.

## [1.0.0] - 2024-03-03

Version 1.0.0: all the basic features originally envisioned are implemented and working, and the author uses it daily for novel writing.

### Added

- A built-in Wi-Fi Manager (on Linux) for writerDeck use.
- .docx import.
- Footnote support, on import and on export/compile.
- Auto-save at set intervals, if desired.
- Auto-backup to a single zip file on close.
- Email the zipped project file.
- The built-in File Manager can now unzip zip files.
- Dark Mode support and options.

### Changed

- .docx export drastically improved, with automatic cover page generation, page number headers in Standard Manuscript Format, and more. It can now produce ready-to-submit manuscript documents.
- Markdown improvements.
- Native file dialogs replaced with custom in-app ones, for a better keyboard-only workflow.
- More of the settings you set are retained, including those for email attachments.
- 70% less ugly.

### Fixed

- Bug fixes.

## [0.10.0] - 2023-06-11

### Added

- A built-in **File Manager** at File > File Manager.
- About now shows the license and third-party notices.

### Changed

- Properties cleaned up, and given a tool for changing the chapters directory.
- The Help doc was expanded.

### Fixed

- Various small bug fixes.

## [0.9.0] - 2023-05-29

Initial beta release, after nearly a year of alpha use — including 30,000 words of a new novel written in WareWoolf.

### Added

At this first release, WareWoolf offered:

- A three-panel, icon-free interface — Chapters, Editor, Notes — each panel toggled with `F1`/`F2`/`F3`, plus an editor width and font size you can adjust to match a narrow paperback column or a wide manuscript page.
- A keyboard-only workflow: no toolbars, a file menu summoned with `Alt`, navigation and chapter-alteration shortcuts, and a Shortcut Helper on `Ctrl+H`.
- Projects saved as a plain text `.woolf` JSON file plus one `.pup` file per chapter in a subdirectory, so only the chapter you are viewing is held in memory.
- Chapter management: create, rename, reorder, renumber, split, delete, and restore from trash.
- **MarkdownFic**, a version of Markdown revised for fiction that keeps manual tabs and indented paragraphs, with headings, italics, bold, strikethrough, blockquotes, centered headings, and escaped markers.
- Import of plain text, .md, and .mdfc files, with options to convert marked italics, convert first lines to chapter headings, convert marked tabs, and split into chapters at a custom marker.
- Export and compile to plain text, MarkdownFic, and .docx — the .docx written by WareWoolf's own converter, double-spaced, with page breaks before chapter headings.
- Find and Replace across one chapter or all of them, with case sensitivity, a replacement counter, and a Search View.
- Spellcheck with suggestions, custom replacements, Ignore All, Change All, and a personal dictionary.
- An Outliner with per-chapter word counts and summary fields, a word count goal with display, and a session word count tracker.
- Email the current chapter or the compiled manuscript, with an optionally remembered password.
- Properties, About, a bundled Help doc, a bundled Frankenstein example project, an error log written to disk with a viewer, unsaved-changes checks before exit or opening another project, Save Copy, cursor position restored at load, and chapters-directory validation with a repair prompt.
- User settings and the personal dictionary stored in the standard user data directory.

## Pre-release development

WareWoolf was developed in the open for two and a half years before the first tagged release. No version numbers were assigned during this period; these are the milestones from the commit history, for the record.

- **2020-12** — Project started. The three-panel editor, project and chapter files on disk, New/Open/Save/Save As, generated project directories, Properties editing, and the first compile dialog.
- **2021-01 – 2021-02** — Cross-platform save/load paths for Windows and Linux, bundled example projects, export to .txt and .docx, a working compile, plain text import, and word count.
- **2021-03** — Find and Replace, including across all chapters and with a case-sensitive option, rewritten twice before it worked properly. Spellcheck with correct indexing, Ignore All, Change All, and a personal dictionary.
- **2021-07** — First distribution packaging experiments.
- **2022-03** — Spellcheck skips numbers; chapter titles become headings on compile; tools to convert first lines to titles and to split headings into chapters.
- **2022-05** — A prolific month: conversion of marked italics on import, import options for italics/headings/tabs, the Split Chapter tool, chapter create/delete/restore in the Edit menu, the app icon, the word count goal, the Help menu and Shortcut Helper, toolbars replaced entirely by keybindings, a custom .docx export engine replacing the quill-to-word dependency, the Outliner, user settings, Electron upgraded to 18.2.3, and **MarkdownFic itself** — paragraph-level and inline parsing, import, export, and compile.
- **2022-06** — Splitting chapters on import, the display-mode system that became simple `F1`/`F2`/`F3` panel toggling, error logging to disk, chapters-directory validation and repair, About, unsaved-changes checks, Save Copy, the bundled Help doc, blockquote formatting, escaped MarkdownFic markers, page breaks before chapter headings in .docx, chapter renumbering, emailing a chapter or the compiled manuscript, the session word count, cursor position restored at load, user settings and the personal dictionary moved to the standard user data directory, the LICENSE, and simple encryption for a remembered email password.
- **2022-07** — Alpha status announced in the README.
- **2022-12** — Fixed data loss when changing a chapter title, the missing-pups alert not taking focus, and the spellcheck dictionary path. README screenshot added.
- **2023-05** — The error log gained a viewer with send and clear, the Help doc was expanded, `Alt+H` was bound to Change All and `Ctrl+Shift+D` to delete a chapter, DevTools was turned off, and a welcome explanation was added to the head of the sample novel. Released as v0.9.0 beta.

[Unreleased]: https://github.com/brsloan/warewoolf/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/brsloan/warewoolf/compare/v2.5.0...v3.0.0
[2.5.0]: https://github.com/brsloan/warewoolf/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/brsloan/warewoolf/compare/v2.3.1...v2.4.0
[2.3.1]: https://github.com/brsloan/warewoolf/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/brsloan/warewoolf/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/brsloan/warewoolf/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/brsloan/warewoolf/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/brsloan/warewoolf/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/brsloan/warewoolf/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/brsloan/warewoolf/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/brsloan/warewoolf/compare/v0.10.0...v1.0.0
[0.10.0]: https://github.com/brsloan/warewoolf/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/brsloan/warewoolf/releases/tag/v0.9.0
