'use strict';

const path = require('path');
const protobuf = require('antpb');
const proto = protobuf.loadAll(path.join(__dirname, 'proto'));

const logger = console;
const { GRpcClient } = require('../').client;

const client = new GRpcClient({
  logger,
  proto,
});

async function test() {
  const consumer = client.createConsumer({
    interfaceName: 'helloworld.Greeter',
    serverHost: 'http://localhost:12200',
  });
  await consumer.ready();
  const r = await Promise.all([
    consumer.invoke('SayHello', [{ name: 'peter' }]),
    consumer.invoke('SayHi', [{ name: 'tony' }]),
  ]);
  console.log(r);
}

test();
