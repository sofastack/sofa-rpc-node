'use strict';

const ByteBuffer = require('byte');
const io = ByteBuffer.allocate(512 * 1024);

class GRpcResponse {
  constructor(req, options) {
    this.req = req;
    this.stream = options.stream;
    this.methodInfo = options.methodInfo;
    this.meta = {
      start: Date.now(),
      rt: 0,
      data: null,
      responseEncodeRT: 0,
      serviceName: req.data.serverSignature,
      interfaceName: req.data.interfaceName,
      method: req.data.methodName,
      remoteIp: this.stream.session.socket.remoteAddress,
      reqSize: req.meta && req.meta.size || 0,
      resSize: 0,
      resultCode: '00', // 00：成功，01：异常，03：超时，04：路由失败
    };
  }

  get isClosed() {
    return this.stream.closed;
  }

  async send(res) {
    const methodInfo = this.methodInfo;
    let http2Header = {
      'content-type': 'application/grpc',
      'grpc-accept-encoding': 'identity',
      'accept-encoding': 'identity',
    };
    let grpcMeta = {
      'grpc-status': 0,
      'grpc-message': 'OK',
    };
    let data = '';
    if (res.isError) {
      this.meta.rt = Date.now() - this.meta.start;
      this.meta.resultCode = '02';
      http2Header = {
        ...http2Header,
        ':status': 500, // make a unknown http2 status
      };
      grpcMeta = {
        ...grpcMeta,
        'grpc-status': 2, // UNKNOWN
        'grpc-message': res.errorMsg,
      };
      data = '';
    } else if (methodInfo.responseType) {
      const responseEncodeStart = Date.now();
      const responseType = methodInfo.resolvedResponseType;
      const buf = responseType
        .encode(responseType.fromObject(res.appResponse))
        .finish();
      const resSize = buf.length;
      io.reset();
      io.put(0);
      io.putInt(resSize);
      io.put(buf);

      this.meta.responseEncodeRT = Date.now() - responseEncodeStart;
      this.meta.data = buf;
      this.meta.rt = Date.now() - this.meta.start;
      this.meta.resSize = resSize + 5;
      http2Header = { ...http2Header, ':status': 200 };
      grpcMeta = {
        ...grpcMeta,
        'grpc-status': 0,
        'grpc-message': 'OK',
      };
      data = io.array();
    }
    if (!this.stream || this.stream.destroyed) {
      return;
    }
    this.stream.respond(http2Header, { waitForTrailers: true });
    this.stream.on('wantTrailers', () => {
      this.stream.sendTrailers(grpcMeta);
    });
    this.stream.end(data);
  }
}

module.exports = GRpcResponse;
