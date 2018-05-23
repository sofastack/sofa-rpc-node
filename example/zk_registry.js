'use strict';

const ZookeeperRegistry = require('../').registry.ZookeeperRegistry;
const logger = console;

async function test() {
  const registry = new ZookeeperRegistry({
    logger,
    address: '127.0.0.1:2181',
  });
  await registry.ready();

  // await registry.register({
  //   interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
  //   url: 'bolt://127.0.0.1:12200',
  // });

  registry.subscribe({
    interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
  }, val => {
    console.log(val);
  });

  // await registry.register({
  //   interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
  //   url: 'bolt://127.0.0.2:12200',
  // });

  // await registry.unRegister({
  //   interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
  //   url: 'bolt://127.0.0.1:12200',
  // });
}

test().catch(console.error);
