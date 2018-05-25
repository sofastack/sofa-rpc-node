'use strict';

const RpcServer = require('../../lib').server.RpcServer;
const sleep = require('mz-modules/sleep');

const server = new RpcServer({
  appName: 'node-rpc-server-test',
  logger: console,
});

server.addService({
  interfaceName: 'com.alipay.node.rpctest.helloService',
}, {
  async mirror(input) {
    return input;
  },
  async delay(input) {
    await sleep(300);
    return input;
  },
  async json(data) {
    return JSON.stringify(data);
  },
  async error() {
    throw new Error('mock error');
  },
});

server.addService('com.alipay.node.rpctest.echoService', {
  async ping() {
    return 'pong';
  },
  async echo(data) {
    return data;
  },
});

module.exports = server;
