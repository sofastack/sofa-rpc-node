'use strict';

const utility = require('utility');
const LoadBalancer = require('./base');

const DEFAULT_WEIGHT = 100;

// 带权重的 Round Robin 算法
class WeightRoundRobinLoadBalancer extends LoadBalancer {
  reset(val) {
    const addressList = super.reset(val);
    if (addressList) {
      this._offset = utility.random(addressList.length);
    }
    return addressList;
  }

  _rr(request, addressList) {
    const address = addressList[this._offset];
    this._offset = (this._offset + 1) % this.size;

    const weight = this.getWeight(address);
    if (weight === DEFAULT_WEIGHT) return address;
    if (weight === 0) return null;

    const randNum = utility.random(DEFAULT_WEIGHT);
    return weight >= randNum ? address : null;
  }

  _doSelect(request, addressList) {
    // 存在balancerFilterFilter标识使用filter_doSelect
    if (this.inBalancerFilterFilter) return this.filter_doSelect(request, addressList);
    let address;
    let count = this.size;
    while (count--) {
      address = this._rr(request, addressList);
      if (address) return address;
    }
    // 直接返回兜底
    return addressList[this._offset];
  }

  // 有balancerFilter时使用外部传入的addressList
  filter_doSelect(request, addressList) {
    // 关闭balancerFilterFilter标识
    this.inBalancerFilterFilter = false;
    let address;
    let count = addressList.length;
    this.filter_offset = utility.random(addressList.length);
    while (count--) {
      address = this.filter_rr(request, addressList);
      if (address) return address;
    }
    // 直接返回兜底
    return addressList[this.filter_offset];
  }

  filter_rr(request, addressList) {
    const address = addressList[this.filter_offset];
    this._offset = (this.filter_offset + 1) % addressList.length;

    const weight = this.getWeight(address);
    if (weight === DEFAULT_WEIGHT) return address;
    if (weight === 0) return null;

    const randNum = utility.random(DEFAULT_WEIGHT);
    return weight >= randNum ? address : null;
  }
}

module.exports = WeightRoundRobinLoadBalancer;
