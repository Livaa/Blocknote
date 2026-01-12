import * as Snappy from "snappy";


let compression_params = null;


export function name(){
    
    return "snappy";
}


export function setParams(params){
        
    compression_params = params;
}


export async function compress(input) {
  
    const buffer    = Buffer.from(input);    
    const compress  = await Snappy.compress(buffer);   
    
    return new Uint8Array(compress);
}


export async function uncompress(compressed_input) {
    
    return Snappy.uncompress(compressed_input);
}