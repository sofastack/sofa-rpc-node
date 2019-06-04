'use strict';

const mm = require('mm');
const assert = require('assert');
const utility = require('utility');
const urlparse = require('url').parse;
const sleep = require('mz-modules/sleep');
const AddressGroup = require('../../lib/client/address_group');
const DynamicConfig = require('../../lib/client/dynamic_config');
const ConnectionManager = require('../../').client.RpcConnectionMgr;
const MockConnection = require('../fixtures/mock_connection');
const RpcRequest = require('../../').client.RpcRequest;
const utils = require('../utils');
const logger = console;

describe('test/client/address_group.test.js', () => {
  let connectionManager;
  before(() => {
    connectionManager = new ConnectionManager({ logger });
  });

  after(async function() {
    await connectionManager.close();
  });

  const args = [{
    $class: 'java.lang.String',
    $: '123',
  }];
  const req = new RpcRequest({
    serverSignature: 'com.alipay.test.TestService:1.0',
    methodName: 'echo',
    args,
    requestProps: {},
    timeout: 3000,
  });

  it('should ready even if _connectAll failed', async function() {
    const addressGroup = new AddressGroup({
      key: 'xxx',
      logger,
      connectionManager,
    });
    mm(addressGroup, '_connectAll', () => {
      return Promise.reject(new Error('123'));
    });
    addressGroup.addressList = [
      urlparse('bolt://127.0.0.1:13201', true),
      urlparse('bolt://127.0.0.1:13202', true),
      urlparse('bolt://2.2.2.2:12200', true),
    ];

    try {
      await addressGroup.ready();
    } catch (err) {
      assert(err.message === '123');
    }
    await addressGroup.close();
  });

  it('should ready even if _connectAll failed', async function() {
    const addressGroup = new AddressGroup({
      key: 'xxx',
      logger,
      connectionManager,
      waitConnect: false,
    });
    mm(addressGroup, '_connectAll', () => {
      return Promise.reject(new Error('123'));
    });
    addressGroup.addressList = [
      urlparse('bolt://127.0.0.1:13201', true),
      urlparse('bolt://127.0.0.1:13202', true),
      urlparse('bolt://2.2.2.2:12200', true),
    ];

    try {
      await addressGroup.await('error');
    } catch (err) {
      assert(err && err.message === '123');
    }
    await addressGroup.ready();
    await addressGroup.close();
  });

  it('should not change weight for invalid address', async function() {
    const addressGroup = new AddressGroup({
      key: 'yyy',
      logger,
      connectionManager,
    });
    addressGroup.addressList = [];
    await addressGroup.ready();
    addressGroup.addressList = [
      urlparse('bolt://2.2.2.2:12200', true),
    ];
    const debug = logger.debug;
    let run = false;
    mm(logger, 'debug', (...args) => {
      debug.apply(logger, args);
      if (args[0].includes('total request count: ')) {
        run = true;
      }
    });
    await addressGroup._healthCounter.await('next');

    assert(!run);
    addressGroup.close();
  });

  it('保证先建连才会被路由到', async function() {
    await Promise.all([
      utils.startServer(13201),
      utils.startServer(13202),
    ]);

    const addressGroup = new AddressGroup({
      key: 'xxx',
      logger,
      connectionManager,
    });
    addressGroup.addressList = [
      urlparse('bolt://127.0.0.1:13201', true),
      urlparse('bolt://127.0.0.1:13202', true),
      urlparse('bolt://2.2.2.2:12200', true),
    ];
    await addressGroup.ready();

    let count = 5;
    while (count--) {
      const connection = await addressGroup.getConnection(req);
      assert(connection && connection.isConnected);
      assert([
        'bolt://127.0.0.1:13201',
        'bolt://127.0.0.1:13202',
      ].includes(connection.url));
    }

    addressGroup.close();
    await connectionManager.closeAllConnections();
    await utils.closeAll();
  });

  it('getConnection() 需要兜底', async function() {
    await Promise.all([
      utils.startServer(13201),
      utils.startServer(13202),
    ]);

    const addressGroup = new AddressGroup({
      key: 'xxx',
      logger,
      connectionManager,
    });
    addressGroup.addressList = [
      urlparse('bolt://127.0.0.1:13201', true),
      urlparse('bolt://127.0.0.1:13202', true),
    ];
    let count = 3;
    while (count--) {
      const connection = await addressGroup.getConnection(req);
      assert(connection && connection.isConnected);
      assert([
        'bolt://127.0.0.1:13201',
        'bolt://127.0.0.1:13202',
      ].includes(connection.url));
    }

    addressGroup.addressList = [
      urlparse('bolt://2.2.2.2:12200', true),
    ];
    let connection = await addressGroup.getConnection(req);
    // 没有可用的地址，返回 null
    assert(!connection);

    addressGroup.addressList = [];
    connection = await addressGroup.getConnection(req);
    // 没有可用的地址，返回 null
    assert(!connection);

    addressGroup.close();
    await connectionManager.closeAllConnections();
    await utils.closeAll();
  });

  describe('对于连不上地址的处理', () => {
    const mod = 2;
    const count = 10;
    const addressList = [];
    let addressGroup;

    before(async function() {
      mm(DynamicConfig.instance.connectionPoolConfig, 'elasticControl', false);
      mm(DynamicConfig.instance.metric, 'numBuckets', 10);
      mm(DynamicConfig.instance.metric, 'bucketSizeInMs', 1000);

      for (let i = 0; i < count; i++) {
        const address = urlparse(`bolt://127.0.0.${i}:12200`, true);
        addressList.push(address);
        if (i % mod === 0) continue;
        MockConnection.addAvailableAddress(address);
      }

      addressGroup = new AddressGroup({
        key: 'xxx',
        logger,
        connectionManager,
        connectionClass: MockConnection,
        retryFaultInterval: 3000,
      });
      addressGroup.addressList = addressList;
      await addressGroup.ready();
    });

    after(async function() {
      MockConnection.clearAvailableAddress();
      addressGroup.close();
      await connectionManager.closeAllConnections();
      mm.restore();
    });

    it('连不上的地址需要被记录下来', () => {
      assert(addressGroup._faultAddressMap);
      assert(addressGroup._faultAddressMap.size === Math.floor(count / mod));
    });

    it('连不上的地址权重为 0，不应该被路由到', async function() {
      assert(addressGroup._weightMap);
      await sleep(1000);
      for (const host of addressGroup._faultAddressMap.keys()) {
        assert(addressGroup._weightMap.get(host) === 0);
      }

      const address = urlparse(`bolt://127.0.0.${mod}:12200`, true);
      let found = false;
      for (let i = 0; i < count; i++) {
        const connection = await addressGroup.getConnection(req);
        if (connection.address.host === address.host) {
          found = true;
          break;
        }
      }
      assert(!found);
    });

    it('对于连不上的地址，隔一段时间需要重连一下', async function() {
      const preCount = Math.floor(count / mod);
      const address = urlparse(`bolt://127.0.0.${mod}:12200`, true);
      MockConnection.addAvailableAddress(address);
      // 等重连窗口
      await sleep(5000);
      assert(addressGroup._faultAddressMap);
      assert(addressGroup._faultAddressMap.size === preCount - 1);
      assert(!addressGroup._faultAddressMap.has(address.host));

      let found = false;
      for (let i = 0; i < count; i++) {
        const connection = await addressGroup.getConnection(req);
        if (connection.address.host === address.host) {
          found = true;
          break;
        }
      }
      assert(found);
    });

    it('所有连不上的地址都重新连上，然后再断开需要再次被感知为不可连接', async function() {
      this.timeout(15000);
      assert(addressGroup._faultAddressMap);
      assert(addressGroup._faultAddressMap.size);

      for (const address of addressList) {
        MockConnection.addAvailableAddress(address);
      }
      // 等重连窗口
      await sleep(3100);
      assert(addressGroup._faultAddressMap.size === 0);

      const connection = await addressGroup.getConnection(req);
      assert(connection && connection.address);

      // mock 故障断开
      const address = connection.address;
      MockConnection.removeAvailableAddress(address);
      await connection.close();

      let found = false;
      for (let i = 0; i < count; i++) {
        const connection = await addressGroup.getConnection(req);
        if (connection.address.host === address.host) {
          found = true;
          break;
        }
      }
      assert(!found);

      // 等重连窗口
      await sleep(3100);
      assert(addressGroup._faultAddressMap.size === 1);
    });
  });

  describe('权重调整', () => {
    const faultIndex = 2;
    const count = 5;
    let addressList;
    let addressGroup;

    beforeEach(async function() {
      mm(DynamicConfig.instance.connectionPoolConfig, 'elasticControl', false);
      mm(DynamicConfig.instance.faultTolerance, 'leastWindowRtMultiple', 3);
      mm(DynamicConfig.instance.metric, 'numBuckets', 5);
      mm(DynamicConfig.instance.metric, 'bucketSizeInMs', 100);

      addressList = [];
      for (let i = 0; i < count; i++) {
        const address = urlparse(`bolt://127.0.0.${i}:12200`);
        addressList.push(address);
        if (i === faultIndex) continue;
        MockConnection.addAvailableAddress(address);
      }

      addressGroup = new AddressGroup({
        key: 'xxx',
        logger,
        connectionManager,
        connectionClass: MockConnection,
        retryFaultInterval: 5000,
      });
      addressGroup.addressList = addressList;
      await addressGroup.ready();
    });

    afterEach(async function() {
      MockConnection.clearAvailableAddress();
      addressGroup.close();
      await connectionManager.closeAllConnections();
      mm.restore();
    });

    async function requestSuccess() {
      const connection = await addressGroup.getConnection(req);
      await connection.invoke({
        resultCode: '00',
        connectionGroup: addressGroup.key,
        rt: 10,
      });
    }

    it('全部成功 qps=100', async function() {
      await addressGroup._healthCounter.await('next');
      for (let i = 0; i < 100; i++) {
        requestSuccess();
      }
      const hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 0);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
        } else {
          console.log('connection -->', connection.key);
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);
        }
      }
    });

    async function requestFail() {
      const connection = await addressGroup.getConnection(req);
      await connection.invoke({
        resultCode: '01',
        connectionGroup: addressGroup.key,
        rt: 10,
      });
    }

    it('全部失败 qps=100', async function() {
      for (let i = 0; i < 100; i++) {
        requestFail();
      }
      const hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 100);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 100);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 100);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 25);
        }
      }
    });

    it('单机故障场景，错误率过高', async function() {
      let errorCount = 10;

      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        if (connection.address.hostname === '127.0.0.1' && errorCount) {
          connection.invoke({
            resultCode: '03',
            connectionGroup: addressGroup.key,
            rt: 10,
          });
          errorCount -= 1;
          continue;
        }
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      const hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 10);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 40);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 10);

          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }
    });

    it('单机故障场景，rt 过高', async function() {
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: connection.address.hostname === '127.0.0.1' ? 100 : 10,
        });
      }

      const hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 0);
      assert(hc.avgRT === 33);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 100);

          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 10);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }
    });

    it('单机故障场景，rt 过高 + 恢复', async function() {
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: connection.address.hostname === '127.0.0.1' ? 100 : 10,
        });
      }

      let hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 0);
      assert(hc.avgRT === 33);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 100);

          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 10);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      mm(utility, 'random', max => (max < 6 ? max - 1 : 6));
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 199);
      assert(hc.errorCount === 0);
      assert(hc.avgRT === 21);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 0);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 0);

          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 58);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 10);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      mm(utility, 'random', max => (max < 4 ? max - 1 : 4));
      for (let i = 0; i < 200; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 399);
      assert(hc.errorCount === 0);
      assert(hc.avgRT === 16);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 50);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 10);

          assert(addressGroup._weightMap.get(address.host) === 10);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 108);
          assert(hc.errorCount === 0);
          assert(hc.avgRT === 10);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(addressGroup._weightMap.get('127.0.0.1:12200') === 20);

      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(addressGroup._weightMap.get('127.0.0.1:12200') === 40);

      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(addressGroup._weightMap.get('127.0.0.1:12200') === 80);

      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(addressGroup._weightMap.get('127.0.0.1:12200') === 100);
    });

    it('单机故障场景，错误率过高 + 过一个窗口期开始恢复', async function() {
      let errorCount = 10;

      mm(utility, 'random', max => (max < 6 ? max - 1 : 6));

      // 1
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        if (connection.address.hostname === '127.0.0.1' && errorCount) {
          connection.invoke({
            resultCode: '03',
            connectionGroup: addressGroup.key,
            rt: 10,
          });
          errorCount -= 1;
          continue;
        }
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      let hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 10);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 40);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 10);

          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      // 2
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 5);
      assert(hc.totalCount === 199);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 3
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 3);
      assert(hc.totalCount === 298);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 4
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 3);
      assert(hc.totalCount === 397);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 5
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 2);
      assert(hc.totalCount === 496);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 6
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 496);
      assert(hc.errorCount === 0);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          assert(hc.totalCount === 1);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 10);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 165);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 497);
      assert(hc.errorCount === 0);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 26);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 20);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 157);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }
    });

    it('单机故障场景，错误率过高 + 过一个窗口期 single test 还是失败', async function() {
      mm(DynamicConfig.instance.faultTolerance, 'degradeLeastWeight', 4);

      let errorCount = 10;

      mm(utility, 'random', max => (max < 6 ? max - 1 : 6));

      // 1
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        if (connection.address.hostname === '127.0.0.1' && errorCount) {
          connection.invoke({
            resultCode: '03',
            connectionGroup: addressGroup.key,
            rt: 10,
          });
          errorCount -= 1;
          continue;
        }
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      let hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 10);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 40);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 10);

          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      // 2
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 5);
      assert(hc.totalCount === 199);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 3
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 3);
      assert(hc.totalCount === 298);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 4
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 3);
      assert(hc.totalCount === 397);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 5
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 2);
      assert(hc.totalCount === 496);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          assert(hc.totalCount === 0);
          assert(hc.errorCount === 0);
          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          assert(hc.totalCount === 157);
          assert(hc.errorCount === 0);
          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      // 6
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: connection.address.hostname === '127.0.0.1' ? '03' : '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 496);
      assert(hc.errorCount === 1);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 100);
          assert(hc.totalCount === 1);
          assert(hc.errorCount === 1);
          assert(addressGroup._weightMap.get(address.host) === 4);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 165);
          assert(hc.errorCount === 0);
          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }
    });

    it('单机故障场景，错误率过高 + 过一个窗口期 single test 还是失败, 如果已经降级到最小权重则不再调控', async function() {
      mm(DynamicConfig.instance.faultTolerance, 'degradeLeastWeight', 5);

      let errorCount = 10;

      mm(utility, 'random', max => (max < 6 ? max - 1 : 6));

      // 1
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        if (connection.address.hostname === '127.0.0.1' && errorCount) {
          connection.invoke({
            resultCode: '03',
            connectionGroup: addressGroup.key,
            rt: 10,
          });
          errorCount -= 1;
          continue;
        }
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      let hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 10);
      assert(hc.totalCount === 100);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 40);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 10);

          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 25);
          assert(hc.errorCount === 0);

          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      // 2
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 5);
      assert(hc.totalCount === 199);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 3
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 3);
      assert(hc.totalCount === 298);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 4
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 3);
      assert(hc.totalCount === 397);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      // 5
      for (let i = 0; i < 99; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 2);
      assert(hc.totalCount === 496);
      assert(hc.errorCount === 10);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          assert(hc.totalCount === 0);
          assert(hc.errorCount === 0);
          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          assert(hc.totalCount === 157);
          assert(hc.errorCount === 0);
          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      // 6
      for (let i = 0; i < 100; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: connection.address.hostname === '127.0.0.1' ? '03' : '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      hc = await addressGroup._healthCounter.await('next');
      assert(hc && hc.errorRate === 0);
      assert(hc.totalCount === 496);
      assert(hc.errorCount === 1);
      assert(hc.avgRT === 10);

      for (const address of addressGroup.addressList) {
        const connection = addressGroup.connectionManager.get(address);
        if (address.hostname === `127.0.0.${faultIndex}`) {
          assert(!connection);
          assert(addressGroup._weightMap.get(address.host) === 0);
        } else if (address.hostname === '127.0.0.1') {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 100);
          assert(hc.totalCount === 1);
          assert(hc.errorCount === 1);
          assert(addressGroup._weightMap.get(address.host) === 5);
        } else {
          assert(connection && connection.latestHealthCount);
          const hc = connection.latestHealthCount;
          assert(hc.errorRate === 0);
          // 4 个可用的 connection 平均分配
          assert(hc.totalCount === 165);
          assert(hc.errorCount === 0);
          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }
    });
  });

  describe('连接数控制', () => {
    let addressGroup;
    let addressList;
    const count = 600;

    beforeEach(async function() {
      mm(DynamicConfig.instance.metric, 'numBuckets', 5);
      mm(DynamicConfig.instance.metric, 'bucketSizeInMs', 100);
      mm(DynamicConfig.instance.faultTolerance, 'leastWindowRtMultiple', 3);

      addressList = [];
      for (let i = 0; i < count; i++) {
        const address = urlparse(`bolt://127.0.0.${i}:12200`, true);
        addressList.push(address);
        MockConnection.addAvailableAddress(address);
      }

      addressGroup = new AddressGroup({
        key: 'com.alipay.TestQueryService:1.0@SOFA@xxxx',
        logger,
        connectionManager,
        connectionClass: MockConnection,
        retryFaultInterval: 5000,
        connectionPoolConfig: {
          minAddressCount: 5,
          maxAddressCount: 50,
          initConnectionSize: 6,
          elasticControl: true,
          capacityPerConnection: 300,
        },
      });
      addressGroup.addressList = addressList;
      await addressGroup.ready();

      assert(addressGroup.connectionPoolSize === 6);
    });

    afterEach(async function() {
      MockConnection.clearAvailableAddress();
      addressGroup.close();
      await connectionManager.closeAllConnections();
      mm.restore();
    });

    it('各属性值赋值正确', () => {
      assert(addressGroup._allAddressList.length === count);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === count);
      assert(addressGroup.choosedSize === 6);
      assert(addressGroup.addressList.length === 6);

      for (const address of addressGroup.addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
      }

      assert(addressGroup._faultAddressMap.size === 0);
      assert(addressGroup._degradeEnable);
    });

    it('当总地址太少时，全部启用', () => {
      let addressList = [
        urlparse('bolt://127.0.0.0:12200', true),
        urlparse('bolt://127.0.0.1:12200', true),
        urlparse('bolt://127.0.0.2:12200', true),
        urlparse('bolt://127.0.0.3:12200', true),
        urlparse('bolt://127.0.0.4:12200', true),
      ];

      addressGroup.addressList = addressList;

      assert(addressGroup._allAddressList.length === 5);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === 5);
      assert(addressGroup.choosedSize === 5);
      assert(addressGroup.addressList.length === 5);
      for (const address of addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
      }
      assert(addressGroup._faultAddressMap.size === 0);
      assert(addressGroup._degradeEnable);

      addressList = [
        urlparse('bolt://127.0.0.0:12200', true),
        urlparse('bolt://127.0.0.1:12200', true),
        urlparse('bolt://127.0.0.2:12200', true),
        urlparse('bolt://127.0.0.3:12200', true),
      ];
      addressGroup.addressList = addressList;
      assert(addressGroup._allAddressList.length === 4);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === 4);
      assert(addressGroup.choosedSize === 4);
      assert(addressGroup.addressList.length === 4);
      for (const address of addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
      }
      assert(addressGroup._faultAddressMap.size === 0);
      assert(addressGroup._degradeEnable);
    });

    it('refresh() 之后启用的地址尽量是已经连上的地址', () => {
      assert(addressGroup._allAddressList.length === count);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === count);
      assert(addressGroup.choosedSize === 6);
      assert(addressGroup.addressList.length === 6);

      const preAddressMap = new Set();
      for (const address of addressGroup.addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
        preAddressMap.add(address.host);
      }

      assert(addressGroup._faultAddressMap.size === 0);
      assert(addressGroup._degradeEnable);

      addressGroup.refresh();

      assert(addressGroup._allAddressList.length === count);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === count);
      assert(addressGroup.choosedSize === 6);
      assert(addressGroup.addressList.length === 6);

      for (const address of addressGroup.addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
        assert(preAddressMap.has(address.host));
      }

      assert(addressGroup._faultAddressMap.size === 0);
      assert(addressGroup._degradeEnable);
    });

    it('选择地址的优先级：健康的 > 未知状态的 > 已知非健康的', () => {
      mm(addressGroup.connectionPoolConfig, 'maxAddressCount', 600);

      const faultAddress_1 = addressGroup.addressList[0];
      addressGroup._faultAddressMap.set(faultAddress_1.host, faultAddress_1);
      addressGroup.connectionPoolSize = count - 1;

      assert(addressGroup._allAddressList.length === count);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === count);
      assert(addressGroup.choosedSize === count - 1);
      assert(addressGroup.addressList.length === count - 1);

      for (const address of addressGroup.addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
        assert(address.host !== faultAddress_1.host);
      }

      const faultAddress_2 = addressGroup.addressList[0];
      addressGroup._faultAddressMap.set(faultAddress_1.host, faultAddress_1);
      addressGroup._weightMap.set(faultAddress_2.host, 99);

      addressGroup.connectionPoolSize = count - 2;

      assert(addressGroup._allAddressList.length === count);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === count);
      assert(addressGroup.choosedSize === count - 2);
      assert(addressGroup.addressList.length === count - 2);

      for (const address of addressGroup.addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
        assert(address.host !== faultAddress_1.host);
        assert(address.host !== faultAddress_2.host);
      }

      addressGroup._faultAddressMap.set(faultAddress_1.host, faultAddress_1);
      addressGroup._weightMap.set(faultAddress_2.host, 99);

      addressGroup.connectionPoolSize = count;

      assert(addressGroup._allAddressList.length === count);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === count);
      assert(addressGroup.choosedSize === count);
      assert(addressGroup.addressList.length === count);

      for (const address of addressGroup.addressList) {
        assert(addressGroup._weightMap.has(address.host));
        // 保留之前的权重
        if (address.host === faultAddress_2.host) {
          assert(addressGroup._weightMap.get(address.host) === 99);
        } else {
          assert(addressGroup._weightMap.get(address.host) === 100);
        }
      }

      assert(addressGroup._faultAddressMap.size === 1);
      assert(addressGroup._degradeEnable);
    });

    it('当总地址数超过最大允许连接数，以最大连接数为准', () => {
      addressGroup.connectionPoolSize = count;

      assert(addressGroup._allAddressList.length === count);
      assert(addressGroup._allAddressList === addressList);
      assert(addressGroup.totalSize === count);
      assert(addressGroup.choosedSize === 50);
      assert(addressGroup.addressList.length === 50);

      for (const address of addressGroup.addressList) {
        assert(addressGroup._weightMap.has(address.host));
        assert(addressGroup._weightMap.get(address.host) === 100);
      }

      assert(addressGroup._faultAddressMap.size === 0);
      assert(addressGroup._degradeEnable);
    });

    it('根据调用量来调整连接池的大小', async function() {
      mm(addressGroup.connectionPoolConfig, 'capacityPerConnection', 30);
      assert(addressGroup.connectionPoolSize === 6);

      for (let i = 0; i < 30 * 10; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      await addressGroup._healthCounter.await('next');
      assert(addressGroup.connectionPoolSize === 10);
      assert(addressGroup.addressList.length === 10);
      assert(addressGroup.choosedSize === 10);

      for (let i = 0; i < 30 * 10; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      await addressGroup._healthCounter.await('next');
      assert(addressGroup.connectionPoolSize === 20);
      assert(addressGroup.addressList.length === 20);
      assert(addressGroup.choosedSize === 20);


      await addressGroup._healthCounter.await('next');
      await addressGroup._healthCounter.await('next');
      await addressGroup._healthCounter.await('next');
      await addressGroup._healthCounter.await('next');

      assert(addressGroup.connectionPoolSize === 10);
      assert(addressGroup.addressList.length === 10);
      assert(addressGroup.choosedSize === 10);

      await addressGroup._healthCounter.await('next');
      assert(addressGroup.connectionPoolSize === 5);
      assert(addressGroup.addressList.length === 5);
      assert(addressGroup.choosedSize === 5);

      for (let i = 0; i < 30 * 51; i++) {
        const connection = await addressGroup.getConnection(req);
        connection.invoke({
          resultCode: '00',
          connectionGroup: addressGroup.key,
          rt: 10,
        });
      }

      await addressGroup._healthCounter.await('next');
      assert(addressGroup.connectionPoolSize === 50);
      assert(addressGroup.addressList.length === 50);
      assert(addressGroup.choosedSize === 50);
    });

    it('弹性控制', () => {
      mm(addressGroup, 'connectionPoolConfig', null);
      assert(!addressGroup._loadbalancer._needElasticControl(100));
      assert(!addressGroup._loadbalancer._needElasticControl(10));

      mm.restore();

      mm(addressGroup.connectionPoolConfig, 'minAddressCount', 10);
      assert(!addressGroup._loadbalancer._needElasticControl(9));
      assert(!addressGroup._loadbalancer._needElasticControl(2));

      mm(addressGroup.connectionPoolConfig, 'enableThreshold', 50);

      assert(addressGroup._loadbalancer._needElasticControl(51));
      assert(!addressGroup._loadbalancer._needElasticControl(50));
      assert(!addressGroup._loadbalancer._needElasticControl(49));
    });
  });
});
