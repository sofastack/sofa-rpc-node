'use strict';

const { RpcClient } = require('../').client;
const logger = console;

async function invoke() {
  const client = new RpcClient({
    logger,
  });
  const consumer = client.createConsumer({
    interfaceName: 'com.nodejs.test.TestService',
    serverHost: '127.0.0.1:12200',
  });
  await consumer.ready();

  const result = await consumer.invoke('plus', [ 1, 2 ], { responseTimeout: 3000 });
  console.log('1 + 2 = ' + result);
}

invoke().catch(console.error);
