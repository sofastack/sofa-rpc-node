'use strict';

const { RpcClient } = require('../').client;
const { ZookeeperRegistry } = require('../').registry;
const protocol = require('dubbo-remoting');
const logger = console;

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181/dubbo/',
});

async function invoke() {
  const client = new RpcClient({
    logger,
    registry,
    protocol,
    group: 'dubbo',
    version: null,
  });
  const consumer = client.createConsumer({
    interfaceName: 'org.apache.dubbo.demo.DemoService',
  });
  await consumer.ready();

  const result = await consumer.invoke('sayHello', [{
    $class: 'java.lang.String',
    $: 'zongyu',
  }], { responseTimeout: 3000 });
  console.log(result);
}

invoke().catch(console.error);
