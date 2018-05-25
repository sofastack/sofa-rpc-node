'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const inspect = require('util').inspect;

class RpcServerTest extends Base {
  constructor(server) {
    assert(server && server.testClient);
    super({ initMethod: '_init' });

    this.client = server.testClient;
    this.server = server;
    this.errorInfo = {};
  }

  async _init() {
    await this.server.start();
    await this.client.ready();
  }

  service(name) {
    if (name.indexOf(':') > 0) {
      for (const key of this.server.services.keys()) {
        if (name === key) {
          const service = this.server.services.get(key);
          this.interfaceName = service.interfaceName;
          this.version = service.version;
          return this;
        }
      }
    }
    this.interfaceName = name;
    this.version = this.server.options.version;
    return this;
  }

  invoke(name, args) {
    this.funcName = name;
    if (args) {
      this.args = args;
    }
    return this;
  }

  send(args) {
    this.args = args;
    return this;
  }

  timeout(timeout) {
    this.responseTimeout = timeout;
    return this;
  }

  async end(fn) {
    await this.ready();
    this.consumer = this.client.createConsumer({
      interfaceName: this.interfaceName,
      version: this.version,
      serverHost: this.server.url,
    });
    await this.consumer.ready();

    if (!this.args) {
      this.args = [];
    }
    if (!Array.isArray(this.args)) {
      this.args = [ this.args ];
    }
    try {
      const result = await this.consumer.invoke(this.funcName, this.args, {
        responseTimeout: this.responseTimeout == null ? 3000 : this.responseTimeout,
        codecType: this.server.options.codecType,
      });
      this.assert(null, result, assertError => {
        fn(assertError, null, result, this.consumer);
      });
    } catch (err) {
      this.assert(err, null, assertError => {
        fn(assertError, err, null, this.consumer);
      });
    }
  }

  then(resolve, reject) {
    if (!this._fullfilledPromise) {
      this._fullfilledPromise = new Promise((innerResolve, innerReject) => {
        this.end((assertError, responseError, data, consumer) => {
          if (assertError) {
            assertError.data = data;
            return innerReject(assertError);
          }
          innerResolve({ responseError, data, consumer });
        });
      });
    }
    return this._fullfilledPromise.then(resolve, reject);
  }

  catch(reject) {
    return this.then(undefined, reject);
  }

  error(filed, value, done) {
    switch (arguments.length) {
      case 3:
        this.errorInfo[filed] = value;
        this.end(done);
        break;
      case 2:
        if (typeof value === 'function') {
          done = value;
          value = filed;
          filed = 'message';
        }
        this.errorInfo[filed] = value;
        done && this.end(done);
        break;
      case 1:
        if (typeof filed === 'function') {
          done = filed;
          this.hasError = true;
        } else {
          this.errorInfo.message = filed;
        }
        done && this.end(done);
        break;
      default:
        break;
    }
    this.hasError = true;
    return this;
  }

  type(responseTime, done) {
    this.type = responseTime;
    this.checkType = true;
    done && this.end(done);
    return this;
  }

  expect(value, done) {
    this.data = value;
    this.checkData = true;
    done && this.end(done);
    return this;
  }

  assert(err, data, fn) {
    const errorInfo = this.errorInfo;
    if ((this.hasError || Object.keys(errorInfo).length) && !err) {
      return fn(new Error('expected exist error, but got undefined'));
    }
    if (!this.hasError && err) {
      return fn(err);
    }
    for (const key in errorInfo) {
      const info = errorInfo[key];
      const isReg = info instanceof RegExp;
      if (isReg) {
        if (!info.test(err[key])) {
          return fn(new Error('expected ' + err[key] + ' to match ' + info + ' at error.' + key));
        }
      } else if (err[key] !== info) {
        return fn(new Error('expected ' + err[key] + ' to equal ' + info + ' at error.' + key));
      }
    }

    if (this.checkType) {
      const typeError = checkType(this.type, data);
      if (typeError) {
        return fn(typeError);
      }
      if (this.type === 'json') {
        data = JSON.parse(data);
      }
    }
    if (this.checkData) {
      const dataError = checkData(this.data, data);
      if (dataError) {
        return fn(dataError);
      }
    }
    fn();
  }
}

function checkType(type, obj) {
  if (typeof type === 'string') {
    // proper english in error msg
    const n = /^[aeiou]/.test(type) ? 'n' : '';

    // typeof with support for 'array'
    let match = true;
    switch (type) {
      case 'json':
        try {
          JSON.parse(obj);
          match = true;
        } catch (e) {
          match = false;
        }
        break;
      case 'array':
        if (!Array.isArray(obj)) {
          match = false;
        }
        break;
      case 'object':
        if (typeof obj !== 'object' && obj !== null) {
          match = false;
        }
        break;
      default:
        if (typeof obj !== type) {
          match = false;
        }
    }
    if (!match) {
      return new Error('expected ' + inspect(obj) + ' to be a' + n + ' ' + type);
    }
  } else {
    // instanceof
    const name = type.name || 'supplied constructor';
    return obj instanceof type ? null : new Error('expected ' + inspect(obj) + ' to be an instance of ' + name);
  }
}

function checkData(expect, data) {
  if (expect instanceof RegExp) {
    if (!expect.test(data)) {
      return new Error('expected ' + inspect(data) + ' to match ' + inspect(expect));
    }
  } else if (typeof expect === 'function') {
    return expect(data);
  } else if (typeof expect === 'object') {
    try {
      assert.deepEqual(Object.keys(expect).sort(), Object.keys(data).sort());
    } catch (err) {
      return new Error('expected ' + inspect(data) + ' to equal ' + inspect(expect));
    }

    // support {k: RegExp, k2: val}
    for (const k in expect) {
      const expectValue = expect[k];
      const value = data[k];
      if (expectValue instanceof RegExp) {
        if (!expectValue.test(value)) {
          return new Error('expected ' + inspect(data) + ' to equal ' + inspect(expect));
        }
      } else if (typeof expectValue === 'object') {
        try {
          assert.deepEqual(expectValue, value);
        } catch (err) {
          return new Error('expected ' + inspect(data) + ' to equal ' + inspect(expect));
        }
      } else if (expectValue !== value) {
        return new Error('expected ' + inspect(data) + ' to equal ' + inspect(expect));
      }
    }
  } else if (expect !== data) {
    return new Error('expected ' + inspect(data) + ' to equal ' + inspect(expect));
  }
}

module.exports = server => {
  return new RpcServerTest(server);
};
module.exports.RpcServerTest = RpcServerTest;
