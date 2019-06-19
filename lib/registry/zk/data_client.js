'use strict';

const { URL } = require('url');
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
      this._rootPath = '/sofa-rpc/';
    }
    const { cluster, authInfo } = options;
    this._zkClient = this.options.zookeeper.createClient(address, { cluster, authInfo });
    this._zkClient.on('connected', () => {
      this.emit('connected');
      this._reRegister();
    });
    this._zkClient.on('disconnected', () => {
      this.emit('disconnected');
    });
    this._zkClient.on('error', err => {
      this.emit('error', err);
    });
    this._subscribeMap = new Map(); // <interfaceName, addressList>
    this._registerMap = new Map();
  }

  get logger() {
    return this.options.logger;
  }

  async _init() {
    await this._zkClient.await('connected');
  }

  _reRegister() {
    for (const config of this._registerMap.values()) {
      this.register(config).catch(err => { this.emit('error', err); });
    }
  }

  async _remove(path) {
    try {
      await this._zkClient.remove(path);
    } catch (err) {
      if (err.name === 'NO_NODE' && err.code === -101) {
        return;
      }
      throw err;
    }
  }

  async register(config) {
    assert(config && config.interfaceName, '[ZookeeperRegistry] register(config) config.interfaceName is required');
    assert(config.url, '[ZookeeperRegistry] register(config) config.url is required');
    const providerPath = this._buildProviderPath(config);
    await this._zkClient.mkdirp(providerPath);
    const path = providerPath + '/' + urlencode.encode(config.url);
    this._registerMap.set(path, config);
    try {
      // NOTE: Maybe the path is invalid, so remove it first
      if (await this._zkClient.exists(path)) {
        await this._remove(path);
      }
      await this._zkClient.create(path, EMPTY, this.options.ephemeralNode ? CreateMode.EPHEMERAL : CreateMode.PERSISTENT);
    } catch (err) {
      if (err.name === 'NODE_EXISTS' && err.code === -110) {
        return;
      }
      throw err;
    }
  }

  async unRegister(config) {
    assert(config && config.interfaceName, '[ZookeeperRegistry] unRegister(config) config.interfaceName is required');
    assert(config.url, '[ZookeeperRegistry] unRegister(config) config.url is required');
    const providerPath = this._buildProviderPath(config);
    const path = providerPath + '/' + urlencode.encode(config.url);
    this._registerMap.delete(path);
    await this._remove(path);
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
            const originAddressList = children.map(url => urlencode.decode(url));
            const addressList = originAddressList.filter(url => this._isMatch(config, url));
            this.logger.info('[ZookeeperRegistry] receive interface:%s:%s@%s address list (%d):\n%s\nvalid providers (%d):\n%s',
              config.interfaceName, config.version || '', config.group || '',
              originAddressList.length, formatAddrs(originAddressList), addressList.length, formatAddrs(addressList));
            this._subscribeMap.set(interfaceName, addressList);
            this.emit(interfaceName, addressList);
          });
        })
        .catch(err => { this.emit('error', err); });

      const consumerPath = this._buildConsumerPath(config);
      const consumerUrl = fmt('%s://%s?uniqueId=%s&version=%s&pid=%s&timeout=%s&appName=%s&serialization=%s&startTime=',
        config.protocol || 'bolt', localIp, config.uniqueId || '', '1.0', process.pid, config.timeout, config.appName || '', Date.now());

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
    return this._rootPath + config.interfaceName + '/providers';
  }

  _buildConsumerPath(config) {
    return this._rootPath + config.interfaceName + '/consumers';
  }

  _isMatch(consumer, urlStr) {
    const url = new URL(urlStr);
    const providerInfo = url.searchParams || {};
    const interfaceName = providerInfo.get('interface') || url.pathname.slice(1);
    if (interfaceName && consumer.interfaceName !== interfaceName) {
      return false;
    }
    const category = providerInfo.get('category');
    if (category && category !== 'providers') {
      return false;
    }
    const enabled = providerInfo.get('enabled');
    if (enabled && enabled !== 'true') {
      return false;
    }
    const consumerGroup = consumer.group;
    const consumerVersion = consumer.version;
    const providerGroup = providerInfo.get('group') || providerInfo.get('default.group');
    const providerVersion = providerInfo.get('version') || providerInfo.get('default.version');
    if (consumerGroup && providerGroup && consumerGroup !== providerGroup) {
      return false;
    }
    if (consumerVersion && providerVersion && consumerVersion !== providerVersion) {
      return false;
    }
    return true;
  }

  close() {
    return this._zkClient.close();
  }
}

function formatAddrs(addrs) {
  return addrs.map(addr => '  - ' + addr).join('\n');
}

module.exports = ZookeeperRegistry;
