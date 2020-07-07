'use strict';

const mm = require('mm');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');
const ZookeeperRegistry = require('../../lib/registry/zk/data_client');

const logger = console;

describe('test/registry/acl.test.js', () => {
  let registry;

  before(async function() {
    cp.spawnSync('node', [ path.join(__dirname, 'acl.js') ], { stdio: 'inherit' });

    registry = new ZookeeperRegistry({
      logger,
      address: 'localhost:2181/acl/sofa-rpc',
      authInfo: {
        scheme: 'digest',
        auth: 'gxcsoccer:123456',
      },
    });
    await registry.ready();
  });
  after(async function() {
    await registry.close();
  });
  afterEach(() => {
    mm.restore();
  });

  it('should subscribe & publish ok', async () => {
    registry.subscribe({
      interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
    }, val => {
      registry.emit('address_update', val);
    });

    let addressList = await registry.await('address_update');
    assert(addressList && addressList.length === 0);

    registry.register({
      interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
      url: 'bolt://127.0.0.1:12200',
    });

    addressList = await registry.await('address_update');
    assert(addressList && addressList.length === 1);
    assert(addressList[0] === 'bolt://127.0.0.1:12200');

    registry.register({
      interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
      url: 'bolt://127.0.0.2:12200',
    });

    addressList = await registry.await('address_update');
    assert(addressList && addressList.length === 2);
    assert(addressList.some(addr => addr === 'bolt://127.0.0.1:12200'));
    assert(addressList.some(addr => addr === 'bolt://127.0.0.2:12200'));

    registry.unRegister({
      interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
      url: 'bolt://127.0.0.1:12200',
    });

    addressList = await registry.await('address_update');
    assert(addressList && addressList.length === 1);
    assert(addressList[0] === 'bolt://127.0.0.2:12200');

    registry.unRegister({
      interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
      url: 'bolt://127.0.0.2:12200',
    });

    addressList = await registry.await('address_update');
    assert(addressList && addressList.length === 0);
  });

  it('should not subscribe ok without authInfo', async () => {
    const registry = new ZookeeperRegistry({
      logger,
      address: '127.0.0.1:2181/acl/sofa-rpc',
    });
    await registry.ready();

    registry.subscribe({
      interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
    }, val => {
      registry.emit('address_update', val);
    });

    try {
      await registry.await('error');
    } catch (err) {
      console.log(err);
      assert(err.name === 'NO_AUTH');
      assert(err.code === -102);
    }

    await registry.close();
  });
});
