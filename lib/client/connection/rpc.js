'use strict';

const net = require('net');
const pump = require('pump');
const assert = require('assert');
const Base = require('sdk-base');
const utils = require('../utils');
const protocol = require('sofa-bolt-node');
const CircuitBreaker = require('../circuit_breaker');

const defaultOptions = {
  protocol,
  noDelay: true, // 默认禁用 Nagle 算法
  maxIdleTime: 30000, // 最大空闲时间
  connectTimeout: 3000, // 连接超时时长
};

class RpcConnection extends Base {
  constructor(options) {
    assert(options.logger, '[RpcConnection] options.logger is required');
    assert(options.address, '[RpcConnection] options.address is required');
    super(Object.assign({}, defaultOptions, options));

    this._closed = false;
    this._isClosing = false;
    this._connected = false;
    this._lastError = null;
    this._sentReqs = new Map();
    this._lastActiveTime = -1; // 上次和服务器通讯的时间（包括心跳）
    this._lastInvokeTime = -1; // 上次调用服务器的时间
    this._key = 'RpcConnection@' + this.address.host;
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

  get protocol() {
    return this.options.protocol;
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
    this._socket = net.connect(Number(this.address.port), this.address.hostname);
    this._socket.setNoDelay(this.options.noDelay);
    this._socket.setTimeout(this.options.connectTimeout, () => {
      const err = new Error('socket#' + this.url + ' connect timeout(' + this.options.connectTimeout + 'ms)');
      err.name = 'RpcSocketConnectTimeoutError';
      this.close(err);
      this.ready(err);
    });
    this._socket.once('close', () => { this._handleClose(); });
    this._socket.once('error', err => { this._handleSocketError(err); });
    this._socket.once('connect', () => {
      this._connected = true;
      this._socket.setTimeout(0);
      this._clientUrl = this._socket.localAddress + ':' + this._socket.localPort;
      this.ready(true);
    });

    const encodeOpts = {
      sentReqs: this._sentReqs,
      classCache: this.options.classCache || new Map(),
      address: this.address,
    };
    const decodeOpts = {
      sentReqs: this._sentReqs,
      classCache: this.options.classCache || new Map(),
      address: this.address,
    };

    // 针对 classMap 针对 hessian, proto 针对 protobuf
    // 因为可能需要同时支持，所以分开设置（一般通过全局设置，所以这里要判断是否有值）
    if (this.options.classMap) {
      encodeOpts.classMap = this.options.classMap;
      decodeOpts.classMap = this.options.classMap;
    }
    if (this.options.proto) {
      encodeOpts.proto = this.options.proto;
      decodeOpts.proto = this.options.proto;
    }

    encodeOpts.classCache.enableCompile = true;
    decodeOpts.classCache.enableCompile = true;
    if (this.options.disableDecodeCache) {
      decodeOpts.classCache = null;
    }

    this._encoder = this.protocol.encoder(encodeOpts);
    this._decoder = this.protocol.decoder(decodeOpts);
    this._decoder.on('response', res => { this._handleResponse(res); });
    // @refer https://nodejs.org/en/docs/guides/backpressuring-in-streams/
    pump(this._encoder, this._socket, this._decoder);
  }

  /**
   * 重置计数器
   */
  resetCounter() {
    this._circuitBreaker.reset();
  }

  /**
   * 心跳，用户维护长连接
   */
  heartbeat() {
    // 长时间空闲需要发心跳来续命（服务端 90s 空闲强制断开）
    if ((Date.now() - this._lastActiveTime) > this.options.maxIdleTime) {
      this._lastActiveTime = Date.now();
      const id = utils.nextId();
      // 只发就好，不用等 ack 了
      this._encoder.writeHeartbeat(id, {
        timeout: 3000,
        clientUrl: this._clientUrl,
      });
    }
  }

  /**
   * 泛化调用 rpc 接口
   *
   * @param {Object} req - 请求对象
   * @return {Promise} 结果
   */
  async invoke(req) {
    assert(req && req.timeout, '[RpcConnection] req.timeout is required');
    this._lastActiveTime = this._lastInvokeTime = Date.now();
    const id = utils.nextId();
    req.meta.id = id;
    req.meta.address = this.address;

    const resPromise = this.await('response_' + id);
    const timer = setTimeout(() => {
      const rt = Date.now() - req.meta.start;
      const err = new Error('no response in ' + rt + 'ms, address:' + this.url);
      err.name = 'RpcResponseTimeoutError';
      err.req = req;
      err.timeout = req.timeout;
      req.meta.resultCode = '03'; // 超时
      this._handleRpcError(id, err);
    }, req.timeout);
    this._sentReqs.set(id, { req, resPromise, timer });

    // 如果目前状态为熔断，则直接返回错误
    if (!this._circuitBreaker.allowRequest()) {
      const hc = this._circuitBreaker.latestHealthCount;
      const err = new Error('this request is block by circuit breaker, ' + hc.toString() + ', url: ' + this.url);
      err.name = 'RpcCircuitBreakerError';
      req.meta.resultCode = '02';
      // 保证异步返回
      process.nextTick(() => { this._handleRpcError(id, err); });
    } else {
      this._encoder.writeRequest(id, req, (err, packet) => {
        if (packet && packet.meta) {
          req.meta.codecType = packet.meta.codecType;
          req.meta.boltVersion = packet.meta.boltVersion;
          req.meta.sofaVersion = packet.meta.sofaVersion;
          req.meta.crcEnable = packet.meta.crcEnable;
          req.meta.reqSize = packet.meta.size;
          req.meta.requestEncodeStart = packet.meta.start;
          req.meta.requestEncodeRT = packet.meta.encodeRT;
        }
        if (err) {
          err.name = 'RpcRequestEncodeError';
          req.meta.resultCode = '02';
          // 保证异步返回
          process.nextTick(() => { this._handleRpcError(id, err); });
        }
      });
    }
    const res = await resPromise;
    req.meta.responseDecodeStart = res.meta.start;
    req.meta.responseDecodeRT = res.meta.rt;
    req.meta.resSize = res.meta.size;
    req.meta.rt = Date.now() - req.meta.start;

    this._circuitBreaker.update(req.meta);
    return res.data;
  }

  _handleResponse(res) {
    const id = res.packetId;
    const reqInfo = this._sentReqs.get(id);
    if (reqInfo) {
      clearTimeout(reqInfo.timer);
      this._sentReqs.delete(id);
      this.emit('response_' + id, res);
    } else {
      this.logger.warn('[RpcConnection] can not find invoke request for response: %j, maybe it\'s timeout.', res);
    }
  }

  _handleRpcError(id, err) {
    this._handleResponse({
      packetId: id,
      packetType: 'response',
      data: { error: err, appResponse: null },
      meta: { size: 0, start: 0, rt: 0 },
    });
  }

  _handleSocketError(err) {
    if (!this.isConnected) {
      this.ready(err);
      return;
    }
    if (this._closed || this._isClosing) {
      this.logger.warn('[RpcConnection] socket#%s error after closed, cause by %s', this.url, err.message);
      return;
    }
    if (err.code === 'ECONNRESET') {
      // 切流的时候可能导致大量不必要的异常日志
      this.logger.warn('[RpcConnection] socket#%s ECONNRESET', this.url);
    } else {
      err.name = 'RpcSocketError';
      err.message += ' (address: ' + this.url + ')';
      this.emit('error', err);
    }
  }

  _cleanRequest(err) {
    if (!err) {
      err = new Error('The socket was closed. (address: address => ' + this.url + ')');
      err.name = 'RpcSocketCloseError';
      err.resultCode = '02';
    }
    for (const id of this._sentReqs.keys()) {
      this._handleResponse({
        packetId: id,
        packetType: 'response',
        data: { error: err, appResponse: null },
        meta: { size: 0, start: 0, rt: 0 },
      });
    }
  }

  _handleClose() {
    this._closed = true;
    this._isClosing = false;
    if (this._lastError) {
      this.emit('error', this._lastError);
    }
    this._cleanRequest(this._lastError);
    this._circuitBreaker.close();
    // 最后触发 close 事件
    this.emit('close');
  }

  /**
   * 强制关闭连接，不等正在进行中的请求
   *
   * @param {Error} [err] - 关闭的异常
   */
  async forceClose(err) {
    if (this._closed) {
      return;
    }
    this._lastError = err;
    this._socket.destroy();
    await this.await('close');
  }

  /**
   * 手动关闭连接
   *
   * @param {Error} [err] - 关闭的异常
   */
  async close(err) {
    this._isClosing = true;
    // 等待 pending 的请求结束
    await Promise.all(
      Array.from(this._sentReqs.values()).map(data => data.resPromise)
    );
    await this.forceClose(err);
  }
}

module.exports = RpcConnection;
