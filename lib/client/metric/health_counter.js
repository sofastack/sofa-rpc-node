'use strict';

const assert = require('assert');
const HealthCounts = require('./health_counts');
const RollingCounter = require('./rolling_counter');

class HealthCounter extends RollingCounter {
  reduceBucket(healthCounts, value) {
    return healthCounts.plus(value);
  }

  update(rpcContext) {
    if (this.isClosed) return;
    this.lastestBucket[rpcContext.resultCode]++;
    this.lastestBucket.rt += rpcContext.rt;
  }

  getEmptyOutputValue() {
    return HealthCounts.empty;
  }

  getEmptyBucketSummary() {
    return {
      '00': 0, // 成功
      '01': 0, // 业务异常
      '02': 0, // RPC逻辑错误
      '03': 0, // 超时失败
      '04': 0, // 路由失败
      rt: 0,
    };
  }
}

const _cache = new Map();

exports.getInstance = (key, prepend = true) => {
  assert(key, '[HealthCounter] key is required');
  let counter = _cache.get(key);
  if (!counter) {
    counter = new HealthCounter(key, prepend);
    counter.once('close', () => { _cache.delete(key); });
    _cache.set(key, counter);
  }
  return counter;
};
