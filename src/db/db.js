let db = null;

/**
 * Initializes the database using Bun's SQLite driver when available,
 * otherwise falls back to better-sqlite3.
 *
 * This runs at module load using top-level await
 * so consumers can directly call exported functions safely afterward.
 */
if (typeof Bun !== "undefined") {

  const { Database }    = await import("bun:sqlite");
  db                    = new Database(process.env.SQLITE_DATABASE_PATH + 'transactions.db');
} 
else{

  const Database    = (await import("better-sqlite3")).default;
  db                = new Database(process.env.SQLITE_DATABASE_PATH + 'transactions.db');
}


/**
 * Ensures the `uploads` table exists and delete entries older than 24h.
 *
 * This function must be called once before saving or fetching uploads.
 * It creates the table if it does not exist.
 *
 * @returns {void}
 */
export function connect(){

    db.prepare(`
    
        CREATE TABLE IF NOT EXISTS uploads (
                
            txid        TEXT,            
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

    const insert = db.prepare(`
    
        INSERT OR REPLACE INTO uploads (txid, content, file, params)
        VALUES (?, ?, ?, ?)
    `);

    try {
        
        insert.run(transaction_id, content, file, params);
    } 
    catch (err) {
        
        throw err;
    }
}


/**
 * Fetches a single upload record by transaction id.
 *
 * @param {string} transaction_id
 * @returns {object|undefined} the matching row, or `undefined` if not found.
 */
export function get(transaction_id){

    const select = db.prepare(`
    
        SELECT * FROM uploads
        WHERE txid = ?
    `);

    try {
        
        return select.get(transaction_id);
    } 
    catch (err) {
        
        throw err;
    }
}


/**
 * Fetches all upload records from the database.
 *
 * @returns {object[]} array of rows, empty if none exist.
 */
export function getAll(){

    const select = db.prepare(`
        SELECT * FROM uploads        
    `);

    
    try {
        
        return select.all(); // returns row or undefined
    } 
    catch (err) {
        
        throw err;
    }
}

