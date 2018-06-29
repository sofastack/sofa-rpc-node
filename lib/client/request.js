'use strict';

const assert = require('assert');
const Base = require('sdk-base');

class RpcRequest extends Base {
  constructor(data = {}) {
    assert(data.serverSignature, '[RpcRequest] req.serverSignature is required');
    assert(data.methodName, '[RpcRequest] req.methodName is required');
    assert(data.args, '[RpcRequest] req.args is required');
    assert(data.timeout, '[RpcRequest] req.timeout is required');
    super();

    this.targetAppName = data.targetAppName;
    this.serverSignature = data.serverSignature;
    this.methodName = data.methodName;
    this.args = data.args;
    this.timeout = data.timeout;
    this.codecType = data.codecType;
    this.requestProps = data.requestProps || {
      service: data.serverSignature,
    };
    this.meta = {
      id: null,
      resultCode: '00',
      connectionGroup: null,
      codecType: null,
      boltVersion: null,
      crcEnable: false,
      start: Date.now(),
      timeout: data.timeout,
      address: null,
      requestEncodeStart: 0,
      requestEncodeRT: 0,
      reqSize: 0,
      responseDecodeStart: 0,
      responseDecodeRT: 0,
      resSize: 0,
      rt: null,
    };
  }
}

module.exports = RpcRequest;
