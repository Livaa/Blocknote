import  {Blocknote} from  "blocknote"

const sender_mnemonic   = process.env.SENDER;
const data              = JSON.stringify({
    
    "details": {
        
        "currency": "dollars",
        "decimals": 2,
        "shop": "NY-2",
        "total": 597843.38
    },
    "january": 39485.54,
    "february": 49584.33,
    "march": 37495.92,
    "april": 39854.07,
    "may": 58334.36,
    "june": 39847.12,
    "july": 49104.24,
    "august": 23849.85,
    "september": 61028.72,
    "october": 53284.12,
    "november": 48647.87,
    "december": 84327.34
});

const blocknote = new Blocknote(sender_mnemonic, {   
    
    mime:           "application/json",
    title:          "Sales report 2025 / NY-2",
    aes_key:        "baa3f9c42e7b1d8a6f4e92c0d7b5a8f1c3e6d4b29a0f7c81e5d93b6a4c2e8f90",
    encrypt_title:  false
});

console.log("Start saving onchain");

blocknote.save(data).then((result) => {
    
    console.log(`The data was saved`);
    console.log(`Payload id:${result.payload_transaction_id}`);
});