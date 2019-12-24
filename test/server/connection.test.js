'use strict';

const mm = require('mm');
const net = require('net');
const path = require('path');
const pump = require('pump');
const antpb = require('antpb');
const assert = require('assert');
const urlparse = require('url').parse;
const awaitEvent = require('await-event');
const protocol = require('sofa-bolt-node');
const RpcConnection = require('../../lib/server/connection');

const classMap = require('../fixtures/class_map');
const logger = console;
const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));

describe('test/server/connection.test.js', () => {
  let server;
  let port;
  let connection;

  const obj = {
    b: true,
    name: 'testname',
    field: 'xxxxx',
    testObj2: { name: 'xxx', finalField: 'xxx' },
    testEnum: { name: 'B' },
    testEnum2: [{ name: 'B' }, { name: 'C' }],
    bs: Buffer.from([ 0x02, 0x00, 0x01, 0x07 ]),
    list1: [{ name: 'A' }, { name: 'B' }],
    list2: [ 2017, 2016 ],
    list3: [{ name: 'aaa', finalField: 'xxx' },
      { name: 'bbb', finalField: 'xxx' },
    ],
    list4: [ 'xxx', 'yyy' ],
    list5: [ Buffer.from([ 0x02, 0x00, 0x01, 0x07 ]), Buffer.from([ 0x02, 0x00, 0x01, 0x06 ]) ],
    map1: { 2017: { name: 'B' } },
    map2: new Map([
      [ 2107, 2016 ],
    ]),
    map3: {},
    map4: { xxx: 'yyy' },
    map5: { 2017: Buffer.from([ 0x02, 0x00, 0x01, 0x06 ]) },
  };

  beforeEach(async function() {
    await new Promise(resolve => {
      server = net.createServer();
      server.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterEach(async function() {
    mm.restore();
    if (connection) {
      await connection.close();
    }
    await new Promise(resolve => {
      server.close(() => { resolve(); });
    });
  });

  it('should check options', () => {
    assert.throws(() => {
      connection = new RpcConnection();
    }, null, '[RpcConnection] options.socket is required');

    assert.throws(() => {
      connection = new RpcConnection({ socket: true });
    }, null, '[RpcConnection] options.logger is required');
  });


  it('should RpcConnection works', async function() {
    const address = urlparse('bolt://127.0.0.1:' + port + '?serialization=hessian2', true);
    const clientSocket = net.connect(port, '127.0.0.1');
    const socket = await awaitEvent(server, 'connection');
    connection = new RpcConnection({ logger, socket, classMap });
    await connection.ready();

    const opts = {
      sentReqs: new Map(),
      classCache: new Map(),
      address,
      classMap,
    };
    const encoder = protocol.encoder(opts);
    const decoder = protocol.decoder(opts);

    pump(encoder, clientSocket, decoder, err => {
      if (err) {
        console.error(err);
      }
    });

    encoder.writeRequest(1000, {
      args: [{
        $class: 'com.alipay.test.TestObj',
        $: obj,
      }],
      serverSignature: 'com.alipay.test.TestService:1.0',
      methodName: 'echoObj',
      requestProps: {
        rpc_trace_context: {
          sofaRpcId: '0.1',
          sofaCallerIp: '127.0.0.1',
          sofaTraceId: '0a0fe66b14781611353261001',
          sofaPenAttrs: 'mark=T&',
          sofaCallerApp: 'test',
        },
      },
      timeout: 3000,
    });

    const req = await connection.await('request');
    connection.send(req, {
      isError: false,
      errorMsg: null,
      appResponse: obj,
    });

    const res = await awaitEvent(decoder, 'response');
    assert(res && res.packetId === 1000);
    assert(res.packetType === 'response');

    assert(res.data && res.data.appResponse);
    assert.deepEqual(res.data.appResponse.map2, { 2107: 2016 });
    res.data.appResponse.map2 = new Map([
      [ 2107, 2016 ],
    ]);

    assert.deepEqual(res.data, {
      error: null,
      appResponse: obj,
      responseProps: null,
    });
    assert.deepEqual(res.options, {
      protocolType: 'bolt',
      codecType: 'hessian2',
    });
    assert(res.meta && res.meta.size > 0);

    assert(Date.now() - connection.lastActiveTime < 20);
    assert(connection.remoteAddress === socket.remoteAddress + ':' + socket.remotePort);

    encoder.writeHeartbeat(1001, { clientUrl: clientSocket.remoteAddress + ':' + clientSocket.remotePort });

    const hbAck = await awaitEvent(decoder, 'heartbeat_ack');

    assert(hbAck && hbAck.packetId === 1001);
    assert(hbAck.packetType === 'heartbeat_ack');
    assert.deepEqual(hbAck.options, { protocolType: 'bolt', codecType: 'hessian2' });

    await connection.close();
  });

  it('should handle socket error', async function() {
    const address = urlparse('bolt://127.0.0.1:' + port + '?serialization=hessian2', true);
    const clientSocket = net.connect(address.port, address.hostname);
    const socket = await awaitEvent(server, 'connection');

    connection = new RpcConnection({ logger, socket, classMap });
    await connection.ready();

    mm(connection.logger, 'warn', msg => {
      assert(msg === '[RpcConnection] error occured on socket: %s, errName: %s, errMsg: %s');
    });

    clientSocket.write(Buffer.from('hello world++++++++++++++++++++++++++++++++'));

    await connection.await('close');
  });

  it('should handle ECONNRESET error', async function() {
    const address = urlparse('bolt://127.0.0.1:' + port + '?serialization=hessian2', true);
    net.connect(address.port, address.hostname);
    const socket = await awaitEvent(server, 'connection');

    connection = new RpcConnection({ logger, socket, classMap });
    await connection.ready();

    mm(connection.logger, 'warn', () => {
      assert(false);
    });

    const err = new Error('mock error');
    err.code = 'ECONNRESET';
    socket.destroy(err);

    await connection.await('close');
  });

  it('should close socket for long time idle', async function() {
    const address = urlparse('bolt://127.0.0.1:' + port + '?serialization=hessian2', true);
    net.connect(address.port, address.hostname);
    const socket = await awaitEvent(server, 'connection');

    connection = new RpcConnection({ logger, socket, classMap, maxIdleTime: 2000 });
    await connection.ready();

    mm(connection.logger, 'warn', msg => {
      assert(msg === '[RpcConnection] socket: %s is idle for %s(ms)');
    });

    await connection.await('close');
  });

  it('should support protobuf', async function() {
    const address = urlparse('bolt://127.0.0.1:' + port + '?serialization=protobuf', true);
    const clientSocket = net.connect(port, '127.0.0.1');
    const socket = await awaitEvent(server, 'connection');
    connection = new RpcConnection({ logger, socket, proto });
    await connection.ready();

    const opts = {
      sentReqs: new Map(),
      classCache: new Map(),
      address,
      proto,
    };
    const encoder = protocol.encoder(opts);
    const decoder = protocol.decoder(opts);

    pump(encoder, clientSocket, decoder, err => {
      if (err) {
        console.error(err);
      }
    });

    const r = {
      args: [{
        name: 'Peter',
        group: 'B',
      }],
      serverSignature: 'com.alipay.sofa.rpc.test.ProtoService:1.0',
      methodName: 'echoObj',
      requestProps: {
        rpc_trace_context: {
          sofaRpcId: '0.1',
          sofaCallerIp: '127.0.0.1',
          sofaTraceId: '0a0fe66b14781611353261001',
          sofaPenAttrs: 'mark=T&',
          sofaCallerApp: 'test',
        },
      },
      timeout: 3000,
    };
    opts.sentReqs.set(1, { req: r });
    encoder.writeRequest(1, r);

    const req = await connection.await('request');
    const reqData = req.data.args[0].toObject({ enums: String });
    connection.send(req, {
      isError: false,
      errorMsg: null,
      appResponse: {
        code: 200,
        message: 'Hello ' + reqData.name + ', you are in ' + reqData.group + ' group',
      },
    });

    const res = await awaitEvent(decoder, 'response');
    assert(res && res.packetId === 1);
    assert(res.packetType === 'response');

    assert(res.data && res.data.appResponse);
    assert.deepEqual(res.data.appResponse, {
      code: 200,
      message: 'Hello Peter, you are in B group',
    });
    assert.deepEqual(res.options, {
      protocolType: 'bolt',
      codecType: 'protobuf',
    });
    assert(res.meta && res.meta.size > 0);

    assert(Date.now() - connection.lastActiveTime < 20);
    assert(connection.remoteAddress === socket.remoteAddress + ':' + socket.remotePort);

    await connection.close();
  });

  it('disable decode cache should works', async function() {
    const address = urlparse('bolt://127.0.0.1:' + port + '?serialization=hessian2', true);
    const clientSocket = net.connect(port, '127.0.0.1');
    const socket = await awaitEvent(server, 'connection');
    connection = new RpcConnection({
      logger,
      socket,
      classMap,
      disableDecodeCache: true,
    });
    await connection.ready();

    const opts = {
      sentReqs: new Map(),
      classCache: new Map(),
      address,
      classMap,
    };
    const encoder = protocol.encoder(opts);
    const decoder = protocol.decoder(opts);

    pump(encoder, clientSocket, decoder, err => {
      if (err) {
        console.error(err);
      }
    });

    encoder.writeRequest(1000, {
      args: [{
        $class: 'com.alipay.test.Test2Obj',
        $: {
          name: 'testname',
          field: 'xxxxx',
        },
      }],
      serverSignature: 'com.alipay.test.TestService:1.0',
      methodName: 'echoObj',
      requestProps: {
        rpc_trace_context: {
          sofaRpcId: '0.1',
          sofaCallerIp: '127.0.0.1',
          sofaTraceId: '0a0fe66b14781611353261001',
          sofaPenAttrs: 'mark=T&',
          sofaCallerApp: 'test',
        },
      },
      timeout: 3000,
    });

    const req = await connection.await('request');
    assert.deepStrictEqual(req.data.args, [{ name: 'testname', field: 'xxxxx' }]);

    encoder.writeRequest(1000, {
      args: [{
        $class: 'com.alipay.test.Test2Obj',
        $: {
          // If use key cache, decode will get wrong result because key order is different
          field: 'xxxxx',
          name: 'testname',
        },
      }],
      serverSignature: 'com.alipay.test.TestService:1.0',
      methodName: 'echoObj',
      requestProps: {
        rpc_trace_context: {
          sofaRpcId: '0.1',
          sofaCallerIp: '127.0.0.1',
          sofaTraceId: '0a0fe66b14781611353261001',
          sofaPenAttrs: 'mark=T&',
          sofaCallerApp: 'test',
        },
      },
      timeout: 3000,
    });

    const req2 = await connection.await('request');
    assert.deepStrictEqual(req2.data.args, [{ name: 'testname', field: 'xxxxx' }]);

    await connection.close();
  });
});
