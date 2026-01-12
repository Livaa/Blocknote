import * as lzstring from "lz-string";


let compression_params = null;


export function name(){
    
    return "lz-string";
}


export function setParams(params){
        
    compression_params = params;
}


export async function compress(input) {
    
    return Promise.resolve().then(() => lzstring.default.compressToUint8Array(input));    
}


export async function uncompress(compressed_input) {
    
    const uncompress = await Promise.resolve().then(() => lzstring.default.decompressFromUint8Array(compressed_input));    
    
    return Buffer.from(uncompress, "utf-8");
}
