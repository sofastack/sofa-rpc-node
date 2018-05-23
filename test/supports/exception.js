'use strict';

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
  killTimeout: 3000,
});

server.addService('com.node.rpctest.ExceptionService', {
  async kill() {
    setTimeout(() => {
      throw new Error('unknown error');
    }, 100);
    return 'ok';
  },
});

server.start();
server.publish();
