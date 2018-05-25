'use strict';

const RegistryBase = require('../base');
const DataClient = require('./data_client');

class ZookeeperRegistry extends RegistryBase {
  get DataClient() {
    return DataClient;
  }
}

module.exports = ZookeeperRegistry;
