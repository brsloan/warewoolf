//Every automatic substitution the editors make as a writer types, and the rules for when each one
//fires. This is the single source of truth the rest of the feature reads from: the Settings popup
//renders its checkboxes from AUTOCORRECT_DEFS, and controllers/autocorrect.js asks
//substitutionFor() what to do about every keystroke. Deliberately free of Quill and of the DOM - a
//substitution is a pure function of the text already on the line and the character just typed,
//which is what makes the whole rule set testable as a plain table.
//
//A RULE is enabled or it is not, and nothing else: there is no per-rule configuration. What gets
//stored in user-settings.json is only the rules a writer has actually changed (see
//diffFromDefaults), keyed by id, so a rule added in a later version reaches a writer who never
//opened the panel.
//
//A SUBSTITUTION is { deleteBack, insert }:
//
//  deleteBack - how many characters to remove, counting back from the end of the just-typed
//               character and INCLUDING it. Typing the second '-' of '--' answers 2; typing '"'
//               answers 1.
//  insert     - what to put in their place.
//
//deleteBack can never reach past the start of the line: the prefix a rule is given is already cut
//at the line break (see the controller's prefixBefore), and no rule asks for more than
//prefix.length + 1.

//How much of the line before the typed character a rule may look at. Nothing needs more than two
//characters today ('..', for the ellipsis); the headroom is so that adding a longer rule does not
//also mean remembering to change the controller.
const MAX_PREFIX_LOOKBACK = 8;

//What a quote is opening after: whitespace, the start of a line, and an opening bracket. The two
//curly openers are what makes a quote inside a quote work - in '"'Tis so," he said', the single
//quote follows a left double quote and has to open as well.
//
//A dash is deliberately NOT opening context, which is the one place this rule earns its keep.
//Interrupted dialogue - '"But I—"' - is everywhere in fiction, and its closing quote comes
//directly after the dash; treating a dash as opening would turn every one of those the wrong way.
//The cost is the rarer 'He said—"Get out."', which comes out with a closing quote. This is also
//what Word does, so a writer's habits carry over.
const OPENING_CONTEXT = /[\s(\[{<“‘]/;

//The rules themselves, keyed by id. Each is handed the text before the typed character and the
//character itself, and answers with a substitution or null. They are evaluated in the order of
//AUTOCORRECT_DEFS below and the first hit wins - no two of these can match the same character
//today, but that keeps it true if one ever could.
const SUBSTITUTION_RULES = {
  smartDoubleQuotes: function(prefix, typedChar){
    if(typedChar !== '"')
      return null;

    return { deleteBack: 1, insert: opensQuote(prefix) ? '“' : '”' };
  },

  //The same open/close test also settles the apostrophe in "don't": the character before it is a
  //letter, which is not opening context, so the quote closes - and a closing single quote is
  //exactly the right apostrophe. Leading elisions ('tis, 'em, '90s) are the case this gets wrong,
  //opening where a writer wanted an apostrophe. Ctrl+Z is the way back; see the controller's note
  //on undo.
  smartSingleQuotes: function(prefix, typedChar){
    if(typedChar !== "'")
      return null;

    return { deleteBack: 1, insert: opensQuote(prefix) ? '‘' : '’' };
  },

  //Fires on the second hyphen rather than waiting to see what follows it, which is what makes it
  //predictable: the dash appears the instant the writer has finished asking for one. The cost is
  //that a '---' scene-break line becomes an em dash followed by a hyphen. Ctrl+Z puts the hyphens
  //back, and a writer who types those often is better served turning this rule off.
  emDash: function(prefix, typedChar){
    if(typedChar !== '-' || !prefix.endsWith('-'))
      return null;

    return { deleteBack: 2, insert: '—' };
  },

  ellipsis: function(prefix, typedChar){
    if(typedChar !== '.' || !prefix.endsWith('..'))
      return null;

    return { deleteBack: 3, insert: '…' };
  }
};

//The order these appear in is the order the Settings popup lists them.
const AUTOCORRECT_DEFS = [
  { id: 'smartDoubleQuotes', label: 'Smart Double Quotes', example: '"word" to “word”', defaultEnabled: true },
  { id: 'smartSingleQuotes', label: 'Smart Single Quotes', example: "'word' to ‘word’", defaultEnabled: true },
  { id: 'emDash', label: 'Em Dash', example: '-- to —', defaultEnabled: true },
  { id: 'ellipsis', label: 'Ellipsis', example: '... to …', defaultEnabled: true }
];

function opensQuote(prefix){
  if(prefix === '')
    return true;

  return OPENING_CONTEXT.test(prefix[prefix.length - 1]);
}

//What to do about the character a writer has just typed, or null for the overwhelming majority of
//keystrokes that are not a substitution. `prefix` is the text before it on the same line, `rules`
//the resolved id -> boolean map from resolveAutocorrect().
function substitutionFor(prefix, typedChar, rules){
  if(typeof typedChar !== 'string' || typedChar.length !== 1)
    return null;

  if(typeof prefix !== 'string')
    prefix = '';

  var enabled = rules && typeof rules === 'object' ? rules : {};
  var substitution = null;

  AUTOCORRECT_DEFS.some(function(def){
    if(!enabled[def.id])
      return false;

    substitution = SUBSTITUTION_RULES[def.id](prefix, typedChar);

    return substitution != null;
  });

  return substitution;
}

function getAutocorrectDefs(){
  return AUTOCORRECT_DEFS.map(function(def){
    return { id: def.id, label: def.label, example: def.example, defaultEnabled: def.defaultEnabled };
  });
}

function getAutocorrectDef(id){
  return AUTOCORRECT_DEFS.find(function(def){
    return def.id === id;
  }) || null;
}

function getDefaultRules(){
  var defaults = {};

  AUTOCORRECT_DEFS.forEach(function(def){
    defaults[def.id] = def.defaultEnabled;
  });

  return defaults;
}

//The rules actually in force: the defaults with the writer's saved overrides laid over them.
function resolveAutocorrect(overrides){
  var resolved = getDefaultRules();
  var sanitized = sanitizeAutocorrect(overrides);

  Object.keys(sanitized).forEach(function(id){
    resolved[id] = sanitized[id];
  });

  return resolved;
}

//What gets written to user-settings.json: only what differs from the defaults, for the same reason
//shortcuts.js stores only the bindings a writer changed - a default flipped in a later version
//then reaches every writer who never had an opinion about that rule.
function diffFromDefaults(rules){
  var overrides = {};

  if(rules == null || typeof rules !== 'object')
    return overrides;

  AUTOCORRECT_DEFS.forEach(function(def){
    if(!(def.id in rules))
      return;

    var enabled = Boolean(rules[def.id]);

    if(enabled !== def.defaultEnabled)
      overrides[def.id] = enabled;
  });

  return overrides;
}

//user-settings.json is a plain file on disk that anything could have written to, so nothing from it
//is trusted: an unknown rule id is dropped, and so is a value that is not a boolean - leaving that
//rule on its default rather than guessing what a string or a number was meant to mean.
function sanitizeAutocorrect(raw){
  var overrides = {};

  if(raw == null || typeof raw !== 'object' || Array.isArray(raw))
    return overrides;

  Object.keys(raw).forEach(function(id){
    if(getAutocorrectDef(id) == null)
      return;

    if(typeof raw[id] === 'boolean')
      overrides[id] = raw[id];
  });

  return overrides;
}

module.exports = {
  MAX_PREFIX_LOOKBACK,
  substitutionFor,
  getAutocorrectDefs,
  getAutocorrectDef,
  getDefaultRules,
  resolveAutocorrect,
  diffFromDefaults,
  sanitizeAutocorrect
};
