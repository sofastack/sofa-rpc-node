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
    let address;
    let count = this.size;
    while (count--) {
      address = this._rr(request, addressList);
      if (address) return address;
    }
    // 直接返回兜底
    return addressList[this._offset];
  }
}

module.exports = WeightRoundRobinLoadBalancer;
