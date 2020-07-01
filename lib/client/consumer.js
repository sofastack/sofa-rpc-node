'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const urlparse = require('url').parse;
const compose = require('koa-compose');
const RpcRequest = require('./request');
const AddressGroup = require('./address_group');
const HealthCounter = require('./metric/health_counter');
const is = require('is-type-of');

const defaultOptions = {
  group: 'SOFA',
  version: '1.0',
  responseTimeout: 3000,
  loadbalancerClass: 'roundRobin',
};

const _handleRequest = Symbol.for('RpcConsumer#handleRequest');

class RpcConsumer extends Base {
  constructor(options = {}) {
    assert(options.interfaceName, '[RpcConsumer] options.interfaceName is required');
    assert(options.logger, '[RpcConsumer] options.logger is required');
    assert(options.allowMock || options.serverHost || options.registry, '[RpcConsumer] options.registry or options.serverHost at least set one');
    assert(options.connectionManager, '[RpcConsumer] options.connectionManager is required');
    super({ initMethod: '_init' });

    this.options = Object.assign({}, defaultOptions, options);
    this._isReady = false;
    this._middlewares = options.middlewares ? options.middlewares.slice(0) : [];
    this[_handleRequest] = null;

    this.ready(err => {
      this._isReady = !err;
    });
  }

  get id() {
    return this.version ? this.interfaceName + ':' + this.version : this.interfaceName;
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
    } else if (this.registry) {
      await this.registry.ready();
      this._addressGroup = this.createAddressGroup(this.id + '@' + this.group);
      this._addressListener = addressList => {
        this._addressGroup.addressList = addressList
          .filter(url => {
            if (!is.string(url)) {
              this.logger.warn('[RpcConsumer] subscribe address format invalid:', url);
              return false;
            }
            return true;
          })
          .map(url => this.parseUrl(url));
      };
      this.registry.subscribe(this.registryConfig, this._addressListener);
    } else {
      setImmediate(() => { this._addressGroup.addressList = []; });
    }
    await this._addressGroup.ready();
  }

  createAddressGroup(key, options) {
    return new AddressGroup(Object.assign({ key }, this.options, options));
  }

  createRequest(method, args, options) {
    return new RpcRequest({
      targetAppName: this.targetAppName,
      serverSignature: this.id,
      group: this.group,
      methodName: method,
      args,
      requestProps: options.requestProps,
      codecType: options.codecType,
      timeout: options.responseTimeout || this.options.responseTimeout,
      ctx: options.ctx,
    });
  }

  createContext(req) {
    const id = this.id;
    return {
      req,
      res: { error: null, appResponse: null },
      get path() {
        return '/rpc/' + id + '/' + req.methodName;
      },
      get body() {
        return this.res.appResponse;
      },
      set body(val) {
        this.res.appResponse = val;
      },
    };
  }

  async getConnection(req) {
    return await this._addressGroup.getConnection(req);
  }

  get handleRequest() {
    if (!this[_handleRequest]) {
      this[_handleRequest] = compose(this._middlewares.concat(this._invoke.bind(this)));
    }
    return this[_handleRequest];
  }

  use(mw) {
    if (Array.isArray(mw)) {
      this._middlewares = this._middlewares.concat(mw);
    } else {
      this._middlewares.push(mw);
    }
    this[_handleRequest] = null;
  }

  async _invoke(ctx) {
    if (!this._isReady) {
      await this.ready();
    }
    const req = ctx.req;
    let conn;
    try {
      conn = await this.getConnection(req);
    } catch (err) {
      this._wrapError(err, req);
      throw err;
    }

    if (!conn) {
      const err = new Error('No provider of ' + this.id + '@' + this.group + ':' + req.methodName + '() found!');
      err.name = 'RpcNoProviderError';
      req.meta.resultCode = '04';
      this._wrapError(err, req);
      throw err;
    }
    try {
      ctx.res = await conn.invoke(req, {
        proto: this.options.proto,
        classMap: this.options.classMap,
      });
      if (ctx.res.error) {
        this._wrapError(ctx.res.error, req);
      }
    } catch (err) {
      this._wrapError(err, req);
      throw err;
    }
  }

  async invoke(method, args, options = {}) {
    const req = this.createRequest(method, args, options);
    this.emit('request', req);

    const ctx = this.createContext(req);
    try {
      await this.handleRequest(ctx);
      if (ctx.res.error) {
        throw ctx.res.error;
      }
      return ctx.res.appResponse;
    } catch (err) {
      if (this.options.errorAsNull !== true) throw err;
      return null;
    } finally {
      if (req.meta.connectionGroup) {
        HealthCounter.getInstance(req.meta.connectionGroup).update(req.meta);
      }
      this.emit('response', ctx);
    }
  }

  _wrapError(err, req) {
    if (req.meta.resultCode === '00') {
      req.meta.resultCode = err.resultCode || '01';
    }
    err.resultCode = req.meta.resultCode;
    req.meta.error = err;
  }

  parseUrl(url) {
    assert(typeof url === 'string', 'parseUrl(url) url should be string');
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
    this.emit('close');
  }
}

module.exports = RpcConsumer;
