'use strict';

const http2 = require('http2');
const ByteBuffer = require('byte');
const Metadata = require('./metadata');
const Duplex = require('stream').Duplex;
const awaitEvent = require('await-event');
const Status = require('./constants').Status;
const ProtoUtil = require('../../../util/proto_util');

const { version: clientVersion } = require('../../../../package');
const io = ByteBuffer.allocate(512 * 1024);
const units = [
  [ 'm', 1 ],
  [ 'S', 1000 ],
  [ 'M', 60 * 1000 ],
  [ 'H', 60 * 60 * 1000 ],
];

function getTimeout(timeoutMs) {
  for (const [ unit, factor ] of units) {
    const amount = timeoutMs / factor;
    if (amount < 1e8) {
      return String(Math.ceil(amount)) + unit;
    }
  }
  throw new Error('Deadline is too far in the future');
}

const {
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_TE,
  HTTP2_HEADER_USER_AGENT,
  HTTP2_HEADER_ACCEPT_ENCODING,

  NGHTTP2_NO_ERROR,
  NGHTTP2_CANCEL,
  NGHTTP2_REFUSED_STREAM,
  NGHTTP2_FLAG_END_STREAM,
  NGHTTP2_ENHANCE_YOUR_CALM,
  NGHTTP2_INADEQUATE_SECURITY,
} = http2.constants;

const statusMappings = {
  200: Status.OK,
  400: Status.INTERNAL,
  401: Status.UNAUTHENTICATED,
  403: Status.PERMISSION_DENIED,
  404: Status.UNIMPLEMENTED,
  429: Status.UNAVAILABLE,
  502: Status.UNAVAILABLE,
  503: Status.UNAVAILABLE,
  504: Status.UNAVAILABLE,
};

class Http2CallStream extends Duplex {
  constructor(http2Session, proto) {
    super({ objectMode: true });

    this._http2Session = http2Session;
    this._proto = proto;
    this._response = null;
    this._mappedStatusCode = Status.UNKNOWN;
    this._statusMessage = '';
    this._responseData = null;
    this._responseMetadata = new Metadata();
    this._buf = null;
    this._canPush = false;
    this._unpushedReadMessages = [];

    this.on('data', data => {
      this._responseData = data;
    });
    this.once('close', () => {
      this.removeAllListeners('data');
    });
  }

  async call(req) {
    const arr = req.serverSignature.split(':');
    const interfaceName = arr[0];
    const version = arr[1];
    const methodName = req.methodName;

    const metadata = new Metadata();
    for (const key in req.requestProps) {
      metadata.add(key, req.requestProps[key]);
    }
    const headers = metadata.toHttp2Headers();
    this._attachHttp2Stream(this._http2Session.request(Object.assign(headers, {
      [HTTP2_HEADER_METHOD]: 'POST',
      [HTTP2_HEADER_PATH]: '/' + interfaceName + '/' + methodName,
      [HTTP2_HEADER_TE]: 'trailers',
      [HTTP2_HEADER_CONTENT_TYPE]: 'application/grpc',
      [HTTP2_HEADER_USER_AGENT]: 'sofa-node-rpc/' + clientVersion,
      [HTTP2_HEADER_ACCEPT_ENCODING]: 'identity',
      'grpc-accept-encoding': 'identity',
      'grpc-timeout': getTimeout(req.timeout),
      'grpc-version': version,
    })));

    io.reset();
    io.put(0); // 暂时都不压缩
    const methodInfo = ProtoUtil.getMethodInfo(this._proto, interfaceName, methodName);
    if (methodInfo.requestType) {
      const requestEncodeStart = Date.now();
      const requestType = methodInfo.resolvedRequestType;
      const buf = requestType.encode(requestType.fromObject(req.args[0])).finish();
      const reqSize = buf.length;
      io.putInt(reqSize);
      io.put(buf);

      req.meta.codecType = 'protobuf';
      req.meta.reqSize = reqSize;
      req.meta.requestEncodeStart = requestEncodeStart;
      req.meta.requestEncodeRT = Date.now() - requestEncodeStart;
    }
    // 序列化
    this.end(io.array());

    const res = await awaitEvent(this, 'response');
    if (!res.data.error) {
      if (methodInfo.responseType && this._responseData) {
        const responseDecodeStart = Date.now();

        const responseType = methodInfo.resolvedResponseType;
        res.data.appResponse = responseType.decode(this._responseData.slice(5));

        req.meta.responseDecodeStart = responseDecodeStart;
        req.meta.responseDecodeRT = Date.now() - responseDecodeStart;
        req.meta.resSize = this._responseData.length - 5;
        req.meta.rt = Date.now() - req.meta.start;
      }
    }
    return res;
  }

  cancelCall(err) {
    this._destroyHttp2Stream();
    this._endCall(err);
  }

  _endCall(err) {
    if (this._response === null) {
      this._response = {
        data: { appResponse: this._responseData, error: err },
        meta: this._responseMetadata.getMap(),
      };
      this.emit('response', this._response);
    }
  }

  _handleTrailers(headers) {
    try {
      this._responseMetadata.fromHttp2Headers(headers);
    } catch (err) {
      err.name = 'DecodeResponseHeadersError';
      err.headers = headers;
      err.code = Status.UNKNOWN;
      err.resultCode = '02';
      this._endCall(err);
      return;
    }
    if (this._mappedStatusCode !== Status.UNKNOWN) return;

    const metadataMap = this._responseMetadata.getMap();
    if (typeof metadataMap['grpc-status'] === 'string') {
      const receivedCode = Number(metadataMap['grpc-status']);
      if (receivedCode in Status) {
        this._mappedStatusCode = receivedCode;
      }
      this._responseMetadata.remove('grpc-status');
    }
    if (typeof metadataMap['grpc-message'] === 'string') {
      this._statusMessage = decodeURI(metadataMap['grpc-message']);
      this._responseMetadata.remove('grpc-message');
    }
  }

  _handleClose() {
    let code = this._mappedStatusCode;
    let details = this._statusMessage;
    const errorCode = this._http2Stream.rstCode;
    if (errorCode === NGHTTP2_REFUSED_STREAM) {
      code = Status.UNAVAILABLE;
    } else if (errorCode === NGHTTP2_CANCEL) {
      code = Status.CANCELLED;
    } else if (errorCode === NGHTTP2_ENHANCE_YOUR_CALM) {
      code = Status.RESOURCE_EXHAUSTED;
      details = 'Bandwidth exhausted';
    } else if (errorCode === NGHTTP2_INADEQUATE_SECURITY) {
      code = Status.PERMISSION_DENIED;
      details = 'Protocol not secure enough';
    } else if (errorCode) {
      code = Status.INTERNAL;
    }

    let err;
    if (code !== Status.OK) {
      err = new Error(details || 'Stream closed with errorCode: ' + errorCode);
      err.code = code;
      err.resultCode = '02';
    }
    this._endCall(err);
    this.destroy();
    // FIXME
    // node 8.x 上 destory 以后接收不到 close
    // https://github.com/nodejs/node/pull/23654
    this.emit('close');
  }

  _attachHttp2Stream(stream) {
    this._http2Stream = stream;
    stream.on('response', (headers, flags) => {
      const status = headers[HTTP2_HEADER_STATUS];
      this._mappedStatusCode = statusMappings[status] != null ? statusMappings[status] : Status.UNKNOWN;
      delete headers[HTTP2_HEADER_STATUS];
      delete headers[HTTP2_HEADER_CONTENT_TYPE];

      /* eslint-disable no-bitwise */
      if (flags & NGHTTP2_FLAG_END_STREAM) {
        /* eslint-enable no-bitwise */
        this._handleTrailers(headers);
      } else {
        try {
          this._responseMetadata.fromHttp2Headers(headers);
        } catch (e) {
          this.cancelCall(e);
        }
      }
    });

    stream.on('data', data => {
      if (this._buf) {
        this._buf = Buffer.concat([ this._buf, data ]);
      } else {
        this._buf = data;
      }

      const total = this._buf.length;
      if (total < 5) return;

      const bodySize = this._buf.readUInt32BE(1);
      if (total < bodySize + 5) return;

      const msg = this._buf.slice(0, 5 + bodySize);
      if (this._canPush) {
        if (!this.push(msg)) {
          this._canPush = false;
          this._http2Stream.pause();
        }
      } else {
        this._unpushedReadMessages.push(msg);
      }

      if (total === bodySize + 5) {
        this._buf = null;
      } else {
        this._buf = this._buf.slice(5 + bodySize);
      }
    });
    stream.on('trailers', headers => {
      this._handleTrailers(headers);
    });
    stream.on('end', () => {
      this.push(null);
      stream.close(NGHTTP2_NO_ERROR);
    });
    stream.once('close', () => {
      this._handleClose();
    });
    stream.on('error', err => {
      this._endCall(err);
    });
  }

  _destroyHttp2Stream() {
    if (this._http2Stream !== null && !this._http2Stream.destroyed) {
      this._http2Stream.close(NGHTTP2_CANCEL);
    }
  }

  _read() {
    if (!this._http2Stream) return;

    if (!this._canPush) {
      this._canPush = true;
      this._http2Stream.resume();
    }
    while (this._unpushedReadMessages.length) {
      const nextMessage = this._unpushedReadMessages.shift();
      this.canPush = this.push(nextMessage);
      if (nextMessage === null || (!this.canPush)) {
        this.canPush = false;
        return;
      }
    }
  }

  _write(chunk, encoding, cb) {
    if (!this._http2Stream) return;

    this._http2Stream.write(chunk, cb);
  }

  _final(cb) {
    this._http2Stream.end(cb);
  }
}

module.exports = Http2CallStream;
