'use strict';

const mm = require('mm');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const ZookeeperRegistry = require('../../lib/registry/zk/data_client');

const cluster = function(clazz, options = {}) {
  options.port = 7778;
  options.singleMode = false;
  return require('cluster-client')(clazz, options);
};
const logger = console;
const innerClient = Symbol.for('ClusterClient#innerClient');

describe('test/registry/edge_case.test.js', () => {
  afterEach(mm.restore);

  it('should recover from disconnected', async function() {
    this.timeout(60000);
    const registry = new ZookeeperRegistry({
      logger,
      cluster,
      address: '127.0.0.1:2181',
    });
    await registry.ready();

    const interfaceName = 'com.nodejs.test.registry.TestService';

    await registry.register({
      interfaceName,
      url: 'bolt://127.0.0.2:12200',
    });

    let firstVal;
    registry.subscribe({
      interfaceName,
    }, val => {
      registry.emit('first', val);
      console.log('first', val);
      firstVal = val;
    });

    let val = await registry.await('first');
    assert.deepEqual(val, [ 'bolt://127.0.0.2:12200' ]);

    const connectionManager = registry._zkClient._client[innerClient]._realClient._zookeeperClient.connectionManager;
    const connect = connectionManager.connect;

    mm(connectionManager, 'connect', function() {
      setTimeout(() => {
        mm.restore();
        connect.call(connectionManager);
      }, 40000);
    });
    connectionManager.socket.destroy();

    const registry2 = new ZookeeperRegistry({
      logger,
      address: '127.0.0.1:2181',
    });
    registry2.register({
      interfaceName,
      url: 'bolt://127.0.0.3:12200',
    });

    await registry.await('connected');
    await sleep(3000);

    registry.subscribe({
      interfaceName,
    }, val => {
      registry.emit('second', val);
    });

    val = await registry.await('second');
    assert.deepEqual(val, [ 'bolt://127.0.0.2:12200', 'bolt://127.0.0.3:12200' ]);
    assert.deepEqual(firstVal, [ 'bolt://127.0.0.2:12200', 'bolt://127.0.0.3:12200' ]);

    registry.close();
    registry2.close();
  });
});
