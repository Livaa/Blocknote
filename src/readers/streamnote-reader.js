import * as algosdk     from "algosdk";
import * as Crypto      from "../crypto/crypto.js";
import * as Search      from "../search/search.js";
import {getCompression} from "../compressions/compressions.js"
import {BlocknoteReader} from "./blocknote-reader.js"

const algod     = new algosdk.Algodv2(process.env.ALGOD_TOKEN, process.env.ALGOD_URL, process.env.ALGOD_PORT);
const indexer   = new algosdk.Indexer(process.env.INDEXER_TOKEN, process.env.INDEXER_URL, process.env.INDEXER_PORT);


export class StreamnoteReader{
           
    
    constructor(payload_transaction_id, properties = {}) {        
        
        /**  
        * ID of the payload transaction containing metadata.   
        *     
        * @type {string}
        */
        this.payload_transaction_id = payload_transaction_id; 
        
        /**
        * AES key for decryption.
        * 
        * @type {string|null}
        */
        this.aes_key = properties?.aes_key;
        
        /**
        * Password used to derive AES key.
        * 
        * @type {string|null}
        */
        this.password = properties?.password;
        
        /**
        * Callback triggered when a chunk of data is emitted.
        * 
        * @type {Function}
        */
        this.onData = properties?.onData;
        
        /**
        * Logs callback.
        * 
        * @type {Function}
        */
        this.onLog = properties?.onLog;
                
        /** 
        * Metadata extracted from the initial payload transaction.    
        * 
        * @type {Object|null}            
        */
        this.payload = null;        

        /** 
        * Address of the original sender of the data.
        * 
        * @type {string|null} 
        */
        this.sender = null;

        /** 
        * Address who receives the data.
        * 
        * @type {string|null} 
        */
        this.receiver = null;

        /** 
        * Compression algorithm.
        * 
        * @type {string|null} 
        */
        this.compression = null;

        /** 
        * True if the receiver received a transaction containing "stop" from this.sender.
        * 
        * @type {boolean} 
        */
        this.stream_is_over = false;

        /** 
        * Offset tracking how many bytes have been consolidated so far
        * while reassembling chunks in order.
        * 
        * @type {number} 
        */
        this.consolidate_seek = 0;

        /** 
        * Stores each chunk of the payload by its index.
        * Allows reordering, deduplication, and eventual merging into `payload`.
        * 
        * @type {Map<number, Uint8Array>} 
        */
        this.content_chunks = new Map;

        /** 
        * Latest blockchain round/block number that contained a received chunk.
        * Useful for synchronization and ensuring data freshness.
        * 
        * @type {number|null} 
        */
        this.youngest_block = null;
    }
    
    
    /**
    * Get the payload object (metadata).
    * 
    * @returns {Object|null} The payload or null if not yet retrieved.
    */
    getPayload(){
        
        return this.payload;
    }
    
    
    /**
    * Retrieves the metadata transaction from indexer if not done yet.
    * Parses and stores sender/receiver/compression info.
    * 
    * @returns {Promise<void>}
    */
    async retrievePayload(){
        
        if( !this.payload ){
            
            const payload_transaction   = await indexer.lookupTransactionByID(this.payload_transaction_id).do();            
            this.payload                = JSON.parse(Buffer.from(transaction.transaction.note, "base64"));
            this.sender                 = payload_transaction.transaction.sender;
            this.receiver               = payload_transaction.transaction.paymentTransaction.receiver;                  
        } 
    }
    
    
    /**
    * Load all historical chunks of the stream, decompress/decrypt them,
    * and return the reconstructed content.
    *
    * @returns {Promise<Uint8Array>} Full content of the stream so far.
    */
    async getPreviousData(){
        
        if(!this.payload){
            
            await this.retrievePayload();
        }
      
        const get_all_transactions = await Search.getAllStreamedTransactions(this.sender, this.receiver);                                    
  
        await this.updateContentChunks(get_all_transactions);

        return this.consolidateContent();
    }
    
    
    /**
     * Initializes streaming from last known state and starts polling for new chunks.
     * 
     * @returns {Promise<void>}
     */
    async start(){
 
        if( !this.payload ){
            
            await this.retrievePayload();          
        }    
    
        // If getPreviousData() was called before, there is already a seek.
        // else, the first seek must be the last transaction.
        if( !this.consolidate_seek ){
                                      
            const last_transaction = await this.getLastReceivedTransaction(this.sender, this.receiver);
            
            // If no transaction was sent yet, retries in few seconds.
            if( !last_transaction ){
                
                await new Promise(r => setTimeout(r, 5000));
                
                return this.start();
            }
            
            await this.updateContentChunks([last_transaction]);
        }
             
        this.readIncomingTransactions(this.sender, this.receiver);             
    }             


    /**
     * Reads raw chunk transactions, decrypts & decompresses them,
     * and inserts them into the internal buffer with correct ordering and deduplication.
     * 
     * @param {Array<Object>} transactions
     * @returns {Promise<void>}
     */
    async updateContentChunks(transactions){

        const compressed_chunks = new Map;
        let first_counter       = null;                
        
        for (const transaction of transactions) {
           
            const note                  = transaction.note;   
            const uint_array_counter    = note.slice(0, 4);   
            const view                  = new DataView(uint_array_counter.buffer);
            const counter               = view.getUint32(0, true); // true = little-endian           
            
            if(this.content_chunks.get(counter)     // This chunk is already into this.content_chunks
               || counter < this.consolidate_seek   // Or it was already sent
            ){
                
                continue;
            }         
                 
            if( !this.youngest_block || transaction.confirmedRound > this.youngest_block ){
                
                this.youngest_block = transaction.confirmedRound;
            }  

            const data = await this.uncompress(Buffer.from(note.slice(4)), counter);
            
            compressed_chunks.set(counter, data);             
        }

        if(compressed_chunks.size > 0){
            
            // Build a new map from the current this.content_chunks and the new received chunks
            const new_content_chunks = new Map([...this.content_chunks, ...compressed_chunks]);  

            // Convert the new map to an array to order by key (counter)
            const content_chunks_arr = [...new_content_chunks.entries()].sort((a, b) => a[0] - b[0]);

            // Convert the ordered array to a map and populate this.content_chunks with it
            this.content_chunks  = new Map(content_chunks_arr);        
        }        
    }

    
    /**
    * Polls the blockchain for new chunks until a stop signal is detected.
    * 
    * @param {string} sender
    * @param {string} receiver
    * @returns {Promise<void>}
    */
    async readIncomingTransactions(sender, receiver) {
        
        while ( !this.stream_is_over ){
            
            this.consolidateContent();
            
            /*             
                The indexer may lag behind the latest round.
                Example:
            
                - The current last round is 1,000,000
                - The indexer might already have all transactions from this block… or not.
                - Even if it does, it could still be indexing earlier blocks (999,999; 999,998; etc.).

                To handle this, we query starting from (youngest_block - 10), 
                roughly a 30s window. This buffer gives the indexer time to 
                fully register new transactions and ensures we don’t miss 
                any delayed ones from previous blocks.            
            */
           
            const min_round = this.youngest_block - BigInt(10);

            this.log("Checking for new incoming txns starting from block: " + min_round);

            const get_all_transactions = Search.getAllStreamedTransactions(sender, receiver, min_round);

            if (get_all_transactions.length > 0) {
                
                await this.updateContentChunks(get_all_transactions);
            }

            if (!this.stream_is_over) {
                
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        this.log("The stream is over");
    }
    
    
    /**
    * Consolidates contiguous ordered chunks into a binary Uint8Array,
    * advances the seek index, prunes buffer, and emits data via callback.
    * 
    * @returns {Uint8Array}
    */
    consolidateContent() {     
        
        const content = [];                                  
      
        // There is no data yet, returns an empty Uint8Array
        if(this.content_chunks.size === 0){                       

            // If they are no new transactions, maybe the stream is over.
            this.checkIfStreamIsOver(this.receiver);  
                             
            return new Uint8Array;
        }
        
        // If the seek is not set yet, we set it to the first key.
        if(this.consolidate_seek === 0){

            this.consolidate_seek = this.content_chunks.keys().next().value ?? 0;
        }

        const returned_chunks_keys = [];
        
        this.log("Getting data from counter: " + this.consolidate_seek);
        
        while (this.content_chunks.has(this.consolidate_seek)) {
            
            const chunk = this.content_chunks.get(this.consolidate_seek);

            returned_chunks_keys.push(this.consolidate_seek);

            content.push(chunk);

            this.consolidate_seek++;
        }

        if(content.length === 0){
            
            this.log("Chunk " + this.consolidate_seek + " not found. " + this.content_chunks.size + " chunk(s) in buffer");
        }
        
        this.pruneContentChunks(returned_chunks_keys);
        
        const concat_buffers    = Buffer.concat(content);
        const res               = new Uint8Array(concat_buffers)
        
        if(res.length > 0){
            
            this.logOnData(res);
        }
        
        return res;           
    }
    
    
    /**
    * Deletes already used chunk counters from the internal buffer.
    * 
    * @param {Array<number>} counters
    * @returns {void}
    */
    pruneContentChunks(returned_chunks_keys){
        
        if(returned_chunks_keys.length > 0){
            
            this.log("Pruning " + returned_chunks_keys.join(","));
        }
        
        for(const key of returned_chunks_keys){
            
            this.content_chunks.delete(key);
        }
    }  
        

    /**
    * Checks if the stream has ended by querying a special stop-signal transaction.
    * 
    * @param {string} receiver
    * @returns {Promise<void>}
    */
    async checkIfStreamIsOver(receiver) {
   
        this.stream_is_over = await Search.isStreamOver(receiver);
    } 
    
        
    
    /**    
     * Handles optional AES decryption and compression decoding of a single chunk.
     * 
     * @param {Uint8Array|Buffer} data
     * @param {number} counter
     * @returns {Promise<Uint8Array>}
     */
    async uncompress(data, counter){
               
        let content             = data;
        const encryption_seed   = this.payload?.salt ?? this.payload?.iv;
        
        // A password was used for encryption but the derived aes key was
        // not calculated yet
        if(this.password && this.payload?.salt && !this.aes_key){
            
            const {salt, derived_key}   = await Crypto.deriveKey(this.password, Buffer.from(this.payload.salt, "base64"));
            this.aes_key                = derived_key;
        }
        
        if(this.aes_key && encryption_seed){
           
            const buffer_seed   = Buffer.from(encryption_seed, "base64"); // iv/saltfrom the payload as based64
            content             = Crypto.decryptWithDerivation(this.aes_key, data, counter, buffer_seed);
        }
        
        if( !this.compression ){
            
            this.compression = await getCompression(this.payload.compression ?? "none");           
        }
        
        content = await this.compression.uncompress(content);
                 
        return content;
    }
    
    
    /**
    * Emits logs via onLog callback if defined.
    * 
    * @param {any} message
    * @returns {void}
    */
    log(content){
            
        if(this.onLog){

            this.onLog(content);
        }
    }
    
    
    /**
    * Emits data via onData callback if defined.
    * 
    * @param {any} data
    * @returns {void}
    */
    logOnData(data){
            
        if(this.onData){

            this.onData(data);
        }
    }
    
}
    