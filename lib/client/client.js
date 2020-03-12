'use strict';

const debug = require('debug')('rpc-client');
const Base = require('sdk-base');
const assert = require('assert');
const Scheduler = require('./scheduler');
const RpcConsumer = require('./consumer');
const protocol = require('sofa-bolt-node');
const RpcConnection = require('./connection/rpc');
const ConnectionManager = require('./connection_mgr');

const defaultOptions = {
  group: 'SOFA',
  version: '1.0',
  responseTimeout: 3000,
  consumerClass: RpcConsumer,
  connectionClass: RpcConnection,
  connectionManagerClass: ConnectionManager,
  connectionOpts: {
    protocol,
    noDelay: true, // 默认禁用 Nagle 算法
    connectTimeout: 3000, // 连接超时时长
  },
};

class RpcClient extends Base {
  constructor(options = {}) {
    assert(options.logger, '[RpcClient] options.logger is required');
    options = Object.assign({}, defaultOptions, options);
    super(options);

    if (options.protocol) this.options.connectionOpts.protocol = options.protocol;

    // 确保一个服务只创建一个 consumer
    this._consumerCache = new Map();
    this.connectionManager = new options.connectionManagerClass(options);
    this.connectionManager.on('error', err => { this.emit('error', err); });

    // middlewares
    this._middlewares = [];
    // 立马 ready
    this.ready(true);
  }

  close() {
    Scheduler.instance.clear();
    for (const consumer of this._consumerCache.values()) {
      consumer.close();
    }
    this._consumerCache.clear();
    return this.connectionManager.close();
  }

  get consumerMap() {
    return this._consumerCache;
  }

  get consumerClass() {
    return this.options.consumerClass;
  }

  set consumerClass(val) {
    this.options.consumerClass = val;
  }

  use(mw) {
    if (Array.isArray(mw)) {
      this._middlewares = this._middlewares.concat(mw);
    } else {
      this._middlewares.push(mw);
    }
    for (const consumer of this.consumerMap.values()) {
      consumer.use(mw);
    }
  }

  // 通常只是在单元测试时使用
  async invoke(opt) {
    const consumer = this.createConsumer(opt);
    const { methodName, args, options } = opt;
    await consumer.ready();
    return await consumer.invoke(methodName, args, options);
  }

  createConsumer(options, consumerClass) {
    assert(typeof options.interfaceName === 'string', '[RpcClient] createConsumer(options) options.interfaceName is required and should be a string.');
    options = Object.assign({
      middlewares: this._middlewares,
      connectionManager: this.connectionManager,
      cache: true,
    }, this.options, options);
    const key = this.formatKey(options);
    let consumer = this._consumerCache.get(key);
    if (!options.cache || !consumer) {
      debug('create consumer for %s', key);
      consumerClass = consumerClass || this.consumerClass;
      consumer = new consumerClass(options);
      this._consumerCache.set(key, consumer);
      // delegate consumer's error to client
      consumer.on('error', err => { this.emit('error', err); });
      consumer.on('request', req => { this.emit('request', req); });
      consumer.on('response', info => { this.emit('response', info); });
      consumer.once('close', () => {
        this._consumerCache.delete(key);
      });
    }
    return consumer;
  }

  formatKey(options) {
    const { interfaceName, version, group, serverHost } = options;
    let key = interfaceName + ':' + version + '@' + group;
    if (serverHost) {
      key += '@' + serverHost;
    }
    if (options.targetAppName) {
      key += '@' + options.targetAppName;
    }
    return key;
  }
}

module.exports = RpcClient;
