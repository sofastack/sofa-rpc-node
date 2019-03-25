'use strict';

const mm = require('mm');
const path = require('path');
const coffee = require('coffee');
const pedding = require('pedding');
const { RpcClient } = require('../../').client;
const { ZookeeperRegistry } = require('../../').registry;
const logger = console;

describe('test/server/cluster.test.js', () => {
  const interfaceName = 'com.nodejs.test.ClusterService';
  let registry;
  let client;

  before(async () => {
    mm(process.env, 'NODE_CLUSTER_CLIENT_SINGLE_MODE', '1');
    registry = new ZookeeperRegistry({
      logger,
      address: '127.0.0.1:2181',
    });
    client = new RpcClient({
      logger,
      registry,
    });
    await client.ready();
  });
  after(async () => {
    mm.restore();
    let count = 2;
    while (count--) {
      await client.invoke({
        interfaceName,
        methodName: 'kill',
        args: [],
      }).catch(err => {
        console.log(err);
      });
    }
    await client.close();
    await registry.close();
  });

  it('should support cluster server', function(done) {
    this.timeout(60000);
    done = pedding(done, 2);

    coffee.fork(path.join(__dirname, '..', 'fixtures', 'server_1.js'), [], { env: { NODE_CLUSTER_CLIENT_SINGLE_MODE: '1' } })
      .expect('code', 0)
      .debug()
      .end(done);

    coffee.fork(path.join(__dirname, '..', 'fixtures', 'server_2.js'), [], { env: { NODE_CLUSTER_CLIENT_SINGLE_MODE: '1' } })
      .expect('code', 0)
      .debug()
      .end(done);

    registry.ready(err => {
      if (err) {
        return done(err);
      }
      registry.subscribe({ interfaceName }, val => {
        console.log(val);
        if (val.length === 2) {
          client.invoke({
            interfaceName,
            methodName: 'kill',
            args: [],
          }).catch(err => {
            console.log(err);
          });

          registry.subscribe({ interfaceName }, val => {
            if (val.length === 1) {
              client.invoke({
                interfaceName,
                methodName: 'kill',
                args: [],
              }).catch(err => {
                console.log(err);
              });
            }
          });
        }
      });
    });
  });
});
