'use strict';
/* Picks the storage backend: MongoDB when a URI is given, otherwise a JSON file. */
const { createJsonStore } = require('./json');

async function openStore({ mongoUri, mongoDb, mongoPrefix, dataFile, saveDelay } = {}) {
  if (mongoUri) {
    const { createMongoStore } = require('./mongo');
    return createMongoStore(mongoUri, { dbName: mongoDb || 'ater', prefix: mongoPrefix || '' });
  }
  return createJsonStore(dataFile, { delay: saveDelay });
}

module.exports = { openStore };
