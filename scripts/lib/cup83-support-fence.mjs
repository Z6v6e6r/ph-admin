// Exact CUP83 first-restart primitive. No CLI, attach, signal, stop, DB or send path.
// An independently pinned operator must select the loaded SupportService prototype,
// own the release lock/Inspector and supply a new private directory. One synchronous
// invocation saves the pre-drain Map before fencing its two periodic producers.
export function captureAndFenceCup83Support(expected, exactPrototype, directory) {
  const need = (value, code) => { if (!value) throw Error(code); };
  need(process.pid === expected.pid && String(performance.timeOrigin) === expected.start
    && process.version === expected.nodeVersion
    && expected.sourceEpoch === '83b1c17bc4c5edaec65387b25b5695e48337c3cf', 'PROCESS_IDENTITY');
  need(Array.isArray(this) && this.length === 1
    && Object.getPrototypeOf(this[0]) === exactPrototype, 'EXACT_ONE_INSTANCE');
  const instance = this[0];
  const data = (object, key) => {
    const d = Object.getOwnPropertyDescriptor(object, key);
    need(d && Object.hasOwn(d, 'value'), 'OWN_DATA_REQUIRED'); return d;
  };
  need(data(instance, 'isPersistenceSyncInProgress').value === false, 'ACTIVE_HYDRATE');
  const interval = data(instance, 'persistenceSyncIntervalMs');
  need(interval.writable && Number.isSafeInteger(interval.value) && interval.value >= 0,
    'INTERVAL_DESCRIPTOR');
  const timerKeys = ['persistenceSyncTimer', 'noReplyQuickReplyTimer'];
  const timers = timerKeys.map(key => {
    const d = Object.getOwnPropertyDescriptor(instance, key);
    if (!d) {
      need(Object.isExtensible(instance), 'TIMER_DESCRIPTOR');
      for (let proto = Object.getPrototypeOf(instance); proto; proto = Object.getPrototypeOf(proto))
        need(!Object.hasOwn(proto, key), 'TIMER_DESCRIPTOR');
      return undefined;
    }
    need(Object.hasOwn(d, 'value') && d.writable, 'TIMER_DESCRIPTOR');
    const timer = d.value;
    if (timer === undefined) return timer;
    need(timer !== null && typeof timer === 'object', 'TIMER_TYPE');
    const ctor = data(Object.getPrototypeOf(timer), 'constructor').value;
    need(typeof ctor === 'function' && ctor.name === 'Timeout', 'TIMER_TYPE');
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(timer)))
      need(Object.hasOwn(descriptor, 'value'), 'TIMER_DESCRIPTOR');
    need(data(timer, '_onTimeout').writable && typeof data(timer, '_destroyed').value === 'boolean',
      'TIMER_DESCRIPTOR');
    return timer;
  });
  const map = data(instance, 'outbox').value;
  let size;
  try { size = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(map); }
  catch { throw Error('MAP_REQUIRED'); }
  need(size <= 5000, 'COUNT_LIMIT');
  const limit = 32 * 1024 * 1024, seen = new Set();
  let undefinedPaths = [];
  let budget = 0;
  const charge = bytes => { budget += bytes; need(budget <= limit, 'BYTE_LIMIT'); };
  const clone = (value, commandId, path = [], depth = 0) => {
    need(depth <= 32, 'DEPTH_LIMIT');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { need(Number.isFinite(value), 'JSON_VALUE'); return value; }
    if (typeof value === 'string') { charge(Buffer.byteLength(value)); return value; }
    need(typeof value === 'object' && !seen.has(value), 'JSON_VALUE');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    need(array || proto === Object.prototype || proto === null, 'PLAIN_DATA_REQUIRED');
    seen.add(value);
    const out = array ? [] : Object.create(null), keys = Object.keys(value);
    need(!array || keys.length === value.length && keys.every((key, i) => key === String(i)), 'ARRAY_SHAPE');
    for (const key of keys) {
      const descriptor = data(value, key); charge(Buffer.byteLength(key) + 8);
      if (descriptor.value === undefined) {
        need(!array, 'ARRAY_UNDEFINED'); undefinedPaths.push({ commandId, path: [...path, key] });
      } else out[key] = clone(descriptor.value, commandId, [...path, key], depth + 1);
    }
    seen.delete(value); return out;
  };
  const rows = [], counts = Object.create(null);
  for (const [key, value] of Map.prototype.entries.call(map)) {
    need(value && typeof value === 'object', 'COMMAND_SHAPE');
    if (!['MAX_BOT', 'MAX_ACADEMY_BOT'].includes(data(value, 'connector').value)) continue;
    need(typeof key === 'string', 'COMMAND_IDENTITY');
    const row = clone(value, key);
    need(row.id === key && ['PENDING', 'LEASED', 'SENT', 'FAILED'].includes(row.status), 'COMMAND_IDENTITY');
    rows.push([key, row]); const group = row.connector + ':' + row.status;
    counts[group] = (counts[group] ?? 0) + 1;
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const payload = Buffer.from(JSON.stringify({ schema: 'SYNTHETIC_MAX_MAP_EXPORT_V1', identity: expected,
    totalMapCount: size, maxCount: rows.length, counts, rows, undefinedPaths }) + '\n');
  need(payload.length <= limit, 'BYTE_LIMIT');
  // Web outbox PENDING is not delivery evidence. Preserve its independent history
  // and identity/ACL context, without acknowledging or re-enqueueing a command.
  undefinedPaths = [];
  const web = { commands: [], messages: [], serviceMessages: [], dialogs: [], clients: [] };
  const webDialogIds = new Set(), webClientIds = new Set(), messageIds = new Set();
  const mapOf = key => {
    const value = data(instance, key).value;
    let count;
    try { count = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(value); }
    catch { throw Error('MAP_REQUIRED'); }
    need(count <= 5000, 'COUNT_LIMIT'); return value;
  };
  const requireId = value => { need(typeof value === 'string' && value.length > 0, 'WEB_IDENTITY'); return value; };
  const retain = (kind, key, value) => {
    requireId(key); const row = clone(value, kind + ':' + key);
    need(row.id === key, 'WEB_IDENTITY'); web[kind].push([key, row]); return row;
  };
  for (const [key, value] of Map.prototype.entries.call(map)) {
    if (data(value, 'connector').value !== 'LK_WEB_MESSENGER') continue;
    const row = retain('commands', key, value);
    need(['PENDING', 'LEASED', 'SENT', 'FAILED'].includes(row.status), 'WEB_STATUS');
    webDialogIds.add(requireId(row.dialogId)); webClientIds.add(requireId(row.clientId));
  }
  const messageMap = mapOf('messages');
  let totalMessages = 0;
  for (const [dialogId, messages] of Map.prototype.entries.call(messageMap)) {
    requireId(dialogId); need(Array.isArray(messages), 'ARRAY_SHAPE');
    const length = data(messages, 'length').value;
    totalMessages += length; need(totalMessages <= 20000, 'COUNT_LIMIT');
    for (let i = 0; i < length; i++) {
      const value = data(messages, String(i)).value;
      if (data(value, 'connector').value !== 'LK_WEB_MESSENGER') continue;
      const id = requireId(data(value, 'id').value);
      need(!messageIds.has(id), 'WEB_DUPLICATE_MESSAGE'); messageIds.add(id);
      const service = ['direction', 'senderRole', 'kind'].some(key => data(value, key).value === 'SYSTEM');
      const kind = service ? 'serviceMessages' : 'messages';
      const row = clone(value, kind + ':' + id);
      need(row.dialogId === dialogId, 'WEB_IDENTITY');
      web[kind].push([id, row]);
      webDialogIds.add(dialogId); webClientIds.add(requireId(row.clientId));
    }
  }
  const dialogs = mapOf('dialogs'), clients = mapOf('clients');
  for (const [key, value] of Map.prototype.entries.call(dialogs)) {
    const connectors = data(value, 'connectors').value;
    need(Array.isArray(connectors), 'ARRAY_SHAPE');
    let includesWeb = false;
    for (let i = 0, length = data(connectors, 'length').value; i < length; i++) {
      need(length <= 32, 'COUNT_LIMIT');
      if (data(connectors, String(i)).value === 'LK_WEB_MESSENGER') includesWeb = true;
    }
    if (!includesWeb && !webDialogIds.has(key)) continue;
    const row = retain('dialogs', key, value);
    webDialogIds.delete(key); webClientIds.add(requireId(row.clientId));
  }
  need(webDialogIds.size === 0, 'WEB_MISSING_DIALOG');
  for (const id of webClientIds) {
    need(Map.prototype.has.call(clients, id), 'WEB_MISSING_CLIENT');
    retain('clients', id, Map.prototype.get.call(clients, id));
  }
  for (const rows of Object.values(web)) rows.sort((a, b) => a[0].localeCompare(b[0]));
  const webCounts = Object.fromEntries(Object.entries(web).map(([kind, rows]) => [kind, rows.length]));
  const webPayload = Buffer.from(JSON.stringify({ schema: 'PHAB_CUP83_WEB_CUSTODY_V1', identity: expected,
    rows: web, counts: webCounts, undefinedPaths, durableCompletenessProven: false }) + '\n');
  need(payload.length + webPayload.length <= limit, 'BYTE_LIMIT');
  const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
  const sha256 = bytes => process.getBuiltinModule('crypto').createHash('sha256').update(bytes).digest('hex');
  const hash = sha256(payload), webHash = sha256(webPayload);
  need(typeof directory === 'string' && path.isAbsolute(directory)
    && path.resolve(directory) === directory && fs.realpathSync(directory) === directory, 'PRIVATE_DIRECTORY');
  for (let ancestor = path.dirname(directory);; ancestor = path.dirname(ancestor)) {
    const s = fs.lstatSync(ancestor);
    need(s.isDirectory() && !s.isSymbolicLink() && (s.uid === 0 || s.uid === process.getuid())
      && (!(s.mode & 0o022) || s.uid === 0 && (s.mode & 0o1000) !== 0), 'PRIVATE_ANCESTRY');
    if (path.dirname(ancestor) === ancestor) break;
  }
  for (const name of ['pre-drain-map.json', 'pre-drain-web.json', 'pre-drain-fence.json']) {
    try { fs.lstatSync(path.join(directory, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Error('NO_REPLAY');
  }
  const stat = fs.lstatSync(directory);
  need(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o777) === 0o700, 'PRIVATE_DIRECTORY');
  const dirfd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let fd;
  try {
    const opened = fs.fstatSync(dirfd);
    need(opened.dev === stat.dev && opened.ino === stat.ino, 'DIRECTORY_DRIFT');
    // The operator owns and protects the entire directory ancestry. Fixed artifact
    // names are exclusive: even an uncertain/partial previous attempt forbids replay.
    const artifact = path.join(directory, 'pre-drain-map.json');
    fd = fs.openSync(artifact, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, payload); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.fsyncSync(dirfd);
    fd = fs.openSync(path.join(directory, 'pre-drain-web.json'), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, webPayload); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.fsyncSync(dirfd);
    const after = fs.lstatSync(directory);
    need(after.dev === opened.dev && after.ino === opened.ino && fs.realpathSync(directory) === directory,
      'DIRECTORY_DRIFT');
    // No await, callback or application JS can run between snapshot and fence.
    for (let i = 0; i < timerKeys.length; i++) {
      if (timers[i] !== undefined) clearInterval(timers[i]);
      instance[timerKeys[i]] = undefined;
    }
    instance.persistenceSyncIntervalMs = 0;
    const receipt = { schema: 'PHAB_CUP83_PRE_DRAIN_FENCE_V1', status: 'SUPPORT_TIMERS_FENCED',
      artifactSha256: hash, webArtifactSha256: webHash, webCounts,
      totalMapCount: size, maxCount: rows.length, counts,
      at: new Date().toISOString(), drainProven: false, replayAllowed: false };
    fd = fs.openSync(path.join(directory, 'pre-drain-fence.json'), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(receipt) + '\n'); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined; fs.fsyncSync(dirfd);
    return receipt;
  } finally { if (fd !== undefined) fs.closeSync(fd); fs.closeSync(dirfd); }
}
