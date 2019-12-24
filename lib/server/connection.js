'use strict';

const pump = require('pump');
const assert = require('assert');
const Base = require('sdk-base');

const defaultOptions = {
  maxIdleTime: 90 * 1000,
  protocol: require('sofa-bolt-node'),
};

class RpcConnection extends Base {
  /**
   * 服务提供者抽象
   *
   * @param {Object} options
   *   - {Socket} socket - tcp socket 实例
   *   - {Object} protocol - 协议
   *   - {Logger} logger - 日志对象
   * @class
   */
  constructor(options = {}) {
    assert(options.socket, '[RpcConnection] options.socket is required');
    assert(options.logger, '[RpcConnection] options.logger is required');
    super(Object.assign({}, defaultOptions, options));

    this._sentReqs = new Map();
    const encodeOpts = {
      sentReqs: this._sentReqs,
      classCache: this.options.classCache || new Map(),
    };
    const decodeOpts = {
      sentReqs: this._sentReqs,
      classCache: this.options.classCache || new Map(),
    };
    // 针对 classMap 针对 hessian, proto 针对 protobuf
    // 因为可能需要同时支持，所以分开设置（一般通过全局设置，所以这里要判断是否有值）
    if (this.options.classMap) {
      encodeOpts.classMap = this.options.classMap;
      decodeOpts.classMap = this.options.classMap;
    }
    encodeOpts.classCache.enableCompile = true;
    decodeOpts.classCache.enableCompile = true;
    if (this.options.proto) {
      encodeOpts.proto = this.options.proto;
      decodeOpts.proto = this.options.proto;
    }
    if (this.options.disableDecodeCache) {
      decodeOpts.classCache = null;
    }

    this.socket.once('close', () => { this._handleClose(); });
    this.socket.once('error', err => { this._handleSocketError(err); });
    this._encoder = this.protocol.encoder(encodeOpts);
    this._decoder = this.protocol.decoder(decodeOpts);
    this._decoder.on('request', req => { this._handleRequest(req); });
    this._decoder.on('heartbeat', hb => { this._handleHeartbeat(hb); });
    // @refer https://nodejs.org/en/docs/guides/backpressuring-in-streams/
    pump(this._encoder, this.socket, this._decoder, err => {
      this.close(err);
    });

    this._closed = false;
    this._lastActiveTime = Date.now();
    this._remoteAddress = this.socket.remoteAddress + ':' + this.socket.remotePort;
    this._timer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastActiveTime >= this.options.maxIdleTime) {
        this.logger.warn('[RpcConnection] socket: %s is idle for %s(ms)', this.remoteAddress, this.options.maxIdleTime);
        this.close();
      }
    }, this.options.maxIdleTime);
    this.ready(true);
  }

  get socket() {
    return this.options.socket;
  }

  get protocol() {
    return this.options.protocol;
  }

  get logger() {
    return this.options.logger;
  }

  get lastActiveTime() {
    return this._lastActiveTime;
  }

  get remoteAddress() {
    return this._remoteAddress;
  }

  get isClosed() {
    return this._closed;
  }

  close(err) {
    if (this.isClosed) return Promise.resolve();

    this.socket.destroy(err);
    return this.await('close');
  }

  send(req, res) {
    return new Promise((resolve, reject) => {
      this._encoder.writeResponse(req, res, (err, packet) => {
        if (err) {
          reject(err);
        } else {
          resolve(packet);
        }
      });
    });
  }

  _handleRequest(req) {
    this._lastActiveTime = Date.now();
    this.emit('request', req);
  }

  _handleHeartbeat(hb) {
    this._lastActiveTime = Date.now();
    this._encoder.writeHeartbeatAck(hb);
  }

  _handleClose() {
    this._closed = true;
    clearInterval(this._timer);
    this.emit('close');
  }

  _handleSocketError(err) {
    // 心跳检查可能频繁的建连和断连，所以如果是 ECONNRESET 就忽略，避免打印很多无用的日志
    if (err.code !== 'ECONNRESET') {
      this.logger.warn('[RpcConnection] error occured on socket: %s, errName: %s, errMsg: %s', this.remoteAddress, err.name, err.message);
    }
  }
}

module.exports = RpcConnection;
