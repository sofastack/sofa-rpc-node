'use strict';

const is = require('is-type-of');
const Base = require('sdk-base');
const assert = require('assert');
const { URL } = require('url');

class RpcService extends Base {
  constructor(options = {}) {
    assert(options.interfaceName, '[RpcService] options.interfaceName is required');
    super(options);

    this.appName = options.appName;
    this.apiMeta = options.apiMeta;
    this.delegate = options.delegate;
    this.interfaceName = options.interfaceName;
    this.version = options.version;
    this.uniqueId = options.uniqueId;
    this.group = options.group;
    // 获取自定义元数据
    // get custom metadata
    this.customMeta = typeof options.customMeta === 'object' ? options.customMeta : {};

    this.id = this.uniqueId ?
      this.interfaceName + ':' + this.version + ':' + this.uniqueId :
      this.interfaceName + ':' + this.version;

    const { methods = [], classMaps } = this.apiMeta || {};
    this.returnTypes = {};
    this.classMaps = classMaps;

    for (const method of methods) {
      this.returnTypes[method.name] = {
        $class: method.returnType,
        generic: method.generic,
      };
    }
    this.ready(true);
  }

  get app() {
    return this.options.app;
  }

  get logger() {
    return this.options.logger;
  }

  get registry() {
    return this.options.registry;
  }

  normalizeReg(urlStr) {
    const url = new URL(urlStr);
    url.searchParams.set('interface', this.interfaceName);
    url.searchParams.set('version', this.version);
    url.searchParams.set('group', this.group);
    // 写入自定义元数据
    // append custom metadata to searchParams
    let customMeta = {};
    const blockList = [ 'interface', 'version', 'group' ];
    Object.keys(this.customMeta).forEach(metaKey => {
      const value = this.customMeta[metaKey];
      if (!(typeof value === 'undefined' || blockList.includes(metaKey))) {
        url.searchParams.set(metaKey, value);
        const source = { [`${metaKey}`]: value };
        customMeta = Object.assign(customMeta, source);
      }
    });
    const reg = {
      interfaceName: this.interfaceName,
      version: this.version,
      group: this.group,
      url: url.toString(),
    };
    return Object.assign(reg, customMeta);
  }

  /**
   * 发布到注册中心
   *
   * @param {String} url - 发布的 url
   * @return {Promise} promise
   */
  publish(url) {
    if (!this.registry) return Promise.resolve();

    const reg = this.normalizeReg(url);
    this.publishUrl = reg.url;
    return this.registry.register(reg)
      .then(() => {
        return new Promise(resolve => {
          const listener = addressList => {
            const exists = addressList.some(addr => {
              return new URL(addr).href.includes(url);
            });
            if (exists) {
              this.registry.unSubscribe(reg, listener);
              resolve();
            }
          };

          this.registry.subscribe(reg, listener);
        });
      });
  }

  /**
   * 取消发布
   * @return {void}
   */
  unPublish() {
    if (!this.registry || !this.publishUrl) return Promise.resolve();

    const reg = this.normalizeReg(this.publishUrl);
    return this.registry.unRegister(reg);
  }

  convertResult(req, result) {
    // protobuf 不需要在这里转换
    if (req.options.codecType === 'protobuf' || result == null) return result;

    if (result instanceof Error) {
      return {
        $class: 'java.lang.Exception',
        $: result,
      };
    }
    const methodName = req.data.methodName;
    const returnType = this.returnTypes[methodName];
    // 如果 apiMeta 信息不足，或者 result 已经是 java 形式了，直接返回
    if ((result.$class) || !returnType) {
      return result;
    }
    return {
      $class: returnType.$class,
      $: result,
      generic: returnType.generic,
    };
  }

  async invoke(ctx, req, res) {
    const methodName = req.data.methodName;
    const args = req.data.args;
    const timeout = req.options.timeout;
    const data = {
      isError: false,
      errorMsg: null,
      appResponse: null,
      classMap: this.classMaps,
    };
    // 外部中间件可以在请求的时候, 拦截, 注入新的 method.
    const method = req.method || this.delegate[methodName];
    if (!is.asyncFunction(method)) {
      res.meta.resultCode = '04'; // 路由失败
      data.isError = true;
      data.errorMsg = 'Can not find method: ' + this.id + '#' + methodName + '()';
    } else {
      let result;
      try {
        result = await method.apply(ctx, args);
      } catch (err) {
        data.isError = true;
        data.errorMsg = err.message;
        // 如果框架自身抛出的异常, error name 可以定义为 SystemError, 方便甄别
        // 这个异常直接放到协议头上
        if (err.name === 'SystemError') {
          res.meta.resultCode = err.resultCode || '02';
        } else {
          // 业务异常
          res.meta.resultCode = err.resultCode || '01';
        }
        // 都把 err 返回
        result = err;
        if (!err.ignoreLog) {
          this.logger.error(err);
        }
      }
      data.appResponse = result;
    }
    res.meta.rt = Date.now() - res.meta.start;

    if (timeout && res.meta.rt >= timeout) {
      this.logger.warn('[RpcService] service: %s#%s() process timeout, rt: %s, timeout: %s', this.id, methodName, res.meta.rt, timeout);
      res.meta.resultCode = '03';
      return;
    }
    if (res.isClosed) {
      this.logger.warn('[RpcService] client maybe closed before sending response, remote address: %s', res.remoteAddress);
      return;
    }

    // 类型转换 js => java
    data.appResponse = this.convertResult(req, data.appResponse);
    await res.send(data);
  }
}

module.exports = RpcService;
