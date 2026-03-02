# Blocknote

**Blocknote** is an open, lightweight protocol for storing data directly on the **Algorand** blockchain. 
It lets developers and users **publish permanent, decentralized content** on-chain using nothing more than Algorand Layer 1 transactions. <br>

* 🖼️ Store files on-chain + update them keeping the versioning
* 📡 Stream continuous data feeds, ideal for IoT devices, sensors and real-time logs
* 🔒 Protect content using password or AES encryption
* 💸 Optimize costs with a smart compression

Blocknote uses a simple, extensible model based on a **payload transaction** that contains metadata about the content (such as type, compression, and encryption).&#x20;

Whether you're building an archival tool, a decentralized publishing platform, or a creative inscription project, **Blocknote gives you the freedom to write to the chain simply and efficiently.**<br>


# Install

## NodeJS or Bun ?

Bun is a modern alternative to Node.js, known for its superior performance, especially in compute-heavy tasks. Since Blocknote makes extensive use of cryptography and compression, we recommend using Bun for optimal speed and efficiency.\
In fact, our current public dapp ([blocknote.space](https://blocknote.space)) is running Blocknote on Bun.

Blocknote remains **fully compatible** with both Bun and Node.js.

## Install Bun

`npm i bun`

Or visit <https://bun.com/docs/installation> for alternated installations.


## Install package

Blocknote is available on <https://www.npmjs.com/package/blocknote>

`npm i blocknote`&#x20;

## The .env file

Before using Blocknote, make sure to edit your .env file.\
There is an .env.skeleton file into the github repo.

```dotenv
PRIVATE_KEY_AES = "" # Use by the BlocknoteManager
SQLITE_DATABASE_PATH = "./db/"  # Use by the BlocknoteManager
ALGOD_URL = "https://testnet-api.algonode.cloud" 
ALGOD_TOKEN = 
ALGOD_PORT = 
INDEXER_TOKEN = 
INDEXER_PORT = 
INDEXER_URL = "https://testnet-idx.algonode.cloud"
```

Since Node.js now supports native handling of `.env` files, Blocknote is not using the `dotenv` library. To ensure proper functionality, run Node.js with the appropriate argument.

`node your-app.js --env-file=.env`

or

`bun your-app.js --env-file=.env`


## Full documentation

Read the full documentation to start using Blocknote <https://blocknote-js.gitbook.io/>


