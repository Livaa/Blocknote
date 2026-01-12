import * as lz4 from "lz4-napi";


let compression_params = null;


export function name(){
    
    return "lz4";
}


export function setParams(params){
        
    compression_params = params;
}


export async function compress(input) {
  
    const buffer    = Buffer.from(input);    
    const compress  = await lz4.compress(buffer);   
    
    return new Uint8Array(compress);
}


export async function uncompress(compressed_input) {
    
    return await lz4.uncompress(compressed_input);
}
