import * as lzma from "lzma";


let compression_params = null;


export function name(){
    
    return "lzma";
}


export function setParams(params){
        
    compression_params = params;
}


export function compress(input) {
  
    const level  = compression_params?.compression_level ?? 9;
  
    return new Promise((resolve, reject) => {
      
        lzma.compress(input, level, (result, error) => {

            if (error) 
                return reject(error);

            resolve(result);
        });
    });   
}


export function uncompress(compressed_input) {
    
    return new Promise((resolve, reject) => {
      
        lzma.decompress(compressed_input, (result, error) => {
            
            if (error) 
                return reject(error);
            
            resolve(result);
        });
    });
}
