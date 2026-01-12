import * as pako from "pako";


let compression_params = null;


export function name(){
    
    return "pako";
}


export function setParams(params){
        
    compression_params = params;
}


export async function compress(input) {
  
    const level  = compression_params?.compression_level ?? 9;
  
    return Promise.resolve().then(() =>
    
        pako.deflate(input, {level: level })
    );
}


export function uncompress(compressed_input) {
    
    return Promise.resolve().then(() =>
  
        Buffer.from(pako.inflate(compressed_input))
    );
}
