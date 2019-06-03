'use strict';

const mm = require('mm');
const assert = require('assert');
const urlparse = require('url').parse;
const MockConnection = require('../fixtures/mock_connection');
const AddressGroup = require('../../lib/client/address_group');
const ConnectionManager = require('../../lib/client/connection_mgr');

const logger = console;

describe('test/client/elastic_control.test.js', () => {
  let connectionManager;
  let addressGroup;
  const count = 51;

  const addressList = [];

  before(async () => {
    connectionManager = new ConnectionManager({ logger });
    await connectionManager.ready();

    for (let i = 0; i < count; i++) {
      const address = urlparse(`tr://127.0.0.${i}:12200`);
      addressList.push(address);
      MockConnection.addAvailableAddress(address);
    }

    addressGroup = new AddressGroup({
      key: 'xxx',
      logger,
      connectionManager,
      connectionClass: MockConnection,
      retryFaultInterval: 5000,
    });
    addressGroup.connectionPoolSize = 2;
    addressGroup.addressList = addressList;

    await addressGroup.ready();
  });

  afterEach(mm.restore);

  after(async () => {
    MockConnection.clearAvailableAddress();
    addressGroup.close();
    await connectionManager.closeAllConnections();
  });

  it('should use new address', () => {
    assert(addressGroup.addressList.length === 2);
    mm(addressGroup._loadbalancer, '_sortAddresses', arr => arr);

    const newAddress = urlparse('rpc://127.0.0.52:12200');
    MockConnection.addAvailableAddress(newAddress);

    const newAddressList = [ newAddress ].concat(addressList);
    addressGroup.addressList = newAddressList;

    assert(addressGroup.addressList.length === 2);
    assert(addressGroup.addressList[0].href === 'rpc://127.0.0.52:12200');
  });
});
