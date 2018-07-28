'use strict';

const Base = require('sdk-base');

class LoadBalancer extends Base {
  constructor(addressGroup) {
    super();
    this.addressGroup = addressGroup;
    this.reset();
    this.ready(true);
  }

  get size() {
    return this.addressGroup._choosedSize;
  }

  get addressList() {
    return this.addressGroup.addressList;
  }

  select(request) {
    if (this.size === 0) return null;
    if (this.size === 1) return this.addressList[0];

    return this._doSelect(request, this.addressList);
  }

  reset() {}

  /* istanbul ignore next */
  _doSelect() {
    throw new Error('not implement');
  }

  getWeight(address) {
    return this.addressGroup.getWeight(address);
  }
}

module.exports = LoadBalancer;
