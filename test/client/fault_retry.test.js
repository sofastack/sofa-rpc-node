'use strict';

const mm = require('mm');
const assert = require('assert');
const urlparse = require('url').parse;
const AddressGroup = require('../../lib/client/address_group');
const ConnectionManager = require('../../lib/client/connection_mgr');
const logger = console;

describe('test/client/fault_retry.test.js', () => {
  let connectionManager;
  before(() => {
    connectionManager = new ConnectionManager({ logger });
  });
  after(async function() {
    await connectionManager.closeAllConnections();
    mm.restore();
  });

  it('should retry fault ok', async function() {
    const addressGroup = new AddressGroup({
      key: 'fault',
      logger,
      connectionManager,
      retryFaultInterval: 3000,
      connectionOpts: {
        connectTimeout: 1000,
      },
    });
    const address = urlparse('tr://2.2.2.2:12200');

    addressGroup.addressList = [ address ];
    await addressGroup.ready();

    const createAndGet = connectionManager.createAndGet;
    mm(connectionManager, 'createAndGet', async function(address, options, connectionClass) {
      if (address.host === '2.2.2.2:12200') {
        addressGroup.emit('retry');
      }
      return await createAndGet.call(connectionManager, address, options, connectionClass);
    });

    await addressGroup.await('retry');

    addressGroup.addressList = [];

    setTimeout(() => {
      addressGroup.emit('timeout');
    }, 8000);

    const o = await addressGroup.awaitFirst([ 'retry', 'timeout' ]);
    assert(o.event === 'timeout');

    addressGroup.close();
  });
});
