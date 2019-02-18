'use strict';

const ByteBuffer = require('byte');
const io = ByteBuffer.allocate(512 * 1024);
const http2 = require('http2');

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
    if (res.isError && this.stream && !this.stream.destroyed) {
      this.stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
      return;
    }
    if (methodInfo.responseType) {
      const responseEncodeStart = Date.now();
      const responseType = methodInfo.resolvedResponseType;
      const buf = responseType.encode(responseType.fromObject(res.appResponse)).finish();
      const resSize = buf.length;
      io.position(0);
      io.put(0);
      io.putInt(resSize);
      io.put(buf);

      this.meta.responseEncodeRT = Date.now() - responseEncodeStart;
      this.meta.data = buf;
      this.meta.rt = Date.now() - this.meta.start;
      this.meta.resSize = resSize + 5;

      this.stream.respond({
        ':status': 200,
        'content-type': 'application/grpc',
        'grpc-accept-encoding': 'identity',
        'accept-encoding': 'identity',
      }, { waitForTrailers: true });
      this.stream.on('wantTrailers', () => {
        this.stream.sendTrailers({
          'grpc-status': 0,
          'grpc-message': 'OK',
        });
      });
      this.stream.end(io.array());
    }
  }
}

module.exports = GRpcResponse;
