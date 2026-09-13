//blots/screenplay.js requires quill, which touches `document` at require-time - so the DOM has to
//exist before anything below is required. Same reasoning as screenplay-editor.test.js's own first
//line.
require('./quill-dom-setup');
const test = require('node:test');
const assert = require('node:assert');

const { ELEMENT_TYPES, ELEMENT_NAMES } = require('../src/components/blots/screenplay');
const { showElementFormat } = require('../src/components/views/format_display');

//The Format block at the foot of the notes panel: what the line the caret is on is, while a script
//is in the editor. See views/format_display.js.

function shell(){
  document.body.innerHTML =
    '<div id="project-notes">' +
      '<div id="notes-editor"></div>' +
      '<div id="format-block" role="group" aria-labelledby="format-header" hidden>' +
        '<h1 id="format-header">Format</h1>' +
        '<p id="format-element"></p>' +
      '</div>' +
    '</div>';
}

test('every element type has a name to show, and no name stands for a type that does not exist', function(){
  ELEMENT_TYPES.forEach(function(type){
    assert.strictEqual(typeof ELEMENT_NAMES[type], 'string', type + ' has no name');
  });

  assert.deepStrictEqual(Object.keys(ELEMENT_NAMES).slice().sort(), ELEMENT_TYPES.slice().sort());
});

//The point of moving the names out of the picker: the block and the Insert/Convert Menu call the
//same type the same thing, so a writer who picks "Centered Text" is not then told they are on a
//"Centered Line".
test('the Insert/Convert Menu takes its labels from the same names, minus boneyard', function(){
  var ELEMENTS = require('../src/components/views/element-picker_display').ELEMENTS;

  ELEMENTS.forEach(function(pair){
    assert.strictEqual(pair[1], ELEMENT_NAMES[pair[0]], pair[0]);
  });

  assert.deepStrictEqual(ELEMENTS.map(function(pair){ return pair[0]; }).sort(),
    ELEMENT_TYPES.filter(function(type){ return type !== 'boneyard'; }).sort(),
    'every type but boneyard, which is commented-out text rather than something to insert');
});

test('showElementFormat names the type, and takes the block away when there is none', function(){
  shell();
  var block = document.getElementById('format-block');
  var value = document.getElementById('format-element');

  showElementFormat('scene');
  assert.strictEqual(block.hidden, false);
  assert.strictEqual(value.textContent, 'Scene Heading');

  //Action is the absence of an element in the delta, but it is still an element to a writer.
  showElementFormat('action');
  assert.strictEqual(value.textContent, 'Action');

  showElementFormat(null);
  assert.strictEqual(block.hidden, true, 'prose has no element to show');
  assert.strictEqual(value.textContent, '');
});

test('showElementFormat says what it has for a type it has no name for, and does nothing with no block in the page', function(){
  shell();
  showElementFormat('fandango');
  assert.strictEqual(document.getElementById('format-element').textContent, 'fandango');

  document.body.innerHTML = '';
  assert.doesNotThrow(function(){ showElementFormat('scene'); });
});
