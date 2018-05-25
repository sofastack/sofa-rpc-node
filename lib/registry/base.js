'use strict';

const APIClientBase = require('cluster-client').APIClientBase;

class RegistryBase extends APIClientBase {
  get clusterOptions() {
    return {
      name: `SofaRpcRegistry@${this.options.address}`,
    };
  }

  async register(config) {
    return await this._client.register(config);
  }

  async unRegister(config) {
    return await this._client.unRegister(config);
  }

  subscribe(config, listener) {
    this._client.subscribe(config, listener);
  }

  unSubscribe(config, listener) {
    this._client.unSubscribe(config, listener);
  }

  close() {
    return this._client.close();
  }
}

module.exports = RegistryBase;
