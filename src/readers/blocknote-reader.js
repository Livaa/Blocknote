import * as Algosdk     from "algosdk";
import * as Crypto      from "../crypto/crypto.js";
import * as Chain       from "../chain/chain.js";
import * as Search      from "../search/search.js";
import {getCompression} from "../compressions/compressions.js"

const indexer   = new Algosdk.Indexer(process.env.INDEXER_TOKEN, process.env.INDEXER_URL, process.env.INDEXER_PORT);


export class BlocknoteReader {
    
    
    constructor(payload_transaction_id, options = {}) {

        /**
        * Transaction ID of the payload.
        * This txn contains metadata in its note (title, type, compression, encryption params).
        * 
        * @type {string}
        */
        this.payload_transaction_id = payload_transaction_id; 
        
        this.aes_key = options?.aes_key;
        this.password = options?.password;
        this.revision = options?.revision;
        this.return_raw = options?.return_raw;
  
    }
    
    
    /**
    * Reconstructs the payload and retrieves the content:
    * 
    *  1. Load payload metadata.
    *  2. Optionally fetch a specific revision.
    *  3. Collect all slice transactions.
    *  4. Consolidate slices into one Uint8Array.
    *  5. Optionally decrypt the content.
    *  6. Optionally decompress the content.
    *
    * @returns {Promise<{payload:Object,content:Uint8Array}>}
    */    
    async read(){        
                
        const get_payload           = await this.getPayload(); 
        const payload               = get_payload.payload;
        const get_all_transactions  = await Search.getAllReceivedTransactions(get_payload.sender, get_payload.receiver, get_payload.transaction_id);                
        const transactions          = [];

        // Retrieve the right amount of txns as defined by payload.txns
        for(let x = 0; x < payload.txns; x++){

            transactions.push(get_all_transactions[x]);
        }

        // Rebuild the compressed/encrypted content into one uint8array
        let content = this.consolidate(transactions);

        // Decrypt the content if an encryption was applied and decryption is asked.
        // Also decrypt the title if it was encrypted.
        if(payload?.iv && !this.return_raw){

            content = await this.decrypt(content, payload, this.aes_key, this.password);                                           
        }

        if( !this.return_raw ){
            
            const compression   = await getCompression(payload.compression ?? "none");    
            content             = await compression.uncompress(content);
        }

        return {payload:payload, content:content};
    }
            
            
    /**
     * Retrieves the requested revision ID.
     * If no specific revision is provided, returns the most recent revision.
     * 
     * @param {string} sender - Sender address of the payload.
     * @param {string} receiver - Receiver address of the payload.
     * @param {number|null} revision - Requested revision number (1-based).
     * @returns {Promise<string|null>} - Transaction ID of the revision or null if none.
     * @throws {Error} If the requested revision number does not exist.
     */
    async getRevisionPayloadTransactionId(sender, receiver, revision){
        
        let revision_payload = null;
        
        if( !revision ){

            const last_transaction  = await Search.getLastReceivedTransaction(sender, receiver, this.payload_transaction_id);       
            revision_payload        = last_transaction ? Search.getRevisionPayloadTransactionId(last_transaction) : null;                
        }    
        else if(revision !== null){
                        
            const revisions_payloads    = await Search.getRevisionsPayloads(this.payload_transaction_id);  
            revision_payload            = revisions_payloads[revision - 1];
            
            if( !revision_payload ){

                throw Error("Invalid revision number, this revision doesn't exist");
            }
        } 
        
        return revision_payload;
    }
    
    
    async getRevisions(){
        
        const revisions = await Search.getRevisionsPayloads(this.payload_transaction_id);
        
        return revisions.length;
    }
    
    
    /**
     * Decrypts the content if encryption metadata is present.
     * Supports:
     *  - Direct AES key
     *  - Password-based PBKDF2 key derivation with salt
     * 
     * @param {Uint8Array|Buffer} content - The encrypted content.
     * @param {Object} payload - Metadata containing encryption info (iv, tag, salt).
     * @param {string} aes_key - The aes_key to decrypt the content
     * @param {string} password - The password to decrypt the content
     * @returns {Promise<Uint8Array>} - Decrypted content.
     */
    async decrypt(content, payload, aes_key, password){

        let decrypted_content           = null;
        const encrypted_with_password   = payload?.salt;
  
        if(encrypted_with_password){

            if( !password ){

                throw Error("Content is encrypted: params.password is missing");
            }
           
            decrypted_content = await Crypto.decryptFromDerivedKey(

                Buffer.from(payload.iv, "base64"), 
                Buffer.from(payload.tag, "base64"), 
                Buffer.from(payload.salt, "base64"), 
                Buffer.from(content),
                password
            );
        }
        else{

            if( !aes_key ){

                throw Error("Content is encrypted: params.aes_key is missing");
            }

            decrypted_content = await Crypto.decrypt(

                Buffer.from(payload.iv, "base64"), 
                Buffer.from(payload.tag, "base64"),  
                Buffer.from(content),
                aes_key
            );
        }

        return decrypted_content;
    }    
    

    /**
    * Decrypts the title from the payload if it is encrypted.
    *
    * @param {Object} payload - The full payload object containing the title and optional encryption details.
    * @param {string} aes_key - The AES key to use for decryption.
    * @param {string} password - The password used for key derivation (if applicable).
    * @returns {Promise<string>} - The decrypted title, or the original title if not encrypted.
    */
    async decryptTitle(payload, aes_key, password){
                
        let title = payload.title;

        if(typeof title === "object"){

            const data = Buffer.from(payload.title.data, "base64");
            
            if(payload?.salt){

                payload.title.salt = payload.salt;
            }

            const decrypt_title = await this.decrypt(data, payload.title, aes_key, password);          
            title               = decrypt_title.toString();
        }

        return title;
    }
    
        
    /**
    * Consolidates individual transaction slices into one contiguous Uint8Array.
    * 
    * @param {Array} transactions - Array of Algorand transactions containing slice data.
    * @returns {Uint8Array} - Reconstructed content.
    */
    consolidate(transactions) {

        const compressed_chunks = this.getChunksOrderedByCounter(transactions);     

        // Rebuild the compressed content into a Uint8Array.
        // Uint8Array are not dynamic so the size must be set in advance.
        const compressed_content_length = compressed_chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const compressed_content        = new Uint8Array(compressed_content_length);
        let offset                      = 0;

        for(const chunk of compressed_chunks){

            compressed_content.set(chunk, offset);

            offset += chunk.length;
        }

        return compressed_content;       
    }


    /**
     * Orders the slice data according to the counter stored in the first 4 bytes of each note.
     * 
     * @param {Array} transactions - Array of transaction objects with `note` fields.
     * @returns {Uint8Array[]} - Ordered array of chunk data.
     */
    getChunksOrderedByCounter(transactions){

        const compressed_chunks = [];

        for (const transaction of transactions) {

            const note                  = transaction.note;                                          
            const uint_array_counter    = note.slice(0, 4);   
            const view                  = new DataView(uint_array_counter.buffer);
            const counter               = view.getUint32(0, true); // true = little-endian         
            compressed_chunks[counter]  = note.slice(4);          
        }

        return compressed_chunks;
    }
    
    
    /**
     * @returns {Promise<{ payload: Object,receiver: string,sender: string,transaction_id: string}>}
     */
    async getPayload(){
           
        let {payload, receiver, sender} = await this.fetchPayloadTransaction(this.payload_transaction_id);     
        const payload_transaction_id    = await this.getRevisionPayloadTransactionId(sender, receiver, this.revision) ?? this.payload_transaction_id;
        
        if(payload_transaction_id){
            
            ({payload, receiver, sender}  = await this.fetchPayloadTransaction(payload_transaction_id)); 
        }

        if(this.aes_key || this.password){
            
            payload.title = await this.decryptTitle(payload, this.aes_key, this.password);
        }
                
        return {payload, receiver, sender, transaction_id: payload_transaction_id};
    };
        
        
     /**
     * Retrieve the payload from the given payload transaction id.
     * 
     * @param {string} payload_id - Transaction ID.
     * @returns {Promise<{payload:Object, receiver:string, sender:string}>}
     */
    async fetchPayloadTransaction(payload_transaction_id) {
        
        const txn = await Chain.getTransactionById(payload_transaction_id);
        
        return {  
            
            payload:    JSON.parse(Buffer.from(txn.note, "base64")),
            receiver:   txn.paymentTransaction.receiver,
            sender:     txn.sender
        };
    }
}  