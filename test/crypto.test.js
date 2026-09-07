const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const {
  seal, open, deriveKey, generateKey, generateSalt, decryptLegacy, isLegacyBlob
} = require('../src/components/controllers/crypto');

//Small scrypt parameters so the tests stay quick; the real ones live in crypto.js.
const testKdf = { N: 1024, r: 8, p: 1 };

test('a sealed string comes back under the same key', function(){
  const key = generateKey();
  assert.strictEqual(open(seal('hunter2', key), key), 'hunter2');
  assert.strictEqual(open(seal('', key), key), '');
  assert.strictEqual(open(seal('pässwörd — with unicode', key), key), 'pässwörd — with unicode');
});

test('the same plaintext seals differently every time, since the iv is random', function(){
  const key = generateKey();
  assert.notStrictEqual(seal('hunter2', key).content, seal('hunter2', key).content);
});

test('the wrong key yields null rather than garbage', function(){
  assert.strictEqual(open(seal('hunter2', generateKey()), generateKey()), null);
});

//The old aes-256-ctr scheme was unauthenticated, so a flipped bit in the ciphertext came back as a
//silently wrong password. GCM's tag is what makes that detectable.
test('tampering with a sealed blob is detected', function(){
  const key = generateKey();

  const flippedContent = seal('hunter2', key);
  flippedContent.content = flipFirstByte(flippedContent.content);
  assert.strictEqual(open(flippedContent, key), null);

  const flippedTag = seal('hunter2', key);
  flippedTag.tag = flipFirstByte(flippedTag.tag);
  assert.strictEqual(open(flippedTag, key), null);

  const flippedIv = seal('hunter2', key);
  flippedIv.iv = flipFirstByte(flippedIv.iv);
  assert.strictEqual(open(flippedIv, key), null);
});

test('a malformed blob yields null rather than throwing', function(){
  const key = generateKey();
  assert.strictEqual(open(null, key), null);
  assert.strictEqual(open({}, key), null);
  assert.strictEqual(open({ iv: 'zz', tag: 'zz', content: 'zz' }, key), null);
});

test('the same passphrase and salt derive the same key, a different salt does not', function(){
  const salt = generateSalt();
  const key = deriveKey('correct horse battery staple', salt, testKdf);

  assert.strictEqual(key.length, 32);
  assert.ok(deriveKey('correct horse battery staple', salt, testKdf).equals(key));
  assert.ok(!deriveKey('correct horse battery staple', generateSalt(), testKdf).equals(key));
  assert.ok(!deriveKey('a different passphrase', salt, testKdf).equals(key));
});

//A frozen blob, not a generated one. encryptTheOldWay() below is a second, independent
//reimplementation of the pre-2.2.2 format, and the test above it is only as good as that
//reimplementation is - change the algorithm, the key or the IV length in crypto.js and in the
//helper together and the test stays green while every real user's saved password stops decrypting.
//This one cannot drift, because nothing in the repo generates it: it is 'old-saved-password'
//encrypted with aes-256-ctr under the key that shipped up to 2.2.1, written down once.
//
//It matters because of how this fails. A writer whose stored password stops migrating gets no
//error, no log line and no artifact to inspect - the password is simply gone the next time they
//open the email dialog, possibly months later, and nothing anywhere says it was ever there.
const FROZEN_LEGACY_BLOB = {
  iv: '9f1c4a77e5b30d2168ac5e91b3470ddf',
  content: 'ffcdaeb4e695b8e2c9b13c01aa44988a9d74'
};

test('a password saved by version 2.2.1 or earlier still decrypts', function(){
  const legacyBlob = encryptTheOldWay('old-saved-password');

  assert.ok(isLegacyBlob(legacyBlob));
  assert.strictEqual(decryptLegacy(legacyBlob), 'old-saved-password');
});

test('a blob written down from a real 2.2.1 install still decrypts', function(){
  assert.ok(isLegacyBlob(FROZEN_LEGACY_BLOB));
  assert.strictEqual(decryptLegacy(FROZEN_LEGACY_BLOB), 'old-saved-password');
});

//The old scheme was unauthenticated, so decryptLegacy cannot tell a wrong key from a right one -
//it returns plausible garbage rather than null. That is exactly why the constant above is
//asserted against its plaintext and not merely against "did not throw": a changed LEGACY_KEY
//still decrypts, still returns a string, and still looks like success from the outside.
test('the legacy key is the one that shipped, not merely some key that decrypts', function(){
  const recovered = decryptLegacy(FROZEN_LEGACY_BLOB);

  assert.strictEqual(typeof recovered, 'string');
  assert.strictEqual(recovered, 'old-saved-password');
  assert.strictEqual(Buffer.from(recovered, 'utf8').length,
    Buffer.from(FROZEN_LEGACY_BLOB.content, 'hex').length);
});

test('a current blob is not mistaken for a legacy one', function(){
  const blob = seal('hunter2', generateKey());

  assert.strictEqual(isLegacyBlob(blob), false);
  assert.strictEqual(decryptLegacy(blob), null);
  assert.strictEqual(isLegacyBlob(null), false);
  assert.strictEqual(decryptLegacy(null), null);
});

//decryptLegacy has its own isLegacyBlob guard, and dropping it left every test above green -
//a current blob's IV is 12 bytes and aes-256-ctr wants 16, so createDecipheriv threw and the
//try/catch turned that into the same null the guard would have returned. The guard was being
//tested by accident, through an IV length that has nothing to do with what it is for. This blob
//is versioned like a current one but carries a legacy-length IV, so nothing but the guard itself
//can refuse it - and it has to be refused, because "decrypt this with the key that shipped in the
//source" must be reachable only for blobs that were actually written with it.
test('a versioned blob is refused on its version, not on the shape of its iv', function(){
  const versionedWithLegacyLengthIv = Object.assign(encryptTheOldWay('hunter2'), { v: 2 });

  assert.strictEqual(versionedWithLegacyLengthIv.iv.length, 32);
  assert.strictEqual(isLegacyBlob(versionedWithLegacyLengthIv), false);
  assert.strictEqual(decryptLegacy(versionedWithLegacyLengthIv), null);
});

//Reproduces exactly what the pre-2.2.2 encrypt() wrote, hardcoded key and all, so the migration
//path is tested against the real old format rather than against itself.
function encryptTheOldWay(text){
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', 'o2V6h1BYiyMWiSFNNoKf6rp7maAr6Lb7', iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

  return { iv: iv.toString('hex'), content: encrypted.toString('hex') };
}

function flipFirstByte(hex){
  const flipped = (parseInt(hex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0');

  return flipped + hex.slice(2);
}
