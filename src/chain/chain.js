import algosdk                              from 'algosdk';
import {fromSeed, KeyContext, XHDWalletAPI} from '@algorandfoundation/xhd-wallet-api';

const algod     = new algosdk.Algodv2(process.env.ALGOD_TOKEN, process.env.ALGOD_URL, process.env.ALGOD_PORT);
const indexer   = new algosdk.Indexer(process.env.INDEXER_TOKEN, process.env.INDEXER_URL, process.env.INDEXER_PORT);


/**
 * Returns the algod instance.
 * 
 * @returns {algosdk.Algodv2}
 */
export function getAlgod(){
    
    return algod;
}


/**
 * Returns the indexer instance.
 * 
 * @returns {algosdk.Indexer}
 */
export function getIndexer(){
    
    return indexer;
}


/**
 * Alias for `algosdk.generateAccount()`.
 * Generate a new Algorand account.
 *
 * @returns {Object} An object containing `addr` and `sk`.
 */
export function createAddress() {

    return algosdk.generateAccount();
}


/**
 * Alias for `algosdk.mnemonicToSecretKey()`.
 * Convert a mnemonic to an Algorand account.
 *
 * @param {string} mnemonic - The 25-word mnemonic phrase.
 * @returns {Object} An object containing `addr` and `sk`.
 */
export function getAddressFromMnemonic(mnemonic){

    return algosdk.mnemonicToSecretKey(mnemonic);
}


/**
 * Alias for `algosdk.secretKeyToMnemonic()`.
 * Convert a secret key to a mnemonic.
 *
 * @param {Uint8Array} secret_key - The account secret key.
 * @returns {string} The mnemonic derived from the secret key.
 */
export function secretKeyToMnemonic(secret_key){

    return algosdk.secretKeyToMnemonic(secret_key);
}


/**
 * Encode an Algorand address.
 *
 * @param {string|Uint8Array} address - The address to encode.
 * @returns {string} Encoded Algorand address.
 */
export function encodeAddress(address){

    return algosdk.encodeAddress(address);
}


/**
 * Convert ALGO to microAlgos.
 *
 * @param {number} algos - Amount in ALGO.
 * @returns {number} Amount in microAlgos.
 */
export function toMicroalgos(algos){

    return algosdk.algosToMicroalgos(algos);
}


/**
 * Fetch suggested transaction parameters from the Algorand network.
 *
 * @returns {Promise<Object>} Suggested params (fee, firstRound, lastRound, genesisID, etc.).
 */
export function getSuggestedParams(){

    return algod.getTransactionParams().do();
}


/**
 * Convert bytes to a base64 string.
 *
 * @param {Uint8Array} bytes - Input bytes.
 * @returns {string} Base64-encoded string.
 */
export function bytesToBase64(bytes){
    
    return algosdk.bytesToBase64(bytes);
}


/**
 * Get the current algod node status.
 *
 * @returns {Promise<Object>} Algod node status.
 */
export async function getStatus(){

    return await algod.status().do();
}


/**
 * Encode an unsigned transaction.
 *
 * @param {Object} unsigned_transaction - Algorand unsigned transaction.
 * @returns {Uint8Array} Encoded transaction bytes.
 */
export function encodeUnsignedTransaction(unsigned_transaction){
    
    return algosdk.encodeUnsignedTransaction(unsigned_transaction);
}


/**
 * Decode a signed transaction.
 *
 * @param {Uint8Array} signed_transaction - Signed transaction bytes.
 * @returns {Object} Decoded transaction object.
 */
export function decodeSignedTransaction(signed_transaction){

    return algosdk.decodeSignedTransaction(signed_transaction);
}


/**
 * Lookup a transaction by its ID using the indexer.
 *
 * @param {string} transaction_id - The transaction ID.
 * @returns {Promise<Object>} Transaction details or null if not found.
 */
export async function getTransactionById(transaction_id){

    const res = await indexer.lookupTransactionByID(transaction_id).do();
  
    return res?.transaction ?? null;
}


/**
 * Build a bootstrap payment transaction with a JSON note.
 *
 * @param {Object} suggestedParams - Algorand suggested parameters.
 * @param {string} user_address - Sender address.
 * @param {string} sender_address - Receiver address.
 * @param {number} amount - Amount in microAlgos.
 * @param {Object} note - JSON-serializable note payload.
 * @returns {Object} Unsigned transaction.
 */
export function buildBootstrapTransaction(suggestedParams, user_address, sender_address, amount, note){
    
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            
        sender:     user_address,
        receiver:   sender_address, 
        amount:     amount,           
        note:       new Uint8Array(Buffer.from(JSON.stringify(note))),
        suggestedParams
    });
    
    return txn;
}


/**
 * Build and sign a payment transaction with a JSON payload in the note field.
 *
 * @param {Object} suggestedParams - Algorand suggested parameters.
 * @param {Object} sender - { addr, sk } sender account.
 * @param {Object} receiver - { addr } receiver account.
 * @param {Object} payload - JSON-serializable payload.
 * @returns {{txn: Uint8Array, id: string}} Signed transaction and ID.
 */
export function buildPayloadTransaction(suggestedParams, sender, receiver, payload){
    
    const json_payload = JSON.stringify(payload);
    
    if(json_payload.length > 1024){
            
        throw Error("The payload is too large");
    }
    
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({

        sender:     sender.addr,
        receiver:   receiver.addr,                     
        amount:     algosdk.algosToMicroalgos(0.1),
        note:       new Uint8Array(Buffer.from(json_payload)),
        suggestedParams            
    });

    return {txn:txn.signTxn(sender.sk), id:txn.txID()};
}


/**
 * Build and sign a transaction containing a revision tag in the note field.
 *
 * @param {Object} suggestedParams - Algorand suggested parameters.
 * @param {Object} sender - { addr, sk } object of sender.
 * @param {Object} receiver - { addr, sk } object of receiver.
 * @param {string} revision_tag - String to put in note field.
 * @returns {Object} Signed transaction blob and transaction ID.
 */
export function buildRevisionTagTransaction(suggestedParams, sender, receiver, revision_tag){

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({

        sender:     sender.addr,
        receiver:   receiver.addr,                     
        amount:     algosdk.algosToMicroalgos(0.1),
        note:       new Uint8Array(Buffer.from(revision_tag)),
        suggestedParams            
    });

    return {txn:txn.signTxn(sender.sk), id:txn.txID()};
}


/**
 * Build and sign a transaction that closes the receiver account and sends remaining balance to the sender.
 *
 * @param {Object} suggestedParams - Algorand suggested parameters.
 * @param {Object} remainder - Account to receive remaining balance.
 * @param {Object} closing_account - Account to be closed (must sign).
 * @returns {Object} Signed transaction blob and transaction ID.
 */
export function buildCloseRevisionReceiverTransaction(suggestedParams, remainder, closing_account){

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({

        sender:             closing_account.addr,
        receiver:           closing_account.addr, 
        closeRemainderTo:   remainder.addr,
        amount:             0,               
        suggestedParams            
    });  

    return {txn:txn.signTxn(closing_account.sk), id:txn.txID()};
}


/**
 * Build a generic payment transaction.
 *
 * @param {Object} suggestedParams - Algorand suggested parameters.
 * @param {Object} sender - { addr, sk } sender account.
 * @param {Object} receiver - { addr, sk } receiver account.
 * @param {string} [note=""] - Optional note field.
 * @param {boolean} is_last_chunk - Whether this transaction closes the receiver account.
 * @returns {{txn: Uint8Array, id: string}} Signed transaction and ID.
 */
export function buildTransaction(suggestedParams, sender, receiver, note = "", is_last_chunk){

    const signed_txn  = makePaymentTransaction(

        sender,
        receiver,
        note,
        suggestedParams,           
        0,
        is_last_chunk
    );

    return signed_txn;
}


/**
 * Build and sign a payment transaction.
 *
 * @param {Object} sender - { addr, sk } sender account.
 * @param {Object} receiver - { addr, sk } receiver account.
 * @param {string} note - Note field content.
 * @param {Object} suggestedParams - Algorand suggested parameters.
 * @param {number} amount - Amount in microAlgos.
 * @param {boolean} close_to_remainder - Whether to close the receiver account and send remaining funds to sender.
 * @returns {{txn: Uint8Array, id: string}} Signed transaction and ID.
 */
export function makePaymentTransaction(sender, receiver, note, suggestedParams, amount, close_to_remainder){

    let res = null;

    if(close_to_remainder){

        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({

            sender:             receiver.addr,
            receiver:           receiver.addr, 
            closeRemainderTo:   sender.addr,
            amount:             amount,
            note:               new Uint8Array(Buffer.from(note)),
            suggestedParams            
        });                               

        res = {txn:txn.signTxn(receiver.sk), id:txn.txID()};
    }
    else{

        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({

            sender:     sender.addr,
            receiver:   receiver.addr,                     
            amount:     amount,
            note:       new Uint8Array(Buffer.from(note)),
            suggestedParams            
        });

        res = {txn:txn.signTxn(sender.sk), id:txn.txID()};
    }

    return res;
}            


/**
 * Send a signed transaction and wait for confirmation.
 *
 * @param {Uint8Array} signed_txn - Signed transaction bytes.
 * @returns {Promise<
 *   { signed_txn: Uint8Array, result: "executed" } |
 *   { signed_txn: Uint8Array, error: Error }
 * >}
 */
export async function sendTransaction(signed_txn){

    try{

        const send      = await algod.sendRawTransaction(signed_txn).do();
        const result    = await waitForConfirmation(signed_txn);     

        if( result !== "executed" ){

            throw Error(result);
        }

        return {signed_txn:signed_txn, result:result};
    }
    catch(e){

        return {signed_txn:signed_txn, error:e};
    }
}


/**
 * Wait for a transaction to be confirmed or rejected.
 *
 * @param {Uint8Array} signed_transaction - Signed transaction bytes.
 * @returns {Promise<string>} "executed", pool error, or "transaction expired".
 */
export async function waitForConfirmation(signed_transaction) {

    const decoded       = algosdk.decodeSignedTransaction(signed_transaction);
    const tx_id         = decoded.txn.txID();
    let current_round   = (await algod.status().do()).lastRound; 
    const last_valid    = decoded.txn.lastValid;

    while (current_round <= last_valid) {

        const pendingInfo = await algod.pendingTransactionInformation(tx_id).do();

        if (pendingInfo.confirmedRound) {

            return "executed";
        }

        if (pendingInfo.poolError !== "") {

            return pendingInfo.poolError;
        }

        current_round++;

        await algod.statusAfterBlock(current_round).do();  
    }

    return "transaction expired";  
}                     


/**
 * Generate a random HD account from a private key.
 *
 * @param {Uint8Array} private_key - Private key bytes.
 * @returns {Promise<Object>} HD account with mnemonic, account_index, and address_index.
 */
export function getRandomHDAccount(private_key){
        
    const max_int           = 2147483647;
    const account_index     = Math.floor(Math.random() * (max_int + 1));
    const address_index     = Math.floor(Math.random() * (max_int + 1));        
    
    return getHDAccount(private_key, account_index, address_index);
}


/**
 * Derive an HD account using a private key and specific indexes.
 *
 * @param {Uint8Array} private_key - Private key bytes.
 * @param {number} account_index - HD account index.
 * @param {number} address_index - HD address index.
 * @returns {Promise<Object>} HD account with mnemonic, account_index, and address_index.
 */
export async function getHDAccount(private_key, account_index, address_index){
    
    const service       = new XHDWalletAPI();  
    const mnemonic      = algosdk.secretKeyToMnemonic(private_key);
    const master_key    = algosdk.mnemonicToMasterDerivationKey(mnemonic); // 32-byte root
    const root_key      = fromSeed(master_key);      
    const hd_key        = await service.keyGen(root_key, KeyContext.Address, account_index, address_index);
    const hd_mnemonic   = algosdk.secretKeyToMnemonic(hd_key);
    
    return {mnemonic: hd_mnemonic, account_index, address_index};
}