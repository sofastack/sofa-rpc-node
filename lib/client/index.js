'use strict';

exports.RpcClient = require('./client');
exports.RpcRequest = require('./request');
exports.RpcConsumer = require('./consumer');
exports.RpcConnection = require('./connection/rpc');
exports.RpcConnectionMgr = require('./connection_mgr');
exports.DynamicConfig = require('./dynamic_config');

// avoid stderr "ExperimentalWarning: The http2 module is an experimental API."
Object.defineProperty(exports, 'GRpcClient', {
  get() {
    return require('./grpc_client');
  },
  enumerable: true,
});
Object.defineProperty(exports, 'GRpcConnection', {
  get() {
    return require('./connection/grpc');
  },
  enumerable: true,
});
