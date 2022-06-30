function getCrypto() {
  const crypto = require('crypto');
  const algorithm = 'aes-256-ctr';
  const sKey = 'o2V6h1BYiyMWiSFNNoKf6rp7maAr6Lb7';

  return {
    encrypt: encrypt,
    decrypt: decrypt
  };

  function encrypt(text){
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, sKey, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

    return {
        iv: iv.toString('hex'),
        content: encrypted.toString('hex')
    };
  }

  function decrypt(hash){
    const decipher = crypto.createDecipheriv(algorithm, sKey, Buffer.from(hash.iv, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(hash.content, 'hex')), decipher.final()]);

    return decrypted.toString();
  }
}
