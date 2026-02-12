import {getCompression} from "../compressions/compressions.js"
import * as Chain       from  "../chain/chain.js";
import {Blocknote}      from "./blocknote.js";
import * as Crypto      from "../crypto/crypto.js";


/**
 * Allows sending data in a compressed stream
 * over multiple blockchain transactions.
 * Extends Blocknote.
 */

export class Streamnote extends Blocknote {


    constructor(sender_mnemonic, options = {}) {
       
        super(sender_mnemonic, options);
        
        /**
        * Extra padding size in bytes.
        * @type {number}
        */
        this.extra_padding_size = 100;
        
        /**
        * Current extra padding applied.
        * @type {number}
        */    
        this.extra_padding = 0;        
        
        /**
        * Timeout in milliseconds before forcing send of partial content.
        * @type {number}
        */
        this.note_size_not_reached_timeout = 10000;
        
        /**
        * Current content buffer to be compressed and sent.
        * @type {string}
        */
        this.content = "";
        
        /**
        * Chunk sequence number for ordering and encryption derivation.
        * @type {number}
        */
        this.counter = 0;
        
        /**
        * Salt used when deriving AES key from a password.
        * Present only if password-based encryption is used.
        * @type {Uint8Array|null}
        */
        this.encryption_salt = null;

        
        /**
        * Flag to request stop.
        * @type {boolean}
        */    
        this.stop_requested = false;  
        
        /**
        * Queue of transactions waiting to be sent.
        * @type {Array<Object>}
        */
        this.transactions_queue = [];
        
        /**
        * The hash of the last processed chunk.
        * @type {string}
        */
        this.last_hash_compressed_chunk  = null;       
       
        /**
        * Timestamp when the same compressed chunk hash was first observed. 
        * @type {number|null}
        */
        this.ts_same_hash = null;
       
        /**
        * Whether the session has been finalized.
        * @type {boolean}
        */
        this.is_finalized = false;        
                
        /**
         * Is true once the stop transaction was sent.
         * @type {boolean}
         */
        this.is_over = false;
        
        /**
        * Callback fired with the payload transaction id once created.
        * @type {(id: string) => void|null}
        */
        this.getPayloadTransactionId = null; 
        
        /**
        * Logging callback for debug messages.
        * @type {(message: any) => void|null}
        */
        this.onLog = null;    
        
        
        this.init()
    }
    
    
    /**
    * Set the compression algorithm.
    * 
    * @param {string|object} compression - The compression name or {compression:name, params:level}.
    * @returns {Promise<void>}
    */
    async setCompression(compression) {
        
        if(typeof compression === "string"){
            
            this.compression = await getCompression(compression); 
        }
        else if(typeof compression === "object"){
            
            this.compression = await getCompression(compression.name); 
            
            if(compression?.params){
                
                this.compression.setParams(compression.params);
            }
        }     
    } 

    
    /**
    * Apply and validate supported options (sender, title, compression, encryption, callbacks).
    * Unsupported options are ignored.
    *
    * @param {Object} options - User-specified configuration object.
    * @returns {Promise<void>}
    */
    async prepareOptions(options){
        
        const allowed_options = [
            
            "sender", 
            "compression",
            "mime",
            "title", 
            "aes_key",             
            "password",
            "encrypt_title",
            "note_size_not_reached_timeout",
            "getPayloadTransactionId",
            "onLog",
            "onFinish",
            "onError"
        ];
        
        for(const option in options){
            
            if( !allowed_options.includes(option) ){
                
                continue;
            }
            
            const value = options[option];
            
            switch(option){
                
                case "sender":      this.setSenderFromMnemonic(value); break;                    
                case "compression": await this.setCompression(value); break;               
                default:            this[option] = value;
            }           
        }
    }
    
    
    async init(){
        
        await this.prepareOptions(this.constructor_options);                   

        if( !this.sender ){

            throw Error("The sender is missing");
        }                                

        // If no compression was set, "none" is applied.        
        if( !this.compression ){

            await this.setCompression("none");
        }

        this.receiver = Chain.createAddress();             

        const receiver  = await Chain.getRandomHDAccount(this.sender.sk);
        this.receiver   = Chain.getAddressFromMnemonic(receiver.mnemonic); 
        
        // Prepare the result
        this.result = {

            fees:       0,
            start:      Date.now(),
            //receiver:   this.receiver.addr.toString()
        };

        // Prepare the payload
        this.payload = {

            title:  this.title,                                               
            type:   "stream",
            mime:   this.mime,
            addid:  receiver.address_index,
            accid:  receiver.account_index
        };   

        // If a compression is set, add it to the payload.
        if(this.compression.name() !== "none"){

            this.payload.compression = this.compression.name();
        }

        // If there is a password, derives an aes key from it.
        if(this.password){

            const {salt, derived_key}   = await Crypto.deriveKey(this.password);
            this.encryption_salt        = salt;
            this.payload.salt           = this.encryption_salt.toString("base64");                
            this.aes_key                = derived_key;       
        }            
        else if(this.aes_key){

            this.iv         = Crypto.randomBytes(16);
            this.payload.iv = this.iv.toString("base64");           
        }     

        if(this.aes_key && this.encrypt_title === true){

            this.encryptTitle();
        }            

        // Build & send payload transaction.
        const suggested_params          = await Chain.getSuggestedParams();
        const payload_transaction       = await Chain.buildPayloadTransaction(suggested_params, this.sender, this.receiver, this.payload);            
        this.result.payload_transaction = payload_transaction.id;
        const send_payload_transaction  = await Chain.sendTransaction(payload_transaction.txn);

        if(send_payload_transaction?.error){

            this.logError(send_payload_transaction.error);

            return;
        }

        if(this.getPayloadTransactionId){

            this.getPayloadTransactionId(payload_transaction.id);
        }
        
        this.start();
    }
    
    
    /**
    * Append raw content to the stream. On the first call:
    * - Initializes sender, receiver, payload, compression and encryption settings.
    * - Creates and sends the payload transaction.
    * - Starts processing the transaction queue.
    *
    * @param {string} raw_content - Raw content to append.
    * @returns {Promise<void>}
    * @throws {Error} If sender account is missing.
    */
    async send(raw_content) {                
               
        if( !this.stop_requested ){
                        
            this.content += raw_content;        
        }                                                     
    }
 
 
    /**
    * Starts processing the content and sending it as transactions.
    * Runs until stop is requested and all content is processed.
    * 
    * @returns {Promise<void>}
    */
    async start() {
        
        this.runTransactionsQueue();
        
        while( !this.stop_requested || this.content.length > 0 ){

            await this.process();      
            
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        this.finalize();
    }   
    
    
    /**
    * Process the content buffer.
    * - Chunk, compress, and queue transactions.
    * - Also handles dynamic padding and timeout rules.
    * 
    * @returns {Promise<void>}
    */
    async process(){       
             
        if(this.content.length === 0){
                      
            return;
        }
   
        let chunk_to_send           = this.content.slice(0, this.note_max_size + this.extra_padding);
        let compressed_chunk        = await this.compress(chunk_to_send, this.counter);  
        const hash_compressed_chunk = Crypto.sha256(compressed_chunk);
      
        // Check if the current compressed_chunk is the same than the previous one.
        // if it is, it means the chunk wasn't sent because it is smaller than 1024.
        const same_chunk_than_previous = hash_compressed_chunk === this.last_hash_compressed_chunk;
        
        if( !same_chunk_than_previous ){
                       
            this.last_hash_compressed_chunk = hash_compressed_chunk;
            this.ts_same_hash               = null;
        }
        else if(same_chunk_than_previous && this.ts_same_hash === null){

            this.ts_same_hash = Date.now();                                    
        }
        
        this.log({
            
            "extra_padding":            this.extra_padding, 
            "compressed_chunk_size":    compressed_chunk.length, 
            "content":                  this.content.length, 
            "same_hash_since":          (this.ts_same_hash ? (Date.now() - this.ts_same_hash) : null) 
        });
        
        // If ::stop() was invoked, send all the remaining content into 1 
        // single transaction if possible.
        
        if(this.stop_requested && (this.content.length <= this.note_max_size)){

            if(this.content.length > 0){
                
                const compressed_remaining_content = await this.compress(this.content, this.counter);

                this.sendTransaction(compressed_remaining_content);                                

                this.content = "";
            }
            
            return;            
        }
                       
        // If the compressed content is smaller than the max note size.
        if(compressed_chunk.length < this.note_max_size){
                             
            // Try with more padding.
            this.extra_padding += this.extra_padding_size;
                      
            // If the same chunk stays into the pipeline for more than 'note_size_not_reached_timeout'
            // it is sent disregarding the size is smaller than 1024.
            if(this.ts_same_hash){
                
                const same_hash_since = Date.now() - this.ts_same_hash;

                if(same_hash_since > this.note_size_not_reached_timeout){

                    this.content                    = "";
                    this.extra_padding              = 0;                    
                    this.ts_same_hash               = null;
                    this.last_hash_compressed_chunk = null;
                    
                    this.sendTransaction(compressed_chunk);                                 

                    this.counter++;                                                                 
                }
            }
        }        
        else{                        
              
            // If the compressed_chunk is too big, reduce the padding (49,48,47, ...)
            // until the compressed_chunk size is === to 1024                    
           
            while(compressed_chunk.length > this.note_max_size){                
                
                this.extra_padding  = this.extra_padding - 5;               
                chunk_to_send       = this.content.slice(0, this.note_max_size + this.extra_padding); 
                compressed_chunk    = await this.compress(chunk_to_send, this.counter);

                await new Promise(resolve => setTimeout(resolve, 10));
            }
          
            this.content        = this.content.slice(this.note_max_size + this.extra_padding);      
            this.extra_padding  = 0;            
                        
            this.log({"new_chunk": compressed_chunk.length});         
            
            this.sendTransaction(compressed_chunk); 
            
            this.counter++;
        }               
    }
          
    
    /**
    * Build and queue a transaction to send the content.
    * 
    * @param {Uint8Array|string} content - The content to send.
    * @param {boolean} [is_close_to_remainder=false] - Whether this is the closing txn.
    * @returns {Promise<void>}
    */
    async sendTransaction(content, is_close_to_remainder = false){
                
        const suggested_params  = await Chain.getSuggestedParams();
        const transaction       = await Chain.buildTransaction(
                
            suggested_params,
            this.sender, 
            this.receiver, 
            content,             
            is_close_to_remainder,
            false
        );

        this.transactions_queue.push(transaction);
    }
    
    
    /**
    * Process the queue of transactions by sending them.
    * Runs periodically until finalized and the queue is empty.
    * 
    * @returns {Promise<void>}
    */
    async runTransactionsQueue(){
        
        while( !this.is_finalized || this.transactions_queue.length > 0 ){
                    
            // Clone rather than reference to avoid any concurrency issue.
            const transactions_to_send = [...this.transactions_queue];

            if(transactions_to_send.length > 0){

                this.log({"in_queue":transactions_to_send.length});

                this.transactions_queue = [];
         
                await this.sendTransactions(transactions_to_send.map(transaction => transaction.txn));                 
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
               
        await this.sendFinalizeTransaction();                      
    }
    
    
    /**
    * Send the closing transaction with close-to-remainder flag and "stop" into the note.
    * 
    * @returns {Promise<void>}
    */
    async sendFinalizeTransaction(){
        
        const suggested_params                      = await Chain.getSuggestedParams();
        const close_to_remainder_transaction        = await Chain.buildTransaction(suggested_params, this.sender, this.receiver, "stop", true, false);
        const send_close_to_remainder_transaction   = await this.sendTransactions([close_to_remainder_transaction.txn]);      
                       
        this.result.end         = Date.now();
        this.result.duration    = this.result.end - this.result.start;
        this.result.payload     = this.payload;                        
        
        if(this.onFinish){

            this.onFinish(this.result);
        }
        
        this.is_over = true;
    }
    
    
    /**
    * Compress content and prepend the counter.
    * If required, encrypts using AES-CTR with a derived IV.
    *
    * @param {string} content - Raw content to compress.
    * @param {number} counter - Chunk sequence number.
    * @returns {Promise<Uint8Array>} - Compressed (and optionally encrypted) binary chunk.
    */
    async compress(content, counter){
 
        let compress = await this.compression.compress(content);                         
                
        if(this.aes_key){
            
            // Determine the derivation seed for encryption:
            // - Password mode: derive per-chunk IV from (salt + counter).
            // - Raw AES key mode: derive per-chunk IV from (iv + counter).
            // In both cases, the final iv for aes-ctr is deterministically derived from this seed and the chunk counter.
            const seed  = this.encryption_salt ?? this.iv;
            compress    = Crypto.encryptWithDerivation(this.aes_key, compress, counter, seed);
        }
 
        return this.prependCounterToContent(compress, counter);
    }
   
    
    /**
    * Request to stop the stream.
    * The code will stop receiving new content but will finish sending all remaining 
    * buffered content. 
    * Returns how much content is left unprocessed (if any).
    * 
    * @returns {{left_content_size: number}}
    */
    stop(){
        
        this.log({stop_requested:this.content.length});       
        
        this.stop_requested = true;
        
        return {
            
            left_content_size: this.content.length
        };
    }
            
    
    /**
    * Finalize the stream:
    * - Clear internal buffers.
    * - Mark as finalized.
    */
    finalize() {
               
        this.content            = "";
        this.extra_padding      = 0;             
        this.is_finalized       = true;                
    }

    
    /**
    * Send a message to the logging callback (if defined).
    *
    * @param {any} message - Debug or status message.
    * @returns {void}
    */
    log(message){
        
        if(this.onLog){
            
            this.onLog(message);
        }
    }
}