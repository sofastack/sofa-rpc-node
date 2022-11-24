'use strict';

const sleep = require('mz-modules/sleep');
const RpcServer = require('../../lib').server.RpcServer;
const ZookeeperRegistry = require('../../').registry.ZookeeperRegistry;
const logger = console;

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

const server = new RpcServer({
  appName: 'error',
  logger: console,
  registry,
  port: 13300,
  publishAddress: '127.0.0.1',
  killTimeout: 3000,
});

server.createContext = () => {
  return {
    logger: {
      warn(...args) {
        console.log('mock-ctx-logger-warn: %o', args);
      },
      error(err) {
        console.error('mock-ctx-logger-error: %o', err);
      },
    },
  };
};

// server.on('request', request => {
//   console.error('RpcServer request event: %o', request);
// });

// server.on('error', (err, ctx) => {
//   console.error('-------------RpcServer error event: %o, ctx: %o', err, ctx);
// });

server.addService('com.node.rpctest.ExceptionService', {
  async kill() {
    setTimeout(() => {
      throw new Error('unknown error');
    }, 100);
    return 'ok';
  },
  async helloError() {
    throw new Error('mock hello error');
  },
  async timeout() {
    await sleep(1010);
    return 'foo';
  },
});

server.start();
server.publish();
