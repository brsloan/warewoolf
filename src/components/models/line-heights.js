//The line spacings a writer may set the manuscript in, and the single source of truth for that
//setting. The Settings popup builds its dropdown from LINE_HEIGHT_DEFS, render.js resolves the
//saved id into the --line-height-editor custom property index.css reads, and user-settings.js
//sanitizes what comes back off disk through sanitizeLineHeightId. Same shape as fonts.js next
//door, and for the same reasons: what is stored is an id, never a css value, so a hand-edited
//user-settings.json can never put arbitrary css into a declaration, and a later version may
//re-tune a spacing for everyone without touching anybody's settings file.
//
//Spacing is a writer's setting rather than the manuscript's. Compile and export are unaffected -
//the leading of a submitted document is decided by whoever it is submitted to - so these values
//only ever reach the screen.
//
//Adding a spacing is adding a row. The id is what lands in user-settings.json and must never
//change once shipped; the label and the multiplier may.
const LINE_HEIGHT_DEFS = [
  {
    id: 'single',
    label: 'Single',
    //1.15 rather than a literal 1: at 1 a serif face's ascenders and descenders very nearly touch
    //between lines, which is why word processors have quietly drawn "single" a shade looser than
    //that for twenty years. This is the tightest setting that is still comfortable to read a
    //chapter in, which is what the option is for - a small writerDeck screen fitting more lines.
    multiplier: 1.15
  },
  {
    id: 'one-and-a-half',
    label: 'One and a Half',
    multiplier: 1.5
  },
  {
    id: 'double',
    //The spacing WareWoolf has always drawn the manuscript at, kept as the default so an existing
    //writer's editor looks exactly as it did before this setting existed. It is also the standard
    //manuscript format, so it is the right thing to start on regardless of the history.
    label: 'Double',
    multiplier: 2
  },
  {
    id: 'two-and-a-half',
    label: 'Two and a Half',
    multiplier: 2.5
  }
];

//What the setting falls back to - the spacing the manuscript was drawn at before it existed.
//Named rather than written as 'double' at each of the places that need it, so that "what an
//unset or unreadable spacing setting means" is one decision in one place.
const DEFAULT_LINE_HEIGHT_ID = 'double';

//Object.create(null), not {}: the ids that reach this table come off disk, and against a plain
//object 'constructor' and 'toString' would both look up to a function from Object.prototype - so
//getLineHeightDef would answer with something truthy that has no .multiplier, and
//sanitizeLineHeightId would wave the id through to land in a line-height declaration as NaN.
const LINE_HEIGHTS_BY_ID = LINE_HEIGHT_DEFS.reduce(function(byId, def){
  byId[def.id] = def;
  return byId;
}, Object.create(null));

//A copy, so the Settings popup cannot reorder or splice the table it is rendering from.
function getLineHeightDefs(){
  return LINE_HEIGHT_DEFS.slice();
}

function getLineHeightDef(id){
  return LINE_HEIGHTS_BY_ID[id] || null;
}

//The css line-height value for a saved id. A percentage rather than a unitless number because
//that is what the rule this replaces said, and the two differ for any element in the editor whose
//font-size is not the editor's own: a percentage resolves against the .ql-editor font-size once
//and every line in the manuscript is then led the same, which is what a manuscript wants.
//
//Answers with the default spacing rather than null for an id that is not one of ours, so a caller
//can set the custom property with what this returns without testing it first - there is no id for
//which "no line-height at all" is the right answer.
function resolveLineHeight(id){
  var def = getLineHeightDef(id) || getLineHeightDef(DEFAULT_LINE_HEIGHT_ID);

  //Rounded to a tenth of a percent rather than multiplied straight out: a multiplier like 1.15 has
  //no exact double, so `1.15 * 100` is 114.99999999999999, and that whole string would go into the
  //declaration. Css would read it correctly, but it is not what the setting says.
  return (Math.round(def.multiplier * 1000) / 10) + '%';
}

//user-settings.json is a plain file anything could have written to, and an id in it is only
//meaningful if it names a spacing we actually have a multiplier for. Anything else - a wrong type,
//an id from a later version that dropped back to an earlier one, a typo from a hand edit - becomes
//the default rather than being passed through to land in a line-height declaration as garbage.
function sanitizeLineHeightId(raw){
  if(typeof raw !== 'string' || getLineHeightDef(raw) == null)
    return DEFAULT_LINE_HEIGHT_ID;

  return raw;
}

module.exports = {
  DEFAULT_LINE_HEIGHT_ID,
  getLineHeightDefs,
  getLineHeightDef,
  resolveLineHeight,
  sanitizeLineHeightId
};
