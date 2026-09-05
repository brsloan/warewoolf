//A project keeps its chapters in three separate lists, but the sidebar shows them end to end as
//one numbered run: chapters, then reference, then trash. That combined index is the app's external
//currency - it is what a sidebar <li> carries in its data-chap-index attribute and what
//project.activeChapterIndex stores - but it is a poor thing to compute with, because every
//question about one list ("is this the last reference doc?") turns into arithmetic against the
//lengths of the other two.
//
//A locator names a chapter the direct way instead: which list it is in, and where in that list it
//sits - {list: 'reference', index: 0}. toLocator()/toCombinedIndex() convert between the two at
//the boundaries where a combined index is genuinely required, and everything in between works in
//locators.

const LIST_ORDER = ['chapters', 'reference', 'trash'];

function listOf(project, listName){
  return project[listName] || [];
}

function totalLength(project){
  return LIST_ORDER.reduce(function(total, listName){
    return total + listOf(project, listName).length;
  }, 0);
}

//Returns null for an index that names no chapter - past the end, negative, or any index at all on
//a project whose three lists are empty. Callers are expected to handle that case rather than
//receive a locator pointing at nothing.
function toLocator(project, combinedIndex){
  var ind = parseInt(combinedIndex);

  if(isNaN(ind) || ind < 0)
    return null;

  var offset = ind;
  for(let i = 0; i < LIST_ORDER.length; i++){
    var list = listOf(project, LIST_ORDER[i]);
    if(offset < list.length)
      return { list: LIST_ORDER[i], index: offset };
    offset -= list.length;
  }

  return null;
}

//As toLocator(), but an index past the end lands on the last chapter in the project rather than
//returning null - the "stay on the last chapter" behaviour the sidebar and the next/previous
//shortcuts want. Still null when there is nothing to land on.
function clampedLocator(project, combinedIndex){
  var total = totalLength(project);
  if(total == 0)
    return null;

  var ind = parseInt(combinedIndex);
  if(isNaN(ind) || ind < 0)
    ind = 0;
  else if(ind > total - 1)
    ind = total - 1;

  return toLocator(project, ind);
}

function toCombinedIndex(project, locator){
  if(!locator || LIST_ORDER.indexOf(locator.list) == -1)
    return -1;

  var list = listOf(project, locator.list);
  if(locator.index < 0 || locator.index >= list.length)
    return -1;

  var combined = locator.index;
  for(let i = 0; i < LIST_ORDER.indexOf(locator.list); i++){
    combined += listOf(project, LIST_ORDER[i]).length;
  }

  return combined;
}

function resolve(project, locator){
  if(!locator || LIST_ORDER.indexOf(locator.list) == -1)
    return undefined;

  return listOf(project, locator.list)[locator.index];
}

function chapterAt(project, combinedIndex){
  return resolve(project, toLocator(project, combinedIndex));
}

function activeLocator(project){
  return toLocator(project, project.activeChapterIndex);
}

function isFirstInList(project, locator){
  return Boolean(locator) && locator.index == 0;
}

function isLastInList(project, locator){
  if(!locator)
    return false;

  return locator.index == listOf(project, locator.list).length - 1;
}

function isLastOfAll(project, locator){
  return toCombinedIndex(project, locator) == totalLength(project) - 1;
}

//Splices the chapter out of its list and hands it back, so a caller that is moving it somewhere
//else does not have to repeat the splice arithmetic.
function remove(project, locator){
  if(!resolve(project, locator))
    return undefined;

  return listOf(project, locator.list).splice(locator.index, 1)[0];
}

//Inserts at the given position, clamped to the end of that list, and returns where it landed.
function insertAt(project, listName, index, chap){
  var list = listOf(project, listName);
  var target = Math.max(0, Math.min(index, list.length));

  list.splice(target, 0, chap);

  return { list: listName, index: target };
}

function append(project, listName, chap){
  return insertAt(project, listName, listOf(project, listName).length, chap);
}

//Where the selection should land once the chapter at `removedFrom` has been taken out of its list:
//whatever slid into its place, or the new last item if it was at the end, falling back to the last
//chapter once that list is empty. Null when the project has nothing left to select.
//Call this after the removal, with the locator the chapter used to occupy.
function selectionAfterRemoval(project, removedFrom){
  if(totalLength(project) == 0)
    return null;

  if(removedFrom){
    var list = listOf(project, removedFrom.list);
    if(list.length > 0)
      return { list: removedFrom.list, index: Math.min(removedFrom.index, list.length - 1) };
  }

  var chapters = listOf(project, 'chapters');
  if(chapters.length > 0)
    return { list: 'chapters', index: chapters.length - 1 };

  return toLocator(project, 0);
}

//Reordering runs within a list, except at the chapters/reference seam, which an item may cross in
//either direction: the first reference doc moves up to become the last chapter, and the last
//chapter moves down to become the first reference doc. The reference/trash seam is closed - a
//chapter only reaches the trash by being deleted, and only leaves it by being restored.
//Returns where the chapter ended up, or null if it could not move.
function moveUp(project, locator){
  if(!resolve(project, locator))
    return null;

  if(!isFirstInList(project, locator))
    return insertAt(project, locator.list, locator.index - 1, remove(project, locator));

  if(locator.list == 'reference')
    return append(project, 'chapters', remove(project, locator));

  return null;
}

function moveDown(project, locator){
  if(!resolve(project, locator))
    return null;

  if(!isLastInList(project, locator))
    return insertAt(project, locator.list, locator.index + 1, remove(project, locator));

  if(locator.list == 'chapters')
    return insertAt(project, 'reference', 0, remove(project, locator));

  return null;
}

module.exports = {
  LIST_ORDER,
  listOf,
  totalLength,
  toLocator,
  clampedLocator,
  toCombinedIndex,
  resolve,
  chapterAt,
  activeLocator,
  isFirstInList,
  isLastInList,
  isLastOfAll,
  remove,
  insertAt,
  append,
  selectionAfterRemoval,
  moveUp,
  moveDown
};
