'use strict';

const protobuf = require('antpb');
const path = require('path');
const proto = protobuf.loadAll(path.join(__dirname, 'proto'));

const logger = console;
const GRpcServer = require('../lib/server/grpc/server');

const server = new GRpcServer({
  logger,
  port: 12200,
  proto,
});

server.addService({
  interfaceName: 'helloworld.Greeter',
}, {
  async SayHello(req) {
    console.log(req);
    return {
      message: `hello ${req.name} from sofa-rpc-node`,
    };
  },
  async SayHi(req) {
    console.log(req);
    return {
      message: `hi ${req.name} from sofa-rpc-node`,
    };
  },
});

server.start();
