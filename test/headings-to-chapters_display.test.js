const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const headingsDisplayPath = require.resolve('../src/components/views/headings-to-chapters_display');
const headingsControllerPath = require.resolve('../src/components/controllers/headings-to-chapters');
const workingDisplayPath = require.resolve('../src/components/views/working_display');

//headings-to-chapters_display.js requires breakHeadingsIntoChapters directly (not destructured)
//and destructures showWorking/showWorkingAndThen/hideWorking from working_display, at
//require-time - so these mocks only take effect if the cache is primed before
//headings-to-chapters_display.js is (re-)required, same pattern as convert-italics_display.test.js.
function freshHeadingsDisplay(mocks){
  delete require.cache[headingsDisplayPath];
  require.cache[headingsControllerPath] = {
    id: headingsControllerPath,
    filename: headingsControllerPath,
    loaded: true,
    exports: mocks.breakHeadingsIntoChapters
  };
  require.cache[workingDisplayPath] = {
    id: workingDisplayPath,
    filename: workingDisplayPath,
    loaded: true,
    exports: {
      showWorking: mocks.showWorking,
      showWorkingAndThen: mocks.showWorkingAndThen,
      hideWorking: mocks.hideWorking
    }
  };
  return require(headingsDisplayPath);
}

//closePopups() also calls disableSearchView()/focusEditor(), which reach for this fixed shell by
//id - same shell used in renumber-chapters_display.test.js.
function bodyShell(){
  return '<div id="editor-container"><div class="ql-editor"></div></div>' +
    '<div id="chapter-list-sidebar"></div>' +
    '<div id="project-notes"></div>' +
    '<div id="writing-field"></div>';
}

function submitForm(){
  document.querySelector('form').onsubmit({ preventDefault: function(){} });
}

test.beforeEach(function(){
  const dom = new JSDOM('<!doctype html><html><body>' + bodyShell() + '</body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
});

test.afterEach(function(){
  delete require.cache[headingsDisplayPath];
  delete require.cache[headingsControllerPath];
  delete require.cache[workingDisplayPath];
  delete global.window;
  delete global.document;
});

test('renders a heading level select with options 1-4 and a warning', function(t){
  var showBreakHeadingsOptions = freshHeadingsDisplay({
    breakHeadingsIntoChapters: function(){},
    showWorking: function(){},
    showWorkingAndThen: function(){},
    hideWorking: function(){}
  });

  showBreakHeadingsOptions({}, function(){});

  var options = Array.from(document.querySelectorAll('#heading-level-select option')).map(function(o){ return o.value; });
  assert.deepStrictEqual(options, ['1', '2', '3', '4']);
  assert.match(document.querySelector('.warning-text').innerText, /cannot be undone/);
});

test('Cancel closes the popup without breaking anything into chapters', function(t){
  var breakCalls = 0;
  var showBreakHeadingsOptions = freshHeadingsDisplay({
    breakHeadingsIntoChapters: function(){ breakCalls++; },
    showWorking: function(){},
    showWorkingAndThen: function(){},
    hideWorking: function(){}
  });

  showBreakHeadingsOptions({}, function(){});
  var cancelBtn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.innerHTML === 'Cancel'; });
  cancelBtn.onclick();

  assert.strictEqual(breakCalls, 0);
  assert.strictEqual(document.getElementsByClassName('popup').length, 0);
});

//Regression: breaking can be slow on projects with many/large chapters, so the popup must close
//and a working indicator must show before breakHeadingsIntoChapters actually runs (deferred via
//showWorkingAndThen), rather than blocking with the popup still up and no feedback.
test('submitting closes the popup and shows a working indicator before splitting, using the selected heading level', function(t){
  var editorQuill = { fake: 'quill' };
  var addImportedChapter = function(){};
  var capturedLevel;
  var capturedEditorQuill;
  var breakCalls = 0;
  var breakHeadingsIntoChapters = function(quill, addChap, level){
    breakCalls++;
    capturedEditorQuill = quill;
    capturedLevel = level;
    return true;
  };

  var showWorkingAndThenCalls = [];
  var hideWorkingCalls = 0;
  var showBreakHeadingsOptions = freshHeadingsDisplay({
    breakHeadingsIntoChapters: breakHeadingsIntoChapters,
    showWorking: function(){},
    showWorkingAndThen: function(status, cb){ showWorkingAndThenCalls.push(status); cb(); },
    hideWorking: function(){ hideWorkingCalls++; }
  });

  showBreakHeadingsOptions(editorQuill, addImportedChapter);
  document.getElementById('heading-level-select').value = '2';
  submitForm();

  assert.strictEqual(document.getElementsByClassName('popup').length, 0, 'popup should close on submit');
  assert.strictEqual(showWorkingAndThenCalls.length, 1);
  assert.match(showWorkingAndThenCalls[0], /Breaking headings into chapters/);
  assert.strictEqual(breakCalls, 1);
  assert.strictEqual(capturedEditorQuill, editorQuill);
  assert.strictEqual(capturedLevel, 2, 'heading level should be parsed as an integer from the select');
  assert.strictEqual(hideWorkingCalls, 1, 'hideWorking should run once splitting succeeds');
});

test('when a split happens, showWorking/setTimeout are not used - only hideWorking runs', function(t){
  var showWorkingCalls = 0;
  var showBreakHeadingsOptions = freshHeadingsDisplay({
    breakHeadingsIntoChapters: function(){ return true; },
    showWorking: function(){ showWorkingCalls++; },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){}
  });

  showBreakHeadingsOptions({}, function(){});
  submitForm();

  assert.strictEqual(showWorkingCalls, 0);
});

//Regression: when there's nothing to split, the popup used to just vanish with no feedback. It
//should instead show a message for a beat before hiding, so the user knows why nothing happened.
test('when nothing matches the heading level, shows a "nothing to split" message and then hides it after a delay', function(t){
  t.mock.timers.enable({ apis: ['setTimeout'] });

  var showWorkingMessages = [];
  var hideWorkingCalls = 0;
  var showBreakHeadingsOptions = freshHeadingsDisplay({
    breakHeadingsIntoChapters: function(){ return false; },
    showWorking: function(status){ showWorkingMessages.push(status); },
    showWorkingAndThen: function(status, cb){ cb(); },
    hideWorking: function(){ hideWorkingCalls++; }
  });

  showBreakHeadingsOptions({}, function(){});
  document.getElementById('heading-level-select').value = '3';
  submitForm();

  assert.strictEqual(showWorkingMessages.length, 1);
  assert.match(showWorkingMessages[0], /No heading 3 found - nothing to split\./);
  assert.strictEqual(hideWorkingCalls, 0, 'should not hide immediately - the message needs time to be seen');

  t.mock.timers.tick(2500);

  assert.strictEqual(hideWorkingCalls, 1);
});
