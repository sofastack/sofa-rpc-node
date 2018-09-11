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
      serverHost: 'http://localhost:' + port,
    });
    await consumer.ready();

    const r = await consumer.invoke('SayHello', [{ name: 'world' }]);
    assert.deepEqual(r, { message: 'hello world' });
  });

  it('should invoke timeout', async function() {
    const consumer = client.createConsumer({
      interfaceName: 'helloworld.Greeter',
      serverHost: 'http://localhost:' + port,
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
});
