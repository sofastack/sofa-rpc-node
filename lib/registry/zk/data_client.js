'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const fmt = require('util').format;
const urlencode = require('urlencode');
const localIp = require('address').ip();
const zookeeper = require('zookeeper-cluster-client');
const CreateMode = zookeeper.CreateMode;
const EMPTY = Buffer.from('');

const defaultOptions = {
  zookeeper,
  ephemeralNode: true,
};

class ZookeeperRegistry extends Base {
  constructor(options = {}) {
    assert(options.logger, '[ZookeeperRegistry] options.logger is required');
    assert(options.address, '[ZookeeperRegistry] options.address is required');
    super({ initMethod: '_init' });
    this.options = Object.assign({}, defaultOptions, options);

    let address;
    const idx = options.address.indexOf('/');
    if (idx > 0) {
      address = options.address.slice(0, idx);
      this._rootPath = options.address.slice(idx);
      if (!this._rootPath.endsWith('/')) this._rootPath += '/';
    } else {
      address = options.address;
      this._rootPath = '/';
    }
    this._zkClient = this.options.zookeeper.createClient(address);
    this._subscribeMap = new Map(); // <interfaceName, addressList>
  }

  get logger() {
    return this.options.logger;
  }

  async _init() {
    await this._zkClient.await('connected');
  }

  async register(config) {
    assert(config && config.interfaceName, '[ZookeeperRegistry] register(config) config.interfaceName is required');
    assert(config.url, '[ZookeeperRegistry] register(config) config.url is required');
    const providerPath = this._buildProviderPath(config);
    await this._zkClient.mkdirp(providerPath);
    const path = providerPath + '/' + urlencode.encode(config.url);
    try {
      await this._zkClient.create(path, EMPTY, this.options.ephemeralNode ? CreateMode.EPHEMERAL : CreateMode.PERSISTENT);
    } catch (err) {
      if (err.name === 'NODE_EXISTS' && err.code === -110) return;
      throw err;
    }
  }

  async unRegister(config) {
    assert(config && config.interfaceName, '[ZookeeperRegistry] unRegister(config) config.interfaceName is required');
    assert(config.url, '[ZookeeperRegistry] unRegister(config) config.url is required');
    const providerPath = this._buildProviderPath(config);
    const path = providerPath + '/' + urlencode.encode(config.url);
    try {
      await this._zkClient.remove(path);
    } catch (err) {
      if (err.name === 'NO_NODE' && err.code === -101) return;
      throw err;
    }
  }

  subscribe(config, listener) {
    assert(config && config.interfaceName, '[ZookeeperRegistry] subscribe(config, listener) config.interfaceName is required');
    const interfaceName = config.interfaceName;

    if (!this._subscribeMap.has(interfaceName)) {
      this._subscribeMap.set(interfaceName, null);
      const providerPath = this._buildProviderPath(config);
      this._zkClient.mkdirp(providerPath)
        .then(() => {
          this._zkClient.watchChildren(providerPath, (err, children) => {
            if (err) {
              this.emit('error', err);
              return;
            }
            const addressList = children.map(url => urlencode.decode(url));
            this._subscribeMap.set(interfaceName, addressList);
            this.emit(interfaceName, addressList);
          });
        })
        .catch(err => { this.emit('error', err); });

      const consumerPath = this._buildConsumerPath(config);
      const consumerUrl = fmt('%s://%s?uniqueId=%s&version=%s&pid=%s&timeout=%s&appName=%s&serialization=%s&startTime=',
        config.protocol, localIp, config.uniqueId || '', '1.0', process.pid, config.timeout, config.appName || '', Date.now());

      const path = consumerPath + '/' + urlencode.encode(consumerUrl);
      this._zkClient.mkdirp(consumerPath)
        .then(() => {
          return this._zkClient.create(path, EMPTY, CreateMode.EPHEMERAL);
        })
        .catch(err => {
          this.logger.warn('[ZookeeperRegistry] create consumerPath: %s failed, caused by %s', path, err.message);
        });
    } else {
      const addressList = this._subscribeMap.get(interfaceName);
      if (addressList) {
        setImmediate(() => { listener(addressList); });
      }
    }
    this.on(interfaceName, listener);
  }

  unSubscribe(config, listener) {
    assert(config && config.interfaceName, '[ZookeeperRegistry] unSubscribe(config, listener) config.interfaceName is required');
    const interfaceName = config.interfaceName;

    if (listener) {
      this.removeListener(interfaceName, listener);
    } else {
      this.removeAllListeners(interfaceName);
    }
    if (this.listenerCount(interfaceName) === 0) {
      const providerPath = this._buildProviderPath(config);
      this._zkClient.unWatchChildren(providerPath);
      this._subscribeMap.delete(interfaceName);
    }
  }

  _buildProviderPath(config) {
    return this._rootPath + 'sofa-rpc/' + config.interfaceName + '/providers';
  }

  _buildConsumerPath(config) {
    return this._rootPath + 'sofa-rpc/' + config.interfaceName + '/consumers';
  }

  close() {
    return this._zkClient.close();
  }
}

module.exports = ZookeeperRegistry;
