import {brotliCompress, brotliDecompress, constants} from 'node:zlib';
import { promisify } from 'node:util';

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

let compression_params = null;


export function name(){
    
    return "brotli";
}


export function setParams(params){
        
    compression_params = params;
}


export async function compress(input) {
  
    const buffer    = Buffer.from(input);
    const level     = compression_params?.compression_level ?? 11;
    const compress  = await brotliCompressAsync(buffer,{ params: { [constants.BROTLI_PARAM_QUALITY]: level } });
    
    return new Uint8Array(compress);
}


export async function uncompress(compressed_input) {

    return await brotliDecompressAsync(compressed_input);
}
