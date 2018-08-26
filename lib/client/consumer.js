'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const urlparse = require('url').parse;
const RpcRequest = require('./request');
const AddressGroup = require('./address_group');
const HealthCounter = require('./metric/health_counter');

const defaultOptions = {
  group: 'SOFA',
  version: '1.0',
  responseTimeout: 3000,
  loadbalancerClass: 'roundRobin',
};

class RpcConsumer extends Base {
  constructor(options = {}) {
    assert(options.interfaceName, '[RpcConsumer] options.interfaceName is required');
    assert(options.logger, '[RpcConsumer] options.logger is required');
    assert(options.serverHost || options.registry, '[RpcConsumer] options.registry or options.serverHost at least set one');
    assert(options.connectionManager, '[RpcConsumer] options.connectionManager is required');
    super({ initMethod: '_init' });

    this.options = Object.assign({}, defaultOptions, options);
    this._isReady = false;
    this.ready(err => {
      this._isReady = !err;
    });
  }

  get id() {
    return this.interfaceName + ':' + this.version;
  }

  get interfaceName() {
    return this.options.interfaceName;
  }

  get version() {
    return this.options.version;
  }

  get group() {
    return this.options.group;
  }

  get logger() {
    return this.options.logger;
  }

  get registry() {
    return this.options.registry;
  }

  get targetAppName() {
    return this.options.targetAppName;
  }

  get registryConfig() {
    return {
      protocol: 'bolt',
      interfaceName: this.interfaceName,
      version: this.version,
      group: this.group,
      appName: this.targetAppName,
      timeout: this.options.responseTimeout,
    };
  }

  async _init() {
    this._addressGroup = this.createAddressGroup(this.id + '@' + this.group);
    if (this.options.serverHost) {
      const addressList = this.options.serverHost.split(',').map(url => this.parseUrl(url));
      setImmediate(() => { this._addressGroup.addressList = addressList; });
    } else {
      await this.registry.ready();
      this._addressGroup = this.createAddressGroup(this.id + '@' + this.group);
      this._addressListener = addressList => {
        this._addressGroup.addressList = addressList.map(url => this.parseUrl(url));
      };
      this.registry.subscribe(this.registryConfig, this._addressListener);
    }
    await this._addressGroup.ready();
  }

  createAddressGroup(key) {
    return new AddressGroup(Object.assign({ key }, this.options));
  }

  createRequest(method, args, options) {
    return new RpcRequest({
      targetAppName: this.targetAppName,
      serverSignature: this.id,
      methodName: method,
      args,
      requestProps: options.requestProps,
      codecType: options.codecType,
      timeout: options.responseTimeout || this.options.responseTimeout,
    });
  }

  async getConnection(req) {
    return await this._addressGroup.getConnection(req);
  }

  async invoke(method, args, options = {}) {
    const req = this.createRequest(method, args, options);
    this.emit('request', req);
    let res;
    try {
      if (!this._isReady) {
        await this.ready();
      }
      const conn = await this.getConnection(req);
      if (!conn) {
        const err = new Error('No provider of ' + this.id + '@' + this.group + ':' + method + '() found!');
        err.name = 'RpcNoProviderError';
        req.meta.resultCode = '04';
        throw err;
      }
      res = await conn.invoke(req);
      if (res.error) {
        throw res.error;
      }
      return res.appResponse;
    } catch (err) {
      if (req.meta.resultCode === '00') {
        req.meta.resultCode = '01';
      }
      if (this.options.errorAsNull !== true) throw err;
      this.logger.warn(err);
      return null;
    } finally {
      if (req.meta.connectionGroup) {
        HealthCounter.getInstance(req.meta.connectionGroup).update(req.meta);
      }
      this.emit('response', { req, res });
    }
  }

  parseUrl(url) {
    const address = urlparse(url.indexOf('://') >= 0 ? url : `bolt://${url}`, true);
    if (!address.port) {
      address.port = 12200;
      address.host += ':12200';
    }
    return address;
  }

  close() {
    this._addressGroup && this._addressGroup.close();
    if (this._addressListener) {
      this.registry.unSubscribe(this.registryConfig, this._addressListener);
    }
    this.removeAllListeners('request');
    this.removeAllListeners('response');
  }
}

module.exports = RpcConsumer;
