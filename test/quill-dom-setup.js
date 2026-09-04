//Quill touches `document`, `Node`, `MutationObserver`, etc. as soon as it's required, so any test
//that exercises quill-utils.js's getTempQuill() needs a DOM in place first. Require this file
//before requiring anything that pulls in quill-utils.js (directly or via another controller).
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });

Object.getOwnPropertyNames(dom.window).forEach(function(key){
  if(!(key in global)){
    try { global[key] = dom.window[key]; } catch(err) { /* not all window props can be copied */ }
  }
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

//jsdom doesn't implement execCommand, which Quill's clipboard module calls on DOMContentLoaded.
global.document.execCommand = function(){ return false; };

//jsdom has no layout engine, so Range/Element getBoundingClientRect() are unimplemented. Quill's
//setSelection() calls both (via Selection#scrollIntoView) whenever it's driving a Quill instance
//that's actually attached to the document, so give it an all-zero rect rather than a thrown error.
var emptyRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
global.Range.prototype.getBoundingClientRect = function(){ return emptyRect; };
global.Range.prototype.getClientRects = function(){ return []; };
global.Element.prototype.getBoundingClientRect = function(){ return emptyRect; };
global.Element.prototype.getClientRects = function(){ return []; };

module.exports = dom;
