const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

//WCAG 2.1 AA contrast, checked against the two palettes themselves rather than trusted from the
//comments at the top of lightmode.css and darkmode.css.
//
//Every colour index.css paints with is a token, and every token is defined in both palette files,
//so the pairings below - which token is drawn on top of which - are the complete list of what a
//reader can actually see. Text needs 4.5:1 (1.4.3); the parts of a control a reader has to find
//by eye - its border, its focus ring, the fill of a progress bar, the tick on a card - need 3:1
//against whatever they sit on (1.4.11). A palette edit that breaks one of these fails here, by
//name, before it reaches a screen.

const CSS_DIR = path.join(__dirname, '..', 'src', 'css');

function readTokens(file){
  var source = fs.readFileSync(path.join(CSS_DIR, file), 'utf8');
  var tokens = {};
  var re = /--([a-z0-9-]+):\s*([^;]+);/g;
  var match;
  while((match = re.exec(source)) !== null){
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function hexToRgb(hex){
  var h = hex.replace('#', '');
  if(h.length === 3)
    h = h.split('').map(function(c){ return c + c; }).join('');
  return [0, 2, 4].map(function(i){ return parseInt(h.substr(i, 2), 16); });
}

//The progress bar's fill is hsl(hue, sat, light) with the hue chosen at run time, so the test
//has to make the same colour the browser will.
function hslToRgb(h, s, l){
  s /= 100; l /= 100;
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs((h / 60) % 2 - 1));
  var m = l - c / 2;
  var rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb.map(function(v){ return Math.round((v + m) * 255); });
}

function luminance(rgb){
  var parts = rgb.map(function(v){
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function contrast(a, b){
  var la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

//Which tokens are drawn on which. A "surfaces" list is every background the foreground can
//appear against somewhere in index.css.
const TEXT_PAIRS = [
  { fg: 'text', on: ['bg', 'sheet', 'surface', 'surface-2', 'input-bg', 'code-bg', 'selected-bg', 'hover-bg', 'btn-bg', 'card-bg', 'selection',
      'cork-1', 'cork-2', 'cork-3', 'cork-4', 'cork-5', 'cork-6', 'cork-7', 'cork-8', 'cork-9'] },
  { fg: 'text-muted', on: ['bg', 'sheet', 'surface', 'surface-2', 'input-bg', 'selected-bg', 'hover-bg', 'btn-bg', 'card-bg'] },
  { fg: 'accent', on: ['bg', 'sheet', 'surface', 'surface-2', 'selected-bg', 'hover-bg'] },
  { fg: 'accent-hover', on: ['surface'] },
  { fg: 'link', on: ['surface'] },
  { fg: 'success', on: ['surface'] },
  { fg: 'danger', on: ['surface'] },
  { fg: 'warning-text', on: ['surface', 'warning-bg'] },
  { fg: 'btn-text', on: ['btn-bg', 'btn-hover', 'selected-bg'] },
  { fg: 'on-accent', on: ['accent'] },
  { fg: 'on-danger', on: ['danger-bg'] }
];

const NON_TEXT_PAIRS = [
  { fg: 'border-strong', on: ['bg', 'sheet', 'surface', 'surface-2', 'input-bg', 'card-bg', 'track',
      'cork-1', 'cork-2', 'cork-3', 'cork-4', 'cork-5', 'cork-6', 'cork-7', 'cork-8', 'cork-9'] },
  { fg: 'btn-border', on: ['btn-bg', 'btn-hover', 'surface', 'surface-2', 'bg'] },
  { fg: 'focus', on: ['bg', 'sheet', 'surface', 'surface-2', 'input-bg', 'selected-bg', 'hover-bg', 'card-bg',
      'cork-1', 'cork-2', 'cork-3', 'cork-4', 'cork-5', 'cork-6', 'cork-7', 'cork-8', 'cork-9'] },
  { fg: 'scrollbar', on: ['bg', 'sheet', 'surface'] },
  { fg: 'success-mark', on: ['card-bg', 'cork-1', 'cork-2', 'cork-3', 'cork-4', 'cork-5', 'cork-6', 'cork-7', 'cork-8', 'cork-9'] },
  { fg: 'warning-border', on: ['warning-bg'] },
  { fg: 'accent', on: ['selected-bg', 'surface'] }
];

['lightmode.css', 'darkmode.css'].forEach(function(file){
  const tokens = readTokens(file);

  function rgbOf(name){
    assert.ok(tokens[name], file + ' defines no --' + name);
    assert.match(tokens[name], /^#[0-9a-f]{3,6}$/i, '--' + name + ' in ' + file + ' is not a hex colour the checker can read');
    return hexToRgb(tokens[name]);
  }

  function check(pairs, minimum, kind){
    var failures = [];
    pairs.forEach(function(pair){
      pair.on.forEach(function(surface){
        var ratio = contrast(rgbOf(pair.fg), rgbOf(surface));
        if(ratio < minimum)
          failures.push('--' + pair.fg + ' on --' + surface + ' is ' + ratio.toFixed(2) + ':1');
      });
    });
    assert.deepStrictEqual(failures, [], file + ': ' + kind + ' below ' + minimum + ':1');
  }

  test(file + ': text reaches 4.5:1 on every surface it is drawn on', function(){
    check(TEXT_PAIRS, 4.5, 'text contrast');
  });

  test(file + ': borders, focus rings and marks reach 3:1 against what they sit on', function(){
    check(NON_TEXT_PAIRS, 3, 'non-text contrast');
  });

  test(file + ': the progress bar fill reaches 3:1 against its track at every hue', function(){
    var sat = parseFloat(tokens['progress-sat']);
    var light = parseFloat(tokens['progress-light']);
    var track = rgbOf('track');
    var failures = [];
    for(let hue = 0; hue <= 120; hue += 10){
      var ratio = contrast(hslToRgb(hue, sat, light), track);
      if(ratio < 3)
        failures.push('hue ' + hue + ' is ' + ratio.toFixed(2) + ':1');
    }
    assert.deepStrictEqual(failures, []);
  });

  test(file + ': the two palettes define the same tokens', function(){
    var other = readTokens(file === 'lightmode.css' ? 'darkmode.css' : 'lightmode.css');
    assert.deepStrictEqual(Object.keys(tokens).sort(), Object.keys(other).sort());
  });
});

test('index.css paints only with tokens both palettes define', function(){
  var source = fs.readFileSync(path.join(CSS_DIR, 'index.css'), 'utf8');
  var defined = readTokens('lightmode.css');
  var used = {};
  var re = /var\(--([a-z0-9-]+)/g;
  var match;
  while((match = re.exec(source)) !== null){
    used[match[1]] = true;
  }

  //The sizes index.css sets on its own :root, and the hue the word count view sets per element.
  var ownTokens = ['main-font-size', 'dialog-font-size', 'dialog-font-size-small', 'dialog-heading-size',
    'editor-width', 'sidebar-width', 'sidebar-width-double-view', 'corkboard-column-width',
    'font-serif', 'font-sans', 'font-mono', 'radius', 'radius-large', 'progress-hue'];

  var undefinedTokens = Object.keys(used).filter(function(name){
    return !defined[name] && ownTokens.indexOf(name) === -1;
  });
  assert.deepStrictEqual(undefinedTokens, [], 'index.css uses tokens no palette defines');

  //Literal colours belong in the palettes, where the contrast tests can see them.
  var literals = source.match(/#[0-9a-f]{3,6}\b|\b(?:rgb|hsl)a?\(/gi) || [];
  var allowed = literals.filter(function(l){ return !/^hsl\($/i.test(l); });
  assert.deepStrictEqual(allowed, [], 'index.css should paint with var() tokens, not literal colours');
});
