import  {Blocknote, BlocknoteReader} from  "blocknote"

const sender_mnemonic   = process.env.SENDER;


// Save data onchain
const save = async (sender_mnemonic, data, options) => {
        
    console.log("--------------------------------------");
    
    options.onProgress = (status) => {
        
        console.log(status);
    };
    
    const blocknote = new Blocknote(sender_mnemonic, options);    
    const save      = await blocknote.save(data);

    console.log("done");
    console.log("");
    
    return save.payload_transaction_id;
};


// Read data from chain
const read = async (payload_transaction_id, options) => {
    
    const reader    = new BlocknoteReader(payload_transaction_id, options);    
    const read      = await reader.read();
    const data      = read.content.toString();
    
    return data;
};


const wait = async (delay) => {
    
    return new Promise(resolve => setTimeout(resolve, delay));    
};


(async ()=>{
    
    
    console.log("Start saving onchain (revision 1)");
    
    const payload_transaction_id = await save(sender_mnemonic, "I am a horse 🐴", {

        title:  "Horse", 
        mime:   "text/plain"
    });       

    console.log("Updating data onchain (revision 2)");
    
    await save(sender_mnemonic, "I am a rabbit 🐇", {

        title:          "Rabbit", 
        mime:           "text/plain",
        revision_of:    payload_transaction_id
    });
    
    console.log("Updating data onchain (revision 3)");
    
    await save(sender_mnemonic, "I am a banana 🍌", {

        title:          "Banana", 
        mime:           "text/plain",
        revision_of:    payload_transaction_id
    }); 

    console.log("Updating data onchain (revision 4)");
    
    await save(sender_mnemonic, "I am a princess 👸", {

        title:          "Princess", 
        mime:           "text/plain",
        revision_of:    payload_transaction_id
    }); 
        
    console.log("Updating data onchain (revision 5)");
    
    await save(sender_mnemonic, "I am just a robot 😔", {

        title:          "Robot", 
        mime:           "text/plain",
        revision_of:    payload_transaction_id
    }); 
        
    
    // Read the revisions        
    const reader    = new BlocknoteReader(payload_transaction_id);
    const revisions = await reader.getRevisions();    
    let data        = await read(payload_transaction_id);
    
    console.log(`They are ${revisions} revisions. Last revision content: ${data}`);
        
    for(let x = 1; x <= revisions; x++){
        
        let data = await read(payload_transaction_id, {revision:x});
    
        console.log(`revision ${x}: ${data}`);
        
        await wait(2000);
    }
    
})();