require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { enableTypewriterMode, disableTypewriterMode } = require('../src/components/controllers/typewriter-mode');

//typewriterScroll only needs on/off/hasFocus/getSelection/getBounds, so a plain EventEmitter
//stands in for editorQuill - it also lets tests assert on/off actually match the same listener,
//the thing that was broken before disableTypewriterMode was fixed to store its handler reference.
function makeEditorQuill({ focused = true, selectionIndex = 5, bounds = {} } = {}){
  var quill = new EventEmitter();
  quill.hasFocus = function(){ return focused; };
  quill.getSelection = function(){ return selectionIndex === null ? null : { index: selectionIndex }; };
  quill.getBounds = function(index){ return { top: bounds[index] || 0 }; };
  return quill;
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
