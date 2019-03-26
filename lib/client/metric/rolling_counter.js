'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const Scheduler = require('../scheduler');
const DynamicConfig = require('../dynamic_config');

class RollingCounter extends Base {
  /**
   * 滑动窗口技术器
   *
   * @param {String} key - the key
   * @param {Boolean} prepend -
   * @class
   */
  constructor(key, prepend) {
    assert(key, '[RollingCounter] key is required');
    super();

    this.key = key;
    this.reset();
    this.isClosed = false;
    this._closeInterval = Scheduler.instance.interval(() => {
      this.latestValue = this.buckets.reduce(this.reduceBucket, this.getEmptyOutputValue());
      this.emit('next', this.latestValue);

      this.buckets.shift();
      this.buckets.push(this.getEmptyBucketSummary());
    }, this.bucketSizeInMs, prepend);
  }

  get config() {
    return DynamicConfig.instance.metric;
  }

  get numBuckets() {
    return this.config.numBuckets;
  }

  get bucketSizeInMs() {
    return this.config.bucketSizeInMs;
  }

  get lastestBucket() {
    return this.buckets[this.numBuckets - 1];
  }

  reset() {
    this.latestValue = null;
    this.buckets = [];
    for (let i = 0; i < this.numBuckets; i++) {
      this.buckets.push(this.getEmptyBucketSummary());
    }
  }

  /* istanbul ignore next */
  reduceBucket() {
    throw new Error('not implement');
  }

  /* istanbul ignore next */
  update() {
    throw new Error('not implement');
  }

  /* istanbul ignore next */
  getEmptyOutputValue() {
    throw new Error('not implement');
  }

  /* istanbul ignore next */
  getEmptyBucketSummary() {
    throw new Error('not implement');
  }

  close() {
    this.isClosed = true;
    this.buckets = [];
    this._closeInterval();
    this.removeAllListeners('next');
    this.emit('close');
  }
}

module.exports = RollingCounter;
