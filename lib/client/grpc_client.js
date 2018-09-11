'use strict';

const assert = require('assert');
const RpcClient = require('./client');
const GRpcConnection = require('./connection/grpc');

const defaultOptions = {
  connectionClass: GRpcConnection,
};

class GRpcClient extends RpcClient {
  constructor(options = {}) {
    assert(options.proto, '[GRpcClient] options.proto is required');
    super(Object.assign({}, defaultOptions, options));
  }
}

module.exports = GRpcClient;
