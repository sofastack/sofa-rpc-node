'use strict';

exports.RpcServer = require('./server');
exports.RpcService = require('./service');
exports.RpcResponse = require('./response');
exports.RpcConnection = require('./connection');

// avoid stderr "ExperimentalWarning: The http2 module is an experimental API."
Object.defineProperty(exports, 'GRpcServer', {
  get() {
    return require('./grpc/server');
  },
  enumerable: true,
});
