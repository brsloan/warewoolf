<p align="center">
	<img src="./src/assets/logo.png" style="width: 280px"/>
</p>
<p align="center">v2.5.0</p>
<p align="center">"The only writing software I use." -Virginia Woolf</p>

WareWoolf is designed for one thing: writing fiction. It is intentionally simplified: beyond a choice of typeface for the manuscript and the sidebars, and light or dark, there is nothing to fiddle with--no line spacing, no colors, no styles. But it has everything you need to organize, edit, and revise a novel--and you don't even need a mouse.

It is composed of three simple text-based panels with no icons: Chapters, Editor, and Notes.

That's it. There is no toolbar with twenty buttons cluttering the screen. There isn't even a file menu unless you summon it by pressing Alt. All formatting is done with shortcuts. (But don't worry, there aren't many to memorize, and you can always press **CTRL** + **H** to show them all in the Shortcut Helper--where you can also change any of them to keys you prefer. It's not like you do a lot of formatting when writing fiction anyway.)

What it does have is an array of tools for importing plaintext and docx files and converting them into proper manuscript format, as well as features such as self-emailing drafts at the press of a button, a built-in file manager, a wi-fi manager, and a battery monitor for easy use in standalone writing devices ("writerDecks") without access to any other software.

Dark Mode:
![screenshot of dark mode of program described](src/assets/screenshot_darkmode.png?raw=true "WareWoolf")
Light Mode:
![screenshot of program described](src/assets/screenshot_lightmode.png?raw=true "WareWoolf")
Corkboard:
![screenshot of program described](src/assets/screenshot_corkboard.png?raw=true "WareWoolf")

For a more in-depth overview of WareWoolf, please see [the Wiki](https://github.com/brsloan/warewoolf/wiki).

## Features

* All-keyboard navigation designed for pleasant use without a mouse.
* Distraction-free writing: Each of the three panels can be toggled on/off at the press of a button. Write with only your manuscript visible.
* The formatting fiction actually needs, all of it on a shortcut and none of it on a toolbar: bold, italics, underline, strikethrough, four levels of heading, left/right/center/justified alignment, bulleted and numbered lists, and blockquotes as well as footnotes.
* Plain text import/conversion tools
   * Options to parse a simplified version of Markdown (MarkdownFic) or interpret custom markers for detecting italics, headings, etc.
   * Detect custom strings marking chapter breaks or break text into chapters at each heading, etc.
* Easily re-order chapters and automatically re-number them in headings after doing so ("Chapter One," "Chapter Two," etc.)
* Compile chapters into single manuscript or export into individual files for each chapter
* Keep notes on each chapter and project as a whole
* "Reference" section of chapters list holds documents you don't want included in compile or word counts. Keep character lists, location info, etc.
* Send Via Email: Email drafts of individual chapters or the entire manuscript to yourself at the press of a button.
* Built In File Manager: Rename, delete, copy, move, and organize files within WareWoolf (for use in a writerDeck).
* Built In Wi-Fi Manager: turn wi-fi on/off, connect to new networks, etc. (Linux only, for use in a writerDeck).
* Built In Battery Monitor: display battery percentage (Linux only, for use in a writerDeck)
* File > Reboot: restart the machine from inside the app, after the usual save prompt and auto-backup (Linux only, for use in a writerDeck).
* Word Counts / Goal: See total count, chapter count, session count, and set a goal to see a progress bar showing how close you are to completion.
* Each chapter is saved as an individual file only loaded when you are working on that chapter. This keeps very long novels from slowing the application at all, even with low-memory computers such as a Raspberry Pi.
* Outliner.
* Corkboard that saves as a markdown file that doubles as an outline.
* Adjust width of text editor and how large text is displayed.
* Choose a typeface for the manuscript and another for the sidebars (File > Settings), from serif and sans through Times, Garamond and a typewriter face to Atkinson Hyperlegible and OpenDyslexic. A sample under each dropdown shows what your machine will actually draw.
* Customizable keyboard shortcuts: rebind any shortcut in the Shortcut Helper (Ctrl+H), or restore the defaults, and your choices are remembered.
* Automatic substitutions as you type: smart quotes, em dashes from two hyphens, and an ellipsis from three periods. Ctrl+Z undoes any one of them, and the whole thing can be switched off in Settings. A Tools item applies the same conversions to an existing manuscript in one pass.
* Spellcheck, but it must be run after writing (no red squiggles or godawful grammar advice). Check against any number of dictionaries at once (File > Dictionaries), import your own, and keep a personal word list alongside a per-project one for character and place names that shouldn't follow you into your next book.
* Word .docx support for import/export
* Auto-saving and auto-backup options
* Saves chapters as .txt files with light Markdown-style formatting, so even if WareWoolf disappears you will always be able to read/edit the documents you create with it. This is also widely considered the most "archival" file format, so people will still be able to open your files in 100 years (if people still read then).
* Export as plain text, markdownFic, standard markdown, docx, HTML, or .epub 
* Import HTML files and EPUB ebooks, splitting a whole book into chapters as it reads - at headings or horizontal rules for HTML, and by the ebook's own table of contents for EPUB.

## Installation

Binaries of the current release for Windows, MacOS, Debian AMD64, and Debian ARM64 (Raspberry Pi) are available in the [releases page](https://github.com/brsloan/warewoolf/releases).

> [!NOTE]
> **On an older Mac?** The main MacOS builds are packaged against Electron 44, which needs macOS 13 "Ventura" or newer. If you are on macOS 10.15 "Catalina" through 12 "Monterey" — as many of the older laptops people turn into writerdecks are — download `warewoolf_<version>_MacOS_Legacy.dmg` instead. It is the same WareWoolf, built from the same source, packaged against Electron 32: the last release line that runs on those systems. It is an Intel build, so on Apple Silicon it runs under Rosetta. Electron 32 no longer receives Chromium security updates, so take a mainline build instead if your Mac can run one.

> [!WARNING]
> The Wi-Fi Manager uses nmcli/Network Manager, which Raspberry Pi OS does not have installed/enabled by default. You will have to install network-manager and enable it in raspi-config for this function to work. You may need to update raspi-config to be able to enable Network-Manager.

## Run or Build From Source

This app was built using Electron Forge. To run it from source...

* You must first have [Node.js](https://nodejs.dev/en/learn/how-to-install-nodejs/) installed.
* Run "npm install" in the WareWoolf source code directory to install the dependencies using the Node Package Manager.
* Then you can simply use command "npm start" to run the program.
* **Building on an older Mac.** Two pins in package.json exist for this and are deliberate. `esbuild` is held at 0.23.x because 0.24.0 is built with Go 1.23, which dropped macOS 10.15 — anything newer fails to install on Catalina with a `dyld: Symbol not found` error. Node 20 is the newest release line that runs on Catalina at all, and it is also what Electron 32 bundles, so tests there run on roughly the runtime the app ships with. To run or package the legacy Mac build locally, use "npm run use:legacy-electron" after "npm install"; it swaps in Electron 32 without touching package.json or the lockfile, and "npm ci" puts the mainline Electron back. You do not need any of this to *release* the legacy build — CI produces that asset on every tagged release, on an ordinary macOS runner, since electron-forge only downloads a prebuilt Electron for the target and copies the app into it.
* To make a binary, "npm run make". See the [Electron Forge documentation](https://www.electronforge.io/) for instructions on how to alter the package.json file for making binaries for different systems, but basically in the "makers" property of the "forge" object in the package.json file, there is an array of different makers for producing different binaries. The "@electron-forge/maker-squirrel" is for producing a Windows binary, the maker-deb for Linux, and the maker-dmg for MacOS. To produce them, run "npm run make" and it should use the appropriate one for your system. You will find the binary in the "out" folder.  

## Documentation

For a more in-depth overview of WareWoolf, please see [the Wiki](https://github.com/brsloan/warewoolf/wiki).

## Status

Unreleased. Changes made:
* New File > Reboot, on Linux only: restarts the machine from inside WareWoolf, which on a writerDeck that boots straight into the app is otherwise a trip to a terminal. It goes out the same way Exit does - you are asked about unsaved changes first, and an auto-backup still runs before the machine goes down - so it is a safer restart than the command line one, not just a quicker one. It uses systemctl, and if the system refuses the reboot it says so rather than doing nothing.
* Keyboard shortcuts are now customizable: open the Shortcut Helper (Ctrl+H, Cmd+Shift+H on Mac), choose a shortcut, and press the keys you want. Backspace clears one; Restore Defaults puts them all back. Your changes are saved between sessions.
* Fixed bug where the Bullets/Numbered List shortcut (Ctrl/Cmd+Shift+B) never worked, because the File > Backup menu item claimed the same keys. Backup is still on the File menu, without a shortcut.
* Automatic substitutions as you type: straight quotes become curly ones (opening or closing to suit), two hyphens become an em dash, and three periods become an ellipsis. Ctrl+Z undoes just the substitution, leaving what you typed. All of it can be switched off, in whole or rule by rule, in File > Settings.
* New Tools > Convert Straight Quotes Etc.: applies those same substitutions to a whole manuscript at once, for work written before the feature existed or imported from elsewhere. Uncheck any you would rather not apply.
* MarkdownFic now reads four spaces as a tab when nesting list items, matching how most Markdown editors indent a sub-list. Spaces only nest an item that directly follows another list item, so an indented paragraph of prose that happens to begin with a hyphen is still prose. WareWoolf still writes tabs, so a space-indented list is normalized on the first save.
* MarkdownFic now treats "#", ">" and "[>" as ordinary characters everywhere except the start of a line, which is the only place any of them was ever read as a marker. A manuscript that mentions "File > Dictionaries" or "C#" is no longer written to disk as "File \> Dictionaries" and "C\#", and a backslash you type mid-sentence stays a backslash instead of quietly disappearing. Where a line really does begin with one of those characters it is still escaped, and the escape still honoured, so a paragraph opening "> " stays prose rather than turning into a quotation. HTML and EPUB export follow the same rule, so the file, the editor and the export all agree.
* One consequence for older projects: a file saved by an earlier version escaped those three characters everywhere, so a "\>" it wrote in the middle of a sentence now shows its backslash where it used to hide it. Delete the stray backslash and save, and that chapter is right from then on. This is the trade for "a \> b" meaning what it says.
* Finishing that narrowing: "#" and "[>" are escaped only where a marker could actually be read, not merely where one begins. A heading needs one to four hashes and a space and an alignment marker needs one of its four letters and "] ", so a paragraph opening "#hashtag", "##### deep" or "[>x] " is now written as typed instead of carrying a backslash it never needed. A footnote reference is "[^", digits and "]", so a "[^" that could never be one - "[^note]", or the two characters alone - is left as typed too.
* A backslash of your own is now doubled wherever the reader would otherwise take it for an escape, and "\\" reads back as the one backslash you typed. A paragraph beginning "\#" or "\-", or ending in a backslash right before a styled word, used to lose it silently on every save. Anywhere else a backslash is still written as itself, so "a \ b" and "C:\Users" are untouched. HTML and EPUB export take the escapes off in the same order the editor does.
* Underline, lettered list markers ("a. item") and the escaping rules are now written down on the MarkdownFic page of the Help doc, which had never mentioned any of them.
* **Breaking change to the MarkdownFic file format: an escape now covers one character instead of a two-character marker.** A literal pair of asterisks is written "\*\*" where it used to be "\**", and the same goes for "\_\_" and "\~\~". This fixes a flaw in the format rather than a bug in one program: "\**" meant two different things - an escaped "**", and an escaped "*" with a style marker behind it - and nothing, no reader and no person, could tell which was which. A writer's own asterisk at the edge of an italicized phrase came back doubled with the phrase's marker eaten, an underlined "_" came back as a plain one, and "file_" next to an underlined word moved a character into the underline. All of that is fixed, and .mdfc now has one reading.
* What this breaks: a chapter written by an earlier version that contains a literal "**", "~~" or "__" typed as prose. Those are the only sequences affected, they are rare in fiction, and the fix is to retype the pair and save. Everything else - all your formatting, and any single escaped "\*" - reads exactly as before. The bundled example projects and Help doc ship already converted.
* An italicized phrase that begins with a space no longer turns its paragraph into a bullet. "* " at the start of a line is a list marker, and an italic run opening with a space was written as exactly that, so the paragraph came back a list item having lost both its italics and its space. The space is now written in front of the marker instead, where it reads as indenting - which is also the rule CommonMark uses, so the Markdown export of such a phrase renders as emphasis now too. A space in the middle of a styled span is untouched.
* A marker spelled across two runs is escaped properly. "1." followed by " item" is a numbered list marker once written out, though neither half is one on its own, and a paragraph beginning that way came back a list item with its first characters eaten. The same went for "[>c]" plus " centered", "##" plus " heading", and a "~" or "_" meeting its pair at a run boundary.
* Spellcheck now understands contractions written with a curly apostrophe, instead of stopping on both halves of "don't".
* A straight quote typed into Find/Replace now finds curly ones too, so searching for a line of dialogue still works. Searching for a specific curly quote still finds only that one.
* New Use Regex option in Find/Replace, for the searches that are about a shape rather than a word: every run of two or more spaces, every paragraph ending in a comma, every "said" with a name after it. In the Replace box, "$1" stands for whatever the first bracketed part of the pattern matched, so finding "(\w+), (\w+)" and replacing with "$2 $1" turns every "Smith, John" into "John Smith". Case Sensitive and Whole Word Only still apply, and with the box unticked everything in the Find box is ordinary text exactly as before. While you are still typing a pattern it usually isn't a valid one yet, and the line under the buttons says which part is unfinished rather than reporting nothing found. There is a new Find and Replace page in the Help doc, which had never had one, covering the whole dialog as well as the pattern syntax.
* Fixed bug where Replace refused to replace the match Find had just highlighted, if it had been found through a straight quote matching a curly one. Find would highlight "don’t" for a typed "don't" and then Replace did nothing, because it compared the highlighted text with what you had typed instead of asking the search. Replace All was never affected, which is what hid it.
* The Word Count window now estimates pages as well as words: every count reads like "1000 wds / ~4 pgs". A new Words Per Page field, under the Goal, is what that divides by - it starts at 300, the traditional double-spaced manuscript page, and whatever you set it to is remembered for every project you open afterwards.
* New File > Dictionaries: tick any number of dictionaries at once, import your own (a Hunspell .aff/.dic pair, or even a bare word list), and edit your personal dictionary directly instead of only adding to it from the spellcheck popup. Projects now carry their own word list too, for character and place names that shouldn't leak into other manuscripts - the spellcheck popup's Add To Dictionary button gets a companion, Add To Project, for exactly that.
* Blockquotes: Ctrl/Cmd+Shift+Q in the editor, the '>' marker in MarkdownFic, and a real Word blockquote style on .docx export. An alignment marker can now be combined with a blockquote or list marker, so a centered quotation or bullet round-trips.
* First-class footnotes: Ctrl/Cmd+Alt+F inserts a numbered marker and opens its note at the foot of the chapter, and the same keys jump between the two afterwards. Numbering is automatic and renumbers as you add, delete or reorder; deleting a marker takes its note with it; copying one carries its note along. Notes come out as real Word footnotes in .docx, linked notes in HTML and EPUB, and [^1] markers in Markdown - and compiling a whole project numbers every chapter's notes into one sequence.
* Import HTML files (.html, .htm, .xhtml) and EPUB ebooks (.epub). Both can be split into chapters as they are read: HTML at a chosen heading level and/or at horizontal rules, EPUB by the book's own table of contents, so Moby-Dick arrives as 141 chapters rather than the eleven files it is packed into. Italics marked by a stylesheet rather than a tag are still read as italics, tables come in as Markdown-style pipe rows, and Project Gutenberg's license header and footer can be stripped on the way in.
* Tools > Indent All Paragraphs is now Tab-Indent Paragraphs, and opens a dialog rather than running the moment you click it. It follows the usual typographic rule for the indent: the tab marks the break between one paragraph and the next, so a paragraph with nothing above it to be separated from is left flush at the margin. "Do Not Indent After" is where you say which those are - New Chapter, Headings, Blank Lines, Blockquotes and Lists, all ticked to begin with, and untick any you would rather have indented anyway. Headings, list items and block quotations are still never indented themselves.
* Two more options in the same dialog. "Correct Current Tabs", on by default, takes the tab off any paragraph that should not have one, so a manuscript that was indented by the old tool (or by hand) is put right rather than only added to. It also reads a line holding nothing but tabs or spaces as the blank line it looks like, clearing the stray tabs off it and leaving the paragraph below it flush at the margin. "Remove Blank Lines Between Paragraphs", off by default, closes up the blank line between one paragraph and the next and condenses a longer gap down to a single line - the quickest way to turn a blog-styled document into a book-styled one, since the paragraphs it closes up are then indented in the same pass. Blank lines under a heading, around a quotation or a list, and at the top or bottom of a chapter are left where they are.
* Fixed bug where a project shipped with the app - the Help doc, or the bundled example - could be opened writable and edited in place. Anything inside the install directory now opens read-only, and Ctrl/Cmd+S on it offers Save As so your annotated copy gets a home of its own.
* The Windows download is an installer again. Releases from v0.9.0 to v2.2.1 were built by hand and shipped a Setup.exe; when release builds moved to CI for v2.3.0 the Windows job was pointed at the wrong maker, and v2.3.0 through v2.5.0 shipped a bare application folder under the same filename - no install step, and no entry in Add or Remove Programs. If you installed one of those four, run the new installer and then delete the folder you unzipped; it will not remove it for you, and a copy of WareWoolf left lying around is only wasted disk space, not a problem for the installed one. Your projects and settings are untouched either way, since neither version keeps them beside the program.
* New “Mark scene breaks with a centered #” box in both Compile and Export, for standard manuscript format: the blank line between one scene and the next comes out carrying a centered hash, so a reader can tell a deliberate break from a page break that happened to land there. Only a blank line with an ordinary paragraph on both sides is marked, which leaves the gap under a chapter heading, the blank lines trailing at the end of a chapter, and anything beside a list, a quotation or a footnote exactly as they were. Your own chapters are untouched — the mark is added to the copy on its way into the file. On export it applies to your chapters, not to your notes or the corkboard, and whichever way you set the box is remembered for next time.
* Windows: Check For Updates can now install the update too. Click Install, wait for it to download (it can take a few minutes on a slow connection, with nothing to show for it in between - sorry), then click Restart To Finish. No more finding the download in your Downloads folder, running it yourself, and clicking past "Windows protected your PC." If the in-app install doesn't work for some reason, you can still fall back to downloading and running it yourself, same as before. Linux and Mac are unchanged.
* Two font settings in File > Settings, under Appearance: one for the manuscript and one for the sidebars, chosen separately so the chapter list can stay plain while you draft in Courier. There are eight to pick from, including Times and Garamond for a manuscript that looks like the page you will submit, a typewriter face, and Atkinson Hyperlegible and OpenDyslexic for anyone who reads more easily in them. WareWoolf ships no fonts of its own, so each choice uses the best face of its kind you already have installed - which is why a sample line under each dropdown shows what you will actually get. The face changes the moment you save, and both settings start where WareWoolf has always been, so nothing moves until you move it.
* A line spacing setting for the manuscript, in the same place: Single, One and a Half, Double or Two and a Half. Tighten it to fit more of a paragraph on a small writerDeck screen, or open it out to weigh sentences one at a time in an editing pass. The sample paragraph under the dropdown is drawn in whichever manuscript font you have chosen, since the two are worth judging together. Only the middle panel moves - the chapter list and the notes stay as they are - and it starts on Double, which is what WareWoolf has always used.

2026-09-07: v2.5.0. Chages made:
* Security improvements
* Fixed bug wifi manager did not show network names

2026-09-06: v2.4.0. Changes made:
* Upgraded Electron from 18.2.3 to the latest stable (44.2.0) for security and performance enhancements.
* NOTE: That upgrade raises the minimum OS requirements. This release needs Debian 11 "Bullseye" or newer (including Raspberry Pi OS Bullseye/Bookworm), 64-bit Windows 10 or newer, and macOS 13 "Ventura" or newer. Electron 44 no longer builds for 32-bit Windows or 32-bit (armv7l) Raspberry Pi OS. If you are on an older system, stay on v2.3.1.
* Fixed bug where opening a damaged/corrupted .woolf file could leave you stuck with a frozen window that only Task Manager could close
* Fixed bug where restoring a chapter from Trash didn't update which chapter was open in the editor, causing your next edits to save over the wrong file
* Fixed bug where restoring a Reference document from Trash sent it back to Chapters instead of Reference
* Fixed bug where missing chapter/reference/trash files weren't always caught by the project repair screen
* Fixed bug where deleting every chapter and reopening a project could leave the editor locked
* Fixed bug where .docx export falsely reported errors on projects with no corkboard
* Fixed bug where Ctrl/Cmd+Shift+Left while renaming a chapter could restart the rename and discard what you'd typed
* Updated in-app Help doc for EPUB export, .docx import, bullet/numbered lists, corkboard shortcuts, and the new secure email credential storage
* Help doc now opens read-only so it always reflects the installed version; use Save As if you want to keep your own annotated copy
* Fixed bug where editing the bundled Frankenstein example silently failed to save; it's now copied to your own project folder on first open

2026-09-05: v2.3.1. Changes made:
* Massive refactor fixed bugs in virtually every feature
* Replaced regex markdownFic parsing with a tokenizer
* Highly recommend immediate upgrade

2026-09-03: v2.3.0. Changes made:
* Bullets and numbered lists now supported.
* Indent all paragraphs tool
* Center all headings tool
* Import option to generate chapter labels from filename or first line of files
* Find/Replace Whole Word Only option
* Saved email password is now protected by the OS keystore (Windows DPAPI / macOS Keychain / Linux libsecret) or an opt-in passphrase, instead of a hardcoded encryption key.
* Added "Exit Without Backup" button to the backup dialog on quit.
* Fixed bug centered blank lines not parsed properly
* Fixed bug spellcheck change all did not limit to whole words
* Fixed bug exported .docx numbered lists renumbered incorrectly / merged with the previous list's sequence
* Fixed bug "Exit Without Backup" button wrongly appeared during manual (menu-triggered) backups, skipping the unsaved-work check
* Fixed bug single-paragraph footnotes lost their anchor link / produced duplicate IDs on export
* Fixed bug first paragraph of a chapter kept a stray indent tab in exports
* Fixed bug HTML export could swallow list-item text containing dialogue, and blank centered/aligned lines leaked stray markers into HTML export

2025-10-09: v2.2.1. Changes made:
* This is a patch to fix a couple bugs I introduced/missed in last update which broke restoring chapters from trash and creating new projects. (Obviously these are embarrassing to have released and I plan to implement testing scripts to catch these issues in future. I've gotten a little too excited about releasing new features this month and was careless.)
* Added an alert that updates on progress when backing up files on close so it doesn't seem to freeze momentarily.
* Refactored code for readability.

2025-10-07: v2.2.0. Changes made:
* .epub export/compile. Meant for quickly generating .epub ebook files for sharing with first readers, etc.
* "Reference" function lets you keep non-compiling documents in your project for planning, notes, etc. Move any chapter to end of chapter list, then move down one more space, and it will shift into "Reference" section and no longer count toward word count or be included in compile. Can move back into compiling chapters in same way (moving up).
* Chapter Notes added. Notes panel can be toggled between the old Project Notes, which stays the same as you change chapters, and the new Chapter Notes, which are attached to each individual chapter and update as you cycle through.
* Project/Chapter Notes now save as separate .txt files just like the chapters do.
* Corkboard exports with rest of project
* Various bug fixes, including that corkboard feature was broken in Windows (oops) and now works.

2025-09-28: v2.1.0! Changes made:
* Corkboard feature for pre-planning/outlining novels. Displays as color-coded digital index cards but saves as plain text "project_corkboard.txt" markdown document, so can be edited/prewritten in other apps.
* Export/Compile as standard Markdown or HTML
* Can now open .woolf files directly (user must set WareWoolf to default program in Windows, but it is automatic on MacOS)
* Battery Charge Display option (Linux only, for use in writerdecks)
* Custom PageDown key behavior. Now scrolls in perfect intervals so that you can seamlessly read long chapters. When you press Page Down, it will jump forward so that the line after the last line visible will be at the top of the text editor. Default behavior would only scroll far enough for the next line to move up to 1/3rd down in the text editor, breaking reading flow because you had to re-find where you were each time.
* Various bug fixes.

2024-03-30: v2.0.0! I know that's a quick version jump, but this has some fundamental changes, primarily the switch to saving chapters as plain text .txt files with MarkdownFic markdown for formatting. This is better than the previous ".pup" json files because even if you and WareWoolf both die and your tech illiterate uncle is your executor, he will still be able to open the .txt chapter files of your manuscript and publish it so that history can remember you as the genius no one recognized while you were alive. Also you can edit them in any other text editor and as long you don't change the filename WareWoolf will load them as normal. Changes Made:
* Completely new MarkdownFic parsing algorithm (about 1000x faster)
* Now saves chapters as plain text .txt files with MarkdownFic markup for formatting rather than Delta ".pup" JSON files. 
  * Can still open legacy files, just will silently save over old file format with new at open.
* Autogenerated subdirectory for chapter files now named "[filename]_chapters" instead of "[filename]_pups".
* Chapter files now saved as "[title].txt" rather than arbitrary numbers. Filename updates when you change chapter titles in WareWoolf.
* Now supports MacOS
* Missing Chapters tool rewritten/expanded
* Can now toggle full screen on Windows/Mac
* Can now export single chapter or all
* Bug fixes

2024-03-16: v1.1.0. Changes made:
* Download and install updates in-app through About screen
  * Only checks for updates on user request.
* File Manager filters out hidden files/directories
* Refactored entire codebase to use proper isolated modules for maintainability
* Wi-Fi Manager now shows IP Address
* Bug fixes

2024-03-03: We have reached version 1.0.0! All the basic features I had originally envisioned are now implemented and working. I use it daily for my own novel writing. Features added/changed since last release:
* Built-in Wi-Fi Manager (on Linux) for use as writerDeck
* Import .docx files
* Footnote support (import and export/compile)
* Auto-save at set intervals (if desired)
* Auto-backup with single zip file on close
* Email zipped project file
* Built-in File Manager now can unzip zip files
* Dark Mode support/options
* Markdown improvements
* Docx export drastically improved, with automatic cover page generation, page number headers in Standard Manuscript Format, etc. Can now export ready-to-submit manuscript documents
* Retains more settings user sets for email attachments, etc.
* Replaced native file dialogs with custom in-app for better keyboard-only workflow
* Bug fixes
* 70% less ugly

2023-06-11: Releasing v0.10.0-beta. Improvements: built-in file manager, Properties tool now allows altering project's chapters directory location. About now shows license. Minor fixes.

2023-05-28: After testing and improving the alpha version for almost a year and writing 30,000 words on a new novel with WareWoolf, I have finally decided it is ready for a beta release. I am numbering it v0.9.0. Now I just have to figure out how to go about "releasing" it...

2022-07-09: WareWoolf is currently in the alpha stage, which is to say I'm using it myself and ironing out the bugs I come across. I hope to do a beta release soon.
