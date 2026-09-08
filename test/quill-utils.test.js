const test = require('node:test');
const assert = require('node:assert');

const { getOrderedListNumbers, getListMarker, parseDelta, generateChapTitleFromFirstLine, applyQuillShortcuts, goPageDown } = require('../src/components/controllers/quill-utils');
const shortcutsModel = require('../src/components/models/shortcuts');

//getOrderedListNumbers works on the paragraph shape parseDelta produces. Building them by hand here
//keeps these tests on the numbering rule itself rather than on delta parsing.
function para(attributes){
  return attributes ? { textRuns: [{text: 'x'}], attributes: attributes } : { textRuns: [{text: 'x'}] };
}

const ordered = { list: 'ordered' };

test('a flat numbered list counts up from one', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([para(ordered), para(ordered), para(ordered)]),
    [1, 2, 3]
  );
});

test('paragraphs that are not numbered list items get zero', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([para(), para({list: 'bullet'}), para({header: 1})]),
    [0, 0, 0]
  );
});

test('a numbered list restarts after any paragraph that breaks it', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([para(ordered), para(ordered), para(), para(ordered)]),
    [1, 2, 0, 1]
  );
  assert.deepStrictEqual(
    getOrderedListNumbers([para(ordered), para({list: 'bullet'}), para(ordered)]),
    [1, 0, 1]
  );
});

test('each nesting level counts independently', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([
      para(ordered),
      para({list: 'ordered', indent: 1}),
      para({list: 'ordered', indent: 1}),
      para(ordered)
    ]),
    [1, 1, 2, 2]
  );
});

test('a level resumes its own count after dropping back out and in', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([
      para(ordered),
      para({list: 'ordered', indent: 1}),
      para(ordered),
      para({list: 'ordered', indent: 1})
    ]),
    [1, 1, 2, 2]
  );
});

test('nesting deeper than three levels is folded into the third', function(){
  assert.deepStrictEqual(
    getOrderedListNumbers([
      para({list: 'ordered', indent: 2}),
      para({list: 'ordered', indent: 3}),
      para({list: 'ordered', indent: 9})
    ]),
    [1, 2, 3]
  );
});

test('an empty paragraph list produces no numbers', function(){
  assert.deepStrictEqual(getOrderedListNumbers([]), []);
});

test('getListMarker renders bullets and numbers at each level', function(){
  assert.strictEqual(getListMarker({list: 'bullet'}), '* ');
  assert.strictEqual(getListMarker({list: 'bullet', indent: 1}), '\t* ');
  assert.strictEqual(getListMarker({list: 'bullet', indent: 2}), '\t\t* ');
  assert.strictEqual(getListMarker({list: 'ordered'}, 1), '1. ');
  assert.strictEqual(getListMarker({list: 'ordered', indent: 1}, 4), '\t4. ');
  assert.strictEqual(getListMarker({list: 'ordered', indent: 2}, 2), '\t\t2. ');
});

test('getListMarker returns nothing for anything that is not a list item', function(){
  assert.strictEqual(getListMarker(null), '');
  assert.strictEqual(getListMarker(undefined), '');
  assert.strictEqual(getListMarker({}), '');
  assert.strictEqual(getListMarker({header: 1}), '');
  assert.strictEqual(getListMarker({blockquote: true}), '');
});

test('parseDelta gives each real paragraph a single run holding its text', function(){
  var parsed = parseDelta({ ops: [{ insert: 'Hello\n\nWorld\n' }] });

  assert.deepStrictEqual(parsed.paragraphs, [
    { textRuns: [{ text: 'Hello' }] },
    { textRuns: [{ text: '' }] },
    { textRuns: [{ text: 'World' }] }
  ]);
});

test('parseDelta preserves per-run attributes and paragraph (line) attributes', function(){
  var parsed = parseDelta({
    ops: [
      { insert: 'Bold', attributes: { bold: true } },
      { insert: 'Plain' },
      { insert: '\n', attributes: { header: 1 } }
    ]
  });

  assert.deepStrictEqual(parsed.paragraphs, [
    {
      textRuns: [
        { text: 'Bold', attributes: { bold: true } },
        { text: 'Plain' }
      ],
      attributes: { header: 1 }
    }
  ]);
});

test('parseDelta on an empty delta produces no paragraphs', function(){
  assert.deepStrictEqual(parseDelta({ ops: [] }), { paragraphs: [] });
});

test('generateChapTitleFromFirstLine takes the first line of the first insert', function(){
  assert.strictEqual(
    generateChapTitleFromFirstLine({ ops: [{ insert: 'Chapter One\nSome body text\n' }] }),
    'Chapter One'
  );
});

test('generateChapTitleFromFirstLine returns an empty string instead of throwing on an empty delta', function(){
  assert.strictEqual(generateChapTitleFromFirstLine({ ops: [] }), '');
});

test('generateChapTitleFromFirstLine returns an empty string when the first insert is not text', function(){
  assert.strictEqual(
    generateChapTitleFromFirstLine({ ops: [{ insert: { image: 'foo.png' } }] }),
    ''
  );
});

//---------------------------------------------------------------------------
// applyQuillShortcuts
//---------------------------------------------------------------------------

//applyQuillShortcuts only touches q.keyboard.bindings, q.getFormat() and q.format(), so a recording
//stand-in exercises the bindings without a real editor or a DOM. It keeps them the way Quill does -
//an object keyed by keyCode, each holding everything bound to that key - because removing the
//previously applied ones on a rebind means filtering exactly that structure.
//
//Quill invokes a handler with `this` bound to a context carrying the instance, which fire() supplies.
function recordingQuill(currentFormat, overrides){
  var q = {
    formatCalls: [],
    keyboard: {
      bindings: {},
      addBinding: function(binding){
        q.keyboard.bindings[binding.key] = q.keyboard.bindings[binding.key] || [];
        q.keyboard.bindings[binding.key].push(binding);
      }
    },
    getFormat: function(){ return currentFormat || {}; },
    format: function(name, value, source){ q.formatCalls.push([name, value, source]); }
  };

  //A binding Quill itself owns - Tab, Enter and the rest come from its keyboard module, not from
  //us - so a test can prove a rebind leaves those where they are.
  q.keyboard.addBinding({ key: 9, quillsOwn: true, handler: function(){} });

  applyQuillShortcuts(q, shortcutsModel.resolveShortcuts(overrides));

  q.applied = function(){
    return Object.keys(q.keyboard.bindings).reduce(function(all, keyCode){
      return all.concat(q.keyboard.bindings[keyCode].filter(function(binding){
        return binding.warewoolfAction != null;
      }));
    }, []);
  };
  q.find = function(actionId){
    return q.applied().find(function(binding){
      return binding.warewoolfAction === actionId;
    });
  };
  q.fire = function(actionId){
    q.find(actionId).handler.call({ quill: q }, { index: 0, length: 0 }, {});
  };

  return q;
}

test('every formatting shortcut is bound on its default key with the platform modifier held', function(){
  var q = recordingQuill();

  assert.deepStrictEqual(q.applied().map(function(binding){ return binding.warewoolfAction; }).sort(), [
    'formatAlignCenter', 'formatAlignJustify', 'formatAlignLeft', 'formatAlignRight',
    'formatBlockquote', 'formatBold', 'formatClearHeading', 'formatHeading1', 'formatHeading2',
    'formatHeading3', 'formatHeading4', 'formatItalics', 'formatList', 'formatStrikethrough',
    'formatTitle', 'formatUnderline'
  ]);

  assert.ok(q.applied().every(function(binding){ return binding.shortKey === true; }));
});

//Quill matches a keypress on its keyCode, so that is what a binding has to carry - a key's name
//would never match anything.
test('a binding carries the key code of the key it is bound to', function(){
  var q = recordingQuill();

  assert.strictEqual(q.find('formatBold').key, 66);
  assert.strictEqual(q.find('formatHeading1').key, 49);
  assert.strictEqual(q.find('formatTitle').key, 84);
  assert.strictEqual(q.find('formatList').shiftKey, true);
  assert.strictEqual(q.find('formatBold').shiftKey, false);
});

test('the title shortcut centres the line and makes it a level one heading', function(){
  var q = recordingQuill();

  q.fire('formatTitle');

  assert.deepStrictEqual(q.formatCalls, [
    ['align', 'center', 'user'],
    ['header', 1, 'user']
  ]);
});

test('each heading shortcut sets its own level, and clear heading removes it', function(){
  [1, 2, 3, 4].forEach(function(level){
    var q = recordingQuill();
    q.fire('formatHeading' + level);
    assert.deepStrictEqual(q.formatCalls, [['header', level, 'user']]);
  });

  var cleared = recordingQuill();
  cleared.fire('formatClearHeading');
  assert.deepStrictEqual(cleared.formatCalls, [['header', null, 'user']]);
});

test('the four alignment shortcuts each set their own alignment', function(){
  var expected = {
    formatAlignLeft: null,
    formatAlignCenter: 'center',
    formatAlignRight: 'right',
    formatAlignJustify: 'justify'
  };

  Object.keys(expected).forEach(function(id){
    var q = recordingQuill();
    q.fire(id);
    assert.deepStrictEqual(q.formatCalls, [['align', expected[id], 'user']], id);
  });
});

test('the strikethrough shortcut toggles against the current format', function(){
  var off = recordingQuill({});
  off.fire('formatStrikethrough');
  assert.deepStrictEqual(off.formatCalls, [['strike', true, 'user']]);

  var on = recordingQuill({ strike: true });
  on.fire('formatStrikethrough');
  assert.deepStrictEqual(on.formatCalls, [['strike', false, 'user']]);
});

test('the blockquote shortcut toggles against the current format', function(){
  var off = recordingQuill({});
  off.fire('formatBlockquote');
  assert.deepStrictEqual(off.formatCalls, [['blockquote', true, 'user']]);

  var on = recordingQuill({ blockquote: true });
  on.fire('formatBlockquote');
  assert.deepStrictEqual(on.formatCalls, [['blockquote', false, 'user']]);
});

//Quill binds these three itself by default. They are switched off where the editors are built (see
//render.js) so they can be rebound like every other formatting shortcut, which means their handlers
//have to live here now.
test('bold, italics and underline toggle against the current format', function(){
  [['formatBold', 'bold'], ['formatItalics', 'italic'], ['formatUnderline', 'underline']].forEach(function(pair){
    var off = recordingQuill({});
    off.fire(pair[0]);
    assert.deepStrictEqual(off.formatCalls, [[pair[1], true, 'user']]);

    var current = {};
    current[pair[1]] = true;
    var on = recordingQuill(current);
    on.fire(pair[0]);
    assert.deepStrictEqual(on.formatCalls, [[pair[1], false, 'user']]);
  });
});

test('the list shortcut cycles bullet, then numbered, then off', function(){
  var none = recordingQuill({});
  none.fire('formatList');
  assert.deepStrictEqual(none.formatCalls, [['list', 'bullet', 'user']]);

  var bullet = recordingQuill({ list: 'bullet' });
  bullet.fire('formatList');
  assert.deepStrictEqual(bullet.formatCalls, [['list', 'ordered', 'user']]);

  var ordered = recordingQuill({ list: 'ordered' });
  ordered.fire('formatList');
  assert.deepStrictEqual(ordered.formatCalls, [['list', null, 'user']]);
});

test('a rebound formatting shortcut is bound to the key the writer chose', function(){
  var q = recordingQuill({}, { formatBold: { key: 'W', mod: true, alt: false, shift: true, code: 'KeyW' } });

  assert.strictEqual(q.find('formatBold').key, 87);
  assert.strictEqual(q.find('formatBold').shiftKey, true);

  q.fire('formatBold');
  assert.deepStrictEqual(q.formatCalls, [['bold', true, 'user']]);
});

test('a shortcut a writer has unassigned is not bound at all', function(){
  var q = recordingQuill({}, { formatBold: null });

  assert.strictEqual(q.find('formatBold'), undefined);
  assert.strictEqual(q.applied().length, 15);
});

//Quill 1.x has no removeBinding(), so re-applying has to strip what it added last time - or every
//rebind would leave the old key working alongside the new one.
test('re-applying replaces the bindings it added before, leaving Quill to keep its own', function(){
  var q = recordingQuill();

  applyQuillShortcuts(q, shortcutsModel.resolveShortcuts({
    formatBold: { key: 'W', mod: true, alt: false, shift: false, code: 'KeyW' }
  }));

  assert.strictEqual(q.applied().length, 16, 'no duplicates left over from the first application');
  assert.strictEqual(q.find('formatBold').key, 87);
  assert.deepStrictEqual((q.keyboard.bindings[66] || []).map(function(binding){
    return binding.warewoolfAction;
  }), ['formatList'], 'only the list shortcut should be left on B');

  assert.deepStrictEqual(q.keyboard.bindings[9].map(function(binding){
    return binding.quillsOwn === true;
  }), [true], 'the Tab binding Quill added should survive');
});

//The physical key a binding was captured from is what rescues the shifted symbols: on a US layout
//Ctrl+Shift+3 reports its key as '#', which says nothing about which key was pressed, while its
//code says Digit3 - and Quill matches on the key code.
test('a binding is matched by the physical key it was captured from', function(){
  var q = recordingQuill({}, { formatBold: { key: '#', mod: true, alt: false, shift: true, code: 'Digit3' } });

  assert.strictEqual(q.find('formatBold').key, 51);
  assert.strictEqual(q.find('formatBold').shiftKey, true);
});

//A binding whose key Quill has no code for could never be matched against a keypress, so it is left
//off rather than sitting in the table looking like it works. Applied directly rather than through
//resolveShortcuts, which drops a binding like this long before it could get here.
test('a binding Quill could not match is left off rather than added dead', function(){
  var q = recordingQuill();
  var bindings = shortcutsModel.getDefaultBindings();
  bindings.formatBold = { key: '#', mod: true, alt: false, shift: true };

  applyQuillShortcuts(q, bindings);

  assert.strictEqual(q.find('formatBold'), undefined);
  assert.strictEqual(q.applied().length, 15);
});

//---------------------------------------------------------------------------
// goPageDown
//---------------------------------------------------------------------------

//A fully synthetic stand-in for the pieces goPageDown actually touches, rather than a real Quill
//instance - real layout metrics (clientHeight, getBoundingClientRect) are always zero under jsdom
//since it has no layout engine, which would leave every geometric branch below untestable.
function stubQuill(opts){
  opts = opts || {};
  var selection = { index: opts.selectionIndex || 0, length: 0 };
  var boundsByIndex = opts.boundsByIndex || {};

  return {
    getSelection: function(){ return selection; },
    setSelection: function(index){ selection = { index: index, length: 0 }; },
    root: { scrollTop: opts.scrollTop || 0, clientHeight: opts.clientHeight || 100 },
    container: { getBoundingClientRect: function(){ return { top: opts.containerTop || 0 }; } },
    selection: {
      //Real Quill returns a viewport-relative DOMRect for a found position, or null once the
      //lookup runs past the end of the content - boundsByIndex models both with plain objects.
      getBounds: function(index){ return boundsByIndex[index] || null; }
    }
  };
}

test('goPageDown does nothing when there is no selection', function(){
  var q = stubQuill();
  q.getSelection = function(){ return null; };

  assert.doesNotThrow(function(){ goPageDown(q); });
});

test('goPageDown stops at the end of the content, landing one position before it', function(){
  //boundsByIndex has no entry for index 1, so the very first lookup already returns null.
  var q = stubQuill({ selectionIndex: 0 });

  goPageDown(q);

  assert.deepStrictEqual(q.getSelection(), { index: 0, length: 0 });
});

test('goPageDown converts viewport-relative bounds to container-relative before comparing against clientHeight', function(){
  //Editor sits 200px down the viewport; a candidate position at viewport y=250 is therefore only
  //50px into the editor's own content, not past a 100px-tall viewport as the raw viewport
  //coordinate would suggest.
  var q = stubQuill({
    selectionIndex: 0,
    containerTop: 200,
    clientHeight: 100,
    boundsByIndex: { 1: { top: 250, height: 20 } }
  });

  goPageDown(q);

  //Not yet past the bottom (container-relative top 50 < clientHeight 100), so the loop keeps
  //walking forward and (nothing at index 2) lands one short of it.
  assert.deepStrictEqual(q.getSelection(), { index: 1, length: 0 });
});

test('goPageDown selects the first position that reaches the bottom of the editor and scrolls by its container-relative offset', function(){
  var q = stubQuill({
    selectionIndex: 0,
    scrollTop: 0,
    containerTop: 200,
    clientHeight: 100,
    //Container-relative top: 320-200=120 >= 100, so this is the landing position.
    boundsByIndex: { 1: { top: 320, height: 20 } }
  });

  goPageDown(q);

  assert.deepStrictEqual(q.getSelection(), { index: 1, length: 0 });
  assert.strictEqual(q.root.scrollTop, 100, '0 (starting scrollTop) + 120 (container-relative top) - 20 (height)');
});
