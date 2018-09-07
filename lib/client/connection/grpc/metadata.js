'use strict';

const LEGAL_KEY_REGEX = /^[0-9a-z_.-]+$/;
const LEGAL_NON_BINARY_VALUE_REGEX = /^[ -~]*$/;

function isLegalKey(key) {
  return LEGAL_KEY_REGEX.test(key);
}

function isLegalNonBinaryValue(value) {
  return LEGAL_NON_BINARY_VALUE_REGEX.test(value);
}

function isBinaryKey(key) {
  return key.endsWith('-bin');
}

function normalizeKey(key) {
  return key.toLowerCase();
}

function validate(key, value) {
  if (!isLegalKey(key)) {
    throw new Error('Metadata key "' + key + '" contains illegal characters');
  }
  if (value != null) {
    if (isBinaryKey(key)) {
      if (!(value instanceof Buffer)) {
        throw new Error('keys that end with \'-bin\' must have Buffer values');
      }
    } else {
      if (value instanceof Buffer) {
        throw new Error('keys that don\'t end with \'-bin\' must have String values');
      }
      if (!isLegalNonBinaryValue(value)) {
        throw new Error('Metadata string value "' + value +
          '" contains illegal characters');
      }
    }
  }
}

class Metadata {
  constructor() {
    this.internalRepr = {};
  }

  set(key, value) {
    key = normalizeKey(key);
    validate(key, value);
    this.internalRepr[key] = [ value ];
  }

  add(key, value) {
    key = normalizeKey(key);
    validate(key, value);
    if (!this.internalRepr[key]) {
      this.internalRepr[key] = [ value ];
    } else {
      this.internalRepr[key].push(value);
    }
  }

  remove(key) {
    key = normalizeKey(key);
    validate(key);
    if (Object.prototype.hasOwnProperty.call(this.internalRepr, key)) {
      delete this.internalRepr[key];
    }
  }

  get(key) {
    key = normalizeKey(key);
    validate(key);
    if (Object.prototype.hasOwnProperty.call(this.internalRepr, key)) {
      return this.internalRepr[key];
    }
    return [];

  }

  getMap() {
    const result = {};
    for (const key in this.internalRepr) {
      const values = this.internalRepr[key];
      if (values.length > 0) {
        const v = values[0];
        result[key] = v instanceof Buffer ? v.slice() : v;
      }
    }
    return result;
  }

  merge(other) {
    for (const key in other.internalRepr) {
      const values = other.internalRepr[key];
      this.internalRepr[key] = (this.internalRepr[key] || []).concat(values);
    }
  }

  toHttp2Headers() {
    // NOTE: Node <8.9 formats http2 headers incorrectly.
    const result = {};
    for (const key in this.internalRepr) {
      const values = this.internalRepr[key];
      // We assume that the user's interaction with this object is limited to
      // through its public API (i.e. keys and values are already validated).
      result[key] = values.map(value => {
        if (value instanceof Buffer) {
          return value.toString('base64');
        }
        return value;
      });
    }
    return result;
  }

  fromHttp2Headers(headers) {
    for (const key in headers) {
      const values = headers[key];
      if (isBinaryKey(key)) {
        if (Array.isArray(values)) {
          values.forEach(value => {
            this.add(key, Buffer.from(value, 'base64'));
          });
        } else if (values !== undefined) {
          values.split(',').forEach(v => {
            this.add(key, Buffer.from(v.trim(), 'base64'));
          });
        }
      } else {
        if (Array.isArray(values)) {
          for (const value of values) {
            this.add(key, value);
          }
        } else if (values !== undefined) {
          values.split(',').forEach(v => this.add(key, v.trim()));
        }
      }
    }
  }
}

module.exports = Metadata;
