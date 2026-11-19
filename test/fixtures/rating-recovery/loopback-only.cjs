const net = require('node:net');

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connectLoopbackOnly(...args) {
  const [endpoint, second] = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof endpoint === 'object' && endpoint !== null ? endpoint
    : typeof endpoint === 'number' ? { host: typeof second === 'string' ? second : undefined }
      : { path: endpoint };
  if (options.path || !['127.0.0.1', '::1', 'localhost'].includes(options.host ?? 'localhost')) {
    throw new Error('Network is restricted to loopback in the rating recovery fixture');
  }
  return connect.apply(this, args);
};
