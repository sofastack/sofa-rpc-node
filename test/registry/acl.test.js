'use strict';

const mm = require('mm');
const assert = require('assert');
const zookeeper = require('zookeeper-cluster-client');
const { ACL, Permission, Id } = require('node-zookeeper-client');
const ZookeeperRegistry = require('../../lib/registry/zk/data_client');

const logger = console;

describe('test/registry/acl.test.js', () => {
  let registry;
  let client;
  before(async function() {
    client = zookeeper.createClient('localhost:2181', {
      authInfo: {
        scheme: 'digest',
        auth: 'gxcsoccer:123456',
      },
    });

    await client.mkdirp('/acl');
    await client.setACL('/acl', [
      new ACL(
        Permission.ALL,
        new Id('auth', 'gxcsoccer:123456')
      ),
    ], -1);

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
    await client.close();
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
