'use strict';


const mm = require('mm');
const path = require('path');
const antpb = require('antpb');
const Base = require('sdk-base');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const protocol = require('sofa-bolt-node');
const RpcClient = require('../..').client.RpcClient;
const RpcConsumer = require('../..').client.RpcConsumer;
const server = require('../supports/pb_server');
const logger = console;

const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));
protocol.setOptions({ proto });

describe('test/client/custom_registry.test.js', () => {
  class CustomRegistry extends Base {
    constructor() {
      super({ initMethod: '_init' });
      this._isReady = false;
    }

    async _init() {
      await sleep(1000);
      this._isReady = true;
    }

    subscribe(_, listener) {
      if (!this._isReady) return;

      listener([ 'tr://127.0.0.1:12202?serialization=protobuf' ]);
    }

    unSubscribe() {
      //
    }

    async close() {
      //
    }
  }

  const registry = new CustomRegistry();
  before(async () => {
    server.start();
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
    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    const res = await consumer.invoke('echoObj', args);
    assert.deepEqual(res, { code: 200, message: 'hello Peter, you are in A' });
    await client.close();
  });
});
