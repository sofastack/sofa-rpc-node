'use strict';

const Base = require('sdk-base');
const availableAddress = new Map();
const DynamicConfig = require('../../lib/client/dynamic_config');
const CircuitBreaker = require('../../lib/client/circuit_breaker');
const HealthCounter = require('../../lib/client/metric/health_counter');

class MockConnection extends Base {
  constructor(options) {
    super(Object.assign({}, options, { initMethod: '_init' }));

    this._closed = false;
    this._connected = false;
    this._lastInvokeTime = Date.now();
    this._lastActiveTime = Date.now();
    const config = DynamicConfig.instance.metric;
    this.key = 'rpcConnection-' + this.address.host;
    this._circuitBreaker = CircuitBreaker.getInstance(this.key);
  }

  get isConnected() {
    return this._connected;
  }

  resetCounter() {
    this._circuitBreaker.reset();
  }

  async _init() {
    if (!availableAddress.has(this.address.host)) {
      this._circuitBreaker.close();
      throw new Error('connect refused');
    }
    this._connected = true;
  }

  close() {
    if (this._closed) return Promise.resolve();
    setImmediate(() => {
      this._circuitBreaker.close();
      this._closed = true;
      this.emit('close');
    });
    return this.await('close');
  }

  get address() {
    return this.options.address;
  }

  get lastInvokeTime() {
    return this._lastInvokeTime;
  }

  heartbeat() {
    this._lastActiveTime = Date.now();
  }

  async invoke(req) {
    // todo:
    this._circuitBreaker.update(req);
    const counter = HealthCounter.getInstance(req.connectionGroup);
    if (counter) {
      counter.update(req);
    }
    this._lastActiveTime = Date.now();
    this._lastInvokeTime = Date.now();
  }

  get latestHealthCount() {
    return this._circuitBreaker.latestHealthCount;
  }

  static addAvailableAddress(address) {
    availableAddress.set(address.host, address);
  }

  static removeAvailableAddress(address) {
    availableAddress.delete(address.host, address);
  }

  static clearAvailableAddress() {
    availableAddress.clear();
  }
}

module.exports = MockConnection;
