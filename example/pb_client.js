'use strict';

const path = require('path');
const antpb = require('antpb');
const protocol = require('sofa-bolt-node');
const { RpcClient } = require('../').client;
const { ZookeeperRegistry } = require('../').registry;
const logger = console;

const proto = antpb.loadAll(path.join(__dirname, '../test/fixtures/proto'));
protocol.setOptions({ proto });

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

async function invoke() {
  const client = new RpcClient({
    logger,
    protocol,
    registry,
  });
  const consumer = client.createConsumer({
    interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
  });
  await consumer.ready();

  const result = await consumer.invoke('echoObj', [{
    name: 'gxcsoccer',
    group: 'B',
  }], { responseTimeout: 3000 });
  console.log(result);
}

invoke().catch(console.error);
