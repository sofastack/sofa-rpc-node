'use strict';

const http2 = require('http2');
const Base = require('sdk-base');
const assert = require('assert');
const utils = require('../../utils');
const CallStream = require('./call_stream');
const CircuitBreaker = require('../../circuit_breaker');

const defaultOptions = {
  maxIdleTime: 30000, // 最大空闲时间
  connectTimeout: 3000, // 连接超时时长
};

const defaultPayload = Buffer.from('12345678');

class GRpcConnection extends Base {

  constructor(options = {}) {
    assert(options.logger, '[GRpcConnection] options.logger is required');
    assert(options.address, '[GRpcConnection] options.address is required');
    super(Object.assign({}, defaultOptions, options));

    this._key = 'GRpcConnection@' + this.address.host;
    this._closed = false;
    this._isClosing = false;
    this._connected = false;
    this._lastError = null;
    this._clientUrl = null;
    this._sentReqs = new Map();
    this._lastActiveTime = -1; // 上次和服务器通讯的时间（包括心跳）
    this._lastInvokeTime = -1; // 上次调用服务器的时间
    // 熔断器
    this._circuitBreaker = CircuitBreaker.getInstance(this.key);
    this._connect();
  }

  get key() {
    return this._key;
  }

  get url() {
    return this.address.href;
  }

  get address() {
    return this.options.address;
  }

  get logger() {
    return this.options.logger;
  }

  get isOk() {
    return this._connected && !this._closed;
  }

  get isClosed() {
    return this._closed;
  }

  get isConnected() {
    return this._connected;
  }

  get lastInvokeTime() {
    return this._lastInvokeTime;
  }

  get latestHealthCount() {
    return this._circuitBreaker.latestHealthCount;
  }

  _connect() {
    this._session = http2.connect(this.url);
    this._session.setTimeout(this.options.connectTimeout, () => {
      const err = new Error('session#' + this.url + ' connect timeout(' + this.options.connectTimeout + 'ms)');
      err.name = 'GRpcSessionConnectTimeoutError';
      this.close(err);
      this.ready(err);
    });

    this._session.once('close', () => { this._handleClose(); });
    this._session.once('error', err => { this._handleSocketError(err); });
    this._session.once('connect', () => {
      this._connected = true;
      this._session.setTimeout(0);
      const socket = this._session.socket;
      this._clientUrl = socket.localAddress + ':' + socket.localPort;
      this.ready(true);
    });
  }

  /**
   * 重置计数器
   */
  resetCounter() {
    this._circuitBreaker.reset();
  }

  /**
   * 心跳，用户维护长连接
   * @param {Buffer} payload - payload
   * @return {void}
   */
  heartbeat(payload = defaultPayload) {
    // 长时间空闲需要发心跳来续命（服务端 90s 空闲强制断开）
    if ((Date.now() - this._lastActiveTime) > this.options.maxIdleTime) {
      this._lastActiveTime = Date.now();
      this._session.ping(payload, err => {
        if (err) {
          this.close(err);
        }
      });
    }
  }

  async invoke(req, options) {
    assert(options && options.proto, '[GRpcConnection] options.proto is required');
    assert(req && req.timeout, '[GRpcConnection] req.timeout is required');
    this._lastActiveTime = this._lastInvokeTime = Date.now();
    req.meta.address = this.address;

    if (!this._circuitBreaker.allowRequest()) {
      const hc = this.latestHealthCount;
      const err = new Error('this request is block by circuit breaker, ' + hc.toString() + ', url: ' + this.url);
      err.name = 'GRpcCircuitBreakerError';
      req.meta.resultCode = '02';
      req.meta.rt = Date.now() - req.meta.start;
      return { error: err };
    }

    const id = utils.nextId();
    const callStream = new CallStream(this._session, options.proto);
    const timer = setTimeout(() => {
      const rt = Date.now() - req.meta.start;
      const err = new Error('no response in ' + rt + 'ms, address:' + this.url);
      err.name = 'GRpcResponseTimeoutError';
      err.req = req;
      err.timeout = req.timeout;
      req.meta.resultCode = '03'; // 超时
      callStream.cancelCall(err);
    }, req.timeout);
    const resPromise = callStream.call(req);
    this._sentReqs.set(id, { req, resPromise, callStream });
    callStream.once('close', () => { this._sentReqs.delete(id); });

    const res = await resPromise;
    clearTimeout(timer);
    this._circuitBreaker.update(req.meta);
    req.meta.rt = Date.now() - req.meta.start;
    return res.data;
  }

  _handleSocketError(err) {
    err.name = 'GRpcSocketError';
    err.message += ' (address: ' + this.url + ')';
    if (!this.isConnected) {
      this.ready(err);
      return;
    }
    if (this._closed || this._isClosing) {
      this.logger.warn('[GRpcConnection] error after closed, cause by %s', err.message);
      return;
    }
    if (err.code === 'ECONNRESET') {
      // 切流的时候可能导致大量不必要的异常日志
      this.logger.warn('[GRpcConnection] socket#%s ECONNRESET', this.url);
    } else {
      this.emit('error', err);
    }
  }

  _cleanRequest(err) {
    if (!err) {
      err = new Error('The socket was closed. (address: address => ' + this.url + ')');
      err.name = 'GRpcSocketCloseError';
    }
    err.resultCode = err.resultCode || '02';
    for (const id of this._sentReqs.keys()) {
      const { callStream } = this._sentReqs.get(id);
      callStream.cancelCall(err);
    }
  }

  _handleClose() {
    this._closed = true;
    this._isClosing = false;
    if (this._lastError) {
      this.emit('error', this._lastError);
    }
    this._circuitBreaker.close();
    // 最后触发 close 事件
    this.emit('close');
  }

  async forceClose(err) {
    if (this._closed) {
      return;
    }
    this._lastError = err;
    this._cleanRequest(err);
    this._session.destroy();
    await this.await('close');
  }

  async close(err) {
    this._isClosing = true;
    // 等待 pending 的请求结束
    await Promise.all(
      Array.from(this._sentReqs.values()).map(data => data.resPromise)
    );
    await this.forceClose(err);
  }
}

module.exports = GRpcConnection;
