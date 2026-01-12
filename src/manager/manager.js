import {Blocknote}  from "../writers/blocknote.js" 
import {BlocknoteReader} from "../readers/blocknote-reader.js";
import * as Chain   from "../chain/chain.js";
import * as Algosdk from "algosdk";
import * as Crypto  from "../crypto/crypto.js";
import * as Db      from "../db/db.js";
import * as Search  from "../search/search.js";
import {randomUUID} from 'crypto';

Db.connect();

const algod     = new Algosdk.Algodv2(process.env.ALGOD_TOKEN, process.env.ALGOD_URL, process.env.ALGOD_PORT);
const indexer   = new Algosdk.Indexer(process.env.INDEXER_TOKEN, process.env.INDEXER_URL, process.env.INDEXER_PORT);
const queue     = {};
const results   = {};


/*
 * The manager handles the following pattern:
 * 
 *  [user web wallet (funder)] ---> boostrap txn ---> [sender] ---> payload + transactions data ---> [receiver]
 */

/**
* Add an async process to the queue.
* 
* @param {string} uuid - Unique identifier for the queued process.
* @param {Function} fn - Async function to run inside the queue.
* @returns {string} The same uuid, for later retrieval.
*/
export function enqueue(uuid, fn) {
   
    results[uuid]   = {status: "in_progress"};   
    queue[uuid]     = (async () => {

        await new Promise(resolve => setTimeout(resolve, 0));
        
        try {
                                                           
            const result = await fn();                
            
            results[uuid] = {status: "done", result: result}; 

        } 
        catch (e) {
            
            delete queue[uuid];                       
        
            results[uuid] = {status: "error", error: e.message, stack:e.stack };
        }

    })();

    return uuid;
}


/**
 * Get the result or progress of a queued process.
 * If it is done or errored, the process is removed from memory.
 * 
 * @param {string} uuid - The process UUID.
 * @returns {{status:string, error?:string, stack?:string, result?:any}|undefined} 
 *          Process status object or undefined if still running.
 */
export function getFromQueue(uuid){
    
    const output = results[uuid];
    
    if(output?.status === "done" || output?.status === "error"){
       
        delete results[uuid];
        delete queue[uuid];
    }
    
    return output;
}


/**
* Prepare a bootstrap transaction to fund a temporary sender account.
* Adds the process to the async queue.
* 
* @param {string} user_address - Address of the user funding the process.
* @param {Buffer|string} content - Data to store (raw or string).
* @param {string|null} [title=null] - Optional content title.
* @param {object} [options={}] - Additional parameters (compression, etc.).
* @returns {string} UUID of the queued process.
*/
export function prepareBootstrapTransaction(
        
    user_address,  
    content, 
    title = null, 
    options = {}
){
    
    const uuid      = randomUUID();
    options.uuid    = uuid;   
        
    enqueue(uuid, () => getBootstrapTransaction(user_address, content, title, options));
            
    return uuid;
}


/**
 * Generate a bootstrap transaction to fund a sender account.
 * Simulation only, actual funding occurs via the user sending the payment transaction.
 * 
 * @param {string} user_address - Address of the user funding the bootstrap.
 * @param {Buffer|string} raw_content - Content to store.
 * @param {object} [options={}] - Options such as compression, revision_of, ...
 * @returns {Promise<{output:object, transaction:string}>} 
 *          Bootstrap transaction details including simulated fees and encoded transaction.
 */
async function getBootstrapTransaction(
        
    user_address, 
    raw_content,    
    options  = {} 
){           

    if(options?.aes_key){
        
        throw new Error("For privacy reasons, the AES key must be provided to 'runFromBootstrapTransaction', not to 'prepareBootstrapTransaction'.");
    }
    
    if(options?.password){
        
        throw new Error("For privacy reasons, the password must be provided to 'runFromBootstrapTransaction', not to 'prepareBootstrapTransaction'.");
    } 
    
    if(options?.encrypt_title){
        
        throw new Error("For privacy reasons, encryption informations must be provided to 'runFromBootstrapTransaction', not to 'prepareBootstrapTransaction'.");
    }
    
    let sender          = Algosdk.generateAccount(); 
    let sender_mnemonic = Algosdk.secretKeyToMnemonic(sender.sk);
    
    if(options.revision_of){
            
        const revised_payload_transaction   = await Chain.getTransactionById(options.revision_of);
        const revised_payload_sender        = revised_payload_transaction.sender;        
        sender_mnemonic                     = await getBootstrapSenderMnemonic(user_address, revised_payload_sender);
        sender                              = Chain.getAddressFromMnemonic(sender_mnemonic);
    }

    const blocknote = new Blocknote(sender_mnemonic, {
        
        ...options,
        simulate:   true,
        onProgress: (message) => { 

            results[options.uuid] = message 
        }        
    });
    
    // Start simulating the saving process
    const output = await blocknote.save(raw_content);       
            
    // Pattern: [user] --funds--> [sender] --txns data--> [receiver]
    // Calculation:
    //   output fees (The fees required by the sender to send to the data to the receiver)
    // + minimal balance for sender     
    // + fees require for sender to send minimal balance to receiver
    // + minimal balance for receiver 
    const suggestedParams                       = await algod.getTransactionParams().do();
    const current_fee                           = Number(suggestedParams.minFee); 
    const fee_multiplier                        = options?.fee_multiplier ?? 3;
    const required_amount                       = output.fees + Algosdk.algosToMicroalgos(0.1) + current_fee + Algosdk.algosToMicroalgos(0.1);   
    const required_amount_expected_refund       = Algosdk.algosToMicroalgos(0.198);
    const recommended_amount                    = (output.fees * fee_multiplier) + Algosdk.algosToMicroalgos(0.1) + (current_fee * fee_multiplier) + Algosdk.algosToMicroalgos(0.1) ;
    const recommended_amount_expected_refund    = (recommended_amount - required_amount) + required_amount_expected_refund;   
    const bootstrap_key                         = (Crypto.randomBytes(32)).toString("base64");
    const encrypted_note                        = Crypto.encryptTransactionNote(JSON.stringify({sender:sender_mnemonic, key:bootstrap_key}));

    const transaction = Algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            
        sender:     user_address,
        receiver:   sender.addr.toString(), 
        amount:     recommended_amount,//deprecated: options?.use_required_amount ? required_amount : recommended_amount,               
        note:       new Uint8Array(Buffer.from( JSON.stringify({app:process.env.APP_NAME,blocknote:encrypted_note}) )),
        suggestedParams
    });
    
    output.funding              = {amount: recommended_amount, expected_refund: recommended_amount_expected_refund};    
    const encoded_transaction   = Algosdk.bytesToBase64(Algosdk.encodeUnsignedTransaction(transaction));
   
    // Put the compression into the options & save them, the title & the content 
    // into the sqlite DB.
  
    options.compression = output.compression.compression;

    Db.save(
                    
        transaction.txID(), 
        raw_content instanceof Buffer ? null : raw_content,
        raw_content instanceof Buffer ? raw_content : null,
        JSON.stringify(options)
    );
    
    return {output:output, key:bootstrap_key, transaction:encoded_transaction};
}


/**
 * Run a queued process from an existing bootstrap transaction.
 * 
 * @param {string} bootstrap_transaction_id - Transaction ID of the bootstrap.
 * @param {string} key - Bootstrap private key.
 * @param {object} encryption - Encryption parameters (aes_key, password, encrypt_title).
 * @returns {Promise<string>} UUID of the queued process.
 */
export async function runFromBootstrapTransaction(bootstrap_transaction_id, key, encryption){
    
    const uuid = randomUUID();

    enqueue(uuid, () => processRunFromBootstrapTransaction(
            
        bootstrap_transaction_id, 
        key,
        encryption,        
        uuid
    ));                           
    
    return uuid;    
}


/**
 * Internal worker: process a bootstrap transaction execution.
 * 
 * @param {object} transaction_id - Transaction ID of the bootstrap. 
 * @param {string} key - Bootstrap private key.
 * @param {object} encryption - Encryption parameters. 
 * @param {string} uuid - Process UUID.
 * @returns {Promise<object>} Blocknote save result.
 */
async function processRunFromBootstrapTransaction(
        
    transaction_id,   
    key, 
    encryption,    
    uuid            
){
    
    // Get the bootstrap transaction from the chain, retrieve the user address
    // and verify the bootstrap key.
    const bootstrap_transaction = await indexer.lookupTransactionByID(transaction_id).do();
    const user_address          = bootstrap_transaction.transaction.sender;
    const encrypted_note        = JSON.parse(Buffer.from(bootstrap_transaction.transaction.note).toString());    
    const note                  = JSON.parse(Crypto.decryptTransactionNote(encrypted_note.blocknote));   

    if(note.key !== key){
        
        throw Error("Invalid bootstrap key");
    }
    
    const from_db   = Db.get(transaction_id); 
    const content   = from_db.content ?? from_db.file;
    const options   = JSON.parse(from_db.params);
    const blocknote = new Blocknote(note.sender, {
               
        ...encryption,
        ...options,
        onProgress: (message) => {

            results[uuid] = message;
        }
    });

    const save = await blocknote.save(content);

    // Close the sender with the user as the remainderTo
    const sender            = Algosdk.mnemonicToSecretKey(note.sender);
    const suggested_params  = await Chain.getSuggestedParams();
    const close_to_user     = await Chain.buildTransaction(suggested_params, {addr:user_address}, sender, "", true, false);

    await Chain.sendTransaction(close_to_user.txn);               

    return save;
}


/**
 * Get a payload by its ID.
 * 
 * @param {string} payload_id - Payload transaction ID.
 * @param {number} revision - The optional revision.
 * @returns {Promise<string>} UUID of the queued process.
 */
export async function getPayload(payload_id, revision = null){
    
    const uuid = randomUUID();   
    
    enqueue(uuid, async () => {
  
        const reader    = new BlocknoteReader(payload_id, revision ? {revision:revision} : null);
        const payload   = await reader.getPayload();

        return payload;        
    });                           
    
    return uuid;
}


/**
 * Get payload revisions.
 * 
 * @param {string} payload_id - Payload transaction ID.
 * @returns {Promise<string>} UUID of the queued process.
 */
export async function getPayloadRevisions(payload_id){
    
    const uuid = randomUUID();   
    
    enqueue(uuid, async () => {
               
        const reader    = new BlocknoteReader(payload_id);
        const revisions = await reader.getRevisions();
        
        return revisions;
        
    });                           
    
    return uuid;    
}


/**
 * Read an uploaded file.
 * 
 * @param {string} payload_id - Payload transaction ID.
 * @param {object} options - BlocknoteReader options.
 * @returns {Promise<string>} UUID of the queued process.
 */
export async function read(payload_id, options){
    
    const uuid = randomUUID();   
    
    enqueue(uuid, async () => {
        
        const reader    = new BlocknoteReader(payload_id, options);
        const content   = await reader.read();

        return content;        
    });                           
    
    return uuid;    
}


/**
 * Get all senders who received bootstrap transactions from a funder (user_address).
 * Only works for uploads done via this Manager.
 * 
 * @param {string} user_address - User's address.
 * @returns {Promise<string>} UUID of the queued process.
 */
export async function getAllSenders(user_address){
    
    const uuid = randomUUID();   
    
    enqueue(uuid, async () => {
        
        const bootstrap_receivers = await Search.getBootstrapTransactionsReceivers(user_address);        

        return bootstrap_receivers;        
    });                           
    
    return uuid;
}


/**
 * Get the payload ID created by a sender.
 * Only works for uploads done via this Manager.
 * 
 * @param {string} sender - Sender's address.
 * @returns {Promise<string>} UUID of the queued process.
 */
export async function getPayloadIdFromSender(sender){
    
    const uuid = randomUUID();   
    
    enqueue(uuid, async () => {
        
        const payload = await Search.getPayloadIdFromSender(sender);    

        return payload;        
    });                           
    
    return uuid;
}


/**
 * Read the sender's mnemonic inside a bootstrap transaction.
 * 
 * @param {string} sender - Sender's address.
 * @param {string} receiver - Receiver's address.
 * @returns {Promise<string|null>} Sender mnemonic or null if unavailable.
 */
export async function getBootstrapSenderMnemonic(sender, receiver){
      
    const bootstrap_transaction = await Search.getBootstrapTransaction(sender, receiver);
   
    if(bootstrap_transaction){
        
        try{
            
            const encrypted_note    = JSON.parse(Buffer.from(bootstrap_transaction.note, "base64"));
            const decrypt_note      = Crypto.decryptTransactionNote(encrypted_note.blocknote);
            const note              = JSON.parse(decrypt_note.toString());
            
            return note?.sender;
        }
        catch{
            
            return null;
        }
    }    
    
    return null;
}