'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const DynamicConfig = require('./dynamic_config');
const HealthCounter = require('./metric/health_counter');

// Symbols
const _status = Symbol.for('CircuitBreaker#status');

class CircuitBreaker extends Base {
  constructor(key) {
    super();
    this._key = key;
    this._circuitOpened = -1;
    this._healthCounter = HealthCounter.getInstance(key);
    this._healthCounter.on('next', hc => {
      this._hc = hc;
      if (hc.totalCount < this.config.requestVolumeThreshold) {
        // 当前 window 期间，请求量太小，不改变熔断状态
      } else {
        if (hc.errorRate < this.config.errorThresholdPercentage) {
          // 错误率低于熔断阀值，保持原状
          // CLOSED => CLOSED
          // HALF_OPEN 需要等待 single test 的结果
          // OPEN 需要等待一个 sleep window
        } else {
          if (this.status === 'CLOSED') {
            this.status = 'OPEN';
            this._circuitOpened = Date.now();
          }
        }
      }
    });
  }

  get key() {
    return this._key;
  }

  // CLOSED, OPEN, HALF_OPEN
  get status() {
    return this[_status] || 'CLOSED';
  }

  set status(val) {
    this[_status] = val;
    this.emit('status_changed', val);
  }

  get config() {
    return DynamicConfig.instance.circuitBreaker;
  }

  get isOpen() {
    if (this.config.forceOpen) {
      return true;
    }
    if (this.config.forceClosed) {
      return false;
    }
    return this._circuitOpened >= 0;
  }

  get isAfterSleepWindow() {
    const currentTime = Date.now();
    const sleepWindowTime = this.config.sleepWindowInMilliseconds;
    return currentTime > this._circuitOpened + sleepWindowTime;
  }

  get latestHealthCount() {
    return this._hc;
  }

  allowRequest() {
    if (this.config.forceOpen) {
      return false;
    }
    if (this.config.forceClosed) {
      return true;
    }
    if (this._circuitOpened === -1) {
      return true;
    }
    if (this.status === 'HALF_OPEN') {
      return false;
    }
    if (this.isAfterSleepWindow) {
      this.status = 'HALF_OPEN';
      return true;
    }
    return false;
  }

  update(rpcContext) {
    this._healthCounter.update(rpcContext);
    if (rpcContext.resultCode === '00') {
      this.markSuccess();
    } else {
      this.markNonSuccess();
    }
  }

  reset() {
    this._healthCounter.reset();
  }

  markSuccess() {
    if (this.status === 'HALF_OPEN') {
      this.reset();
      this.status = 'CLOSED';
      this._circuitOpened = -1;
    }
  }

  markNonSuccess() {
    if (this.status === 'HALF_OPEN') {
      this.status = 'OPEN';
      this._circuitOpened = Date.now();
    }
  }

  close() {
    this._healthCounter.close();
    this.emit('close');
  }
}

const _cache = new Map();

exports.getInstance = key => {
  assert(key, '[CircuitBreaker] key is required');
  let cb = _cache.get(key);
  if (!cb) {
    cb = new CircuitBreaker(key);
    cb.once('close', () => { _cache.delete(key); });
    _cache.set(key, cb);
  }
  return cb;
};
