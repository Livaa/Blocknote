import { compress as zstdCompress, decompress as zstdDecompress, init} from "@bokuweb/zstd-wasm";


let compression_params = null;


export function name() {
    
    return "zstd";
}


export function setParams(params) {
    
  compression_params = params;
}


/**
 * Compresses input using Zstandard.
 * @param {Buffer|Uint8Array} input
 * @returns {Promise<Uint8Array>}
 */
export async function compress(input) {
    
    await init();

    const buffer      = Buffer.from(input);
    const level       = compression_params?.compression_level || 22; 
    const compressed  = await zstdCompress(buffer, level);

    return compressed;
}


/**
 * Decompresses Zstandard-compressed input.
 * @param {Buffer|Uint8Array} compressed_input
 * @returns {Promise<Uint8Array>}
 */
export async function uncompress(compressed_input) {
    
    await init();
   
    return await zstdDecompress(compressed_input);
}