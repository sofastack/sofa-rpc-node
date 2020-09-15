'use strict';

const Consumer = require('../../lib/client/consumer');

class CustomRpcConsumer extends Consumer {
  createRequest(method, args, options) {
    if (!this._isReady) {
      throw new Error('consumer is not ready');
    }
    return super.createRequest(method, args, options);
  }
}

module.exports = CustomRpcConsumer;
