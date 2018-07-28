'use strict';

const mm = require('mm');
const path = require('path');
const antpb = require('antpb');
const assert = require('assert');
const protocol = require('sofa-bolt-node');
const RpcConsumer = require('../..').client.RpcConsumer;
const RpcConnectionMgr = require('../..').client.RpcConnectionMgr;
const ZookeeperRegistry = require('../../').registry.ZookeeperRegistry;
const server = require('../supports/pb_server');
const logger = console;

const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));
protocol.setOptions({ proto });

describe('test/client/consumer.test.js', () => {
  let registry;
  let connectionManager;
  before(async () => {
    registry = new ZookeeperRegistry({
      logger,
      address: '127.0.0.1:2181',
    });
    connectionManager = new RpcConnectionMgr({ logger });
    await Promise.all([
      registry.ready(),
      connectionManager.ready(),
      server.start(),
    ]);
  });

  after(async function() {
    await connectionManager.closeAllConnections();
    await server.close();
    await registry.close();
  });
  afterEach(mm.restore);

  it('should invoke ok', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      loadbalancerClass: 'random',
      connectionManager,
      connectionOpts: {
        protocol,
      },
      registry,
      logger,
    });
    assert(consumer.logger);
    await consumer.ready();
    const args = [{
      name: 'Peter',
      group: 'A',
    }];

    let count = 10;
    let total = 0;
    while (count--) {
      const start = Date.now();
      try {
        const res = await consumer.invoke('echoObj', args);
        assert.deepEqual(res, { code: 200, message: 'hello Peter, you are in A' });
      } catch (err) {
        console.log(err);
      }
      const rt = Date.now() - start;
      total += rt;
    }
    console.log(total, total / 1000);
    consumer.close();
  });

  it('should invoke ok before ready', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      connectionManager,
      registry,
      logger,
      proto,
      classMap: {},
    });
    assert(consumer.logger);
    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    const res = await consumer.invoke('echoObj', args);
    assert.deepEqual(res, { code: 200, message: 'hello Peter, you are in A' });

    let addr = consumer.parseUrl('127.0.0.1:12201');
    assert(addr.host === '127.0.0.1:12201');

    addr = consumer.parseUrl('127.0.0.1');
    assert(addr.host === '127.0.0.1:12200');

    consumer.close();
  });

  it('should direct connect', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      connectionManager,
      connectionOpts: {
        protocol,
      },
      serverHost: '127.0.0.1:12202?serialization=protobuf',
      logger,
    });
    assert(consumer.logger);
    await consumer.ready();
    let req;
    consumer.once('request', val => {
      req = val;
    });
    consumer.once('response', val => {
      assert(val && val.req && val.res);
    });
    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    const res = await consumer.invoke('echoObj', args);
    assert.deepEqual(res, { code: 200, message: 'hello Peter, you are in A' });

    assert(req);
    assert(req.serverSignature === 'com.alipay.sofa.rpc.test.ProtoService:1.0');
    assert(req.methodName === 'echoObj');
    assert.deepEqual(req.args, args);
    assert(req.requestProps);
    assert(req.timeout === 3000);
    assert(req.meta.id);
    assert(req.meta.resultCode === '00');
    assert(req.meta.connectionGroup === 'com.alipay.sofa.rpc.test.ProtoService:1.0@SOFA');
    assert(req.meta.codecType === 'protobuf');
    assert(req.meta.boltVersion === 1);
    assert(req.meta.crcEnable === false);
    assert(req.meta.timeout === 3000);
    assert(req.meta.reqSize === 268);
    assert(req.meta.resSize === 133);
    assert(req.meta.rt >= 0);

    consumer.close();
  });

  it('should throw RpcNoProviderError', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.NotExistService',
      connectionManager,
      connectionOpts: {
        protocol,
      },
      registry,
      logger,
    });
    await consumer.ready();
    let req;
    consumer.once('request', val => {
      req = val;
    });
    consumer.once('response', val => {
      assert(val && val.req && !val.res);
    });
    const args = [{
      name: 'Peter',
      group: 'A',
    }];

    try {
      await consumer.invoke('echoObj', args);
      assert(false);
    } catch (err) {
      assert(err && err.name === 'RpcNoProviderError');
    }

    assert(req);
    assert(req.serverSignature === 'com.alipay.sofa.rpc.test.NotExistService:1.0');
    assert(req.methodName === 'echoObj');
    assert.deepEqual(req.args, args);
    assert(req.timeout === 3000);
    assert(!req.meta.id);
    assert(req.meta.resultCode === '04');
    assert(req.meta.connectionGroup === 'com.alipay.sofa.rpc.test.NotExistService:1.0@SOFA');
    assert(!req.meta.codecType);
    assert(!req.meta.boltVersion);
    assert(!req.meta.crcEnable);
    assert(req.meta.timeout === 3000);
    assert(!req.meta.reqSize);
    assert(!req.meta.resSize);
    assert(!req.meta.rt);

    consumer.close();
  });

  it('should throw RpcResponseTimeoutError', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      connectionManager,
      connectionOpts: {
        protocol,
      },
      registry,
      logger,
    });
    await consumer.ready();
    let req;
    let res;
    consumer.once('request', val => {
      req = val;
    });
    consumer.once('response', val => {
      assert(val && val.req && val.res);
      res = val.res;
    });

    const args = [{
      name: 'Peter',
      group: 'A',
    }];
    try {
      await consumer.invoke('echoObj', args, { responseTimeout: 1 });
      assert(false);
    } catch (err) {
      assert(err && err.name === 'RpcResponseTimeoutError');
      assert(err.timeout === 1);
    }

    assert(req);
    assert(req.serverSignature === 'com.alipay.sofa.rpc.test.ProtoService:1.0');
    assert(req.methodName === 'echoObj');
    assert.deepEqual(req.args, args);
    assert(req.timeout === 1);
    assert(req.meta.id);
    assert(req.meta.resultCode === '03');
    assert(req.meta.connectionGroup === 'com.alipay.sofa.rpc.test.ProtoService:1.0@SOFA');
    assert(req.meta.codecType === 'protobuf');
    assert(req.meta.boltVersion === 1);
    assert(!req.meta.crcEnable);
    assert(req.meta.timeout === 1);
    assert(req.meta.reqSize === 268);
    assert(!req.meta.resSize);
    assert(req.meta.rt >= 0);

    assert(res && res.error && res.error.name === 'RpcResponseTimeoutError');
    assert(!res.appResponse);
    consumer.close();
  });

  it('should support errorAsNull', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      connectionManager,
      connectionOpts: {
        protocol,
      },
      registry,
      logger,
      errorAsNull: true,
    });
    await consumer.ready();
    const args = [{
      name: 'Peter',
      group: 'A',
    }];

    const res = await consumer.invoke('echoObj', args, { responseTimeout: 1 });
    assert(res == null);
    consumer.close();
  });

  it('should handle encode error', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      connectionManager,
      connectionOpts: {
        protocol,
      },
      registry,
      logger,
    });
    await consumer.ready();
    let req;
    let res;
    consumer.once('request', val => {
      req = val;
    });
    consumer.once('response', val => {
      assert(val && val.req && val.res);
      res = val.res;
    });

    const args = [{
      name: 'Peter',
      group: 'A',
    }];

    mm(consumer, 'createRequest', () => ({
      timeout: true,
      meta: {
        id: null,
        resultCode: '00',
        connectionGroup: null,
        codecType: null,
        boltVersion: null,
        crcEnable: false,
        start: Date.now(),
        timeout: 3000,
        address: null,
        requestEncodeStart: 0,
        requestEncodeRT: 0,
        reqSize: 0,
        responseDecodeStart: 0,
        responseDecodeRT: 0,
        resSize: 0,
        rt: null,
      },
    }));
    try {
      await consumer.invoke('echoObj', args);
      assert(false);
    } catch (err) {
      assert(err && err.name === 'RpcRequestEncodeError');
    }

    assert(req.meta.id);
    assert(req.meta.resultCode === '02');
    assert(req.meta.connectionGroup === 'com.alipay.sofa.rpc.test.ProtoService:1.0@SOFA');
    assert(req.meta.codecType === 'protobuf');
    assert(req.meta.boltVersion === 1);
    assert(!req.meta.crcEnable);
    assert(req.meta.timeout === 3000);
    assert(!req.meta.reqSize);
    assert(!req.meta.resSize);
    assert(req.meta.rt >= 0);

    console.log(req.meta.rt);

    assert(res && res.error && res.error.name === 'RpcRequestEncodeError');
    assert(!res.appResponse);
    consumer.close();
  });


  it('should throw BizError', async function() {
    const consumer = new RpcConsumer({
      interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
      connectionManager,
      connectionOpts: {
        protocol,
      },
      registry,
      logger,
    });
    await consumer.ready();
    let req;
    let res;
    consumer.once('request', val => {
      req = val;
    });
    consumer.once('response', val => {
      assert(val && val.req && val.res);
      res = val.res;
    });

    const args = [{
      name: 'XIAOCHEN',
      group: 'A',
    }];
    try {
      await consumer.invoke('echoObj', args);
      assert(false);
    } catch (err) {
      assert(err.message.includes('mock error'));
    }

    assert(req);
    assert(req.serverSignature === 'com.alipay.sofa.rpc.test.ProtoService:1.0');
    assert(req.methodName === 'echoObj');
    assert.deepEqual(req.args, args);
    assert(req.timeout === 3000);
    assert(req.meta.id);
    assert(req.meta.resultCode === '01');
    assert(req.meta.connectionGroup === 'com.alipay.sofa.rpc.test.ProtoService:1.0@SOFA');
    assert(req.meta.codecType === 'protobuf');
    assert(req.meta.boltVersion === 1);
    assert(!req.meta.crcEnable);
    assert(req.meta.timeout === 3000);
    assert(req.meta.reqSize === 271);
    assert(req.meta.resSize === 113);
    assert(req.meta.rt >= 0);

    assert(res && res.error && res.error.message.includes('mock error'));
    console.log(res.error);
    assert(!res.appResponse);
    consumer.close();
  });
});
