'use strict';

const net = require('node:net');
const { MongoClient } = require('mongodb');

let mongoConnectAttempts = 0;
let externalFetchAttempts = 0;
let externalSocketAttempts = 0;
let externalListenAttempts = 0;
let reporting = false;

function notify(type) {
  if (typeof process.send === 'function') {
    process.send({ type });
  }
}

function isLoopback(hostname) {
  return ['127.0.0.1', '::1', 'localhost'].includes(
    String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase()
  );
}

MongoClient.prototype.connect = async function guardedMongoConnect() {
  mongoConnectAttempts += 1;
  notify('guard-mongo-attempt');
  throw new Error('Mongo connect blocked by main bootstrap smoke');
};

MongoClient.connect = async function guardedStaticMongoConnect() {
  mongoConnectAttempts += 1;
  notify('guard-mongo-attempt');
  throw new Error('Mongo static connect blocked by main bootstrap smoke');
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async function guardedFetch(input, init) {
  const rawUrl = input instanceof URL
    ? input.toString()
    : typeof input === 'string'
      ? input
      : String(input && input.url ? input.url : '');
  const target = new URL(rawUrl);
  if (!isLoopback(target.hostname)) {
    externalFetchAttempts += 1;
    notify('guard-fetch-attempt');
    throw new Error('External fetch blocked by main bootstrap smoke');
  }
  return originalFetch(input, init);
};

const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  const first = args[0];
  const isOptions = first && typeof first === 'object';
  const isUnixSocket = typeof first === 'string' || (isOptions && typeof first.path === 'string');
  if (!isUnixSocket) {
    const hostname = isOptions
      ? first.host || first.hostname || 'localhost'
      : typeof args[1] === 'string'
        ? args[1]
        : 'localhost';
    if (!isLoopback(hostname)) {
      externalSocketAttempts += 1;
      notify('guard-socket-attempt');
      throw new Error('External socket blocked by main bootstrap smoke');
    }
  }
  return originalSocketConnect.apply(this, args);
};

const originalServerListen = net.Server.prototype.listen;
net.Server.prototype.listen = function guardedServerListen(...args) {
  const first = args[0];
  const isOptions = first && typeof first === 'object';
  const isUnixSocket = typeof first === 'string' && !/^\d+$/.test(first)
    || (isOptions && typeof first.path === 'string');
  if (!isUnixSocket) {
    const hostname = isOptions
      ? first.host
      : typeof args[1] === 'string'
        ? args[1]
        : undefined;
    if (!isLoopback(hostname)) {
      externalListenAttempts += 1;
      notify('guard-listen-attempt');
      throw new Error('Non-loopback listen blocked by main bootstrap smoke');
    }
  }
  return originalServerListen.apply(this, args);
};

function reportAndExit(signal) {
  if (reporting) return;
  reporting = true;
  const summary = {
    type: 'guard-summary',
    signal,
    mongoConnectAttempts,
    externalFetchAttempts,
    externalSocketAttempts,
    externalListenAttempts
  };
  const fallback = setTimeout(() => process.exit(0), 1000);
  if (typeof process.send !== 'function') {
    clearTimeout(fallback);
    process.exit(0);
    return;
  }
  process.send(summary, () => {
    clearTimeout(fallback);
    process.exit(0);
  });
}

process.once('SIGTERM', () => reportAndExit('SIGTERM'));
process.once('SIGINT', () => reportAndExit('SIGINT'));
