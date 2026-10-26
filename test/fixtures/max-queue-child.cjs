'use strict';
const { MongoClient } = require('mongodb');
const { MaxOutboxStore } = require('../../dist/support/max-outbox-store');
(async () => {
  const [uri, name] = process.argv.slice(2), target = new URL(uri);
  if (target.hostname !== '127.0.0.1' || !/^max_queue_test_[a-f0-9]+$/.test(name)) throw Error('DISPOSABLE_LOOPBACK_ONLY');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try { await client.connect(); const c = client.db(name).collection('outbox');
    const result = await new MaxOutboxStore(c, undefined, undefined, undefined, client).pull('MAX_BOT', 10, 60);
    process.stdout.write(JSON.stringify(result.map(x => x.id)));
  } finally { await client.close(); }
})().catch(() => { process.stderr.write('SYNTHETIC_CHILD_FAILED'); process.exitCode = 1; });
