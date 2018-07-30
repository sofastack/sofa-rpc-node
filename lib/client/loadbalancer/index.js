'use strict';

const assert = require('assert');

const buildinLoadBalancers = {
  get random() {
    return require('./random');
  },
  get roundRobin() {
    return require('./weight_rr');
  },
  get consistentHash() {
    return require('./consistent_hash');
  },
};

module.exports = addressGroup => {
  let loadbalancerClass = addressGroup.loadbalancerClass;
  if (typeof loadbalancerClass === 'string') {
    loadbalancerClass = buildinLoadBalancers[loadbalancerClass];
  }
  assert(typeof loadbalancerClass === 'function', `loadbalancerClass:${addressGroup.loadbalancerClass} invalid`);
  return new loadbalancerClass(addressGroup);
};
