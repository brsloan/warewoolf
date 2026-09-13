const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { buildMenuTemplate, NOVEL_PROJECT_ONLY, PROSE_DOCUMENT_ONLY } = require('../src/components/controllers/app-menu');

//Every item with a click, flattened out of the top-level menus, with its label, whether it is
//enabled (an item says nothing when it is), and what clicking it sends.
function clickableItems(template, sent){
  var items = [];
  template.forEach(function(menu){
    (menu.submenu || []).forEach(function(entry){
      if(typeof entry.click !== 'function')
        return;
      sent.length = 0;
      entry.click();
      items.push({ label: entry.label, enabled: entry.enabled !== false, sends: sent.slice() });
    });
  });
  return items;
}

function build(mode, platform){
  var sent = [];
  var template = buildMenuTemplate(Object.assign({
    appName: 'warewoolf',
    appVersion: '3.0.0',
    send: function(){ sent.push(Array.from(arguments)); },
    mode: mode
  }, platform || {}));
  return { template: template, items: clickableItems(template, sent) };
}

function itemFor(items, channel){
  return items.find(function(i){ return i.sends.length > 0 && i.sends[0][0] === channel; });
}

test('a novel project showing prose has every item enabled, and Word Count is Word Count', function(){
  var built = build({ project: 'novel', document: 'prose' });

  assert.ok(built.items.every(function(i){ return i.enabled; }), 'nothing should be disabled for a novel');
  assert.strictEqual(itemFor(built.items, 'word-count-clicked').label, 'Word Count');
});

test('no mode at all is the novel menu', function(){
  var built = build(undefined);

  assert.ok(built.items.every(function(i){ return i.enabled; }));
  assert.strictEqual(itemFor(built.items, 'word-count-clicked').label, 'Word Count');
});

test('a screenplay project showing its script renames Word Count and disables what is not for a script', function(){
  var built = build({ project: 'screenplay', document: 'screenplay' });

  assert.strictEqual(itemFor(built.items, 'word-count-clicked').label, 'Page Count');

  var disabled = built.items.filter(function(i){ return !i.enabled; }).map(function(i){ return i.sends[0][0]; }).sort();
  assert.deepStrictEqual(disabled, NOVEL_PROJECT_ONLY.concat(PROSE_DOCUMENT_ONLY).sort());

  //Named, so a change to the lists is a change to this test too.
  assert.deepStrictEqual(disabled, [
    'center-all-heads-clicked', 'compile-clicked', 'convert-first-lines-clicked',
    'convert-italics-clicked', 'convert-tabs-clicked', 'delete-chapter-clicked',
    'headings-to-chaps-clicked', 'renumber-chapters-clicked', 'restore-chapter-clicked',
    'split-chapter-clicked', 'tab-indent-paragraphs-clicked'
  ]);

  //What a screenplay keeps: the script's own tools, and Add New Chapter, which makes a Reference
  //document beside the script.
  ['import-clicked', 'export-clicked', 'word-count-clicked', 'find-replace-clicked', 'spellcheck-clicked',
   'outliner-clicked', 'corkboard-clicked', 'add-chapter-clicked', 'properties-clicked'].forEach(function(channel){
    assert.strictEqual(itemFor(built.items, channel).enabled, true, channel + ' should stay enabled');
  });
});

test('a screenplay project showing a prose Reference document gets the chapter tools back, not the conversions', function(){
  var built = build({ project: 'screenplay', document: 'prose' });

  assert.strictEqual(itemFor(built.items, 'word-count-clicked').label, 'Page Count');

  var disabled = built.items.filter(function(i){ return !i.enabled; }).map(function(i){ return i.sends[0][0]; }).sort();
  assert.deepStrictEqual(disabled, NOVEL_PROJECT_ONLY.slice().sort());
});

//A .fountain chapter in a novel project works, because mode follows the file (docs/screenplay-plan.md).
test('a novel project showing a script keeps its conversions and loses only the chapter tools', function(){
  var built = build({ project: 'novel', document: 'screenplay' });

  assert.strictEqual(itemFor(built.items, 'word-count-clicked').label, 'Word Count');

  var disabled = built.items.filter(function(i){ return !i.enabled; }).map(function(i){ return i.sends[0][0]; }).sort();
  assert.deepStrictEqual(disabled, PROSE_DOCUMENT_ONLY.slice().sort());
});

test('Shortcuts and About send what the renderer expects with the channel', function(){
  var built = build({ project: 'novel', document: 'prose' }, { isMac: true });

  assert.deepStrictEqual(itemFor(built.items, 'shortcuts-clicked').sends, [['shortcuts-clicked', true]]);
  assert.deepStrictEqual(itemFor(built.items, 'about-clicked').sends, [['about-clicked', '3.0.0']]);
});

test('the platform-only menus and items come and go with the platform', function(){
  var linux = build({}, { isLinux: true });
  var mac = build({}, { isMac: true });
  var windows = build({}, {});

  var menus = function(built){ return built.template.map(function(m){ return m.label; }); };
  assert.deepStrictEqual(menus(windows), ['File', 'Edit', 'Tools', 'View', 'Help']);
  assert.deepStrictEqual(menus(linux), ['File', 'Edit', 'Tools', 'Help']);
  assert.deepStrictEqual(menus(mac), ['warewoolf', 'File', 'Edit', 'Tools', 'View', 'Help']);

  assert.ok(itemFor(linux.items, 'reboot-clicked'), 'Reboot is a writerDeck item');
  assert.ok(itemFor(linux.items, 'wifi-manager-clicked'));
  assert.strictEqual(itemFor(windows.items, 'reboot-clicked'), undefined);
  assert.strictEqual(itemFor(windows.items, 'wifi-manager-clicked'), undefined);
});

//render.js answers the same two lists with a message each, for a command that reaches it anyway
//(a shortcut, an accelerator on a menu built before the mode arrived). The two must not drift.
test('the menu\'s gating lists are the ones render.js answers with a message', function(){
  var render = fs.readFileSync(path.join(__dirname, '../src/render.js'), 'utf8');

  function channelsOf(tableName){
    var match = render.match(new RegExp('const ' + tableName + ' = \\{([\\s\\S]*?)\\};'));
    assert.ok(match, tableName + ' should be a table in render.js');
    return Array.from(match[1].matchAll(/'([a-z-]+-clicked)'/g), function(m){ return m[1]; }).sort();
  }

  assert.deepStrictEqual(channelsOf('NOVEL_PROJECT_ONLY'), NOVEL_PROJECT_ONLY.slice().sort());
  assert.deepStrictEqual(channelsOf('PROSE_DOCUMENT_ONLY'), PROSE_DOCUMENT_ONLY.slice().sort());
});

//index.js builds the real menu from this template and nothing else, so an item cannot be added
//there and missed here.
test('index.js builds its menu from the template and hand-writes no menu items of its own', function(){
  var main = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');

  assert.ok(main.includes("require('./components/controllers/app-menu')"));
  assert.ok(main.includes('Menu.buildFromTemplate(buildMenuTemplate('));
  assert.strictEqual(main.indexOf('buildFromTemplate(['), -1, 'index.js should hold no menu template of its own');
  //The window's close event routes through exit-app-clicked as the Exit item does; that is the one
  //menu channel index.js sends itself, and it is not a menu item.
  var sent = (main.match(/webContents\.send\(['"][a-z-]+-clicked['"]/g) || []);
  assert.deepStrictEqual(sent, ["webContents.send('exit-app-clicked'"]);
});
