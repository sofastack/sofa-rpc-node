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

    it('should filter with version & group', async () => {
      const reg1 = {
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
        url: 'dubbo://127.0.0.1:12200/org.apache.dubbo.demo.DemoService?accepts=100000&appName=&application=demo-consumer&check=false&dubbo=2.0.2&dynamic=true&group=HSF&interface=org.apache.dubbo.demo.DemoService&language=nodejs&methods=sayHello&pid=45510&qos.port=33333&register.ip=192.168.1.13&revision=1.0.0&rpcVer=50400&serialization=hessian2&side=consumer&startTime=1540925808939&timeout=3000&timestamp=1540925836963&uniqueId=&version=1.0.0&weight=100',
      };
      const reg2 = {
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0.test',
        group: 'HSF',
        url: 'dubbo://127.0.0.2:12200?uniqueId=&version=1.0.0.test&timeout=0&delay=-1&id=rpc-cfg-0&dynamic=true&weight=100&accepts=100000&startTime=1526050447423&pid=13862&language=java&rpcVer=50400&group=HSF&interface=org.apache.dubbo.demo.DemoService',
      };
      const reg3 = {
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'SOFA',
        url: 'dubbo://127.0.0.3:12200?uniqueId=&version=1.0&timeout=0&delay=-1&id=rpc-cfg-0&dynamic=true&weight=100&accepts=100000&startTime=1526050447423&pid=13862&language=java&rpcVer=50400&group=SOFA&interface=org.apache.dubbo.demo.DemoService',
      };
      registry.register(reg1);
      registry.register(reg2);
      registry.register(reg3);

      await sleep(2000);

      let addressList;
      const listener = val => {
        addressList = val;
        registry.emit('address_update', val);
      };
      registry.subscribe({
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
      }, listener);

      await registry.await('address_update');

      registry.unSubscribe({
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
      });

      assert(addressList && addressList.length === 1);
      assert(addressList[0].startsWith('dubbo://127.0.0.1:12200'));

      await registry.unRegister(reg1);
      await registry.unRegister(reg2);
      await registry.unRegister(reg3);
    });

    it('should filter with interfaceName', async () => {
      const reg1 = {
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
        url: 'dubbo://127.0.0.1:12200/org.apache.dubbo.demo.DemoService?accepts=100000&appName=&application=demo-consumer&check=false&dubbo=2.0.2&dynamic=true&default.group=HSF&interface=org.apache.dubbo.demo.DemoService&language=nodejs&methods=sayHello&pid=45510&qos.port=33333&register.ip=192.168.1.13&revision=1.0.0&rpcVer=50400&serialization=hessian2&side=consumer&startTime=1540925808939&timeout=3000&timestamp=1540925836963&uniqueId=&default.version=1.0.0&weight=100',
      };
      const reg2 = {
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
        url: 'dubbo://127.0.0.2:12200?uniqueId=&version=1.0.0.test&timeout=0&delay=-1&id=rpc-cfg-0&dynamic=true&weight=100&accepts=100000&startTime=1526050447423&pid=13862&language=java&rpcVer=50400&group=HSF&interface=org.apache.dubbo.demo.HelloService',
      };
      const reg3 = {
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
        url: 'dubbo://127.0.0.3:12200?uniqueId=&version=1.0&timeout=0&delay=-1&id=rpc-cfg-0&dynamic=true&weight=100&accepts=100000&startTime=1526050447423&pid=13862&language=java&rpcVer=50400&group=HSF&interface=org.apache.dubbo.demo.DemoService&category=routers',
      };
      const reg4 = {
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
        url: 'dubbo://127.0.0.4:12200?uniqueId=&version=1.0&timeout=0&delay=-1&id=rpc-cfg-0&dynamic=true&weight=100&accepts=100000&startTime=1526050447423&pid=13862&language=java&rpcVer=50400&group=HSF&interface=org.apache.dubbo.demo.DemoService&enabled=false',
      };
      registry.register(reg1);
      registry.register(reg2);
      registry.register(reg3);
      registry.register(reg4);

      await sleep(2000);

      let addressList;
      const listener = val => {
        addressList = val;
        registry.emit('address_update', val);
      };
      registry.subscribe({
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
      }, listener);

      await registry.await('address_update');

      registry.unSubscribe({
        interfaceName: 'org.apache.dubbo.demo.DemoService',
        version: '1.0.0',
        group: 'HSF',
      });

      assert(addressList && addressList.length === 1);
      assert(addressList[0].startsWith('dubbo://127.0.0.1:12200'));

      await registry.unRegister(reg1);
      await registry.unRegister(reg2);
      await registry.unRegister(reg3);
      await registry.unRegister(reg4);
    });

    it('should filter with interfaceName', async () => {
      const reg1 = {
        interfaceName: 'com.alipay.sofa.rpc.test.SimpleService',
        version: '1.0',
        group: 'SOFA',
        url: 'bolt://127.0.0.1:12200?interface=com.alipay.sofa.rpc.test.SimpleService&group=SOFA&version=1.0',
      };
      const reg2 = {
        interfaceName: 'com.alipay.sofa.rpc.test.SimpleService',
        version: '1.0',
        group: 'SOFA',
        url: 'bolt://127.0.0.1:12200?interface=com.alipay.sofa.rpc.test.SimpleService&group=SOFA',
      };
      const reg3 = {
        interfaceName: 'com.alipay.sofa.rpc.test.SimpleService',
        version: '1.0',
        group: 'SOFA',
        url: 'bolt://127.0.0.1:12200?interface=com.alipay.sofa.rpc.test.SimpleService&version=1.0',
      };
      registry.register(reg1);
      registry.register(reg2);
      registry.register(reg3);
      await sleep(2000);

      let addressList;
      const listener = val => {
        addressList = val;
        registry.emit('address_update', val);
      };
      registry.subscribe({
        interfaceName: 'com.alipay.sofa.rpc.test.SimpleService',
        version: '1.0',
        group: 'SOFA',
      }, listener);

      await registry.await('address_update');

      registry.unSubscribe({
        interfaceName: 'com.alipay.sofa.rpc.test.SimpleService',
        version: '1.0',
        group: 'SOFA',
      });

      assert(addressList && addressList.length === 3);

      await registry.unRegister(reg1);
      await registry.unRegister(reg2);
      await registry.unRegister(reg3);
    });
  });
});
