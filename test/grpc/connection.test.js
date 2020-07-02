'use strict';

const mm = require('mm');
const path = require('path');
const antpb = require('antpb');
const assert = require('assert');
const urlparse = require('url').parse;
const sleep = require('mz-modules/sleep');
const { GRpcConnection } = require('../../').client;
const { GRpcServer } = require('../../').server;
const HealthCounts = require('../../lib/client/metric/health_counts');

const port = 8081;
const logger = console;
const address = urlparse('http://127.0.0.1:' + port, true);
const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));

describe('test/grpc/connection.test.js', () => {
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
  });
  afterEach(mm.restore);
  after(async function() {
    await server.close();
  });

  it('should throw if missing logger or address', () => {
    assert.throws(() => {
      new GRpcConnection();
    }, /\[GRpcConnection\] options\.logger is required/);
    assert.throws(() => {
      new GRpcConnection({ logger });
    }, /\[GRpcConnection\] options\.address is required/);
  });

  it('should connect timeout', async function() {
    const address = urlparse('http://2.2.2.2:8888', true);
    const conn = new GRpcConnection({
      logger,
      address,
      connectTimeout: 200,
    });
    try {
      await conn.ready();
      assert(false);
    } catch (err) {
      assert(err.name === 'GRpcSessionConnectTimeoutError');
      assert(err.message === 'session#http://2.2.2.2:8888/ connect timeout(200ms)');
    }
  });

  it('should connect failed', async function() {
    const address = urlparse('http://127.0.0.1:8888', true);
    const conn = new GRpcConnection({
      logger,
      address,
    });
    try {
      await conn.ready();
      assert(false);
    } catch (err) {
      assert(err.name === 'GRpcSocketError');
      assert(err.message === 'connect ECONNREFUSED 127.0.0.1:8888 (address: http://127.0.0.1:8888/)');
      assert(err.code === 'ECONNREFUSED');
    }
  });

  it('should connect success', async function() {
    const conn = new GRpcConnection({
      logger,
      address,
    });
    await conn.ready();

    assert(conn.key === 'GRpcConnection@127.0.0.1:' + port);
    assert(conn.logger === logger);
    assert(conn.isOk);
    assert(!conn.isClosed);
    assert(conn.isConnected);
    assert(conn.lastInvokeTime === -1);

    await conn.close();
  });

  it('should invoke ok', async function() {
    const conn = new GRpcConnection({
      logger,
      address,
    });
    await conn.ready();

    const req = {
      serverSignature: 'helloworld.Greeter:1.0',
      methodName: 'SayHello',
      args: [{ name: 'world' }],
      requestProps: {},
      timeout: 3000,
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
    };
    const r = await conn.invoke(req, { proto });
    assert(r);
    assert(!r.error);
    assert.deepEqual(r.appResponse, { message: 'hello world' });

    assert(conn.lastInvokeTime && conn.lastInvokeTime === conn._lastActiveTime);

    await conn.close();
  });

  it('should do heartbeat ok', async function() {
    const conn = new GRpcConnection({
      logger,
      address,
      maxIdleTime: 500,
    });
    await conn.ready();

    assert(conn._lastActiveTime === -1);
    conn.heartbeat();
    assert(conn._lastActiveTime);

    const time = conn._lastActiveTime;
    conn.heartbeat();
    assert(conn._lastActiveTime === time);

    await sleep(600);

    conn.heartbeat(Buffer.from('12345678'));
    await conn.forceClose();
  });

  it('should handle timeout', async function() {
    const conn = new GRpcConnection({
      logger,
      address,
    });
    await conn.ready();

    const req = {
      serverSignature: 'helloworld.Greeter:1.0',
      methodName: 'SayHello',
      args: [{ name: 'world' }],
      requestProps: {},
      timeout: 100,
      meta: {
        id: null,
        resultCode: '00',
        connectionGroup: null,
        codecType: null,
        boltVersion: null,
        crcEnable: false,
        start: Date.now(),
        timeout: 100,
        address: null,
        requestEncodeStart: 0,
        requestEncodeRT: 0,
        reqSize: 0,
        responseDecodeStart: 0,
        responseDecodeRT: 0,
        resSize: 0,
        rt: null,
      },
    };

    const r = await conn.invoke(req, { proto });
    const err = r.error;
    assert(err && !r.appResponse);
    assert(err.name === 'GRpcResponseTimeoutError');
    assert(err.timeout === 100);
    assert(err.req && err.req.serverSignature === 'helloworld.Greeter:1.0');
    assert(err.req.methodName === 'SayHello');
    assert(err.req.timeout === 100);
    assert(err.req.meta && err.req.meta.resultCode === '03');
    assert(err.req.meta.rt >= 100);

    await conn.close();
    await conn.forceClose();

    conn._handleSocketError(new Error('mock error'));
  });

  it('should cancel ongoing invoke if forceClose', async function() {
    const conn = new GRpcConnection({
      logger,
      address,
    });
    await conn.ready();

    const req = {
      serverSignature: 'helloworld.Greeter:1.0',
      methodName: 'SayHello',
      args: [{ name: 'world' }],
      requestProps: {},
      timeout: 3000,
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
    };
    setTimeout(() => {
      conn.forceClose(new Error('mock error'));
    }, 10);
    const r = await conn.invoke(req, { proto });
    const err = r.error;
    assert(err && !r.appResponse);
    assert(err.message === 'mock error');
    assert(err.resultCode === '02');

    conn._handleSocketError(new Error('mock error'));
    const error = new Error('mock error');
    error.code = 'ECONNRESET';
    conn._handleSocketError(error);
  });

  it('should support circuit break', async function() {
    const conn = new GRpcConnection({
      logger,
      address,
    });
    await conn.ready();

    mm(conn._circuitBreaker, 'allowRequest', () => false);
    mm(conn._circuitBreaker, 'latestHealthCount', new HealthCounts(1000, 600, 100000));

    const req = {
      serverSignature: 'helloworld.Greeter:1.0',
      methodName: 'SayHello',
      args: [{ name: 'world' }],
      requestProps: {},
      timeout: 3000,
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
    };
    const r = await conn.invoke(req, { proto });
    const err = r.error;
    assert(err && !r.appResponse);
    assert(err.name === 'GRpcCircuitBreakerError');
    assert(err.message === 'this request is block by circuit breaker, HealthCounts[600 / 1000 : 60%, avg rt : 100ms], url: http://127.0.0.1:8081/');
    conn.resetCounter();
    await conn.close();
  });
});
