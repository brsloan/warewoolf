const { getTempQuill, getIndexableText } = require('./quill-utils');

//How a search is to be run, carried as one object rather than as a tail of positional booleans:
//the flags always travel together, from the popup's checkboxes down to the matcher, and a caller
//passing them in the wrong order would search wrongly rather than fail. Defaults are the ones the
//old parameter defaults gave: case sensitive, matching anywhere inside a word.
function searchOptions(options){
    options = options || {};

    return {
        caseSensitive: options.caseSensitive !== false,
        wholeWordOnly: options.wholeWordOnly === true,
        useRegex: options.useRegex === true
    };
}

//Compiled once here rather than inside the recursion below, which re-enters this search for every
//chapter an In All Chapters search visits. A pattern that will not compile finds nothing; the popup
//has already told the writer why, having compiled it itself before getting this far.
function find(editorQuill, project, str, startingIndex, searchAllChapters, displayChapterByIndex, options){
    if(!str)
        return -1;

    var search = compileSearch(str, options);

    return search.error ? -1 : findWith(search, editorQuill, project, startingIndex, searchAllChapters, displayChapterByIndex);
}

function findWith(search, editorQuill, project, startingIndex, searchAllChapters, displayChapterByIndex){
    var index = -1;
    var match = search.findFrom(getIndexableText(editorQuill), startingIndex);

    if(match){
        index = match.index;
        //match.length rather than the search term's length: what was matched is not always the same
        //length as what was typed, and only the matcher knows which.
        editorQuill.setSelection(match.index, match.length);
    }
    else{
        //No more results. Either start again at top of current chapter or move to next chapter.
        if(searchAllChapters){
            var startingChapIndex = project.activeChapterIndex;
            var chapIndex = startingChapIndex;

            //Visits every other chapter exactly once, starting with the next one and wrapping
            //around, stopping as soon as a match turns up.
            for(var i = 0; i < project.chapters.length - 1 && index < 0; i++){
                chapIndex = chapIndex < project.chapters.length - 1 ? chapIndex + 1 : 0;
                displayChapterByIndex(chapIndex);
                //searchAllChapters is deliberately false here so the recursive call searches
                //only the chapter just displayed rather than re-entering this loop.
                index = findWith(search, editorQuill, project, 0, false, displayChapterByIndex);
            }

            //Nothing found anywhere; return to the chapter the search started from instead of
            //leaving the view on whichever chapter the wraparound happened to end on.
            if(index < 0)
                displayChapterByIndex(startingChapIndex);
        } else {
            if(startingIndex != 0){
                index = findWith(search, editorQuill, project, 0, false, displayChapterByIndex);
            }
        }
    }

    return index;
}

//Works out how to run a search once, rather than once per match: for a regular expression that
//means compiling it, which is also the only way to discover that a half-typed pattern - "(", "[a-",
//"*" - is not one yet. Returns either {findFrom} or {error}, never both, and never throws.
//
//findFrom(text, startingIndex) returns {index, length} describing the match in the text as it was
//passed in - not in the lowercased or quote-folded copy actually searched, both of which are
//length-preserving precisely so that the two describe the same span - or null for no match.
function compileSearch(str, options){
    var opts = searchOptions(options);

    if(!opts.useRegex){
        //An empty term matches emptily at every position and so finds nothing under the rule below;
        //saying so here rather than scanning the whole chapter to reach the same answer.
        if(!str)
            return { findFrom: function(){ return null; } };

        return { findFrom: matcher(literalPreparer(str, opts), literalMatchAt(str, opts)) };
    }

    var regex;

    try {
        regex = new RegExp(regexPatternFor(str, opts), regexFlagsFor(opts));
    }
    catch(err){
        return { error: describeRegexError(err) };
    }

    return { findFrom: matcher(function(text){ return foldQuotesInText(str, text); }, regexMatchAt(regex)) };
}

//A regular expression can match nothing at all - "x*", "\b", "^", a lookahead - and a match of
//nothing is not something to select or to replace: replacing it would drop the replacement between
//every pair of characters in the manuscript, and with an empty replacement the search would never
//advance past it. Empty matches are stepped over rather than returned, so "x*" replaces runs of x
//and leaves the rest of the prose alone, and Find never highlights a span of nothing.
//
//Preparing the text once per search rather than once per step matters here: a pattern that matches
//emptily does so at nearly every position, so this loop runs the length of the chapter.
function matcher(prepare, matchAt){
    return function(text, startingIndex){
        var prepared = prepare(text);
        var index = startingIndex > 0 ? startingIndex : 0;

        while(index <= prepared.length){
            var match = matchAt(prepared, index);

            if(!match)
                return null;
            if(match.length > 0)
                return match;

            index = match.index + 1;
        }

        return null;
    };
}

//Case-insensitivity outside regex mode is still done by lowercasing both sides, exactly as it
//always was. In regex mode it has to be the 'i' flag instead - see regexFlagsFor.
function literalPreparer(str, opts){
    var term = opts.caseSensitive ? str : str.toLowerCase();

    return function(text){
        return foldQuotesInText(term, opts.caseSensitive ? text : text.toLowerCase());
    };
}

function literalMatchAt(str, opts){
    var term = opts.caseSensitive ? str : str.toLowerCase();

    if(!opts.wholeWordOnly){
        return function(text, index){
            var found = text.indexOf(term, index);
            return found > -1 ? { index: found, length: term.length, captures: [term] } : null;
        };
    }

    var regex = new RegExp(getWholeWordPattern(term), 'g');

    return regexMatchAt(regex);
}

//captures is the exec array - captures[0] the whole match, captures[n] the nth group - which is
//what a $1 in the Replace box is expanded from. It is read out of the text as searched, so the
//quote folding above has already been applied to it: a $& covering a curly quote hands back the
//straight one. That only arises when the pattern itself contains a straight quote, which is a
//writer asking for exactly that substitution.
function regexMatchAt(regex){
    return function(text, index){
        regex.lastIndex = index;
        var match = regex.exec(text);

        return match ? { index: match.index, length: match[0].length, captures: match } : null;
    };
}

//The pattern is used as the writer typed it; Whole Word Only wraps it rather than rewriting it.
//The non-capturing group is not optional - without it the boundaries would bind to one alternative
//of "cat|dog" only. Lookbehind is already relied on by getWholeWordPattern below.
function regexPatternFor(str, opts){
    return opts.wholeWordOnly ? '(?<!\\w)(?:' + str + ')(?!\\w)' : str;
}

//'g' so a search can resume from lastIndex, and 'm' so that ^ and $ mean the start and end of a
//line rather than of the whole chapter, which is what a writer means by them. 'i' for a
//case-insensitive search, which in regex mode has to be the flag: lowercasing the pattern itself
//would turn \S into \s and \W into \w, quietly inverting it. Deliberately not 's', so that "." stops
//at a paragraph break rather than running through the rest of the chapter.
function regexFlagsFor(opts){
    return opts.caseSensitive ? 'gm' : 'gmi';
}

//V8 phrases these as "Invalid regular expression: /<pattern>/<flags>: <reason>". The pattern is
//already in the box in front of the writer, and Whole Word Only may have wrapped it into something
//they never typed, so only the reason is worth repeating back.
function describeRegexError(err){
    var message = err && err.message ? err.message : 'not a valid regular expression';
    var reason = /:\s*([^:]+)$/.exec(message);

    return reason ? reason[1] : message;
}

//The whole search in one call, for callers with a single chapter's text and no reason to hold on
//to a compiled pattern. A pattern that will not compile matches nothing here; find() and
//replaceAllInDelta() compile for themselves so that they can say why instead.
function getNextMatch(str, text, startingIndex, options){
    var search = compileSearch(str, options);

    return search.error ? null : search.findFrom(text, startingIndex);
}

//Index-only views of getNextMatch, for callers that have no use for the length. Both keep the
//signatures they had when each was the search itself.
function findInText(str, text, caseSensitive, startingIndex, wholeWordOnly = false){
    return indexOfMatch(getNextMatch(str, text, startingIndex, { caseSensitive: Boolean(caseSensitive), wholeWordOnly: wholeWordOnly }));
}

function getNextIndex(str, text, startingIndex, wholeWordOnly){
    return indexOfMatch(getNextMatch(str, text, startingIndex, { wholeWordOnly: wholeWordOnly }));
}

function indexOfMatch(match){
    return match ? match.index : -1;
}

//A writer's fingers still type a straight quote into the search box long after the editors stopped
//putting one in the manuscript (see models/autocorrect.js), so searching for "don't" or for a bare
//quote has to find the curly ones as well - otherwise the commonest search there is quietly finds
//nothing. Imported manuscripts bring the low and reversed quotes with them, so those count too.
//
//Only in that direction: a curly quote typed or pasted into the box means that exact character,
//which is what still allows hunting down one particular quote.
//
//Length-preserving on purpose, and that is not incidental - every quote folds to exactly one
//character, so the index this produces and the search term's own length still describe the match
//in the untouched text, which is what the caller selects and replaces.
function foldQuotesInText(str, text){
    if(!/['"]/.test(str))
        return text;

    return text.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'");
}

//The search term comes straight from the user, so it must be escaped before going into a
//RegExp or characters like ( and * will either throw or match the wrong thing. \b also only
//marks a boundary between a word and a non-word character, so a term that starts or ends with
//punctuation (--, 'tis) would never match; those sides need a "not preceded/followed by a word
//character" check instead.
function getWholeWordPattern(str){
    var escaped = escapeRegExp(str);
    var openingBoundary = /^\w/.test(str) ? '\\b' : '(?<!\\w)';
    var closingBoundary = /\w$/.test(str) ? '\\b' : '(?!\\w)';

    return openingBoundary + escaped + closingBoundary;
}

function escapeRegExp(string){
    const specialCharacters = /[.*+?^${}()|[\]\\]/g;
    return string.replace(specialCharacters, '\\$&');
}

//Whether the whole of text is one match, which is what the Replace button has to know before it
//touches the selection: the editor stays interactive while the popup is open, so the writer can
//select something else between Find and Replace, and Replace must not clobber whatever that is.
//
//Answered by running the search itself over the selected text and asking whether the match covers
//all of it, rather than by anchoring a second pattern - which keeps the flags, the quote folding
//and the Whole Word wrapping identical to the search that found it in the first place. Returns the
//match, captures and all, so the replacement can be expanded from it.
function matchEntireText(str, text, options){
    if(!str)
        return null;

    var search = compileSearch(str, options);

    if(search.error)
        return null;

    var match = search.findFrom(text, 0);

    return match && match.index == 0 && match.length == text.length ? match : null;
}

//$1 to $9, $& for the whole match and $$ for a literal dollar, expanded from the match - the same
//shorthand every other find/replace box uses. Only in regex mode: outside it a '$' a writer typed
//is a dollar sign, which is the commoner thing to want to replace in prose.
const REPLACEMENT_TOKEN = /\$(\$|&|[1-9])/g;

function expandReplacement(match, newStr, options){
    if(!searchOptions(options).useRegex || !newStr || newStr.indexOf('$') < 0)
        return newStr;

    var captures = match && match.captures ? match.captures : [];

    return newStr.replace(REPLACEMENT_TOKEN, function(token, which){
        if(which == '$')
            return '$';
        if(which == '&')
            return captures[0] != null ? captures[0] : '';

        var group = Number(which);

        //A number past the end of the pattern's groups is left as the writer typed it, the same as
        //JavaScript's own replace does - a stray "$5" is easier to spot in the text than a gap.
        if(group >= captures.length)
            return token;

        //A group that took no part in the match - the other side of an alternation - counts as
        //empty rather than as the word "undefined".
        return captures[group] != null ? captures[group] : '';
    });
}

function replace(editorQuill, newStr, match, options){
    var selectedRange = editorQuill.getSelection(true);
    if(selectedRange.length > 0){
        var replacement = expandReplacement(match, newStr, options);
        editorQuill.deleteText(selectedRange.index, selectedRange.length, 'user');
        editorQuill.insertText(selectedRange.index, replacement, 'user');
    }
}

//Async because a chapter that is not already in memory has to be read off disk, which now goes
//through the platform facade. replaceAllInDelta below stays pure and synchronous - it is the part
//convert-tabs.js and the tests reuse.
async function replaceAllInAllChapters(project, oldStr, newStr, options){
  var numReplaced = 0;
  var everyChapter = project.chapters.concat(project.reference);

  for(let i = 0; i < everyChapter.length; i++){
    numReplaced += await replaceAllInChapter(oldStr, newStr, everyChapter[i], options);
  }

  if(numReplaced > 0)
    project.hasUnsavedChanges = true;

  return numReplaced;
}

async function replaceAllInChapter(oldStr, newStr, chap, options){
  var result = replaceAllInDelta(oldStr, newStr, chap.contents ? chap.contents : await chap.getFile(), options);
  if(result.changed > 0){
    chap.contents = result.delta;
    chap.hasUnsavedChanges = true;
  }
  return result.changed;
}

function replaceAllInDelta(oldStr, newStr, delt, options){
    //An empty search term matches at every position without ever advancing, so the loop below would
    //never end. The Find button guards against this already, Replace All did not.
    if(!oldStr)
        return { changed: 0, delta: delt };

    //Compiled before anything is edited, and once for the whole pass. Replace All runs this over
    //every chapter in the project, so a pattern that will not compile has to be refused here rather
    //than part-way through, with some chapters rewritten and some not.
    var search = compileSearch(oldStr, options);

    if(search.error)
        return { changed: 0, delta: delt, error: search.error };

    var tempQuill = getTempQuill();
    var counter = 0;

    tempQuill.setContents(delt);
    //getIndexableText rather than getText for the same reason find() above uses it: Quill drops
    //embeds from getText() entirely, so a chapter with a footnote marker in it reports every
    //index after that marker one short of the index deleteText/insertText below actually act on.
    //Replace All would then cut from the wrong place - "the cat sat" losing " ca" instead of
    //"cat" - and could delete the marker itself.
    var text = getIndexableText(tempQuill);

    var startingIndex = 0;
    var match = search.findFrom(text, startingIndex);

    while(match){
        //Expanded per match rather than once up front: $1 stands for a different word each time.
        var replacement = expandReplacement(match, newStr, options);

        //match.length, not oldStr.length - see the same point in findWith() above.
        tempQuill.deleteText(match.index, match.length);
        tempQuill.insertText(match.index, replacement);

        var updated = getIndexableText(tempQuill);
        //Resuming past the text just inserted rather than at the match, so a replacement that
        //contains the search term is not found again and again.
        var nextIndex = match.index + replacement.length;

        //Text unchanged and the index standing still together mean the edit did not take. That can
        //only happen one way: Quill keeps a newline at the end of every document and will not delete
        //it, so a pattern that matches it - "\s+$" with an empty replacement, say - would otherwise
        //meet the same newline forever. Nothing was replaced, so step past it and do not count it.
        //An identity replacement ("cat" for "cat") leaves the text alone too, but always advances
        //the index, so it still counts.
        if(updated === text && nextIndex <= startingIndex)
            startingIndex = match.index + 1;
        else {
            counter++;
            startingIndex = nextIndex;
            text = updated;
        }

        match = search.findFrom(text, startingIndex);
    }

    delt = tempQuill.getContents();

    return {
      changed: counter,
      delta: delt
    };
}

module.exports = {
    compileSearch,
    expandReplacement,
    find,
    findInText,
    getNextIndex,
    getNextMatch,
    matchEntireText,
    replace,
    replaceAllInAllChapters,
    replaceAllInChapter,
    replaceAllInDelta
}