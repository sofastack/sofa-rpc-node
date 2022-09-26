'use strict';

const { RpcServer } = require('../../').server;
const { ZookeeperRegistry } = require('../../').registry;
const logger = console;

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

const server = new RpcServer({
  logger,
  registry,
  port: 12200,
  killTimeout: 1000,
  serverGracefulIgnoreCode: ['EMOCKERROR']
});

server.addService({
  interfaceName: 'com.nodejs.test.TestService',
}, {
  async plus(a, b) {
    return a + b;
  },
});

server.start()
  .then(() => {
    server.publish();
  });


setTimeout(function () {
  const error = new Error('MockError');
  error.code = 'EMOCKERROR';
  throw error;
}, 1000);

setTimeout(function () {
  process.exit(0);
}, 10000)