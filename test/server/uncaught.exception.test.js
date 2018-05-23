'use strict';

const path = require('path');
const coffee = require('coffee');
const RpcClient = require('../../').client.RpcClient;
const ZookeeperRegistry = require('../../').registry.ZookeeperRegistry;
const logger = console;

describe('test/server/uncaught.exception.test.js', () => {
  it('should handle uncaught exception', done => {
    const registry = new ZookeeperRegistry({
      logger,
      address: '127.0.0.1:2181',
    });

    registry.subscribe({
      interfaceName: 'com.node.rpctest.ExceptionService',
    }, val => {
      console.log(val);
      if (val && val.length) {
        const client = new RpcClient({
          logger,
          registry,
        });
        client.invoke({
          interfaceName: 'com.node.rpctest.ExceptionService',
          methodName: 'kill',
          args: [],
          options: { timeout: 3000 },
        });
      }
    });

    coffee.fork(path.join(__dirname, '../supports/exception'), [], {
      env: {
        NODE_ENV: 'unittest',
      },
    })
      .expect('stderr', /\[RpcServer\] server is down, cause by uncaughtException in this process \d+/)
      .expect('code', 1)
      .debug(0)
      .end(done);
  });
});
