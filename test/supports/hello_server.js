'use strict';

const RpcServer = require('../../lib').server.RpcServer;

const server = new RpcServer({
  appName: 'node-rpc-server-test',
  logger: console,
  port: 12201,
});

server.addService('com.alipay.node.rpctest.echoService', {
  async ping() {
    return 'pong 2';
  },
});

module.exports = server;
