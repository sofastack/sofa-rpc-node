'use strict';

const request = require('../').test;
const { RpcServer } = require('../').server;
const logger = console;

describe('test/server.test.js', () => {
  let server;
  before(async function() {
    server = new RpcServer({
      logger,
      port: 12200,
    });
    server.addService({
      interfaceName: 'com.nodejs.test.TestService',
    }, {
      async plus(a, b) {
        return a + b;
      },
    });
    await server.start();
  });
  after(async function() {
    await server.close();
  });

  it('should call plus ok', async function() {
    await request(server)
      .service('com.nodejs.test.TestService')
      .invoke('plus')
      .send([ 1, 2 ])
      .expect(3);
  });
});
