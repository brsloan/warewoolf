//The typefaces a writer may put the manuscript and the sidebars in, and the single source of truth
//for both. The Settings popup builds its two dropdowns from FONT_DEFS, render.js resolves the saved
//ids into the --font-editor/--font-sidebar custom properties index.css reads, and user-settings.js
//sanitizes what comes back off disk through sanitizeFontId.
//
//WareWoolf bundles no font files and never will - that is a megabyte of webfont in a program whose
//whole point is starting instantly on a writerDeck with a slow disk. So a `stack` here is a CSS
//font-family list, ordered best-first, and every one of them ends in a generic family (serif,
//sans-serif, monospace). A writer who has none of the named faces installed still gets something
//readable in roughly the right shape rather than a blank editor, and a writer who installs, say,
//EB Garamond tomorrow finds this option using it with no change here.
//
//Adding a face is adding a row. The id is what lands in user-settings.json and must never change
//once shipped; the label and the stack may.
const FONT_DEFS = [
  {
    id: 'serif',
    label: 'Serif',
    //The stack WareWoolf has always drawn text in, kept first and kept as the default so an
    //existing writer's app looks exactly as it did before this setting existed.
    stack: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, "Times New Roman", serif'
  },
  {
    id: 'sans',
    label: 'Sans Serif',
    stack: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif'
  },
  {
    id: 'times',
    //Separate from Serif even though the Serif stack falls back to it eventually: this is the
    //standard manuscript face, and a writer who wants their screen to look like the page they are
    //submitting wants it chosen, not arrived at when nothing better is installed.
    label: 'Times',
    stack: '"Times New Roman", Times, "Liberation Serif", Tinos, "Nimbus Roman", serif'
  },
  {
    id: 'garamond',
    label: 'Garamond',
    stack: '"EB Garamond", Garamond, "Adobe Garamond Pro", "Garamond Premier Pro", "URW Palladio L", "Palatino Linotype", serif'
  },
  {
    id: 'typewriter',
    //Courier at a manuscript's usual size is wide and loose, which is the point - it is the face a
    //lot of writers draft in precisely because it slows the eye down.
    label: 'Typewriter',
    stack: '"Courier Prime", "Courier New", Courier, "Nimbus Mono PS", "Liberation Mono", monospace'
  },
  {
    id: 'monospace',
    label: 'Monospace',
    stack: '"Cascadia Mono", Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace'
  },
  {
    id: 'hyperlegible',
    //Atkinson Hyperlegible was drawn by the Braille Institute to keep characters that usually blur
    //into one another (I/l/1, O/0) distinct at small sizes. Not installed by default anywhere, so
    //the fallbacks are the widest-countered sans faces that are.
    label: 'Atkinson Hyperlegible',
    stack: '"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", Verdana, Tahoma, "DejaVu Sans", sans-serif'
  },
  {
    id: 'dyslexic',
    label: 'OpenDyslexic',
    stack: '"OpenDyslexic", "OpenDyslexic3", "Open Dyslexic", Verdana, Tahoma, "DejaVu Sans", sans-serif'
  }
];

//What the manuscript falls back to - the face WareWoolf drew everything in before either setting
//existed - and the last resort anywhere a caller names no other. Named rather than written as
//'serif' at each of the four or five places that need it, so that "what an unset/unreadable font
//setting means" is one decision in one place.
const DEFAULT_FONT_ID = 'serif';

//The sidebars start on Sans instead. They are columns to glance down for a chapter title rather
//than prose to read, and a sans face is what the short strings at that size are legible in; the
//manuscript, which is read the way the finished book will be, keeps the serif above.
const DEFAULT_SIDEBAR_FONT_ID = 'sans';

//Object.create(null), not {}: the ids that reach this table come off disk, and against a plain
//object 'constructor' and 'toString' would both look up to a function from Object.prototype - so
//getFontDef would answer with something truthy that has no .stack, and sanitizeFontId would wave
//the id through to land in a font-family declaration as `undefined`.
const FONTS_BY_ID = FONT_DEFS.reduce(function(byId, def){
  byId[def.id] = def;
  return byId;
}, Object.create(null));

//A copy, so the Settings popup cannot reorder or splice the table it is rendering from.
function getFontDefs(){
  return FONT_DEFS.slice();
}

function getFontDef(id){
  return FONTS_BY_ID[id] || null;
}

//The css font-family value for a saved id. Answers with the default font's stack rather than null
//for an id that is not one of ours, so a caller can set the custom property with what this returns
//without testing it first - there is no id for which "no font at all" is the right answer.
function resolveFontStack(id){
  var def = getFontDef(id) || getFontDef(DEFAULT_FONT_ID);

  return def.stack;
}

//user-settings.json is a plain file anything could have written to, and an id in it is only
//meaningful if it names a font we actually have a stack for. Anything else - a wrong type, an id
//from a later version that dropped back to an earlier one, a typo from a hand edit - becomes the
//default rather than being passed through to land in a font-family declaration as garbage.
//
//`fallbackId` is which default: the two settings no longer share one, and an unreadable sidebarFont
//should land on the face a fresh install's sidebars are drawn in rather than on the manuscript's.
//It is itself checked, so a caller passing something unknown gets DEFAULT_FONT_ID rather than
//having its own bad id waved through as this function's answer.
function sanitizeFontId(raw, fallbackId){
  var fallback = getFontDef(fallbackId) == null ? DEFAULT_FONT_ID : fallbackId;

  if(typeof raw !== 'string' || getFontDef(raw) == null)
    return fallback;

  return raw;
}

module.exports = {
  DEFAULT_FONT_ID,
  DEFAULT_SIDEBAR_FONT_ID,
  getFontDefs,
  getFontDef,
  resolveFontStack,
  sanitizeFontId
};
