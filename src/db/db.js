let db          = null;
let Database    = null;


/**
 * Initializes the database using Bun's SQLite driver when available,
 * otherwise falls back to better-sqlite3.
 *
 * This runs at module load using top-level await
 * so consumers can directly call exported functions safely afterward.
 */
if (typeof Bun !== "undefined") {

    ({ Database } = await import("bun:sqlite"));
} 
else{

    Database= (await import("better-sqlite3")).default;
}


function initDB(){
    
    if(!db){
        
        db = new Database(process.env.SQLITE_DATABASE_PATH + 'transactions.db');
        
        db.prepare(`
    
            CREATE TABLE IF NOT EXISTS uploads (

                txid        TEXT PRIMARY KEY,            
                content     TEXT,
                file        BLOB,
                params      TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    
        db.prepare(`

            DELETE FROM uploads
            WHERE created_at < datetime('now', '-24 hours');

        `).run();
    }
    
    return db;
}


/**
 * Saves an upload record into the database.
 *
 * Uses `INSERT OR REPLACE` to allow overwriting existing records by `txid`.
 * The `content` only accept text.
 * The `file` field accepts binary data (Buffer, Uint8Array, etc).
 *
 * @param {string} transaction_id
 * @param {string} content
 * @param {Buffer|Uint8Array|ArrayBuffer|null} file
 * @param {string|null} params
 * @returns {void}
 */
export function save(transaction_id, content, file, params){

    const db        = initDB();    
    const insert    = db.prepare(`
    
        INSERT OR REPLACE INTO uploads (txid, content, file, params)
        VALUES (?, ?, ?, ?)
    `);

    insert.run(transaction_id, content, file, params);    
}


/**
 * Fetches a single upload record by transaction id.
 *
 * @param {string} transaction_id
 * @returns {object|undefined} the matching row, or `undefined` if not found.
 */
export function get(transaction_id){

    const db        = initDB();    
    const select    = db.prepare(`
    
        SELECT * FROM uploads WHERE txid = ?
    `);

    return select.get(transaction_id);
}


/**
 * Fetches all upload records from the database.
 *
 * @returns {object[]} array of rows, empty if none exist.
 */
export function getAll(){

    const db        = initDB();    
    const select    = db.prepare(`
    
        SELECT * FROM uploads        
    `);

    return select.all();
}