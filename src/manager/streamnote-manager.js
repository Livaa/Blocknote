import Chain        from "../chain/chain.js";
import {randomUUID} from 'crypto';

const algod     = Chain.getAlgod();
const indexer   = Chain.getIndexer();
const streams   = {};


// Clean the store for terminated streams
const remove_interval = setInterval(() => {deleteTerminatedStreams}, 10000);

remove_interval.unref(); // unref from the main loop event.


/**
 * Remove streams that have finished execution.
 * A stream is considered terminated when `is_over === true`.
 *
 * @returns {void}
 */
function deleteTerminatedStreams(){
    
    for (const uuid of Object.keys(streams)) {

        if (streams[uuid]?.is_over) {

           delete streams[uuid];
        }
    }
}


/**
* Store a Streamnote instance and return its UUID.
* 
* @param {Streamnote} The streamnote instance to put in streams.
* @returns {string} The UUID of the streamsd instance.
*/
export function store(streamnote_instance) {
   
    const uuid      = randomUUID();
    streams[uuid]   = streamnote_instance;

    return uuid;
}


/**
 * Get a stored Streamnote instance by UUID.
 *
 * @param {string} uuid - Stream UUID.
 * @returns {Streamnote|null} The Streamnote instance, or null if not found.
 */
export function get(uuid) {
       
    return streams[uuid] ?? null;
}


/**
 * Send data to a stream.
 *
 * @param {string} uuid - Stream UUID.
 * @param {*} data - Data to send to the stream.
 * @returns {void}
 */
export function send(uuid, data){
    
    streams[uuid].send(data);
}


/**
 * Stop a running stream.
 *
 * @param {string} uuid - Stream UUID.
 * @returns {void}
 */
export function stop(uuid, data){
    
    streams[uuid].stop();
}


/**
 * Returns the payload transaction id.
 *
 * @param {string} uuid - Stream UUID.
 * @returns {Promise<string>} Payload transaction ID.
 */
export async function getPayloadTransactionId(uuid){
    
    const instance = streams[uuid];

    while (true) {
        
        const payload_id = instance?.result?.payload_transaction;

        if(payload_id){
            
            return payload_id;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }
}


/**
 * List all active streams with their payload transaction ID and payload.
 *
 * @returns {Promise<Object.<string, {payload_transaction_id: string, payload: object}>>}
 */
export async function list(){
    
    const res = {};
    
    for(const uuid in streams){
        
        res[uuid] = {payload_transaction_id: await getPayloadTransactionId(uuid), payload:streams[uuid].payload};
    }
    
    return res;
}




