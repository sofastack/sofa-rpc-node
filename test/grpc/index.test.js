'use strict';

const path = require('path');
const antpb = require('antpb');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const request = require('../../lib').test;
const { GRpcClient } = require('../../').client;
const { GRpcServer } = require('../../').server;

const port = 8080;
const logger = console;
const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));

describe('test/grpc/index.test.js', () => {
  let client;
  let server;
  before(async function() {
    server = new GRpcServer({
      proto,
      logger,
      port,
    });
    server.addService({
      interfaceName: 'helloworld.Greeter',
    }, {
      async SayHello(req) {
        await sleep(200);
        return {
          message: `hello ${req.name}`,
        };
      },
      async SayHi(req) {
        await sleep(100);
        if (req.name === 'throw') {
          throw new Error('test error message');
        }
        return {
          message: `hi ${req.name}`,
        };
      },
    });
    await server.start();
    client = new GRpcClient({
      proto,
      logger,
    });
    await client.ready();
  });

  after(async function() {
    await client.close();
    await server.close();
  });

  it('should invoke gRPC ok', async function() {
    const consumer = client.createConsumer({
      interfaceName: 'helloworld.Greeter',
      serverHost: 'http://127.0.0.1:' + port,
    });
    await consumer.ready();

    const r = await consumer.invoke('SayHello', [{ name: 'world' }]);
    assert.deepEqual(r, { message: 'hello world' });
  });

  it('should invoke timeout', async function() {
    const consumer = client.createConsumer({
      interfaceName: 'helloworld.Greeter',
      serverHost: 'http://127.0.0.1:' + port,
    });
    await consumer.ready();

    try {
      await consumer.invoke('SayHello', [{ name: 'world' }], {
        responseTimeout: 100,
      });
      assert(false);
    } catch (err) {
      console.log(err);
      assert(err.name === 'GRpcResponseTimeoutError');
      assert(err.timeout === 100);
      assert(err.req && err.req.serverSignature === 'helloworld.Greeter:1.0');
      assert(err.req.methodName === 'SayHello');
      assert(err.req.timeout === 100);
      assert(err.req.meta && err.req.meta.resultCode === '03');
      assert(err.req.meta.rt >= 100);
    }
  });

  it('should invoke with testClient', async function() {
    await request(server)
      .service('helloworld.Greeter')
      .invoke('SayHello', { name: 'world' })
      .expect({ message: 'hello world' });
  });

  it('should invoke gRPC multi times works fine', async function() {
    const helloResult = await request(server)
      .service('helloworld.Greeter')
      .invoke('SayHello', { name: 'world' });
    helloResult.consumer.close();
    assert.deepEqual(helloResult.data, { message: 'hello world' });
    const hiResult = await request(server)
      .service('helloworld.Greeter')
      .invoke('SayHi', { name: 'world' });
    hiResult.consumer.close();
    assert.deepEqual(hiResult.data, { message: 'hi world' });
  });

  it('should get error response when service throw exception', async function() {
    const consumer = client.createConsumer({
      interfaceName: 'helloworld.Greeter',
      serverHost: 'http://127.0.0.1:' + port,
    });
    await consumer.ready();
    try {
      await consumer.invoke('SayHi', [{ name: 'throw' }], {});
      assert(false);
    } catch (e) {
      assert(e.code === 2);
      assert(e.message === 'test error message');
    } finally {
      consumer.close();
    }
  });

  it('should invoke large request body ok', async function() {
    const consumer = client.createConsumer({
      interfaceName: 'helloworld.Greeter',
      serverHost: 'http://127.0.0.1:' + port,
    });
    await consumer.ready();
    const largeStr = Buffer.alloc(100 * 1024);
    await consumer.invoke('SayHi', [{ name: largeStr.toString() }], {});
  });
});
