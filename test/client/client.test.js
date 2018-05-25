'use strict';

const mm = require('mm');
const path = require('path');
const antpb = require('antpb');
const assert = require('assert');
const protocol = require('sofa-bolt-node');
const RpcClient = require('../..').client.RpcClient;
const RpcConsumer = require('../..').client.RpcConsumer;
const ZookeeperRegistry = require('../../').registry.ZookeeperRegistry;
const server = require('../supports/pb_server');
const logger = console;

const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));
protocol.setOptions({ proto });

describe('test/client/client.test.js', () => {
  let registry;
  before(async () => {
    registry = new ZookeeperRegistry({
      logger,
      address: '127.0.0.1:2181',
    });
    await Promise.all([
      registry.ready(),
      server.start(),
    ]);
  });

  after(async function() {
    await server.close();
    await registry.close();
  });
  afterEach(mm.restore);

  it('should work well', async function() {
    const client = new RpcClient({
      registry,
      protocol,
      logger,
    });
    client.consumerClass = RpcConsumer;

    const consumer = client.createConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      targetAppName: 'pb',
    });
    assert(client.consumerMap && client.consumerMap.size === 1);
    assert(client.consumerMap.get('com.alipay.sofa.rpc.test.ProtoService:1.0@SOFA@pb') === consumer);
    await consumer.ready();

    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    const res = await consumer.invoke('echoObj', args);
    assert.deepEqual(res, { code: 200, message: 'hello Peter, you are in A' });

    await client.close();
  });
});
