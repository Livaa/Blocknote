/**
 * Dynamic import of a compression module by name.
 *
 * @param {string} name - Name of the compression algorithm (e.g., "brotli", "snappy" ...)
 * @returns {Promise<Module>} The imported compression module.
 */
export function getCompression(name) {

    return import("./"+name+".js");
}


/**
 * Compare multiple compression algorithms on the same input.
 *
 * Skips "lz-string" if the input is not a string.
 * Note: "lzma" and "zstd" were removed due to performance/memory issues.
 *
 * @async
 * @param {string|Buffer|Uint8Array} content - The data to compress.
 * @returns {Promise<Array<{name: string, duration: number, size: number}>>} 
 *          Array of results containing the algorithm name, duration in ms, and compressed size.
 */
export async function compareCompressions(content){
    
    // Note: 
    // -> Lzma was removed because it does hang async process.
    // -> "zstd" was removed because it creates out of memory issues.   
    const compressions   = ["brotli", "gzip", "lz4", "lz-string", "pako", "snappy"];
    const results       = [];
    
    for(const name of compressions){
               
        // lz-string only supports string input.
        // Since the content might be a Buffer or Uint8Array, 
        // we skip compression with lz-string if is not a string.
        if(typeof content !== "string" && name === "lz-string"){
            
            continue;
        }
        
        const compression           = await getCompression(name);     
        const start                 = Date.now();
        const compressed_content    = await compression.compress(content); 
        const end                   = Date.now();
        
        results.push({name:name, duration:end-start, size:compressed_content.length});
    }

    return results;
}

      

