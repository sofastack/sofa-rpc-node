'use strict';

const Base = require('sdk-base');
const assert = require('assert');
const RpcConnection = require('./connection/rpc');

const defaultOptions = {
  connectionClass: RpcConnection,
  // NOTE: 这里是按照单进程最多 6000 个 socket 连接来设置的，
  // 如果超过了要么是需要做连接数控制，要么就是代码有问题，忘记清理事件监听，
  // 还有可能是依赖的下游服务太多，需要拆应用了
  warnConnectionCount: 6000,
};

class ConnectionManager extends Base {
  /**
   * 连接池管理（按 ip 来管理）
   *
   * @param {Object} options - The options
   * @class
   */
  constructor(options = {}) {
    assert(options.logger, '[ConnectionManager] options.logger is required');
    super(Object.assign({}, defaultOptions, options));
    this._connections = new Map(); // <ip, Connection>
    this.ready(true);
    this._warnConnectionCount = options.warnConnectionCount;
  }

  get logger() {
    return this.options.logger;
  }

  get connections() {
    return this._connections;
  }

  get connectionClass() {
    return this.options.connectionClass;
  }

  /**
   * 同步获取可用的连接
   *
   * @param {Url} address - 地址对象
   * @return {Connection} 连接对象
   */
  get(address) {
    const conn = this.doGetConn(address);
    if (conn && conn.isConnected) {
      return conn;
    }
    return null;
  }

  doGetConn(address) {
    return this._connections.get(address.host);
  }

  doSetConn(address, conn) {
    return this._connections.set(address.host, conn);
  }

  doDeleteConn(address) {
    this._connections.delete(address.host);
  }

  // 记录 connection 启动异常消息，可按需覆盖展示逻辑
  logConnectErrorMessage(message) {
    this.logger.info(message);
  }

  /**
   * 若不存在，则创建新的连接
   *
   * @param {Url} address - 地址
   * @param {Object} options - 参数
   * @param {Function} connectionClass - connection 类
   * @return {Promise} 连接对象
   */
  async createAndGet(address, options, connectionClass) {
    connectionClass = connectionClass || this.options.connectionClass;
    let conn = this.doGetConn(address);
    if (!conn) {
      conn = new connectionClass(Object.assign({
        address,
        logger: this.logger,
      }, options));
      this.doSetConn(address, conn);
      conn.once('close', () => { this.doDeleteConn(address); });
      conn.once('error', err => { this.emit('error', err); });
    }
    if (!conn.isConnected) {
      try {
        await conn.ready();
        const currentSize = this._connections.size;
        if (currentSize > this._warnConnectionCount) {
          this.logger.warn(
            '[ConnectionManager] current connection count is %s, great than warn count %s',
            currentSize, this._warnConnectionCount);
        }
      } catch (err) {
        const message = `[ConnectionManager] create connection: ${address.href} failed, caused by ${err.message}`;
        this.logConnectErrorMessage(message);
        this.doDeleteConn(address);
        return null;
      }
    }
    return conn;
  }

  // 主要是给 ci 时用的
  closeAllConnections() {
    return Promise.all(Array.from(this._connections.values()).map(conn => conn.close()));
  }

  close() {
    return this.closeAllConnections();
  }
}

module.exports = ConnectionManager;
