'use strict';

const assert = require('assert');
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

    const interfaceName = 'com.node.rpctest.ExceptionService';
    registry.subscribe({
      interfaceName,
    }, val => {
      console.log('subscribe %s: %j', interfaceName, val);
      if (val && val.length) {
        const client = new RpcClient({
          logger,
          registry,
        });
        client.invoke({
          interfaceName,
          methodName: 'helloError',
          args: [],
        }).catch(err => {
          console.error('%o', err);
          assert(err);

          client.invoke({
            interfaceName,
            methodName: 'timeout',
            args: [],
            options: { responseTimeout: 1000 },
          }).then(res => {
            console.log('---------- should not get res: %o', res);
          }).catch(err => {
            console.error('timeout error: %s', err);
            assert(err);

            client.invoke({
              interfaceName,
              methodName: 'kill',
              args: [],
              options: { responseTimeout: 3000 },
            }).then(res => {
              assert(res === 'ok');
            });
          });
        });
      }
    });

    coffee.fork(path.join(__dirname, '../supports/exception'), [], {
      env: {
        NODE_ENV: 'unittest',
      },
    })
      .expect('stderr', /\[RpcServer\] server is down, cause by uncaughtException in this process \d+/)
      .includes('stderr', 'mock-ctx-logger-error: Error: mock hello error')
      .includes('stdout', 'mock-ctx-logger-warn: [')
      .expect('code', 1)
      .debug()
      .end(done);
  });
});
