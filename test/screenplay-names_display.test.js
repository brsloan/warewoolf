//The Characters/Locations dialog - docs/screenplay-plan.md, "Characters and locations".
//
//Required before anything else, because the view reaches screenplay-editor.js and that reaches
//Quill, which wants a DOM the moment it is required. Each test then gets a document of its own.
require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { assertDialogDescribed, assertControlsNamed } = require('./helpers');

const showScreenplayNames = require('../src/components/views/screenplay-names_display');
const { parseFountain, elementsToDelta } = require('../src/components/controllers/fountain');
const { nameCounts } = require('../src/components/controllers/screenplay-editor');

const SCRIPT = 'INT. KITCHEN - DAY\n\nBOB\nMorning.\n\nANNA (V.O.)\nMorning.\n\nEXT. GARDEN - NIGHT\n\nBOB (CONT\'D)\nStill here.\n\nINT. KITCHEN - NIGHT\n\nANNA\nStill here.\n';

function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

//`names` is { characters: {added, removed}, locations: {...} } with either half left out where it
//is empty, so a test says only what it is about.
function makeProject(names){
  var given = names || {};

  return {
    type: 'screenplay',
    screenplayNames: {
      characters: listOf(given.characters),
      locations: listOf(given.locations)
    },
    hasUnsavedChanges: false
  };

  function listOf(list){
    return { added: (list && list.added) || [], removed: (list && list.removed) || [] };
  }
}

//A script the dialog can read and write, standing in for render.js's screenplayNamesView(): the
//delta is held here and the rename applies screenplay-editor.js's renameName to it, which is what
//render.js does through the editor or through the chapter's contents.
function makeScript(fountain){
  const { renameName } = require('../src/components/controllers/screenplay-editor');
  currentScript = fountain == null ? SCRIPT : fountain;
  var delta = elementsToDelta(parseFountain(currentScript).elements);
  var renames = [];

  return {
    renames: renames,
    getDelta: function(){ return delta; },
    rename: function(type, from, to){
      renames.push([type, from, to]);
      var renamed = renameName(delta, type, from, to);
      if(!renamed)
        return 0;

      delta = { ops: renamed.ops };
      return renamed.count;
    }
  };
}

//A rename splits the line it rewrote into three ops - what was before the name, the name, what was
//after - so a heading has to be put back together before it can be read.
function linesOf(delta){
  var lines = [];
  var text = '';

  delta.ops.forEach(function(op){
    if(typeof op.insert !== 'string')
      return;

    op.insert.split('\n').forEach(function(part, i, parts){
      text += part;
      if(i < parts.length - 1){
        lines.push(text);
        text = '';
      }
    });
  });

  return lines;
}

//What autocomplete would actually offer for `typed`, given the project's lists as the dialog has
//left them - the thing the dialog is for, asked of the code the editor asks.
function offeredFor(project, type, typed){
  const { suggestionsFor } = require('../src/components/controllers/screenplay-editor');
  var line = type === 'character' ? typed : 'INT. ' + typed;
  var found = suggestionsFor(elementsToDelta(parseFountain(currentScript).elements), type === 'character' ? 'character' : 'scene',
    line, 0, project.screenplayNames);

  return found ? found.suggestions : [];
}

//The fountain the last makeScript() was built from, so offeredFor() can ask about the same script
//the dialog is showing without the test having to carry it about.
var currentScript = SCRIPT;

function open(project, script){
  return showScreenplayNames(project || makeProject(), script === undefined ? makeScript() : script);
}

function listFor(legend){
  var fieldset = Array.from(document.querySelectorAll('fieldset')).find(function(fs){
    return fs.querySelector('legend').innerText === legend;
  });

  return {
    fieldset: fieldset,
    input: fieldset.querySelector('input[type=text]'),
    listbox: fieldset.querySelector('select'),
    status: fieldset.querySelector('.name-list-status'),
    count: fieldset.querySelector('.word-list-count'),
    button: function(label){
      return Array.from(fieldset.querySelectorAll('button')).find(function(b){
        return b.textContent === label;
      });
    },
    rows: function(){
      return Array.from(fieldset.querySelector('select').options).map(function(o){ return o.textContent; });
    },
    names: function(){
      return Array.from(fieldset.querySelector('select').options).map(function(o){ return o.value; });
    },
    select: function(){
      var wanted = Array.prototype.slice.call(arguments);
      Array.from(fieldset.querySelector('select').options).forEach(function(opt){
        opt.selected = wanted.indexOf(opt.value) > -1;
      });
      fieldset.querySelector('select').onchange();
    },
    type: function(text){
      fieldset.querySelector('input[type=text]').value = text;
      fieldset.querySelector('input[type=text]').oninput();
    }
  };
}

test('both lists open on the names the script is written with, each with the lines it is in', function(){
  open();

  var characters = listFor('Characters');
  assert.deepStrictEqual(characters.names(), ['ANNA', 'BOB']);
  assert.deepStrictEqual(characters.rows(), ['ANNA  (2)', 'BOB  (2)']);
  assert.strictEqual(characters.count.innerText, '(2 of 2)');

  var locations = listFor('Locations');
  assert.deepStrictEqual(locations.names(), ['GARDEN', 'KITCHEN']);
  assert.deepStrictEqual(locations.rows(), ['GARDEN  (1)', 'KITCHEN  (2)']);
});

test('the names added to the project are listed beside the script\'s, marked as added', function(){
  open(makeProject({ characters: { added: ['zelda'] }, locations: { added: ['ZOO'] } }));

  assert.deepStrictEqual(listFor('Characters').rows(), ['ANNA  (2)', 'BOB  (2)', 'ZELDA  (added)']);
  assert.deepStrictEqual(listFor('Locations').rows(), ['GARDEN  (1)', 'KITCHEN  (2)', 'ZOO  (added)']);
});

test('Add puts a name the script has not reached yet into the project, in capitals', function(){
  var project = makeProject();
  open(project);

  var characters = listFor('Characters');
  characters.type('carla');
  assert.strictEqual(characters.button('Add').disabled, false);
  characters.button('Add').click();

  assert.deepStrictEqual(project.screenplayNames.characters.added, ['CARLA']);
  assert.strictEqual(project.hasUnsavedChanges, true);
  assert.deepStrictEqual(characters.names(), ['ANNA', 'BOB', 'CARLA']);
  assert.strictEqual(characters.input.value, '', 'the field is cleared for the next one');

  //A name already in the list is not one to add, whoever put it there.
  characters.type('bob');
  assert.strictEqual(characters.button('Add').disabled, true);
  characters.type('CARLA');
  assert.strictEqual(characters.button('Add').disabled, true);
});

test('Rename rewrites every line of the script that uses the name, and says how many', function(){
  var project = makeProject();
  var script = makeScript();
  open(project, script);

  var characters = listFor('Characters');
  characters.select('BOB');
  assert.strictEqual(characters.button('Rename').disabled, false);
  characters.button('Rename').click();

  assert.strictEqual(characters.input.value, 'BOB', 'the name to change is in the field to be edited');
  characters.type('robert');
  characters.button('Save').click();

  assert.deepStrictEqual(script.renames, [['character', 'BOB', 'ROBERT']]);
  assert.strictEqual(characters.status.innerText, 'Renamed BOB to ROBERT in 2 lines of the script.');
  assert.deepStrictEqual(characters.names(), ['ANNA', 'ROBERT']);
  assert.strictEqual(characters.button('Save'), undefined, 'the button is Add again');

  //And the script itself now says ROBERT, with the (CONT'D) still on the cue that had it.
  assert.deepStrictEqual(nameCounts(script.getDelta()).characters, { ANNA: 2, ROBERT: 2 });
});

test('Rename on a location rewrites its headings and leaves what is around them', function(){
  var script = makeScript();
  open(makeProject(), script);

  var locations = listFor('Locations');
  locations.select('KITCHEN');
  locations.button('Rename').click();
  locations.type('THE GALLEY');
  locations.button('Save').click();

  assert.deepStrictEqual(script.renames, [['location', 'KITCHEN', 'THE GALLEY']]);
  assert.deepStrictEqual(locations.names(), ['GARDEN', 'THE GALLEY']);

  assert.deepStrictEqual(linesOf(script.getDelta()).filter(function(line){ return line.indexOf('INT.') === 0; }),
    ['INT. THE GALLEY - DAY', 'INT. THE GALLEY - NIGHT']);
});

test('renaming an added name changes the project\'s list and says the script had no such line', function(){
  var project = makeProject({ characters: { added: ['ZELDA'] } });
  open(project, makeScript());

  var characters = listFor('Characters');
  characters.select('ZELDA');
  characters.button('Rename').click();
  characters.type('ZELDA MAY');
  characters.button('Save').click();

  assert.deepStrictEqual(project.screenplayNames.characters.added, ['ZELDA MAY']);
  assert.strictEqual(characters.status.innerText,
    'Renamed ZELDA to ZELDA MAY. The script has no line using that name.');
});

test('renaming an added name onto one already in the list drops it rather than listing it twice', function(){
  var project = makeProject({ characters: { added: ['ZELDA', 'YOLANDA'] } });
  open(project);

  var characters = listFor('Characters');
  characters.select('ZELDA');
  characters.button('Rename').click();
  characters.type('YOLANDA');
  characters.button('Save').click();

  assert.deepStrictEqual(project.screenplayNames.characters.added, ['YOLANDA']);
  assert.deepStrictEqual(characters.names(), ['ANNA', 'BOB', 'YOLANDA']);
});

test('Escape in the field abandons a rename, and the script is not touched', function(){
  var script = makeScript();
  open(makeProject(), script);

  var characters = listFor('Characters');
  characters.select('BOB');
  characters.button('Rename').click();
  characters.type('ROBERT');

  var escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  characters.input.dispatchEvent(escape);

  assert.deepStrictEqual(script.renames, []);
  assert.deepStrictEqual(characters.names(), ['ANNA', 'BOB']);
  assert.strictEqual(escape.defaultPrevented, true, 'and does not travel on to close the dialog');
});

//The reason the dialog exists: a one-off DAN in scene one cannot be unwritten, and while he is
//offered every attempt at DANIELLE is met with him first.
test('Remove takes a name the script uses out of the list and leaves the script alone', function(){
  var project = makeProject();
  var script = makeScript('INT. KITCHEN - DAY\n\nDAN\nOne line only.\n\nDANIELLE\nAll the rest.\n');
  open(project, script);

  var characters = listFor('Characters');
  characters.select('DAN');
  assert.strictEqual(characters.button('Remove').disabled, false);
  assert.strictEqual(characters.status.innerText,
    'DAN is in 1 line of the script. Remove stops it being offered and leaves those lines as they are.');

  characters.button('Remove').click();

  assert.deepStrictEqual(project.screenplayNames.characters.removed, ['DAN']);
  assert.strictEqual(project.hasUnsavedChanges, true);
  assert.strictEqual(characters.status.innerText,
    'DAN is no longer offered. Every line of the script it is in is untouched.');

  //The script still says DAN, in the line it always did.
  assert.deepStrictEqual(script.renames, []);
  assert.deepStrictEqual(nameCounts(script.getDelta()).characters, { DAN: 1, DANIELLE: 1 });

  //And the name keeps its row, marked, so it can be seen and put back - but it is not offered.
  assert.deepStrictEqual(characters.rows(), ['DAN  (1, removed)', 'DANIELLE  (1)']);
  assert.deepStrictEqual(offeredFor(project, 'character', 'DAN'), ['DANIELLE']);
});

test('a removed name is restored by the same button, which says Restore for one', function(){
  var project = makeProject({ characters: { removed: ['BOB'] } });
  open(project);

  var characters = listFor('Characters');
  assert.deepStrictEqual(characters.rows(), ['ANNA  (2)', 'BOB  (2, removed)']);
  assert.deepStrictEqual(offeredFor(project, 'character', 'B'), []);

  characters.select('BOB');
  assert.strictEqual(characters.button('Restore').textContent, 'Restore');
  assert.strictEqual(characters.status.innerText, 'BOB is not being offered. Restore puts it back.');
  characters.button('Restore').click();

  assert.deepStrictEqual(project.screenplayNames.characters.removed, []);
  assert.strictEqual(characters.status.innerText, 'BOB is offered again.');
  assert.deepStrictEqual(characters.rows(), ['ANNA  (2)', 'BOB  (2)']);
  assert.deepStrictEqual(offeredFor(project, 'character', 'B'), ['BOB']);
});

test('Remove drops an added name outright rather than recording a name nothing can produce', function(){
  var project = makeProject({ characters: { added: ['ZELDA'] } });
  open(project);

  var characters = listFor('Characters');
  characters.select('ZELDA');
  characters.button('Remove').click();

  assert.deepStrictEqual(project.screenplayNames.characters, { added: [], removed: [] });
  assert.deepStrictEqual(characters.names(), ['ANNA', 'BOB']);
});

test('a selection over both is a Remove, and one over removed names alone a Restore', function(){
  var project = makeProject({ characters: { removed: ['BOB'] } });
  open(project);

  var characters = listFor('Characters');

  //ANNA is offered and BOB is not, so the button is the one that acts on ANNA.
  characters.select('ANNA', 'BOB');
  assert.strictEqual(characters.button('Remove').textContent, 'Remove');
  characters.button('Remove').click();

  assert.deepStrictEqual(project.screenplayNames.characters.removed, ['BOB', 'ANNA']);
  assert.strictEqual(characters.status.innerText,
    '2 names are no longer offered. Every line of the script they are in is untouched.');

  characters.select('ANNA', 'BOB');
  assert.strictEqual(characters.button('Restore').textContent, 'Restore');
  assert.strictEqual(characters.status.innerText, '2 removed names. Restore puts them back.');
  characters.button('Restore').click();

  assert.deepStrictEqual(project.screenplayNames.characters.removed, []);
});

test('renaming a removed name keeps it removed under its new name', function(){
  var project = makeProject({ characters: { removed: ['BOB'] } });
  var script = makeScript();
  open(project, script);

  var characters = listFor('Characters');
  characters.select('BOB');
  characters.button('Rename').click();
  characters.type('ROBERT');
  characters.button('Save').click();

  assert.deepStrictEqual(project.screenplayNames.characters.removed, ['ROBERT']);
  assert.deepStrictEqual(characters.rows(), ['ANNA  (2)', 'ROBERT  (2, removed)']);
});

test('the reason a name cannot be removed goes when the row it was about does', function(){
  var project = makeProject();
  open(project);

  var characters = listFor('Characters');
  characters.select('BOB');
  assert.notStrictEqual(characters.status.innerText, '');

  //Filtering rebuilds the rows and drops the selection with them, so the line about the name that
  //was selected is no longer about anything.
  characters.type('an');
  assert.strictEqual(characters.status.innerText, '');

  //What the last change reported is not about the selection and stands through a rebuild.
  characters.type('cleo');
  characters.button('Add').click();
  assert.strictEqual(characters.status.innerText,
    'CLEO will be offered from now on, whether or not the script uses it yet.');
});

test('Refresh rebuilds a list from the script, undoing both what was added and what was removed', function(){
  var project = makeProject({
    characters: { added: ['ZELDA', 'YOLANDA'], removed: ['BOB'] },
    locations: { added: ['ZOO'] }
  });
  open(project);

  var characters = listFor('Characters');
  assert.strictEqual(characters.button('Refresh').disabled, false);
  characters.button('Refresh').click();

  assert.deepStrictEqual(project.screenplayNames.characters, { added: [], removed: [] });
  assert.deepStrictEqual(characters.rows(), ['ANNA  (2)', 'BOB  (2)']);
  assert.strictEqual(characters.status.innerText, 'Rebuilt from the script, undoing 3 changes to this list.');

  //Nothing changed is nothing to rebuild, so the button says so by being off rather than by doing
  //nothing when it is pressed.
  assert.strictEqual(characters.button('Refresh').disabled, true);

  //One list at a time: the locations keep theirs.
  assert.deepStrictEqual(project.screenplayNames.locations.added, ['ZOO']);
});

test('the filter narrows a list, and Enter adds the typed name only when nothing matched', function(){
  var project = makeProject();
  open(project);

  var characters = listFor('Characters');
  characters.type('an');
  assert.deepStrictEqual(characters.names(), ['ANNA']);
  assert.strictEqual(characters.count.innerText, '(1 of 2)');

  //Still narrowing: ANNA is on screen, so Enter is not a request to add "AN".
  characters.input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepStrictEqual(project.screenplayNames.characters.added, []);

  characters.type('cleo');
  assert.deepStrictEqual(characters.names(), []);
  characters.input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepStrictEqual(project.screenplayNames.characters.added, ['CLEO']);
});

test('a project with no script of its own still lists and edits the names added to it', function(){
  var project = makeProject({ characters: { added: ['ZELDA'] } });
  open(project, null);

  var characters = listFor('Characters');
  assert.deepStrictEqual(characters.rows(), ['ZELDA  (added)']);

  characters.select('ZELDA');
  assert.strictEqual(characters.button('Remove').disabled, false);
});

test('a project whose name lists are missing or malformed gets usable ones rather than throwing', function(){
  var project = { type: 'screenplay', screenplayNames: null, hasUnsavedChanges: false };
  open(project);

  var characters = listFor('Characters');
  characters.type('CLEO');
  characters.button('Add').click();

  assert.deepStrictEqual(project.screenplayNames, {
    characters: { added: ['CLEO'], removed: [] },
    locations: { added: [], removed: [] }
  });
});

test('the dialog names itself and every control in it', function(){
  var popup = open();

  assertDialogDescribed(popup);
  assertControlsNamed(popup);
});
