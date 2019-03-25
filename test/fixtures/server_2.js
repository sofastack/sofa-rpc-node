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
  port: 19201,
});

server.addService({
  interfaceName: 'com.nodejs.test.ClusterService',
}, {
  async kill() {
    setTimeout(() => {
      console.log('exit ----- 19201');
      process.exit(0);
    }, 500);
    return 'ok';
  },
});

server.start()
  .then(() => {
    server.publish();
  });
