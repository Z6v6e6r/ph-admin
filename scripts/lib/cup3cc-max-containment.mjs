// One terminal containment operation for the pinned CUP3cc instance.
// Four historical failures remain unresolved; this never admits a restart.
// Separate from the zero-failure cutover contract, which stays unchanged.
export function captureAndContainCup3ccMax(expected, supportPrototype, persistencePrototype, directories) {
  const need = (value, code) => { if (!value) throw Error(code); };
  const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
  const hash = bytes => process.getBuiltinModule('crypto').createHash('sha256').update(bytes).digest('hex');
  const data = (object, key) => {
    const d = Object.getOwnPropertyDescriptor(object, key);
    need(d && Object.hasOwn(d, 'value'), 'OWN_DATA_REQUIRED'); return d;
  };
  need(expected.sourceCommit === '3cc4708811fc3d734d1c6673fd38f3b928589154'
    && process.pid === expected.pid && process.version === expected.nodeVersion
    && String(performance.timeOrigin) === expected.timeOrigin, 'PROCESS_IDENTITY');
  const stat = fs.readFileSync('/proc/self/stat', 'utf8');
  need(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === expected.startTicks, 'PROCESS_START');
  need(Array.isArray(this) && this.length === 1 && Object.getPrototypeOf(this[0]) === supportPrototype,
    'EXACT_SUPPORT_INSTANCE');
  const service = this[0], persistence = data(service, 'persistence').value;
  need(persistence && Object.getPrototypeOf(persistence) === persistencePrototype, 'EXACT_PERSISTENCE_INSTANCE');
  need(!Object.hasOwn(service, 'acceptOutbox') && !Object.hasOwn(persistence, 'trackedLegacyMax')
    && !Object.hasOwn(persistence, 'persistOutboxCommand'), 'SHADOWED_ADMISSION_METHOD');
  // The external custodian must additionally bind loaded script bytes and complete
  // release inventory. Hashing functions binds these selected live prototypes.
  for (const [object, name, expectedHash] of [
    [supportPrototype, 'acceptOutbox', expected.acceptOutboxSha256],
    [persistencePrototype, 'trackedLegacyMax', expected.trackedLegacyMaxSha256],
    [persistencePrototype, 'persistOutboxCommand', expected.persistOutboxCommandSha256]
  ]) {
    const fn = data(object, name).value;
    need(typeof fn === 'function' && /^[a-f0-9]{64}$/.test(expectedHash)
      && hash(Function.prototype.toString.call(fn)) === expectedHash, 'LIVE_FUNCTION_IDENTITY');
  }
  need((process.env.SUPPORT_MAX_OUTBOX_MODE === undefined || process.env.SUPPORT_MAX_OUTBOX_MODE === 'legacy')
    && process.env.SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS === '0'
    && String(process.env.NODE_ENV).trim().toLowerCase() === 'production', 'RUNTIME_MODE');
  need(data(service, 'persistenceSyncIntervalMs').value === 0
    && data(service, 'isPersistenceSyncInProgress').value === false, 'HYDRATION_ACTIVE');
  for (const key of ['persistenceSyncTimer', 'noReplyQuickReplyTimer']) {
    const d = Object.getOwnPropertyDescriptor(service, key);
    need(!d || Object.hasOwn(d, 'value') && d.value === undefined, 'PRODUCER_TIMER_ACTIVE');
  }
  const closing = data(persistence, 'legacyMaxClosing');
  need(closing.writable && closing.value === false, 'ALREADY_CLOSING_NO_REPLAY');
  const writes = data(persistence, 'legacyMaxWrites').value;
  need(Object.getOwnPropertyDescriptor(Set.prototype, 'size').get.call(writes) === 0, 'MAX_WRITES_NOT_DRAINED');
  const failures = data(persistence, 'legacyMaxWriteFailures').value;
  need(expected.unresolvedHistoricalFailures === 4 && failures === 4, 'HISTORICAL_FAILURE_COUNT_DRIFT');
  const outbox = data(service, 'outbox').value;
  const counts = Object.create(null);
  for (const [, row] of Map.prototype.entries.call(outbox)) {
    if (!['MAX_BOT', 'MAX_ACADEMY_BOT'].includes(data(row, 'connector').value)) continue;
    const status = data(row, 'status').value;
    need(['PENDING', 'LEASED', 'SENT', 'FAILED'].includes(status), 'OUTBOX_STATUS');
    const meta = Object.getOwnPropertyDescriptor(row, 'meta');
    need(!meta || Object.hasOwn(meta, 'value'), 'OUTBOX_META');
    const held = !!meta?.value && Object.hasOwn(meta.value, 'legacyMaxRestartCustody');
    need(held || !['PENDING', 'LEASED'].includes(status), 'MAX_OPEN_COMMAND');
    const key = status + (held ? ':HELD' : ':UNHELD'); counts[key] = (counts[key] ?? 0) + 1;
  }
  // Preserve history and all outbox rows, including web rows and held commands.
  // undefined is represented separately, so the custody copy is lossless for
  // these plain in-memory entities; it is never an automatic import manifest.
  const seen = new Set(), undefinedPaths = []; let bytes = 0, entities = 0;
  const charge = n => { bytes += n; need(bytes <= 32 * 1024 * 1024, 'SNAPSHOT_BYTE_LIMIT'); };
  const clone = (value, location, depth = 0) => {
    need(depth <= 32, 'SNAPSHOT_DEPTH');
    if (value === undefined) { undefinedPaths.push(location); return null; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { charge(Buffer.byteLength(value)); return value; }
    if (typeof value === 'number') { need(Number.isFinite(value), 'SNAPSHOT_NUMBER'); return value; }
    need(typeof value === 'object' && !seen.has(value), 'SNAPSHOT_VALUE');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    need(array || proto === Object.prototype || proto === null, 'SNAPSHOT_PLAIN_DATA');
    seen.add(value); const result = array ? [] : Object.create(null), keys = Object.keys(value);
    need(!array || keys.length === value.length && keys.every((key, i) => key === String(i)), 'SNAPSHOT_ARRAY');
    for (const key of keys) { charge(Buffer.byteLength(key) + 8); result[key] = clone(data(value, key).value, [...location, key], depth + 1); }
    seen.delete(value); return result;
  };
  const rows = Object.create(null);
  for (const key of ['outbox', 'messages', 'dialogs', 'clients', 'responseMetrics']) {
    rows[key] = [];
    for (const [id, value] of Map.prototype.entries.call(data(service, key).value)) {
      need(typeof id === 'string' && ++entities <= 50000, 'SNAPSHOT_COUNT');
      rows[key].push([id, clone(value, [key, id])]);
    }
  }
  const snapshot = Buffer.from(JSON.stringify({ schema: 'CUP3CC_MAX_CONTAINMENT_CUSTODY_V1',
    identity: expected, rows, undefinedPaths, unresolvedHistoricalFailures: failures,
    failureRetirementProven: false, activationAdmitted: false, replayAllowed: false }) + '\n');
  need(snapshot.length <= 32 * 1024 * 1024, 'SNAPSHOT_BYTE_LIMIT');
  need(Array.isArray(directories) && directories.length === 2 && directories[0] !== directories[1], 'TWO_BACKUPS_REQUIRED');
  const openDirs = [];
  try {
    for (const directory of directories) {
      need(typeof directory === 'string' && path.isAbsolute(directory) && path.resolve(directory) === directory
        && fs.realpathSync(directory) === directory, 'PRIVATE_DIRECTORY');
      for (let p = directory;; p = path.dirname(p)) {
        const s = fs.lstatSync(p);
        need(s.isDirectory() && !s.isSymbolicLink() && s.uid === 0 && !(s.mode & 0o022), 'DIRECTORY_CUSTODY');
        if (p === '/') break;
      }
      const s = fs.lstatSync(directory);
      need((s.mode & 0o777) === 0o700 && s.uid === process.getuid(), 'PRIVATE_DIRECTORY');
      const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      openDirs.push({ directory, fd });
      const opened = fs.fstatSync(fd);
      need(opened.dev === s.dev && opened.ino === s.ino, 'DIRECTORY_DRIFT');
      for (const name of ['pre-containment-map.json', 'containment-intent.json', 'containment-receipt.json']) {
        try { fs.lstatSync(path.join(directory, name)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw Error('EXISTING_ATTEMPT_NO_REPLAY');
      }
    }
    const write = (directory, name, body) => {
      const fd = fs.openSync(path.join(directory, name), fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.fsyncSync(openDirs.find(x => x.directory === directory).fd);
    };
    const snapshotSha256 = hash(snapshot);
    const intent = Buffer.from(JSON.stringify({ schema: 'CUP3CC_MAX_CONTAINMENT_INTENT_V1', identity: expected,
      snapshotSha256, at: new Date().toISOString(), terminalForOldProcess: true,
      containmentOnly: true, unresolvedHistoricalFailures: failures, failureRetirementProven: false,
      maxAcceptedQueueOnly: true, httpDrainProven: false, replayAllowed: false }) + '\n');
    for (const directory of directories) { write(directory, 'pre-containment-map.json', snapshot); write(directory, 'containment-intent.json', intent); }
    for (const name of ['pre-containment-map.json', 'containment-intent.json']) need(
      fs.readFileSync(path.join(directories[0], name)).equals(fs.readFileSync(path.join(directories[1], name))), 'BACKUP_MISMATCH');
    // No await or callback occurs between the checked maps, custody copies and
    // fence. Existing trackedLegacyMax rejects all later actions before DB access.
    persistence.legacyMaxClosing = true;
    need(data(persistence, 'legacyMaxClosing').value === true, 'FENCE_NOT_SET');
    const receipt = { schema: 'CUP3CC_MAX_CONTAINED_V1', at: new Date().toISOString(),
      snapshotSha256, counts, pendingWrites: 0, writeFailures: failures, terminalForOldProcess: true,
      containmentOnly: true, unresolvedHistoricalFailures: failures, failureRetirementProven: false,
      producerDrainProven: false, historyPreservationProven: false, cohortCoverageProven: false,
      maxAcceptedQueueOnly: true, httpDrainProven: false, postFenceAndStoppedMajorityChecksRequired: true,
      activationAdmitted: false, replayAllowed: false };
    for (const directory of directories) write(directory, 'containment-receipt.json', Buffer.from(JSON.stringify(receipt) + '\n'));
    return receipt;
  } finally { for (const { fd } of openDirs) fs.closeSync(fd); }
}
