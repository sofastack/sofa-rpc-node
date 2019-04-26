'use strict';

const path = require('path');
const sleep = require('mz-modules/sleep');
const protocol = require('sofa-bolt-node');
const RpcServer = require('../../lib').server.RpcServer;
const ZookeeperRegistry = require('../../').registry.ZookeeperRegistry;
const logger = console;

const proto = require('antpb').loadAll(path.join(__dirname, '../fixtures/proto'));
protocol.setOptions({ proto });

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

let server;
let count = 0;

exports.start = async function() {
  server = new RpcServer({
    appName: 'pb',
    logger: console,
    registry,
    protocol,
    codecType: 'protobuf',
    port: 12202,
  });
  server.addService({
    interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
  }, {
    async echoObj(req) {
      if (req.name === 'XIAOCHEN') throw new Error('mock error');

      req = req.toObject({ enums: String });
      await sleep(10);
      return {
        code: 200,
        message: 'hello ' + req.name + ', you are in ' + req.group,
      };
    },

    async incr(req) {
      count += req.count;
    },
  });
  await server.start();
  await server.publish();
  return;
};

exports.close = async function() {
  await server.close();
};

exports.getCount = function() {
  return count;
};
