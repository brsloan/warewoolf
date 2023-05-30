<p align="center">
	<img src="./src/assets/logo.png" style="width: 280px"/>
</p>

WareWoolf is designed for one thing: writing fiction. It is intentionally simplified: you cannot change the font, line spacing, or color. But it has everything you need to organize, edit, and revise a novel--and you don't even need a mouse.

It is composed of three simple text-based panels with no icons: Chapters, Editor, and Notes.

That's it. There is no toolbar with twenty buttons cluttering the screen. There isn't even a file menu unless you summon it. All formatting is done with shortcuts. (But don't worry, there aren't many to memorize, and you can always press **CTRL** + **H** to show them all in the Shortcut Helper. It's not like you do a lot of formatting when writing fiction anyway.)

What it does have is an array of tools for importing plaintext files and converting them into proper manuscript format, as well as features such as self-emailing drafts at the press of a button for easy use in standalone writing devices ("writerDecks") without access to any other software.

 ![screenshot of program described](src/assets/screenshot.png?raw=true "WareWoolf")

For a more in-depth overview of WareWoolf, please see [the Wiki](https://github.com/brsloan/warewoolf/wiki).

## Features

* All-keyboard navigation designed for pleasant use without a mouse
* Distraction-free writing: Each of the three panels can be toggled on/off at the press of a button. Write with only your manuscript visible.
* Plain text import/conversion tools
   * Options to parse a simplified version of Markdown (MarkdownFic) or interpret custom markers for detecting italics, headings, etc.
   * Detect custom strings marking chapter breaks or break text into chapters at each heading, etc.
* Easily re-order chapters and automatically re-number them in headings after doing so ("Chapter One," "Chapter Two," etc.)
* Compile chapters into single manuscript or export into individual files for each chapter
* Send Via Email: Email drafts of individual chapters or the entire manuscript to yourself at the press of a button.
* Word Counts / Goal: See total count, chapter count, session count, and set a goal to see a progress bar showing how close you are to completion.
* Each chapter is saved as an individual file only loaded when you are working on that chapter. This keeps very long novels from slowing the application at all, even with low-memory computers such as a Raspberry Pi.
* Outliner (very simple as is, but plan to improve drastically)
* Adjust width of text editor and how large text is displayed.
* Spellcheck, but it must be run after writing (no form of auto-correct or red squiggles or godawful grammar advice).

## Installation

Binaries of the current release for Windows, Debian AMD64, and Debian ARM64 (Raspberry Pi) are available in the [releases page](https://github.com/brsloan/warewoolf/releases).

## Run or Make From Source

This app was built using Electron Forge. To run it from source, you can simply use command "npm start". To make a binary, "npm run make". See the Electron Forge documentation for instructions on how to alter the package.json file for making binaries for different systems, but basically in the "makers" property of the "forge" object in the package.json file, there is an array of different makers for producing different binaries. The "@electron-forge/maker-squirrel" is for producing a Windows binary, the maker-deb for Debian, and the maker-rpm for Redhat. To produce one, delete the other two from the file before running "npm run make". You will find the binary in the "out" folder. 

## Documentation

For a more in-depth overview of WareWoolf, please see [the Wiki](https://github.com/brsloan/warewoolf/wiki).

## Status

2023-05-28: After testing and improving the alpha version for almost a year and writing 30,000 words on a new novel with WareWoolf, I have finally decided it is ready for a beta release. I am numbering it v0.9.0. Now I just have to figure out how to go about "releasing" it...

2022-07-09: WareWoolf is currently in the alpha stage, which is to say I'm using it myself and ironing out the bugs I come across. I hope to do a beta release soon.
