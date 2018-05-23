'use strict';

const path = require('path');
const antpb = require('antpb');
const protocol = require('sofa-bolt-node');
const { RpcServer } = require('../').server;
const { ZookeeperRegistry } = require('../').registry;
const logger = console;

const proto = antpb.loadAll(path.join(__dirname, '../test/fixtures/proto'));
protocol.setOptions({ proto });

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

const server = new RpcServer({
  logger,
  protocol,
  registry,
  codecType: 'protobuf',
  port: 12200,
});

server.addService({
  interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
}, {
  async echoObj(req) {
    req = req.toObject({ enums: String });
    return {
      code: 200,
      message: 'hello ' + req.name + ', you are in ' + req.group,
    };
  },
});
server.start()
  .then(() => {
    server.publish();
  });
