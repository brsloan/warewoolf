const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const SEAL_VERSION = 2;
const KEY_BYTES = 32;
const IV_BYTES = 12;

//The key that shipped inside every copy of WareWoolf up to 2.2.1. It is no secret — it sat in the
//packaged source next to the file it encrypted — so nothing writes with it any more. It is kept
//only so a password saved by an older version can be read once and re-sealed properly.
const LEGACY_ALGORITHM = 'aes-256-ctr';
const LEGACY_KEY = 'o2V6h1BYiyMWiSFNNoKf6rp7maAr6Lb7';

//scrypt cost for passphrase-derived keys. 2^16 keeps the derivation near a second on a Raspberry
//Pi while staying expensive to attack. The parameters are stored beside the ciphertext, so they
//can be raised later without stranding anything already saved.
const KDF_PARAMS = { N: 65536, r: 8, p: 1 };

//scrypt needs roughly 128 * N * r bytes, and node's default cap of 32MB is below what N above asks
//for, so the limit has to be raised explicitly.
function kdfMemoryLimit(params){
  return 256 * params.N * params.r;
}

function generateKey(){
  return crypto.randomBytes(KEY_BYTES);
}

function generateSalt(){
  return crypto.randomBytes(16);
}

function deriveKey(passphrase, salt, params){
  const opts = params || KDF_PARAMS;
  return crypto.scryptSync(passphrase, salt, KEY_BYTES, {
    N: opts.N,
    r: opts.r,
    p: opts.p,
    maxmem: kdfMemoryLimit(opts)
  });
}

//Encrypts with a random IV and an authentication tag, so a blob that has been tampered with or
//decrypted under the wrong key fails loudly instead of returning plausible garbage.
function seal(plaintext, key){
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    v: SEAL_VERSION,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    content: encrypted.toString('hex')
  };
}

//Returns null rather than throwing when the key is wrong: a mistyped passphrase is an ordinary
//outcome here, not an error worth logging.
function open(blob, key){
  try{
    if(blob == null || blob.iv == null || blob.tag == null || blob.content == null)
      return null;

    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(blob.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(blob.content, 'hex')), decipher.final()]);

    return decrypted.toString('utf8');
  }
  catch(err){
    return null;
  }
}

function isLegacyBlob(blob){
  return blob != null && blob.iv != null && blob.content != null && blob.v == null;
}

function decryptLegacy(blob){
  try{
    if(!isLegacyBlob(blob))
      return null;

    const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, LEGACY_KEY, Buffer.from(blob.iv, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(blob.content, 'hex')), decipher.final()]);

    return decrypted.toString('utf8');
  }
  catch(err){
    return null;
  }
}

module.exports = {
  seal,
  open,
  deriveKey,
  generateKey,
  generateSalt,
  decryptLegacy,
  isLegacyBlob,
  KDF_PARAMS,
  SEAL_VERSION
};
