import * as Crypto from 'crypto';

const PRIVATE_KEY_AES   = process.env.PRIVATE_KEY_AES;
//const derived_keys      = deriveKeys();
   
   
/**
* Encrypts data using aes-256-gcm
* 
* @param {string} data - Data to encrypt.
* @param {string} private_key - Hex string of AES key. Defaults to PRIVATE_KEY_AES.
* @returns {{iv: Buffer, data: Buffer, tag: Buffer}} Encrypted content including IV and auth tag.
*/
export function encrypt(data = '', private_key) {

    const iv        = Crypto.randomBytes(12); // Recommended 12 bytes for GCM
    const hex_key   = Buffer.from(private_key ?? PRIVATE_KEY_AES, "hex");
    const cipher    = Crypto.createCipheriv("aes-256-gcm", hex_key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag       = cipher.getAuthTag();

    return {

        iv:     iv,
        data:   encrypted,
        tag:    tag
    };
}


/**
 * Decrypt data encrypted with AES-256-GCM.
 *
 * @param {Buffer} iv - Initialization vector used for encryption.
 * @param {Buffer} tag - Authentication tag from encryption.
 * @param {Buffer} data - Encrypted data.
 * @param {string} private_key - Hex string of AES key. Defaults to PRIVATE_KEY_AES.
 * @returns {Buffer} Decrypted data.
 */
export function decrypt(iv, tag, data, private_key) {
  
    const hex_key   = Buffer.from(private_key ?? PRIVATE_KEY_AES, "hex");
    const decipher  = Crypto.createDecipheriv("aes-256-gcm", hex_key, iv);

    decipher.setAuthTag(tag);

    return Buffer.concat([

        decipher.update(data),
        decipher.final()
    ]);
}



/**
 * Derive a cryptographic key from a password using PBKDF2.
 *
 * @param {string|Buffer} password - Input password.
 * @param {Buffer|null} [salt] - Optional salt. Randomly generated if not provided.
 * @returns {Promise<{salt: Buffer, derived_key: Buffer}>} Derived key and salt.
 */
export function deriveKey(password, salt = null){
    
    return new Promise((resolve, reject) => {
      
        if( !salt ){
            
            salt = Crypto.randomBytes(16);        
        }

        Crypto.pbkdf2(password, salt, 1e5, 32, "sha256", (err, derived_key) => {
            
            if (err){
                
                reject(err);
            }
            else{
            
                resolve({salt, derived_key}); 
            }
            
        });
    });
}


/**
 * Decrypt data using a derived key from password and salt.
 *
 * @async
 * @param {Buffer} iv - Initialization vector used for encryption.
 * @param {Buffer} auth_tag - Authentication tag.
 * @param {Buffer} salt - Salt used in key derivation.
 * @param {Buffer} data - Encrypted data.
 * @param {string|Buffer} password - Password to derive key.
 * @returns {Promise<Buffer>} Decrypted data.
 */
export async function decryptFromDerivedKey(iv, auth_tag, salt, data, password) {
    
    const derived_key = await deriveKey(password, salt);
    
    return decrypt(iv, auth_tag, data, derived_key.derived_key);
}


/**
 * Encrypt a transaction note.
 * Produces a base64 string containing JSON {iv, data, tag}.
 *
 * @param {string} content - Note content to encrypt.
 * @returns {string} Base64-encoded encrypted note.
 */
export function encryptTransactionNote(content = ""){
    
    const {iv, data, tag}   = encrypt(content);
    const payload           = {

        iv:     iv.toString('hex'),
        data:   data.toString('hex'),
        tag:    tag.toString('hex')
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
}


/**
 * Decrypt a transaction note previously encrypted with encryptTransactionNote().
 *
 * @param {string} encrypted_data - Base64-encoded encrypted note.
 * @returns {Buffer} Decrypted note content.
 */
export function decryptTransactionNote(encrypted_data){
    
    const base64_decode     = Buffer.from(encrypted_data).toString();
    const json              = Buffer.from(base64_decode, 'base64').toString('utf8');        
    const { iv, data, tag } = JSON.parse(json);        
    
    return decrypt(
            
        Buffer.from(iv, "hex"), 
        Buffer.from(tag, "hex"), 
        Buffer.from(data, "hex")
    );  
}


/**
 * Derive encryption and IV keys from a shared AES key.
 *
 * @private
 * @param {Buffer} aes_private_key - Shared AES key.
 * @returns {{key_enc: Buffer, key_iv: Buffer}} Derived encryption and IV keys.
 */
function deriveKeys(aes_private_key) {
    
    // Used by StreamnoteManager to encrypt each transaction.
    // Because data is processed as a stream (chunk by chunk), we can't use AES-256-GCM:
    //   - GCM requires generating and storing a unique IV and authTag for each chunk.
    //   - This would introduce significant overhead in a streamed context.
    //
    // Instead, we use AES-256-CTR (a stream cipher mode) with deterministic IVs.
    // Each IV is securely derived using HMAC-SHA256 from the shared PRIVATE_KEY_AES,
    // avoiding the need to store per-chunk IVs.
    //
    // This design ensures:
    //   - Unique IVs per chunk (preventing keystream reuse)
    //   - Deterministic encryption (IVs are derived from the chunk index)
    //   - No need to store or transmit additional metadata per chunk (like auth tags or IVs)
    
    const key_enc = Crypto.createHmac('sha256', aes_private_key).update('encryption').digest();
    const key_iv  = Crypto.createHmac('sha256', aes_private_key).update('iv-derivation').digest();

    return {key_enc, key_iv};
}


/**
 * Derive a deterministic IV from key_iv, chunk index, and seed.
 *
 * @private
 * @param {Buffer} key_iv - IV derivation key.
 * @param {number} index - Chunk index.
 * @param {Buffer} seed - Seed value.
 * @returns {Buffer} 16-byte IV.
 */
function deriveSeed(key_iv, index, seed) {
    
    const hmac   = Crypto.createHmac('sha256', key_iv);
    const buffer = Buffer.alloc(4);
    
    buffer.writeUInt32BE(index);
    hmac.update(seed);
    hmac.update(buffer);

    return hmac.digest().subarray(0, 16);
}


/**
 * Encrypt a chunk using AES-256-CTR with deterministic IV derivation.
 *
 * @param {Buffer} aes_private_key - Shared AES key.
 * @param {Buffer} chunk_buffer - Chunk of data to encrypt.
 * @param {number} index - Chunk index.
 * @param {Buffer} seed - Seed value.
 * @returns {Buffer} Encrypted chunk.
 */
export function encryptWithDerivation(aes_private_key, chunk_buffer, index, seed){
    
    const {key_enc, key_iv} = deriveKeys(aes_private_key);
    const iv                = deriveSeed(key_iv, index, seed);
    const cipher            = Crypto.createCipheriv('aes-256-ctr', key_enc, iv);

    return Buffer.concat([
        
        cipher.update(chunk_buffer), 
        cipher.final()
    ]);
}


/**
 * Decrypt a chunk encrypted with encryptWithDerivation().
 *
 * @param {Buffer} aes_private_key - Shared AES key.
 * @param {Buffer} encrypted_buffer - Encrypted chunk.
 * @param {number} index - Chunk index.
 * @param {Buffer} seed - Seed value.
 * @returns {Buffer} Decrypted chunk.
 */
export function decryptWithDerivation(aes_private_key, encrypted_buffer, index, seed) {
    
    const {key_enc, key_iv} = deriveKeys(aes_private_key);
    const iv                = deriveSeed(key_iv, index, seed);  
    const decipher          = Crypto.createDecipheriv('aes-256-ctr', key_enc, iv);

    return Buffer.concat([
        
        decipher.update(encrypted_buffer), 
        decipher.final()
    ]);
}


/**
 * Generate cryptographically secure random bytes.
 *
 * @param {number} size - Number of bytes to generate.
 * @returns {Buffer} Random bytes.
 */
export function randomBytes(size) {
    
    return Crypto.randomBytes(size);
}


/**
 * Compute SHA256 hash of input data.
 *
 * @param {Buffer|string} data - Input data to hash.
 * @returns {string} Hexadecimal SHA256 hash.
 */
export function sha256(data){
        
    return Crypto.createHash('sha256').update(data).digest('hex');
}