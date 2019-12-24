'use strict';

const net = require('net');
const assert = require('assert');
const Base = require('sdk-base');
const qs = require('querystring');
const graceful = require('graceful');
const awaitFirst = require('await-first');
const RpcService = require('./service');
const RpcResponse = require('./response');
const RpcConnection = require('./connection');
const RpcClient = require('../client').RpcClient;
const localIp = require('address').ip();

const _testClient = Symbol.for('RpcServer#testClient');
const defaultOptions = {
  port: 12200,
  group: 'SOFA',
  version: '1.0',
  protocol: require('sofa-bolt-node'),
  serviceClass: RpcService,
  responseClass: RpcResponse,
  connectionClass: RpcConnection,
  idleTime: 5000,
  killTimeout: 30000,
  maxIdleTime: 90 * 1000,
  responseTimeout: 3000,
  codecType: 'hessian2',
  classCacheClass: Map,
};

class RpcServer extends Base {
  /**
   * Rpc 服务提供方
   *
   * @param {Object} options
   *   - {String} appName - 应用名称
   *   - {Registry} registry - 配置中心客户端，用于发布服务地址
   *   - {Logger} logger - 日志对象，推荐使用 egg-logger 实例
   *   - {String} [group=SOFA] - 默认分组
   *   - {String} [codecType=hessian2] - 序列化协议类型，支持 hessian2 / protobuf 等
   *   - {Protocol} [protocol=require('sofa-bolt-node')] - rpc 通讯协议具体实现
   *   - {Number} [idleTime=5000] - 客户端心跳间隔
   *   - {Number} [maxIdleTime=30000] - 客户端最大空闲间隔，超过该间隔没有收到数据，则断开连接
   * @class
   */
  constructor(options) {
    assert(options.logger, '[RpcServer] options.logger is required');
    super(Object.assign({}, defaultOptions, options));

    this._started = false;
    this._localIp = localIp;
    this._servers = [];
    this._services = new Map(); // <id, Service>
    this._connections = new Map(); // <address, Connection>

    this.classMap = options.classMap;
    this.proto = options.proto;
    this.publishAddress = this.options.publishAddress || this._localIp;
    this.publishPort = this.options.port;
    this.serviceClass = this.options.serviceClass;
    this.responseClass = this.options.responseClass;
    this.connectionClass = this.options.connectionClass;
  }

  // 给单元测试用
  get testClient() {
    if (!this[_testClient]) {
      this[_testClient] = new RpcClient({
        logger: this.logger,
        connectionOpts: {
          proto: this.proto,
          classMap: this.classMap,
          protocol: this.protocol,
          codecType: this.options.codecType,
        },
      });
    }
    return this[_testClient];
  }

  get services() {
    return this._services;
  }

  get protocol() {
    return this.options.protocol;
  }

  get listenPorts() {
    return [ this.publishPort ];
  }

  get logger() {
    return this.options.logger;
  }

  get registry() {
    return this.options.registry;
  }

  get url() {
    const type = this.protocol.name || 'bolt';
    // uniqueId=&version=1.0&timeout=0&delay=-1&id=rpc-cfg-0&dynamic=true&weight=100&accepts=100000&startTime=1526050447423&pid=13862&language=java&rpcVer=50400
    return type + '://' + this.publishAddress + ':' + this.publishPort + '?' + qs.stringify(this.params);
  }

  get params() {
    const obj = {
      startTime: Date.now(),
      pid: process.pid,
      uniqueId: '',
      dynamic: 'true',
      appName: this.options.appName,
      timeout: this.options.responseTimeout,
      serialization: this.options.codecType,
      weight: 100,
      accepts: 100000,
      language: 'nodejs',
      rpcVer: '50400',
      protocol: this.protocol.name,
    };
    return obj;
  }

  // https://nodejs.org/api/net.html#net_server_getconnections_callback
  getConnections(callback) {
    if (callback) {
      callback(null, this._connections.size);
    }
  }

  /**
   * Adds a service.
   *
   * @param {Object} info      The information
   * @param {Object} delegate  The delegate
   * @return {void}
   */
  addService(info, delegate) {
    if (typeof info === 'string') {
      info = { interfaceName: info };
    }
    const service = new this.serviceClass(Object.assign({
      registry: this.registry,
      logger: this.logger,
      group: this.options.group,
      version: this.options.version,
      delegate,
    }, info));
    service.on('error', err => { this.emit('error', err); });
    if (this._services.has(service.id)) {
      this.logger.warn('[RpcServer] service: %s already added, will override it', service.id);
    }
    this._services.set(service.id, service);
  }

  _startServer(port) {
    const server = net.createServer();
    server.once('error', err => { this.emit('error', err); });
    server.on('connection', socket => { this._handleSocket(socket); });
    server.listen(port, () => {
      const realPort = server.address().port;
      if (port === this.publishPort && port === 0) {
        this.publishPort = realPort;
      }
      this.logger.info('[RpcServer] server start on %s', realPort);
    });
    return server;
  }

  /**
   * Start the rpc server
   *
   * @return {Promise} promise
   */
  async start() {
    if (!this._started) {
      this._started = true;
      for (const port of this.listenPorts) {
        const server = this._startServer(port);
        this._servers.push(server);
      }
      graceful({
        killTimeout: this.options.killTimeout,
        server: this._servers,
        error: () => {
          this._handleUncaughtError();
        },
      });
      Promise.all(this._servers.map(server => awaitFirst(server, [ 'listening', 'error' ])))
        .then(() => {
          this.emit('listening');
          this.ready(true);
        }, err => {
          this.ready(err);
        });
    }
    return this.ready();
  }

  publish() {
    const tasks = [];
    for (const service of this._services.values()) {
      tasks.push(service.publish(this.url));
    }
    return Promise.all(tasks);
  }

  unPublish() {
    const tasks = [];
    for (const service of this._services.values()) {
      tasks.push(service.unPublish());
    }
    return Promise.all(tasks);
  }

  async close() {
    // 1. 取消服务注册
    await this.unPublish();
    // 2. 关闭 tcp server
    for (const server of this._servers) {
      server.close();
    }
    // 3. 强制关闭连接
    const closeTasks = [];
    for (const connection of this._connections.values()) {
      closeTasks.push(connection.close());
    }
    await Promise.all(closeTasks);
    this.emit('close');

    if (this.testClient) {
      await this.testClient.close();
    }
  }

  _handleSocket(socket) {
    const options = {
      socket,
      protocol: this.protocol,
      logger: this.logger,
      proto: this.proto,
      classMap: this.classMap,
      maxIdleTime: this.options.maxIdleTime,
      disableDecodeCache: this.options.disableDecodeCache,
    };
    if (this.options.classCacheClass) {
      // 每一个 connection 实例化一个 classCache
      options.classCache = new this.options.classCacheClass();
    }
    const conn = new this.connectionClass(options);
    const key = conn.remoteAddress;
    this._connections.set(key, conn);
    conn.on('request', req => {
      this._handleRequest(req, conn).catch(err => {
        err.req = req;
        this.emit('error', err);
      });
    });
    conn.once('close', () => { this._connections.delete(key); });
    this.emit('connection', conn);
  }

  createContext(/* req, res*/) {
    return null;
  }

  async _handleRequest(req, conn) {
    const id = req.data.serverSignature;
    req.data.interfaceName = req.data.interfaceName || req.data.serverSignature.split(':')[0];
    const service = this._services.get(id);
    const res = new this.responseClass(req, conn);
    const ctx = this.createContext(req, res);
    this.emit('request', { req, ctx });
    try {
      if (!service) {
        throw new Error('not found service: ' + id);
      }
      await service.invoke(ctx, req, res);
    } catch (e) {
      this.emit('error', e);
      res.meta.resultCode = '02';
      await res.send({
        isError: true,
        errorMsg: e.message,
        appResponse: null,
      });
    } finally {
      this.emit('response', { ctx, req, res });
    }
  }

  _handleUncaughtError() {
    this.logger.warn('[RpcServer] server is down, cause by uncaughtException in this process %s', process.pid);
    this.unPublish();
  }
}

module.exports = RpcServer;
