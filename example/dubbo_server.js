'use strict';

const { RpcServer } = require('../').server;
const { ZookeeperRegistry } = require('../').registry;
const protocol = require('dubbo-remoting');
const logger = console;

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181/dubbo/',
});

const server = new RpcServer({
  logger,
  registry,
  port: 12200,
  group: 'HSF',
  protocol,
  version: '1.0.0',
});

server.addService({
  interfaceName: 'org.apache.dubbo.demo.DemoService',
}, {
  async sayHello(name) {
    return 'hello ' + name;
  },
});

server.start()
  .then(() => {
    server.publish();
  });
