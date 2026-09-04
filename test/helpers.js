//Shared helpers for the converter tests.

//A delta that has been through convertDeltaToMDF -> parseMDF comes back semantically equal to the
//original but not literally identical: parseMDF emits zero-length inserts where a paragraph ends,
//and boolean run attributes arrive as the strings Quill also accepts ("true"). Normalising both
//sides lets a round-trip test assert on the parts that carry meaning without pinning down those
//two artifacts. Anything else that differs is a real difference and will fail the comparison.
function normalizeDelta(delta){
  var ops = (delta.ops || [])
    .filter(function(op){ return op.insert !== ''; })
    .map(function(op){
      var normalized = { insert: op.insert };
      if(op.attributes)
        normalized.attributes = normalizeAttributes(op.attributes);
      return normalized;
    });

  return { ops: ops };
}

function normalizeAttributes(attributes){
  var normalized = {};
  Object.keys(attributes).sort().forEach(function(key){
    normalized[key] = attributes[key] === 'true' ? true : attributes[key];
  });
  return normalized;
}

module.exports = { normalizeDelta };
