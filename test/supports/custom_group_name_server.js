'use strict';

const RpcServer = require('../../lib').server.RpcServer;

const server = new RpcServer({
  appName: 'node-rpc-server-test',
  logger: console,
  groupName: 'custom-group-name'
});

server.addService('com.alipay.node.rpctest.echoService', {
  async ping() {
    return server.options.groupName;
  },
});

module.exports = server;
