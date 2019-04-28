'use strict';

const http2 = require('http2');
const assert = require('assert');
const qs = require('querystring');
const RpcServer = require('../server');
const GRpcResponse = require('./response');
const { GRpcClient } = require('../../client');
const ProtoUtil = require('../../util/proto_util');

const {
  HTTP2_HEADER_PATH,
} = http2.constants;

const units = {
  m: 1,
  S: 1000,
  M: 60 * 1000,
  H: 60 * 60 * 1000,
};

const _testClient = Symbol.for('RpcServer#testClient');
const defaultOptions = {
  responseClass: GRpcResponse,
};

class GRpcServer extends RpcServer {
  constructor(options = {}) {
    assert(options.proto, '[GRpcServer] options.proto is required');
    super(Object.assign({}, defaultOptions, options));
  }

  get testClient() {
    if (!this[_testClient]) {
      this[_testClient] = new GRpcClient({
        logger: this.logger,
        proto: this.proto,
      });
    }
    return this[_testClient];
  }

  get url() {
    // uniqueId=&version=1.0&timeout=0&delay=-1&id=rpc-cfg-0&dynamic=true&weight=100&accepts=100000&startTime=1526050447423&pid=13862&language=java&rpcVer=50400
    return 'http://' + this.publishAddress + ':' + this.publishPort + '?' + qs.stringify(this.params);
  }

  _startServer(port) {
    const server = http2.createServer();
    server.once('error', err => { this.emit('error', err); });
    server.on('session', session => { this._handleSocket(session); });
    server.on('stream', (stream, headers) => { this._handleStream(stream, headers); });
    server.listen(port, () => {
      const realPort = server.address().port;
      if (port === this.publishPort && port === 0) {
        this.publishPort = realPort;
      }
      this.logger.info('[RpcServer] server start on %s', realPort);
    });
    return server;
  }

  _handleSocket(session) {
    const socket = session.socket;
    const key = socket.remoteAddress + ':' + socket.remotePort;
    this._connections.set(key, session);
    session.once('close', () => { this._connections.delete(key); });
    this.emit('connection', session);
  }

  _handleStream(stream, headers) {
    const path = headers[HTTP2_HEADER_PATH];
    const version = headers['grpc-version'] || '1.0';
    const arr = path.split('/');
    const interfaceName = arr[1];
    const methodName = arr[2];
    let timeout = headers['grpc-timeout'];
    if (timeout && timeout.length > 1) {
      timeout = Number(timeout.slice(0, -1)) * units[timeout.slice(-1)];
    }
    const serverSignature = interfaceName + ':' + version;
    const methodInfo = ProtoUtil.getMethodInfo(this.proto, interfaceName, methodName);
    const req = {
      data: {
        serverSignature,
        interfaceName,
        methodName,
        args: [],
      },
      options: {
        codecType: 'protobuf',
        timeout,
      },
      meta: {
        size: 0,
      },
    };

    let buf = null;
    stream.on('data', data => {
      if (buf) {
        buf = Buffer.concat([ buf, data ]);
      } else {
        buf = data;
      }

      const total = buf.length;
      if (total < 5) return;

      const bodySize = buf.readUInt32BE(1);
      if (total < bodySize + 5) return;

      const msg = buf.slice(5, bodySize + 5);
      if (methodInfo.requestType) {
        const requestType = methodInfo.resolvedRequestType;
        const arg = requestType.decode(msg);
        req.data.args.push(arg);
      }
      req.meta.size = total;
    });
    stream.on('end', () => {
      this._handleRequest(req, {
        stream,
        methodInfo,
      }).catch(err => { this.emit('error', err); });
    });
    stream.on('error', err => {
      this.logger.warn(err);
    });
  }
}

module.exports = GRpcServer;
