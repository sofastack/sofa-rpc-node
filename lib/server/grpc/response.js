'use strict';

const ByteBuffer = require('byte');
const io = ByteBuffer.allocate(512 * 1024);
const empty = Buffer.from('');

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
    const http2Header = {
      'content-type': 'application/grpc',
      'grpc-accept-encoding': 'identity',
      'accept-encoding': 'identity',
    };
    let grpcMeta = {
      'grpc-status': 0,
      'grpc-message': 'OK',
    };
    let data = empty;
    let resSize = 0;

    const responseEncodeStart = Date.now();
    if (res.isError) {
      this.meta.resultCode = '02';
      http2Header[':status'] = 500; // make a unknown http2 status
      grpcMeta = {
        'grpc-status': 2, // UNKNOWN
        'grpc-message': res.errorMsg,
      };
    } else if (methodInfo.responseType) {
      const responseType = methodInfo.resolvedResponseType;
      const buf = responseType
        .encode(responseType.fromObject(res.appResponse))
        .finish();
      resSize = buf.length + 5;
      io.reset();
      io.put(0);
      io.putInt(buf.length);
      io.put(buf);

      http2Header[':status'] = 200;
      data = io.array();
    }
    this.meta.responseEncodeRT = Date.now() - responseEncodeStart;
    this.meta.data = data;
    this.meta.resSize = resSize;
    this.meta.rt = Date.now() - this.meta.start;

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
