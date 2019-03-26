'use strict';

const { ZookeeperRegistry } = require('../../').registry;
const logger = console;

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

registry.subscribe({
  interfaceName: 'com.nodejs.test.ClusterService',
}, val => {
  console.log(val);
});
