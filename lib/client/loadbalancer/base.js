'use strict';

const Base = require('sdk-base');
const { shuffle, printAddresses } = require('../utils');

class LoadBalancer extends Base {
  constructor(addressGroup) {
    super();
    this.addressGroup = addressGroup;
    this.reset(addressGroup.addressList);
    this.ready(true);
  }

  get size() {
    return this.addressGroup.choosedSize;
  }

  get addressList() {
    return this.addressGroup.addressList;
  }

  get logger() {
    return this.addressGroup.logger;
  }

  select(request) {
    if (this.size === 0) return null;
    if (this.size === 1) return this.addressList[0];

    return this._doSelect(request, this.addressList);
  }

  reset(addressList) {
    if (!addressList) return null;

    const newSet = new Set();
    const oldSet = new Set();
    const allAddressList = this.addressGroup.allAddressList;
    // 只有地址真正改变的时候才 shuffle 一次
    if (allAddressList !== addressList) {
      // 找出推送过来新增加的地址（扩容的）
      if (allAddressList) {
        for (const addr of allAddressList) {
          oldSet.add(addr.host);
        }
      }
      for (const addr of addressList) {
        if (!oldSet.has(addr.host)) {
          newSet.add(addr.host);
        }
      }
      this.addressGroup.allAddressList = this._sortAddresses(addressList);
    }
    return this._chooseAddresses(this.addressGroup.allAddressList, newSet);
  }

  adjustConnectionPoolSize(requestCount) {
    const connectionPoolConfig = this.addressGroup.connectionPoolConfig;
    if (connectionPoolConfig && connectionPoolConfig.elasticControl) {
      // 根据上个窗口的总请求数来计算需要多少个 connection
      const capacityPerConnection = connectionPoolConfig.capacityPerConnection;
      let need = Math.ceil(requestCount / capacityPerConnection);
      if (need < connectionPoolConfig.minAddressCount) {
        need = connectionPoolConfig.minAddressCount;
      }
      if (need > connectionPoolConfig.maxAddressCount) {
        need = connectionPoolConfig.maxAddressCount;
      }
      this.addressGroup.connectionPoolSize = need;
    }
  }

  _sortAddresses(addressList) {
    return shuffle(addressList);
  }

  _needElasticControl(addressCount) {
    const connectionPoolConfig = this.addressGroup.connectionPoolConfig;
    if (!connectionPoolConfig) return false;

    // 如果地址不够，禁用弹性控制
    if (addressCount < connectionPoolConfig.minAddressCount) {
      return false;
    }

    const enableThreshold = connectionPoolConfig.enableThreshold || 50;
    // 开启弹性控制有两个条件
    // 1. 配置 elasticControl = true
    // 2. 当前分组的地址数量要大于开启的阈值（enableThreshold）
    return connectionPoolConfig.elasticControl && addressCount > enableThreshold;
  }

  _chooseAddresses(addressList, newSet) {
    const totalSize = addressList.length;
    const { key, connectionPoolSize, connectionPoolConfig } = this.addressGroup;

    // 禁用弹性控制直接返回 或者 地址太少，直接返回
    if (!this._needElasticControl(totalSize)) {
      return addressList;
    }

    if (connectionPoolSize > totalSize) {
      this.logger.warn('[AddressGroup] group: %s needs %s addresses, but there are only %s', key, connectionPoolSize, totalSize);
      return addressList;
    }
    let leftCount = connectionPoolSize;
    if (leftCount > connectionPoolConfig.maxAddressCount) {
      leftCount = connectionPoolConfig.maxAddressCount;
      this.logger.info('[AddressGroup] there are %s addresses totally, exteeding the max address count: %s, group: %s',
        totalSize, connectionPoolConfig.maxAddressCount, key);
    }
    const choosedAddressList = [];
    const unChoosedAddressList = [];
    for (const address of addressList) {
      const result = this.addressGroup.checkHealthy(address);
      // 需求：新推送的地址或已经连接上的地址，优先被选中
      //
      // 因为当客户端集群很大，服务端很小的场景，客户端这边的分摊到一台机器的 qps 可能不高，
      // 但是服务端确可能很高，这个时候服务端扩容，如果按照老的逻辑，客户端这边认为不需要扩容，则不会去尝试连接扩容的机器（连上的优先）
      if ((result > 0 || newSet.has(address.host)) && leftCount > 0) {
        choosedAddressList.push(address);
        leftCount--;
      } else if (result < 0) {
        // 已知为异常的地址放到栈顶，只有地址不够的时候才被选中
        unChoosedAddressList.unshift(address);
      } else {
        // 未知状态的地址推到栈底，优先被选中
        unChoosedAddressList.push(address);
      }
    }
    // 补全个数
    while (leftCount--) {
      choosedAddressList.push(unChoosedAddressList.pop());
    }

    this.logger.debug('[AddressGroup] choosing %s / %s addresses for group=%s%s', choosedAddressList.length, totalSize, key, printAddresses(addressList));
    if (unChoosedAddressList.length) {
      this.logger.debug('[AddressGroup] there are %s addresses not choosed for connection control strategy%s',
        unChoosedAddressList.length, printAddresses(unChoosedAddressList));
    }
    return choosedAddressList;
  }

  /* istanbul ignore next */
  _doSelect() {
    throw new Error('not implement');
  }

  getWeight(address) {
    return this.addressGroup.getWeight(address);
  }
}

module.exports = LoadBalancer;
