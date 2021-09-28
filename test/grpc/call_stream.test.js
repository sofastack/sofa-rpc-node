'use strict';

const mm = require('mm');
const path = require('path');
const http2 = require('http2');
const antpb = require('antpb');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const { GRpcServer } = require('../../').server;
const CallStream = require('../../lib/client/connection/grpc/call_stream');

const port = 8082;
const logger = console;
const url = 'http://127.0.0.1:' + port;
const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));

describe('test/grpc/call_stream.test.js', () => {
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

  it('should call ok', async function() {
    const session = http2.connect(url);
    const stream = new CallStream(session, proto);

    const req = {
      serverSignature: 'helloworld.Greeter:1.0',
      methodName: 'SayHello',
      args: [{ name: 'world' }],
      requestProps: {
        foo: 'bar',
      },
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
    const res = await stream.call(req);
    assert.deepEqual(res.data, {
      appResponse: { message: 'hello world' },
      error: undefined,
    });
    // TODO: NODE 8 没有收到 trailer ?
    // assert(res.meta && res.meta['grpc-status'] === '0');
    // assert(res.meta['grpc-message'] === 'OK');

    session.close();
  });

  it('should handle DecodeResponseHeadersError', async function() {
    const session = http2.connect(url);
    const stream = new CallStream(session, proto);

    const req = {
      serverSignature: 'helloworld.Greeter:1.0',
      methodName: 'SayHello',
      args: [{ name: 'world' }],
      requestProps: {
        foo: 'bar',
      },
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
    mm(stream._responseMetadata, 'fromHttp2Headers', () => { throw new Error('mock error'); });
    const res = await stream.call(req);
    assert(res && res.data);
    assert(!res.data.appResponse);
    assert(res.data.error && res.data.error.message === 'mock error');

    stream._handleTrailers({
      'grpc-status': '14',
      'grpc-message': 'UNAVAILABLE',
    });

    assert(stream._mappedStatusCode === 0);

    mm.restore();
    mm(stream, '_mappedStatusCode', 2);

    stream._handleTrailers({
      'grpc-status': '14',
      'grpc-message': 'UNAVAILABLE',
    });

    assert(stream._mappedStatusCode === 14);
    assert(stream._statusMessage === 'UNAVAILABLE');

    session.close();
  });

  [
    // 'NGHTTP2_CANCEL',
    'NGHTTP2_REFUSED_STREAM',
    'NGHTTP2_ENHANCE_YOUR_CALM',
    'NGHTTP2_INADEQUATE_SECURITY',
  ].forEach(errorCode => {
    it('should handle errorCode ' + errorCode, async function() {
      const session = http2.connect(url);
      const stream = new CallStream(session, proto);

      const req = {
        serverSignature: 'helloworld.Greeter:1.0',
        methodName: 'SayHello',
        args: [{ name: 'world' }],
        requestProps: {
          foo: 'bar',
        },
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

      const num = http2.constants[errorCode];
      setImmediate(() => {
        stream._http2Stream.close(num);
      });

      const res = await stream.call(req);
      assert(res && res.data);
      // assert(!res.data.appResponse);
      // assert(res.data.error &&
      //   (
      //     res.data.error.message === 'Stream closed with error code ' + errorCode ||
      //     res.data.error.message === 'Stream closed with errorCode: ' + num
      //   )
      // );
    });
  });
});
