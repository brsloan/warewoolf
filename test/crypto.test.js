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

test('a password saved by version 2.2.1 or earlier still decrypts', function(){
  const legacyBlob = encryptTheOldWay('old-saved-password');

  assert.ok(isLegacyBlob(legacyBlob));
  assert.strictEqual(decryptLegacy(legacyBlob), 'old-saved-password');
});

test('a current blob is not mistaken for a legacy one', function(){
  const blob = seal('hunter2', generateKey());

  assert.strictEqual(isLegacyBlob(blob), false);
  assert.strictEqual(decryptLegacy(blob), null);
  assert.strictEqual(isLegacyBlob(null), false);
  assert.strictEqual(decryptLegacy(null), null);
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
