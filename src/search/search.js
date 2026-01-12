
import * as Algosdk from "algosdk";
import * as Crypto  from "../crypto/crypto.js";

const indexer = new Algosdk.Indexer(process.env.INDEXER_TOKEN, process.env.INDEXER_URL, process.env.INDEXER_PORT);


/**
* Fetches all payment transactions where the given address is the receiver.
* Paginates through indexer results until no `next_token` remains.
* 
* @param {string} sender - Sender's account address.
* @param {string} receiver - Receiver's account address.
* @param {string} payload_transaction_id - The payload transaction ID to exclude from results.
* @returns {Promise<object[]>} Array of Algorand transaction objects.
*/
export async function getAllReceivedTransactions(sender, receiver, payload_transaction_id) {

    let res = [];
    let next_token = null;

    do{
        const query = await indexer
                    .searchForTransactions()
                    .address(receiver)                              
                    .addressRole("receiver")
                    .txType("pay")
                    .limit(1000)
                    .nextToken(next_token)
                    .do();           

        const filtered = query.transactions.filter(

            // The last txn is sent by the receiver to itself to close its account.
            txn => (txn.sender === sender || txn.sender === receiver) 
                   //&& !txn.rekeyTo
                   && txn.id !== payload_transaction_id
        );

        res.push(...filtered);

        next_token = query?.nextToken;

        if(next_token){

            await new Promise(r => setTimeout(r, 200)); // pause to avoid rate limit
        }
    } 
    while (next_token);

    return res.reverse();
}
    

/**
* Get the last transaction received from a sender to a receiver (excluding payload).
* 
* @param {string} sender - Sender's account address.
* @param {string} receiver - Receiver's account address.
* @param {string} payload_transaction_id - The payload transaction ID to exclude.
* @returns {Promise<object|null>} The last transaction or null if none.
*/
export async function getLastReceivedTransaction(sender, receiver, payload_transaction_id){
        
    let res         = null;
    let next_token  = null;

    do{
        const query = await indexer
            .searchForTransactions()                        
            .address(receiver)
            .addressRole("receiver")
            .txType("pay")
            .limit(1000)
            .nextToken(next_token)
            .do();                                                         

        const filtered = query.transactions.filter(

            txn => txn.sender === sender && txn.id !== payload_transaction_id
        );

        if(filtered[0]){

            res = filtered[0];

            break;
        }

        next_token = query?.nextToken;

        if(next_token){

            await new Promise(r => setTimeout(r, 200)); // pause to avoid rate limit
        }
    } 
    while (next_token);

    return res;
}


/**
* Retrieves all revisions associated with a payload transaction.
* 
* @param {string} payload_id - The payload transaction ID.
* @returns {Promise<string[]>} Array of revision IDs, latest first.
*/
export async function getRevisionsPayloads(payload_id){

    let res         = null;
    let next_token  = null;
    let counter     = 0;
    let stop        = false;
    const revisions = [];
    
    const payload_transaction   = await indexer.lookupTransactionByID(payload_id).do();
    const sender                = payload_transaction.transaction.sender;
    const receiver              = payload_transaction.transaction.paymentTransaction.receiver;
    
    do{
        const query = await indexer
                    .searchForTransactions()
                    .address(receiver)                              
                    .addressRole("receiver")
                    .txType("pay")
                    .limit(1000)
                    .nextToken(next_token)
                    .do();           

        for(const transaction of query.transactions){

            const revision_id  = transaction.sender === sender ? this.getRevisionPayloadTransactionId(transaction) : null;     

            if(revision_id){

                revisions.push(revision_id);
            }           
        }
       
        next_token = query?.nextToken;

        if(next_token){

            await new Promise(r => setTimeout(r, 200)); // pause to avoid rate limit
        }
    } 
    while (next_token);

    revisions.push(payload_id);
    
    revisions.reverse();

    return revisions;
}


/**
* Extracts the revision ID from a transaction note.
* 
* @param {object} transaction - Algorand transaction object.
* @returns {string|null} Revision ID if valid, otherwise null.
*/
export function getRevisionPayloadTransactionId(transaction){
   
    let res = null;
    
    if(transaction.note){
   
        const transaction_note  = Buffer.from(transaction.note, "base64");

        try{

            /*
            * Ensure the JSON is a valid revision object, preventing conflicts 
            * with arbitrary data a user might include. 
            * For example, if the user submits:
            * { something:true, some_other_thing:false, hello:123, revision:3894 }
            * it will not be mistaken for a valid revision.
            */            
            const note      = JSON.parse(transaction_note);  
            const is_valid  = note?.revision 
                                && note.revision.length === 52
                                && Object.entries(note).length === 1 // 0 ["revision", "KDJD89..."]
                                && Object.entries(note)[0].length === 2;   

            res = is_valid ? note.revision : null;
        }
        catch(e){ /* JSON.parse failed */}
    }
    
    return res;
}
    

/**
* Fetches all transactions from a sender to a receiver starting from a given round.
* 
* @param {string} sender - Sender's account address.
* @param {string} receiver - Receiver's account address.
* @param {bigint|null} [min_round=null] - Optional minimum round to start fetching from.
* @returns {Promise<object[]>} Array of Algorand transaction objects.
*/
export async function getAllStreamedTransactions(sender, receiver, min_round = null) {

    let res = [];
    let next_token = null;

    do{
        const query = indexer
            .searchForTransactions()                        
            .address(receiver)
            .addressRole("receiver")
            .txType("pay")
            .limit(1000)
            .nextToken(next_token);                                 

        if(min_round){

            query.minRound(min_round);
        }

        const process_query = await query.do();       
        const filtered      = process_query.transactions.filter(

            txn => txn.sender === sender && txn.id !== this.payload_transaction_id
        );

        res.push(...filtered);

        next_token = process_query?.nextToken;

        if(next_token){

            await new Promise(r => setTimeout(r, 200)); // pause to avoid rate limit
        }
    } 
    while (next_token);

    return res;
}


/**
* Checks if the stream has ended by looking for a "stop" transaction from the receiver.
* 
* @param {string} receiver - Receiver's account address.
* @returns {Promise<boolean>} True if stream ended, otherwise false.
*/
export async function isStreamOver(receiver) {
        
    let res         = false;
    let next_token  = null;

    do{
        const query = await indexer
            .searchForTransactions()                        
            .address(receiver)
            .addressRole("receiver")
            .txType("pay")
            .limit(1000)
            .nextToken(next_token)
            .do();                                                         

        const filtered = query.transactions.filter(

            transaction =>  transaction.sender === receiver 
                            && Buffer.from(transaction.note, "base64") === "stop"
        );

        if(filtered[0]){

            res = true;

            break;
        }

        next_token = query?.nextToken;

        if(next_token){

            await new Promise(r => setTimeout(r, 200));
        }
    } 
    while (next_token);

    return res;
} 


/**
* Retrieves the last bootstrap transaction from a user to a receiver.
* 
* @param {string} user_address - Sender account address.
* @param {string} receiver - Receiver account address.
* @returns {Promise<object|null>} The last transaction if exists, otherwise null.
*/
export async function getBootstrapTransaction(user_address, receiver){
        
    let res         = [];
    let next_token  = null;

    do{
        const query = await indexer
            .searchForTransactions()                        
            .address(receiver)
            .addressRole("receiver")
            .txType("pay")
            .limit(1000)
            .nextToken(next_token)
            .do();                                                         

        const filtered = query.transactions.filter(

            txn => txn.sender === user_address
        );

        res.push(...filtered);

        next_token = query?.nextToken;

        if(next_token){

            await new Promise(r => setTimeout(r, 200)); // pause to avoid rate limit
        }
    } 
    while (next_token);

    return res.length > 0 ? res.reverse()[0] : null;
}


/**
* Retrieves all receivers of a bootstrap transaction initiated by a user.
* 
* @param {string} user_address - Sender account address.
* @returns {Promise<string[]>} Array of unique receiver addresses.
*/
export async function getBootstrapTransactionsReceivers(user_address){
         
    let receivers       = [];
    let next_token      = null;
    const pattern       = `{"app":"${process.env.APP_NAME}","blocknote":`;
    const note_prefix   = Buffer.from(pattern).toString("base64"); //eyJibG9ja25vdGUiOg=='; // base64 of: {"blocknote":        

    do{

        const response = await indexer
            .searchForTransactions()
            .address(user_address)
            .addressRole('sender')
            .notePrefix(Uint8Array.from(atob(note_prefix), c => c.charCodeAt(0)))
            .limit(1000)
            .nextToken(next_token)
            .do();
        
        // Try to decrypt the note with the current process.env.AES_PRIVATE_KEY
        // If it fails, it means this bootstrap transaction belongs to a different app 
        // with the same APP_NAME but not the same AES_PRIVATE_KEY.
        for(const transaction of response.transactions){
            
            try{
                
                const bootstrap_note    = JSON.parse(Buffer.from(transaction.note, "base64").toString());
                const decrypt_note      = Crypto.decryptTransactionNote(bootstrap_note.blocknote);
                const note              = JSON.parse(decrypt_note.toString());
                
                receivers.push(transaction.paymentTransaction.receiver);
            }
            catch{}                        
        }               
        
        next_token = response?.nextToken;
        
        if(next_token){

            await new Promise(r => setTimeout(r, 200)); 
        }
    }
    while (next_token);

    // Needs to be unified as a same sender can receive multiple
    // boostrap transactions because of revisions.
    const unique_receivers = new Set(receivers);
    
    return [...unique_receivers];
} 


/**
* Retrieves the initial payload transaction sent by a sender.
* 
* @param {string} sender - Sender account address.
* @returns {Promise<string|null>} Payload transaction ID or null if none.
*/
export async function getPayloadIdFromSender(sender) {

    let transactions    = [];
    let next_token      = null;
    let res             = null;

    // Retrieve all the transactions sent by the account
    do{
        const query = await indexer
                    .searchForTransactions()
                    .address(sender)                              
                    .addressRole("sender")
                    .txType("pay")
                    .limit(1000)
                    .nextToken(next_token)
                    .do();                  

        transactions.push(...query.transactions);

        next_token = query?.nextToken;
       
        if(next_token){

            await new Promise(r => setTimeout(r, 200)); // pause to avoid rate limit
        }
    } 
    while (next_token);
    
    if(transactions.length > 0){
        
        transactions.reverse();
        
        res = transactions[0]?.id;          
    }
    
    return res;
}
        