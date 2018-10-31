'use strict';

const mm = require('mm');
const assert = require('assert');
const urlparse = require('url').parse;
const RpcRequest = require('../../lib/client/request');
const MockConnection = require('../fixtures/mock_connection');
const AddressGroup = require('../../lib/client/address_group');
const ConnectionManager = require('../../').client.RpcConnectionMgr;
const RandomLoadBalancer = require('../../lib/client/loadbalancer/random');
const ConsistentHashLoadBalancer = require('../../lib/client/loadbalancer/consistent_hash');

const logger = console;

describe('test/client/loadbalancer.test.js', () => {
  let connectionManager;
  let addressGroup;
  const addressList = [];

  before(async function() {
    connectionManager = new ConnectionManager({ logger });
    addressGroup = new AddressGroup({
      key: 'xxx',
      logger,
      connectionManager,
      connectionClass: MockConnection,

      connectionPoolConfig: {
        minAddressCount: 5,
        maxAddressCount: 50,
        initConnectionSize: 6,
        elasticControl: false,
        capacityPerConnection: 300,
      },
    });

    for (let i = 0; i < 20; i++) {
      const address = urlparse(`bolt://127.0.0.1:${9000 + i}`, true);
      addressList.push(address);
      MockConnection.addAvailableAddress(address);
    }
    addressGroup.addressList = addressList;
    await addressGroup.ready();
  });

  after(async function() {
    await addressGroup.close();
    await connectionManager.close();
  });

  afterEach(mm.restore);

  describe('RandomLoadBalancer', () => {
    it('should select ok', () => {
      const balancer = new RandomLoadBalancer(addressGroup);
      const request = new RpcRequest({
        serverSignature: 'com.alipay.TestService:1.0',
        methodName: 'test',
        args: [ 'foobar' ],
        timeout: 3000,
      });

      const cnt = new Map();
      for (let i = 0; i < 20; i++) {
        cnt.set(9000 + i, 0);
      }

      for (let i = 0; i < 100000; i++) {
        const address = balancer.select(request);
        const port = Number(address.port);
        cnt.set(port, cnt.get(port) + 1);
      }

      const avg = 100000 / 20;
      for (let i = 0; i < 20; i++) {
        assert(avg * 0.9 < cnt.get(9000 + i) &&
          avg * 1.1 > cnt.get(9000 + i)); // 随机偏差不会太大，应该不超过10%
      }

      //
      const weightMap = new Map();
      for (let i = 0; i < 20; i++) {
        weightMap.set(`127.0.0.1:${9000 + i}`, (i + 1) * 10);
      }
      mm(addressGroup, '_weightMap', weightMap);

      cnt.clear();
      for (let i = 0; i < 20; i++) {
        cnt.set(9000 + i, 0);
      }

      for (let i = 0; i < 100000; i++) {
        const address = balancer.select(request);
        const port = Number(address.port);
        cnt.set(port, cnt.get(port) + 1);
      }

      let count = 0;
      for (let i = 0; i < 20; i++) {
        count += i;
      }
      const per = 100000 / count;
      for (let i = 0; i < 20; i++) {
        assert(per * (i + 1) * 0.80 < cnt.get(9000 + i) &&
          per * (i + 1) * 1.20 > cnt.get(9000 + i)); // 随机偏差不会太大，应该不超过20%
      }
    });
  });

  describe('ConsistentHashLoadBalancer', () => {
    it('should select same address if argument is same', () => {
      const balancer = new ConsistentHashLoadBalancer(addressGroup);
      for (let j = 0; j < 100; j++) {
        const request = new RpcRequest({
          serverSignature: 'com.alipay.TestService:1.0',
          methodName: 'test',
          args: [ 'foobar' + j ],
          timeout: 3000,
        });
        const address = balancer.select(request);

        for (let i = 0; i < 1000; i++) {
          assert(balancer.select(request) === address);
        }
      }

      const request = new RpcRequest({
        serverSignature: 'com.alipay.TestService:1.0',
        methodName: 'test',
        args: [],
        timeout: 3000,
      });
      const address = balancer.select(request);

      for (let i = 0; i < 10000; i++) {
        assert(balancer.select(request) === address);
      }
    });
  });
});
