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
      loadbalancerClass: 'consistentHash',
    });
    let req;
    consumer.once('request', r => { req = r; });
    assert(consumer.targetAppName === 'pb');
    assert(client.consumerMap && client.consumerMap.size === 1);
    assert(client.consumerMap.get('com.alipay.sofa.rpc.test.ProtoService:1.0@SOFA@pb') === consumer);
    await consumer.ready();

    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    const ctx = { foo: 'bar' };
    const res = await consumer.invoke('echoObj', args, { ctx });
    assert.deepEqual(res, { code: 200, message: 'hello Peter, you are in A' });

    assert(req && req.targetAppName === 'pb');
    assert(req.ctx === ctx);

    await client.close();
  });

  it('should support without registry or serverHost in unittest env', async function() {
    const client = new RpcClient({
      protocol,
      logger,
      allowMock: true, // 标识当前支持 mock
    });
    const consumer = client.createConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      targetAppName: 'pb',
    });
    await consumer.ready();

    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    try {
      await consumer.invoke('echoObj', args);
      assert(false);
    } catch (err) {
      assert(err.name === 'RpcNoProviderError');
      assert(err.message === 'No provider of com.alipay.sofa.rpc.test.ProtoService:1.0@SOFA:echoObj() found!');
    }

    await client.close();
  });

  it('should support middleware', async function() {
    const client = new RpcClient({
      protocol,
      logger,
      allowMock: true, // 标识当前支持 mock
    });

    client.use(async function(ctx, next) {
      try {
        await next();
      } catch (err) {
        assert(err.name === 'RpcNoProviderError');
        ctx.body = 'empty';
      }
    });

    const consumer = client.createConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      targetAppName: 'pb',
    });
    await consumer.ready();

    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    let result = await consumer.invoke('echoObj', args);
    assert(result === 'empty');

    async function mw1(ctx, next) {
      const req = ctx.req;
      assert(req.methodName === 'echoObj');

      await next();
    }

    async function mw2(ctx, next) {
      try {
        await next();
      } catch (err) {
        assert(err.name === 'RpcNoProviderError');
      }
    }

    client.use([ mw1, mw2 ]);

    result = await consumer.invoke('echoObj', args);
    assert(!result);


    const consumer2 = client.createConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService2',
      targetAppName: 'pb',
    });
    await consumer2.ready();

    result = await consumer2.invoke('echoObj', []);
    assert(!result);

    await client.close();
  });
});
