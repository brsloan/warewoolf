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

module.exports = dom;
