import  {Blocknote} from  "blocknote"
import fs           from 'fs';

const sender_mnemonic   = process.env.SENDER;
const data              = fs.readFileSync("./flying-bro.jpg");

const blocknote = new Blocknote(sender_mnemonic, {   
    
    mime:       "image/jpeg",
    title:      "Flying Bro",
    onProgress: (status) => {
        
        console.log(status);
    }
});

console.log("Start saving onchain");

blocknote.save(data).then((result) => {
    
    console.log(`The data was saved`);
    console.log(`Payload id:${result.payload_transaction_id}`);
});