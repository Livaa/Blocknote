import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);


let compression_params = null;


export function name(){
    
    return "gzip";
}


export function setParams(params){
        
    compression_params = params;
}


export async function compress(input) {
  
    const buffer    = Buffer.from(input);
    const level     = compression_params?.compression_level ?? 9;
    const compress  = await gzipAsync(buffer, {level: level});    
    
    return new Uint8Array(compress);
}


export function uncompress(compressed_input) {
        
    return gunzipAsync(compressed_input);
}
