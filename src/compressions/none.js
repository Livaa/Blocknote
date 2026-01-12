let compression_params = null;


export function name(){
    
    return "none";
}


export function setParams(params){
        
    compression_params = params;
}


// Doesn't compress but convert the input to Uint8Array
export async function compress(input) {
  
    let res = input;

    if(input instanceof ArrayBuffer) {
        
        res = new Uint8Array(input);        
    }
    else{
               
        res = new TextEncoder().encode(input.toString());           
    }

    return res;
}


export async function uncompress(compressed_input) {        
    
    return compressed_input;
}
