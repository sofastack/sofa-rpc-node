'use strict';

const mm = require('mm');
const net = require('net');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const request = require('../../').test;
const dubboProtocol = require('dubbo-remoting');
const RpcClient = require('../../').client.RpcClient;
const RpcServer = require('../../').server.RpcServer;
const protocol = require('sofa-bolt-node/lib/protocol');
const ZookeeperRegistry = require('../../').registry.ZookeeperRegistry;

const logger = console;
const version = process.versions.node;

describe('test/server.test.js', () => {
  let client;
  let server;
  let registry;

  afterEach(mm.restore);

  before(async function() {
    registry = new ZookeeperRegistry({
      logger,
      address: '127.0.0.1:2181',
    });
    client = new RpcClient({
      registry,
      logger,
    });
    await registry.ready();
    await client.ready();
  });

  after(async function() {
    await client.close();
    await registry.close();
  });

  it('should format url without rpcVersion', async function() {
    server = new RpcServer({
      appName: 'test',
      registry,
      logger,
      codecType: 'protobuf',
    });
    assert(server.url.endsWith('dynamic=true&appName=test&timeout=3000&serialization=protobuf&weight=100&accepts=100000&language=nodejs&rpcVer=50400&protocol='));
    await server.close();
  });

  it('should format url with property protocol type', async function() {
    server = new RpcServer({
      appName: 'test',
      protocol: dubboProtocol,
      logger,
      codecType: 'hessian2',
    });
    assert(server.url.startsWith('dubbo://'));
    assert(server.url.endsWith('dynamic=true&appName=test&timeout=3000&serialization=hessian2&weight=100&accepts=100000&language=nodejs&rpcVer=50400&protocol=dubbo'));
    await server.close();
  });

  it('should handleRequest error', async () => {
    server = new RpcServer({
      appName: 'test',
      registry,
      logger,
    });
    await server.start();

    const buf = protocol.requestEncode(1, {
      serverSignature: null,
      methodName: 'foo',
      targetAppName: 'test',
      args: [],
      timeout: 3000,
    }, {
      protocolType: 'bolt',
      codecType: 'hessian2',
      boltVersion: 1,
      sofaVersion: '',
      crcEnable: false,
    });
    const socket = net.connect(12200, '127.0.0.1');
    socket.write(buf);

    try {
      await server.await('error');
    } catch (err) {
      console.log(err);
      assert(err.message.includes('Cannot read property \'split\' of null'));
      assert(err.req);
      assert(err.req.packetId === 1);
      assert.deepEqual(err.req.data, {
        methodName: 'foo',
        serverSignature: null,
        args: [],
        methodArgSigs: [],
        requestProps: null,
        targetAppName: 'test',
      });
    }
    socket.destroy();
    await server.close();
  });


  describe('bolt', () => {
    before(async function() {
      server = new RpcServer({
        appName: 'test',
        registry,
        version,
        logger,
        port: 0,
      });
      server.on('error', err => console.error(err));
      server.addService({
        interfaceName: 'com.alipay.x.facade.HelloRpcFacade',
        version,
        apiMeta: {
          methods: [{
            name: 'plus',
            parameterTypes: [
              'java.lang.Integer',
              'java.lang.Integer',
            ],
            returnType: 'java.lang.Integer',
          }],
        },
      }, {
        // a + b
        async plus(a, b) {
          return a + b;
        },
      });
      server.addService({
        interfaceName: 'com.alipay.test.TestService',
      }, {
        async timeout() {
          await sleep(2000);
          return 'ok';
        },
        async error() {
          throw new Error('mock error');
        },
      });
      server.addService({
        interfaceName: 'com.alipay.test.HelloService',
        version,
        uniqueId: 'hello',
      }, {
        async hello() {
          await sleep(2000);
          return 'hello';
        },
      });
      await server.start();
      await server.publish();
    });
    after(async function() {
      await server.close();
    });

    it('should delegate provider error event', done => {
      server.once('error', err => {
        assert(err && err.message === 'mock error');
        done();
      });

      const id = 'com.alipay.x.facade.HelloRpcFacade:' + version;
      assert(server.services.has(id));
      const service = server.services.get(id);
      service.emit('error', new Error('mock error'));
    });

    it('should serve service ok', async function() {
      await server.start();
      const id = 'com.alipay.x.facade.HelloRpcFacade:' + version;
      const consumer = client.createConsumer({
        interfaceName: 'com.alipay.x.facade.HelloRpcFacade',
        version,
      });
      await consumer.ready();

      let req;
      let res;
      server.once('request', data => { req = data.req; });
      server.once('response', data => { res = data.res; });

      const result = await consumer.invoke('plus', [ 1, 2 ]);

      assert(req && req.data);
      assert(req.data.methodName === 'plus');
      assert(req.data.serverSignature === id);
      assert.deepEqual(req.data.args, [ 1, 2 ]);
      assert.deepEqual(req.data.requestProps, { service: 'com.alipay.x.facade.HelloRpcFacade:' + version });
      assert(res && res.req === req);
      assert(res.meta);
      assert(res.meta.start);
      assert(res.meta.rt >= 0);
      assert(res.meta.responseEncodeRT >= 0);
      assert(res.meta.resultCode === '00');
      assert(res.socket && res.remoteAddress);
      console.log(res.meta);
      assert(result === 3);

      server.getConnections((err, count) => {
        assert.ifError(err);
        assert(count);
        console.log('connections count', count);
      });
    });

    it('should intercept request service ok', async function() {
      await server.start();
      const consumer = client.createConsumer({ interfaceName: 'com.alipay.x.facade.HelloRpcFacade', version });
      await consumer.ready();

      let res;
      let req;

      server.once('request', data => {
        req = data.req;
        req.method = async () => {
          const err = new Error('SystemException');
          err.name = 'SystemError';
          err.resultCode = '02';
          err.stack = '';
          throw err;
        };
      });

      server.once('response', data => { res = data.res; });

      let error;
      try {
        await consumer.invoke('plus', [ 1, 2 ]);
      } catch (e) {
        error = e;
      }
      assert(error.message = 'SystemError: SystemException');
      assert(res.meta.resultCode === '02');

      assert(req && req.data);
      assert(req.data.methodName === 'plus');
      assert(req.data.serverSignature === 'com.alipay.x.facade.HelloRpcFacade:' + version);
      assert.deepEqual(req.data.args, [ 1, 2 ]);
      assert.deepEqual(req.data.requestProps, { service: 'com.alipay.x.facade.HelloRpcFacade:' + version });
      assert(res && res.req === req);
      assert(res.meta);
      assert(res.meta.start);
      assert(res.meta.rt >= 0);
      assert(res.meta.responseEncodeRT >= 0);
      assert(res.meta.resultCode === '02');
      assert(res.socket && res.remoteAddress);
      console.log(res.meta);
    });

    it('should invoke ok', () => {
      return request(server)
        .service('com.alipay.x.facade.HelloRpcFacade')
        .invoke('plus')
        .send([ 1, 2 ])
        .expect(3);
    });

    it('should throw error if method not exists', () => {
      return request(server)
        .service('com.alipay.x.facade.HelloRpcFacade')
        .invoke('not-exists')
        .send([])
        .catch(err => {
          assert(err && err.message === 'com.alipay.remoting.rpc.exception.RpcServerException: Error: Can not find method: com.alipay.x.facade.HelloRpcFacade:' + version + '#not-exists()');
        });
    });

    it('should invoke timeout', async () => {
      let meta;
      server.once('response', data => {
        meta = data.res.meta;
      });
      await request(server)
        .service('com.alipay.test.TestService')
        .invoke('timeout')
        .timeout(1000)
        .send([])
        .error('name', 'RpcResponseTimeoutError');
      await sleep(2000);
      assert(meta.resultCode === '03');
    });

    it('should resultCode=01 if biz error', async function() {
      let meta;
      server.once('response', data => {
        meta = data.res.meta;
      });

      await request(server)
        .service('com.alipay.test.TestService')
        .invoke('error')
        .timeout(1000)
        .send([])
        .error(/mock error/);

      assert(meta && meta.resultCode === '01');
    });

    it('should resultCode=02 if service not found', async function() {
      let meta;
      server.once('response', data => {
        meta = data.res.meta;
      });

      await request(server)
        .service('not-exists')
        .invoke('error')
        .timeout(1000)
        .send([])
        .error(/not found service: not-exists/);

      assert(meta && meta.resultCode === '02');
    });

    it('should warn if add duplicate service', () => {
      server.addService({
        interfaceName: 'com.alipay.test.DuplicateService',
        version,
      }, {
        async echo(data) {
          return data;
        },
      });
      const id = 'com.alipay.test.DuplicateService:' + version;
      assert(server.services);
      assert(server.services.has(id));

      mm(server.logger, 'warn', message => {
        assert(message === '[RpcServer] service: %s already added, will override it');
      });

      server.addService({
        interfaceName: 'com.alipay.test.DuplicateService',
        version,
      }, {
        async echo2(data) {
          return data;
        },
      });

      assert(server.services.has(id));
      const service = server.services.get(id);
      assert(service.delegate && service.delegate.echo2);
      assert(!service.delegate.echo);
    });

    it('should addService dynamic', async function() {
      server.addService({
        interfaceName: 'com.alipay.test.EchoService',
        version,
      }, {
        async echo(data) {
          return data;
        },
      });
      await request(server)
        .service('com.alipay.test.EchoService')
        .invoke('echo')
        .send([ 'hello world' ])
        .expect('hello world');
    });

    it('should ready failed cause by EADDRINUSE', async function() {
      const server_1 = new RpcServer({
        appName: 'test',
        registry,
        logger: console,
      });
      await server_1.start();

      try {
        const server_2 = new RpcServer({
          appName: 'test_2',
          registry,
          logger: console,
        });
        await server_2.start();
        assert(false);
      } catch (err) {
        assert(err && err.message.includes('listen EADDRINUSE'));
      }

      await server_1.close();
    });
  });

});
