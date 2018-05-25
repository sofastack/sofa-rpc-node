'use strict';

const mm = require('mm');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const ZookeeperRegistry = require('../../lib/registry').ZookeeperRegistry;

const logger = console;

describe('test/registry/index.test.js', () => {
  describe('zk', () => {
    let registry;
    before(async function() {
      registry = new ZookeeperRegistry({
        logger,
        address: '127.0.0.1:2181',
      });
      await registry.ready();
    });
    after(async function() {
      await registry.close();
    });
    afterEach(() => {
      mm.restore();
    });

    it('should register / subscribe ok', async () => {
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

    it('should unSubscribe ok', async () => {
      let addressList;
      const listener = val => {
        addressList = val;
        registry.emit('address_update', val);
      };
      registry.subscribe({
        interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
      }, listener);

      await registry.await('address_update');
      assert(addressList && addressList.length === 0);

      registry.register({
        interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
        url: 'bolt://127.0.0.1:12200',
      });

      await registry.await('address_update');
      assert(addressList && addressList.length === 1);
      assert(addressList[0] === 'bolt://127.0.0.1:12200');

      registry.unSubscribe({
        interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
      }, listener);

      registry.unRegister({
        interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
        url: 'bolt://127.0.0.1:12200',
      });

      await Promise.race([
        registry.await('address_update'),
        sleep(1000),
      ]);

      assert(addressList && addressList.length === 1);
      assert(addressList[0] === 'bolt://127.0.0.1:12200');
    });

    it('should support register duplicate', async () => {
      let addressList;
      const listener = val => {
        addressList = val;
        registry.emit('address_update', val);
      };
      registry.subscribe({
        interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
      }, listener);

      await registry.await('address_update');
      assert(addressList && addressList.length === 0);

      registry.register({
        interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
        url: 'bolt://127.0.0.1:12200',
      });
      registry.register({
        interfaceName: 'com.alipay.sofa.rpc.test.HelloService',
        url: 'bolt://127.0.0.1:12200',
      });

      await registry.await('address_update');
      assert(addressList && addressList.length === 1);
      assert(addressList[0] === 'bolt://127.0.0.1:12200');
    });
  });
});
