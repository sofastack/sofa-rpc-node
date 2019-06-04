'use strict';

const utils = require('../utils');
const LoadBalancer = require('./base');

const NUM = 128;

class ConsistentHashLoadBalancer extends LoadBalancer {
  reset(val) {
    const addressList = super.reset(val);
    this._virtualNodes = new Map();
    if (addressList) {
      for (const address of addressList) {
        for (let i = 0; i < NUM / 4; i++) {
          const digest = this._messageDigest(`${address.host}${i}`);
          for (let h = 0; h < 4; h++) {
            const m = this._hash(digest, h);
            this._virtualNodes.set(m, address);
          }
        }
      }
    }
    this._sortKeys = Array.from(this._virtualNodes.keys()).sort();
    return addressList;
  }

  /* eslint-disable  no-bitwise */
  _hash(digest, index) {
    const f = ((digest[3 + index * 4] & 0xFF) << 24) |
      ((digest[2 + index * 4] & 0xFF) << 16) |
      ((digest[1 + index * 4] & 0xFF) << 8) |
      (digest[index * 4] & 0xFF);
    return f & 0xFFFFFFFF;
  }
  /* eslint-enable  no-bitwise */

  _messageDigest(value) {
    return utils.md5(value);
  }

  _selectForKey(hash) {
    const len = this._sortKeys.length;
    let key = this._sortKeys[0];
    if (this._sortKeys[len - 1] >= hash) {
      for (let i = len - 1; i >= 0; i--) {
        if (this._sortKeys[i] < hash) {
          key = this._sortKeys[i + 1];
          break;
        }
      }
    }
    return this._virtualNodes.get(key);
  }

  _buildKeyOfHash(request) {
    const args = request.args;
    if (!args.length) return '';
    return JSON.stringify(args[0]);
  }

  _doSelect(request) {
    const key = this._buildKeyOfHash(request);
    const digest = this._messageDigest(key);
    return this._selectForKey(this._hash(digest, 0));
  }
}

module.exports = ConsistentHashLoadBalancer;
