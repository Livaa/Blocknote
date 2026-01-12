import {getCompression, compareCompressions}    from "../compressions/compressions.js"
import * as Chain                               from "../chain/chain.js";
import * as Crypto                              from "../crypto/crypto.js";


export class Blocknote {


    constructor(sender_mnemonic, options = {}) {
  
        /**
        * Blocknote version identifier.
        * @type {number}
        */
        this.version = 0.1;
        
        /**
        * Receiver address where data chunks and the metadata (payload) transaction are sent.
        * This address acts as the storage account for the current upload.
        * @type {{addr: string, sk: Uint8Array} | null}
        */
        this.receiver = null;             
        
        /**
        * Sender address (pays fees and funds the receiver).
        * @type {{addr: string, sk: Uint8Array} | null}
        */
        this.sender = null;
        
        /**
        * Title of the content.
        * @type {string}
        */
        this.title = "untitled";  
        
        /**
        * Indicates whether the title should be encrypted when content encryption is enabled.
        * Has no effect if `aes_key` or `password` are not provided.
        * @type {boolean}
        */
        this.encrypt_title = true;
        
        /**
        * MIME type of the content (e.g., "text", "image/png").
        * @type {string}
        */
        this.mime = "text/plain";
        
        /**
        * If provided, contains the ID of a previous payload transaction being revised.
        * Triggers ownership verification and revision tagging.
        * @type {string | null}
        */
        this.revision_of = null;
        
        /**
        * AES key for encryption.
        * @type {string|null}
        */
        this.aes_key = null;
        
        /**
        * Password for deriving the AES key.
        * @type {string|null}
        */
        this.password = null;
        
        /**
        * Compressed content buffer.
        * @type {Uint8Array|null}
        */
        this.content = null;                          
                
        /**
        * Maximum retry attempts before rebuilding a transaction.
        * @type {number}
        */
        this.retry_failed_transaction = 25;        
        
        /**
        * Max note size in bytes (Algorand limit is 1024 bytes per note).
        * @type {number}
        */
        this.note_max_size = 1024;
        
        /**
        * Callback triggered when the session finishes.
        * @type {function|null}
        */
        this.onFinish = null;
        
        /**
        * Error callback invoked when a transaction batch reaches unrecoverable failure
        * or parameter validation throws.
        * @type {function|null}
        */
        this.onError = null;    
        
        /**
        * Progress callback for status updates during compression, transaction 
        * building, and sending.
        * @type {function|null}
        */
        this.onProgress = null;
        
        /**
        * If true, disables calling any user-provided callbacks.
        * @type {booleanean}
        */       
        this.silent_callbacks = false;
        
        /**
        * Compression instance's handler.
        * @type {any|null}
        */
        this.compression = null; 
                
        /**
        * If true, run in simulation mode without sending transactions.
        * @type {booleanean}
        */
        this.is_simulation = false;
        
        /**
        * Metadata about the session (compression info, timestamps, etc.).
        * @type {Object}
        */
        this.payload = {}; 
        
        /**
         * The payload transaction of the data that is been revised.
         */
        this.revised_payload_transaction = null;
        
        /**
        * Result object with list of txids, total fees, and payload info.
        * @type {{ txns: string[], fees: number, payload?: Object }}
        */
        this.result = null;           
        
        /**
        * Constructor parameters passed during instantiation.
        * Stored for later re-use in `prepareOptions`.
        * @type {Object}
        */
        this.constructor_options = options;  
        
        this.setSenderFromMnemonic(sender_mnemonic);
    }
    
    
    /**
    * Hydrates instance settings from an options object, filtering allowed keys.
    * Options outside the allowlist are ignored.
    * @param {Object} options
    * 
    * @returns {Promise<void>}
    */
    async prepareOptions(options){
      
        const allowed_options = [
            
            "compression", 
            "mime",
            "revision_of",
            "title", 
            "encrypt_title",
            "aes_key", 
            "password",            
            "simulate", 
            "onProgress",
            "onFinish", 
            "onError"
        ];
        
        for(const option in options){
            
            if( !allowed_options.includes(option) ){
                
                continue;
            }
            
            const value = options[option];
            
            switch(option){
                                  
                case "compression": await this.setCompression(value); break;                
                case "simulate":    this.simulate(value); break;
                default:            this[option] = value;
            }           
        }
    } 

    
    /**
    * Sets the compression mode or algorithm instance.
    * Accepts either:
    * - "fast" to trigger automatic fastest algorithm selection
    * - A compression name string
    * - An object `{name: string, params?: Object}` to configure parameters
    * 
    * @param {"fast" | string | {name: string, params?: Object}} compression
    * @returns {Promise<void>}
    */
    async setCompression(compression) {
        
        if(compression === "fast"){
            
            this.compression = "fast";
        }
        else if(typeof compression === "string"){
            
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
    * Set the sender account from mnemonic.
    * 
    * @param {string} mnemonic
    */
    setSenderFromMnemonic(mnemonic){
        
        this.sender = Chain.getAddressFromMnemonic(mnemonic);               
    } 


    /**
    * Compare different compression algorithms on the given content.
    * 
    * @param {Uint8Array} content
    * @returns {Promise<Array<{name: string, size: number, duration: number}>>}
    */
    compareCompressions(content){
        
        return compareCompressions(content);
    }
    
    
    /**
    * Picks and sets the smallest output compression algorithm.
    * 
    * @param {Uint8Array} content
    * @returns {Promise<void>}
    */
    async setBestCompression(content){
        
        const compare   = await this.compareCompressions(content);        
        const best      = compare.reduce((min, current) => current.size < min.size ? current : min);

        await this.setCompression(best.name);                
    }
    
    
    /**
    * Picks and set the fastest compression based on duration.
    * 
    * @param {Uint8Array} content
    * @returns {Promise<void>}
    */
    async setFastestCompression(content){
        
        const compare   = await this.compareCompressions(content);        
        const fastest   = compare.reduce((min, current) => current.duration < min.duration ? current : min);
        
        await this.setCompression(fastest.name);
    }

    
    /**
    * Enables or disables transaction simulation mode.
    * 
    * @param {booleanean} is_simulation
    */
    simulate(is_simulation) {
        
        this.is_simulation = is_simulation;
    }    
    
    
    /**
    * Save content to the blockchain.
    * 
    * @param {Uint8Array} raw_content - The raw uncompressed content.
    * @returns {Promise<Object>}
    * @throws if sender is missing or revision ownership mismatches or payload too large.
    */
    async save(raw_content) {                
                    
        if ( !raw_content ){
            
            return;
        }
        
        await this.prepareOptions(this.constructor_options);
        
        if( !this.sender ){

            throw Error("The sender's mnemonic is missing");
        }                                                                  
        
        // Assert revision
        if(this.revision_of){
            
            this.revised_payload_transaction = await Chain.getTransactionById(this.revision_of);        

            if(this.revised_payload_transaction.sender !== Chain.encodeAddress(this.sender.addr.publicKey)){
                
                throw Error("The sender of the data to revise is not the same as the current sender");
            }                      
        }
              
        // Set compression
        if(this.compression === "fast"){
            
            this.logOnProgress({status:"searching_for_fastest_compression"});
            
            await this.setFastestCompression(raw_content);
        }        
        else if( !this.compression ){
            
            this.logOnProgress({status:"searching_for_best_compression"});
               
            await this.setBestCompression(raw_content);            
        }

        // Set the receiver    
        const receiver  = await Chain.getRandomHDAccount(this.sender.sk);
        this.receiver   = Chain.getAddressFromMnemonic(receiver.mnemonic);         
        
        // Build the payload
        this.payload = {

            version:    this.version,
            title:      this.title,
            mime:       this.mime,
            size:       raw_content.length,
            addid:      receiver.address_index,
            accid:      receiver.account_index,            
        };
        
        if(this.compression.name() !== "none"){
            
            this.payload.compression = this.compression.name();
            
            this.logOnProgress({status:"compressing_content", compression: this.compression.name()});
        }
                
        this.content = await this.compression.compress(raw_content); 

        // Already populates some results entries.
        this.result = {
            
            start:          Date.now(),
            simulation:     this.is_simulation,
            fees:           0,
            compression:    {

                compression:        this.compression.name(),
                original_size:      raw_content.length,
                compressed_size:    this.content.length
            }
        };
        
        // If there is a password, derives an aes key from it.
        // Derived aes from password requires a salt, it is saved into the payload.
        if(this.password && !this.aes_key){
            
            const {salt, derived_key}   = await Crypto.deriveKey(this.password);
            this.payload.salt           = salt.toString("base64");
            this.aes_key                = derived_key;           
        }
        
        // Encrypt the content and the title if required.
        // Add the iv & the authag into the payload,
        // Note: the encryption must happen after the compression.
        if(this.aes_key){
           
            const encrypt       = Crypto.encrypt(this.content, this.aes_key);       
            this.payload.iv     = encrypt.iv.toString("base64");
            this.payload.tag    = encrypt.tag.toString("base64");           
            this.content        = new Uint8Array(encrypt.data);  
            
            if(this.encrypt_title){
                
                const encrypt_title = Crypto.encrypt(this.title, this.aes_key);   
                //this.payload.title  = Buffer.from(JSON.stringify(encrypt_title)).toString("base64");
                this.payload.title = {
                    iv: encrypt_title.iv.toString("base64"),
                    tag  :    encrypt_title.tag.toString("base64"),
                    data: encrypt_title.data.toString("base64")
                }
            }
        }                                 
        
        await this.start();
        
        return this.result;
    }

    
    /**
    * Splits content into chunks, builds transactions, sends them in batches,
    * optionally applies revision tags, then finalizes session.
    *
    * @returns {Promise<void>}
    */
    async start() {
                
        const transactions      = [];    
        const simulation_transactions = [];
        const suggested_params  = await Chain.getSuggestedParams();
        let counter             = 0;
        
        // - Slice the content into chunks of 1020 + 4 for the counter
        // - Build and save transactions from each chunks.
        while(true){

            this.logOnProgress({

                status:                 "building_transactions", 
                counter:                counter, 
                remaining_content_size: this.content.length, 
                remaining_transactions: Math.ceil(this.content.length / this.note_max_size)
            });
            
            // let the event loop breathe.     
            await new Promise(resolve => setTimeout(resolve, 0)); 
            
            this.content        = this.prependCounterToContent(this.content, counter);  
            const chunk_to_send = this.content.slice(0, this.note_max_size);      
            this.content        = this.content.slice(this.note_max_size);
            const is_last_chunk = this.content.length === 0;
            const transaction   = Chain.buildTransaction(
                    
                suggested_params, 
                this.sender, 
                this.receiver, 
                chunk_to_send,                 
                is_last_chunk
            );

            // Collect the transactions to send.
            transactions.push(transaction.txn);                            
            
            if(is_last_chunk){
                
                break;
            }
            
            counter++;
        }                
        
        // Put into the payload the number of data transactions
        this.payload.txns = transactions.length;                                                             


        /*
        *  Send the payload transaction  
        */
        this.logOnProgress({status: "sending_payload_transaction"});
                
        const payload_transaction = Chain.buildPayloadTransaction(
                
            suggested_params, 
            this.sender, 
            this.receiver, 
            this.payload
        ); 

        // Don't put the id of the payload txn if this is a simulation in order
        // to avoid confusion.
        if( !this.is_simulation  ){
            
            this.result.payload_transaction_id = payload_transaction.id;  
        }
        
        await this.sendTransactions([payload_transaction.txn]);    
               

        /*
        * Send data transactions
        * 
        * The last transaction in transactions[] can include a closeRemainderTo field.
        * It returns the 0.1 ALGO minimum balance back to the sender previously sent with the payload_transaction.
        * This transaction must be executed last to ensure all others are processed beforehand.          
        */
        
        this.logOnProgress({status: "sending_data_transactions"});
        
        const last_transaction = transactions.pop();

        await this.sendTransactions(transactions);   
        

        /*
        * Send the last transaction.
        */ 
        
        this.logOnProgress({status: "sending_close_transaction"});

        await this.sendTransactions([last_transaction]);
        

        /*
        * Save the revision tag to the initial upload account.
        */ 
        if(this.revised_payload_transaction){

            this.logOnProgress({status: "saving_revision_tag"});
            
            const revised_note              = JSON.parse(Buffer.from(this.revised_payload_transaction.note, "base64").toString());                           
            const revision_receiver         = await Chain.getHDAccount(this.sender.sk, revised_note.accid, revised_note.addid);                          
            const revision_receiver_account = Chain.getAddressFromMnemonic(revision_receiver.mnemonic);        
            const revision_tag              = JSON.stringify({revision: payload_transaction.id});
            const revision_transaction      = Chain.buildRevisionTagTransaction(suggested_params, this.sender, revision_receiver_account, revision_tag);

            await this.sendTransactions([revision_transaction.txn]); 

            this.logOnProgress({status: "closing_revision_tag_receiver"});
            
            const close_revision_receiver = await Chain.buildCloseRevisionReceiverTransaction(suggested_params, this.sender, revision_receiver_account);

            await this.sendTransactions([close_revision_receiver.txn]); 
            
        }
            
        this.stop();
    }
    

    /**
    * Sends a list of signed transactions to the network, retrying failures.
    * Rebuilds a transaction after the retry threshold is exceeded.
    * 
    * @param {Uint8Array[]} transactions_list - Already signed transactions
    * @returns {Promise<void>}
    */
    async sendTransactions(transactions_list){
        
        if(this.is_simulation){
            
            return this.saveSimulationResult(transactions_list);
        };
        
        const sendBatchOfTransactions = async (transactions) => {
            
            const res = [];
            
            for (const txn of transactions) {
                
                res.push(Chain.sendTransaction(txn));
              
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            return res;
        };
        
        let suggested_params    = await Chain.getSuggestedParams();
        let transactions        = await Promise.all(await sendBatchOfTransactions(transactions_list));     
        let counters            = {};        
        
        while(true){
            
            let failed_transactions = [];
            
            for(const transaction of transactions){                              
            
                // Decode the signed txn to extract the id
                const decode_signed_transaction = Chain.decodeSignedTransaction(transaction.signed_txn);
                const unsigned_transaction      = decode_signed_transaction.txn;                         
                const txn_id                    = unsigned_transaction.txID();
               
                if( txn_id in counters === false ){
                        
                    counters[txn_id] = 0;         
                } 
         
                if(transaction?.error && transaction.error.toString().indexOf("transaction already in ledger") === -1){                                                    
                   
                    this.logError(transaction.error);
                    
                    // Rebuild the transaction if it failed after too many tries.
                    if(counters[txn_id] > this.retry_failed_transaction){
                        
                        delete counters[txn_id];
                                              
                        const note                  = unsigned_transaction.note;        
                        const is_last_chunk         = unsigned_transaction.payment.closeRemainderTo ? true : false;  
                        suggested_params            = await Chain.getSuggestedParams();
                        const rebuilt_transaction   = await Chain.buildTransaction(
                                
                            suggested_params, 
                            this.sender, 
                            this.receiver, 
                            note, 
                            is_last_chunk
                        );
                        
                        failed_transactions.push(rebuilt_transaction.txn);                        
                    }
                    else{
                        
                        console.log("retrying txn", txn_id, "counter:", counters[txn_id]);
                        
                        counters[txn_id]++;
                        
                        failed_transactions.push(transaction.signed_txn);
                    }                                        
                }
                else{                        
              
                    this.saveTransactionCosts(unsigned_transaction);
                }
            }

            if (failed_transactions.length === 0) break;
            
            await new Promise(resolve => setTimeout(resolve, 6000));                                    
            
            transactions = await Promise.all(await sendBatchOfTransactions(failed_transactions));              
        }
    }
    
    
    /**
    * Prefixes a 4-byte little-endian counter at the start of each content buffer chunk.
    * Ensures chunk ordering can be restored when reading from chain.
    *
    * @param {Uint8Array} content
    * @param {number} counter
    * @returns {Uint8Array} new buffer with 4 counter bytes prepended
    */
    prependCounterToContent(content, counter){
        
        const counter_bytes = new Uint8Array(4);       
        const new_content   = new Uint8Array(content.length + 4);

        new DataView(counter_bytes.buffer).setUint32(0, counter, true);
        
        new_content.set(counter_bytes, 0);
        new_content.set(content, 4);
        
        return new_content;
    }
    
    
    /**
    * Save transaction fee results into the result.
    * 
    * @param {Object} transaction - Transaction object.
    */
    saveTransactionCosts(transaction){
            
        this.result.fees += Number(transaction.fee);// + amount;        
    }
    
    
    /**
    * Save simulated transaction fees into the current result object.
    * 
    * @param {Object[]} transactions - Array of signed transactions.
    */
    saveSimulationResult(transactions){
        
        for(const transaction of transactions){
                
            const decode_signed_transaction = Chain.decodeSignedTransaction(transaction);
            const unsigned_transaction      = decode_signed_transaction.txn;                         
            
            this.saveTransactionCosts(unsigned_transaction);            
        }
    }
    
    
    /**
    * Finalizes the current Blocknote session.    
    * Marks the end time, calculates the total duration, attaches the payload 
    * To the result, and triggers the  `onFinish` callback if defined.
    */
    stop() {
      
        this.result.end         = Date.now();
        this.result.duration    = this.result.end - this.result.start;
        this.result.payload     = this.payload;        

        if(this.onFinish) {

            this.onFinish(this.result);
        }
    }
    
    
    /**
    * Logs an error using the on_error callback, if defined.
    *
    * @param {Error|string} error - The error object or message to log.
    */
    logError(error){
        
        if(this.onError && !this.silent_callbacks){

            this.onError(error);
        }
    }
        
    
    /**
    * Logs general information using the on_log callback, if defined.
    *
    * @param {any} content - The content to log (message, object, etc.).
    */
    logOnProgress(content){
            
        if(this.onProgress && !this.silent_callbacks){

            this.onProgress(content);
        }
    }    
    
}