require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { enableTypewriterMode, disableTypewriterMode } = require('../src/components/controllers/typewriter-mode');

//typewriterScroll only needs on/off/hasFocus/getSelection/getBounds, so a plain EventEmitter
//stands in for editorQuill - it also lets tests assert on/off actually match the same listener,
//the thing that was broken before disableTypewriterMode was fixed to store its handler reference.
function makeEditorQuill({ focused = true, selectionIndex = 5, selectionLength = 0, bounds = {} } = {}){
  var quill = new EventEmitter();
  quill.hasFocus = function(){ return focused; };
  quill.getSelection = function(){
    return selectionIndex === null ? null : { index: selectionIndex, length: selectionLength };
  };
  quill.getBounds = function(index){ return { top: bounds[index] || 0 }; };
  return quill;
}

//typewriterScroll reads document.getSelection() to tell which end of a range the caret is on, and
//jsdom's own selection has no relationship to the fake Quill above - so the two ends are set here
//as bare text nodes, the only thing selectionIsBackwards() actually compares.
function setDomSelectionDirection(direction){
  var host = document.createElement('div');
  var first = document.createTextNode('first');
  var second = document.createTextNode('second');
  host.appendChild(first);
  host.appendChild(second);
  document.body.appendChild(host);

  var anchor = direction === 'backwards' ? second : first;
  var focus = direction === 'backwards' ? first : second;

  var selection = document.getSelection();
  selection.removeAllRanges();
  selection.setBaseAndExtent(anchor, 0, focus, 0);
}

//scrollTop is given its own plain-storage getter/setter rather than relying on jsdom's built-in
//scroll clamping (which depends on layout this environment doesn't compute), so tests observe
//exactly what typewriter-mode.js assigns.
function makeEditorDiv(clientHeight){
  document.body.innerHTML = '';
  var div = document.createElement('div');
  div.className = 'ql-editor';
  Object.defineProperty(div, 'clientHeight', { value: clientHeight, configurable: true });
  var scrollTopValue = 0;
  Object.defineProperty(div, 'scrollTop', {
    get: function(){ return scrollTopValue; },
    set: function(v){ scrollTopValue = v; },
    configurable: true
  });
  document.body.appendChild(div);
  return div;
}

test('enabling typewriter mode scrolls the editor to keep the cursor 75% down on editor-change', function(){
  var editorDiv = makeEditorDiv(100);
  var quill = makeEditorQuill({ bounds: { 0: 10, 5: 200 } });

  enableTypewriterMode(quill);
  quill.emit('editor-change');

  // toScroll = 200 - 10 = 190; heightOffset = floor(100 * 0.75) = 75; scrollTop = 190 - 75 = 115
  assert.strictEqual(editorDiv.scrollTop, 115);
});

test('typewriter scroll does nothing while the editor is unfocused', function(){
  var editorDiv = makeEditorDiv(100);
  editorDiv.scrollTop = 42;
  var quill = makeEditorQuill({ focused: false, bounds: { 0: 0, 5: 200 } });

  enableTypewriterMode(quill);
  quill.emit('editor-change');

  assert.strictEqual(editorDiv.scrollTop, 42);
});

test('typewriter scroll does not throw and leaves scroll unchanged when there is no selection', function(){
  var editorDiv = makeEditorDiv(100);
  editorDiv.scrollTop = 7;
  var quill = makeEditorQuill({ selectionIndex: null });

  enableTypewriterMode(quill);
  assert.doesNotThrow(function(){ quill.emit('editor-change'); });
  assert.strictEqual(editorDiv.scrollTop, 7);
});

test('enableTypewriterMode registers exactly one editor-change listener', function(){
  makeEditorDiv(100);
  var quill = makeEditorQuill();

  enableTypewriterMode(quill);

  assert.strictEqual(quill.listenerCount('editor-change'), 1);
});

test('disableTypewriterMode removes the listener enableTypewriterMode registered', function(){
  var editorDiv = makeEditorDiv(100);
  var quill = makeEditorQuill({ bounds: { 0: 0, 5: 200 } });

  enableTypewriterMode(quill);
  disableTypewriterMode(quill);

  assert.strictEqual(quill.listenerCount('editor-change'), 0);

  editorDiv.scrollTop = 3;
  quill.emit('editor-change');
  assert.strictEqual(editorDiv.scrollTop, 3);
});

test('disableTypewriterMode without a prior enable does not throw', function(){
  makeEditorDiv(100);
  var quill = makeEditorQuill();

  assert.doesNotThrow(function(){ disableTypewriterMode(quill); });
});

test('typewriter scroll follows the caret at the end of a forwards selection', function(){
  var editorDiv = makeEditorDiv(100);
  setDomSelectionDirection('forwards');
  var quill = makeEditorQuill({ selectionIndex: 5, selectionLength: 20, bounds: { 0: 10, 5: 200, 25: 600 } });

  enableTypewriterMode(quill);
  quill.emit('editor-change');

  //Shift+Down leaves index at 5 and grows length, so scrolling to index would hold the view at
  //200 while the caret sat at 600. toScroll = 600 - 10 = 590; 590 - 75 = 515.
  assert.strictEqual(editorDiv.scrollTop, 515);
});

test('typewriter scroll follows the caret at the start of a backwards selection', function(){
  var editorDiv = makeEditorDiv(100);
  setDomSelectionDirection('backwards');
  var quill = makeEditorQuill({ selectionIndex: 5, selectionLength: 20, bounds: { 0: 10, 5: 200, 25: 600 } });

  enableTypewriterMode(quill);
  quill.emit('editor-change');

  // Shift+Up moves the caret to index. toScroll = 200 - 10 = 190; 190 - 75 = 115.
  assert.strictEqual(editorDiv.scrollTop, 115);
});

test('typewriter scroll uses index for a collapsed selection whatever the DOM selection says', function(){
  var editorDiv = makeEditorDiv(100);
  setDomSelectionDirection('backwards');
  var quill = makeEditorQuill({ selectionIndex: 5, selectionLength: 0, bounds: { 0: 10, 5: 200 } });

  enableTypewriterMode(quill);
  quill.emit('editor-change');

  assert.strictEqual(editorDiv.scrollTop, 115);
});
