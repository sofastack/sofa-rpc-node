'use strict';

const mm = require('mm');
const assert = require('assert');
const RpcService = require('../../').server.RpcService;
const logger = console;

describe('test/server/service-custom-metadata.test.js', () => {
  afterEach(mm.restore);
  it('should work ok', async function() {
    assert.throws(() => {
      new RpcService();
    }, null, '[RpcService] options.interfaceName is required');

    const service = new RpcService({
      interfaceName: 'com.node.test.TestService',
      version: '1.0',
      appName: 'test',
      group: 'SOFA',
      logger,
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
      customMeta: {
        release: '2.7.4.1',
      },
      delegate: {
        async plus(a, b) {
          return a + b;
        },
      },
    });
    await service.ready();

    assert(!service.app);
    assert(!service.registry);
    assert(!service.classMaps);

    assert.deepEqual(service.normalizeReg('bolt://127.0.0.1:12200'), {
      interfaceName: 'com.node.test.TestService',
      version: '1.0',
      group: 'SOFA',
      release: '2.7.4.1',
      url: 'bolt://127.0.0.1:12200?interface=com.node.test.TestService&version=1.0&group=SOFA&release=2.7.4.1',
    });

    await service.publish('bolt://127.0.0.1:12200');
    assert(!service.publishUrl);
    await service.unPublish();

    const ctx = {};
    const req = {
      data: {
        methodName: 'plus',
        args: [ 1, 2 ],
      },
      options: {
        timeout: 3000,
      },
    };
    const res = {
      isClosed: true,
      meta: {},
      remoteAddress: '127.0.0.1',
    };
    let executed = false;
    mm(service.logger, 'warn', message => {
      assert(message === '[RpcService] client maybe closed before sending response, remote address: %s');
      executed = true;
    });
    await service.invoke(ctx, req, res);
    assert(executed);
  });
});
