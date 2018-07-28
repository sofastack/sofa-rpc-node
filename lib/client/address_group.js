'use strict';

const debug = require('debug')('rpc-client#AddressGroup');
const assert = require('assert');
const Base = require('sdk-base');
const utils = require('./utils');
const Table = require('easy-table');
const sleep = require('mz-modules/sleep');
const DynamicConfig = require('./dynamic_config');
const HealthCounter = require('./metric/health_counter');
const createLoadBalancer = require('./loadbalancer');

const defaultOptions = {
  loadbalancerClass: 'roundRobin',
  retryFaultInterval: 30000, // 30s 重新尝试连接下不可用的地址
};
const NA = 'N/A';
// 默认初始权重
const DEFAULT_WEIGHT = 100;

class AddressGroup extends Base {
  constructor(options = {}) {
    assert(options.key, '[AddressGroup] options.key is required');
    assert(options.logger, '[AddressGroup] options.logger is required');
    super(Object.assign({}, defaultOptions, options));

    this._inited = false;
    this._closed = false;
    this._addressList = null; // 生效地址列表
    this._choosedSize = 0; // 生效的地址数量
    this._allAddressList = null; // 原始地址列表
    this._totalSize = 0; // 完整的地址数量
    this._unChoosedAddressList = null; // 未被选中的地址
    this._faultAddressMap = new Map(); // 故障地址列表
    this._weightMap = new Map(); // <host, weight>
    this._maxIsolatedNum = 0; // 最大的故障摘除数量，如果故障机器超过这个值则禁用摘除功能
    this._degradeEnable = false; // 是否可以做故障摘除
    // 连接池初始的大小，只有在弹性模式下才有用
    this._connectionPoolSize = this.connectionPoolConfig.initConnectionSize;
    const config = DynamicConfig.instance.metric;
    this._maxIdleWindow = config.numBuckets * config.bucketSizeInMs;
    this._loadbalancer = createLoadBalancer(this);

    // 每个 window 周期更新一遍权重，权重区间 [0, 10]，0 代表地址被摘除了
    this.ready(err => {
      if (!err && !this._closed) {
        // HealthCounter.getInstance(key, prepend) prepend => false，确保 avgCounter 在最后触发
        this._healthCounter = HealthCounter.getInstance(this.key, false);
        this._healthCounter.on('next', hc => {
          try {
            this._onNext(hc);
          } catch (err) {
            this.emit('error', err);
          }
        });
        this._retryFaultAddresses();
      }
    });
  }

  get key() {
    // 规则： ${serviceId}:${version}@${group}@${zone}
    // @example:
    // com.alipay.cif.user.UserInfoQueryService:1.0@SOFA@rz00a
    return this.options.key;
  }

  get logger() {
    return this.options.logger;
  }

  // 故障摘除相关的配置
  get faultToleranceConfig() {
    return this.options.faultTolerance || DynamicConfig.instance.faultTolerance;
  }

  // 连接控制相关的配置
  get connectionPoolConfig() {
    return this.options.connectionPoolConfig || DynamicConfig.instance.connectionPoolConfig;
  }

  // 连接池大小
  get connectionPoolSize() {
    return this._connectionPoolSize;
  }

  set connectionPoolSize(val) {
    if (val !== this._connectionPoolSize) {
      const prev = this._connectionPoolSize;
      this._connectionPoolSize = val;
      this.logger.info('[AddressGroup] adjust connection pool size from %s to %s, group=%s', prev, val, this.key);
      this._refresh();
    }
  }

  // 是否开启故障摘除
  get degradeEnable() {
    return this.faultToleranceConfig.degradeEffective && this._degradeEnable;
  }

  get connectionManager() {
    return this.options.connectionManager;
  }

  get loadbalancerClass() {
    return this.options.loadbalancerClass;
  }

  get addressList() {
    return this._addressList;
  }

  set addressList(val) {
    this._addressList = this._chooseAddresses(val);
    this._choosedSize = this._addressList.length;
    this._loadbalancer.reset();
    // 最大熔断个数，为了防止「雪崩」，超过这个数，则关闭熔断
    this._maxIsolatedNum = Math.ceil(this.faultToleranceConfig.maxIsolatedPercentage * this._choosedSize);

    // 故障地址和权重都重置一下
    const newFaultAddressMap = new Map();
    const newWeightMap = new Map();
    for (const address of this._addressList) {
      newWeightMap.set(address.host, this._weightMap.has(address.host) ? this._weightMap.get(address.host) : DEFAULT_WEIGHT);
      if (this._faultAddressMap.has(address.host)) {
        newFaultAddressMap.set(address.host, address);
      }
    }
    this._weightMap = newWeightMap;
    this._faultAddressMap = newFaultAddressMap;
    this._degradeEnable = true;

    this.logger.info('[AddressGroup] choosing %s / %s addresses for group=%s%s', this._choosedSize, this._totalSize, this.key, printAddresses(this._addressList));
    if (debug.enabled && this._unChoosedAddressList.length) {
      this.logger.info('[AddressGroup] there are %s addresses not choosed for connection control strategy%s',
        this._unChoosedAddressList.length, printAddresses(this._unChoosedAddressList));
    }

    this._connectAll(this._addressList).then(() => {
      if (!this._inited) {
        this._inited = true;
        this.ready(true);
      }
    }).catch(err => {
      if (!this._inited) {
        this.ready(err);
      } else {
        this.emit('error', err);
      }
    });
  }

  _refresh() {
    this.addressList = this._allAddressList;
  }

  _chooseAddresses(addressList) {
    // 只有地址真正改变的时候才 shuffle 一次
    if (this._allAddressList !== addressList) {
      this._allAddressList = utils.shuffle(addressList);
    }
    this._totalSize = this._allAddressList.length;
    this._unChoosedAddressList = [];
    // 禁用弹性控制直接返回 或者 地址太少，直接返回
    if (!this.connectionPoolConfig.elasticControl || this._totalSize < this.connectionPoolConfig.minAddressCount) {
      return this._allAddressList;
    }
    if (this._connectionPoolSize > this._totalSize) {
      this.logger.warn('[AddressGroup] group: %s needs %s addresses, but there are only %s', this.key, this._connectionPoolSize, this._totalSize);
      return this._allAddressList;
    }
    let leftCount = this._connectionPoolSize;
    if (leftCount > this.connectionPoolConfig.maxAddressCount) {
      leftCount = this.connectionPoolConfig.maxAddressCount;
      this.logger.info('[AddressGroup] there are %s addresses totally, exteeding the max address count: %s, group: %s',
        this._totalSize, this.connectionPoolConfig.maxAddressCount, this.key);
    }
    const choosedAddressList = [];
    const connections = this.connectionManager.connections;
    for (const address of this._allAddressList) {
      const unHealthy = this._faultAddressMap.has(address.host) || this._weightMap.get(address.host) < DEFAULT_WEIGHT;
      if (connections.has(address.host) && !unHealthy && leftCount) {
        choosedAddressList.push(address);
        leftCount--;
      } else if (unHealthy) {
        // 已知为异常的地址放到栈顶，只有地址不够的时候才被选中
        this._unChoosedAddressList.unshift(address);
      } else {
        // 未知状态的地址推到栈底，优先被选中
        this._unChoosedAddressList.push(address);
      }
    }
    // 补全个数
    while (leftCount--) {
      choosedAddressList.push(this._unChoosedAddressList.pop());
    }
    return choosedAddressList;
  }

  // 统计整个分组地址列表的健康状态
  _onNext(hc) {
    let degradeCount = 0;
    const avgErrorRate = hc.errorRate;
    const avgRT = hc.avgRT;
    const avgErrorRateStr = avgErrorRate + '%';
    const avgRTStr = avgRT + 'ms';
    const totalRequestCount = hc.totalCount;

    if (this.connectionPoolConfig.elasticControl) {
      // 根据上个窗口的总请求数来计算需要多少个 connection
      const capacityPerConnection = this.connectionPoolConfig.capacityPerConnection;
      let need = Math.ceil(totalRequestCount / capacityPerConnection);
      if (need < this.connectionPoolConfig.minAddressCount) {
        need = this.connectionPoolConfig.minAddressCount;
      }
      if (need > this.connectionPoolConfig.maxAddressCount) {
        need = this.connectionPoolConfig.maxAddressCount;
      }
      this.connectionPoolSize = need;
    }

    // 全局开关：如果应用打开了这个开关，则会开启整个单点故障自动剔除摘除功能，否则完全不进入该功能的逻辑
    if (!this.faultToleranceConfig.regulationEffective) {
      return;
    }

    const table = new Table();
    let i = 0;
    let changed = false;
    for (const address of this.addressList) {
      const preWeight = this._weightMap.has(address.host) ? this._weightMap.get(address.host) : DEFAULT_WEIGHT;
      let weight = preWeight;
      const conn = this.connectionManager.get(address);
      let errorMultiple = NA;
      let rtMultiple = NA;
      let totalCount = NA;
      let errorCount = NA;
      let errorRateStr = NA;
      let rtStr = NA;

      if (!conn) {
        weight = 0; // 0 代表直接摘除
        this._faultAddressMap.set(address.host, address);
      } else {
        // 错误率远高于平均错误率，则对该地址进行调控，降低其权重
        const latestHealthCount = conn.latestHealthCount;
        // 确保 connection 上个周期有统计数据，并且有请求
        if (latestHealthCount && latestHealthCount.totalCount) {
          errorRateStr = latestHealthCount.errorRate + '%';
          rtStr = latestHealthCount.avgRT + 'ms';
          if (avgErrorRate === 0) {
            errorMultiple = latestHealthCount.errorRate > 0 ? this.faultToleranceConfig.leastWindowExceptionRateMultiple : 0;
          } else {
            errorMultiple = (Math.round(latestHealthCount.errorRate * 10 / avgErrorRate) / 10);
          }
          rtMultiple = avgRT === 0 ? 1 : (Math.round(latestHealthCount.avgRT * 10 / avgRT) / 10);
          totalCount = latestHealthCount.totalCount;
          errorCount = latestHealthCount.errorCount;
          if (errorMultiple >= this.faultToleranceConfig.leastWindowExceptionRateMultiple ||
            rtMultiple >= this.faultToleranceConfig.leastWindowRtMultiple) {
            // 如果已经降级到最小权重则不再调控
            if (preWeight <= this.faultToleranceConfig.degradeLeastWeight) {
              weight = this.faultToleranceConfig.degradeLeastWeight;
            } else {
              weight = preWeight * this.faultToleranceConfig.weightDegradeRate;
              if (weight < this.faultToleranceConfig.degradeLeastWeight) {
                weight = this.faultToleranceConfig.degradeLeastWeight;
              }
              // 被降级的 connection 需要重置 counter，不然它因为权重下降可能导致一直被降级
              conn.resetCounter();
            }
          } else if (preWeight < DEFAULT_WEIGHT &&
            (errorMultiple < this.faultToleranceConfig.recoverWindowExceptionRateMultiple &&
              rtMultiple < this.faultToleranceConfig.recoverWindowRtMultiple)) {
            weight = preWeight * this.faultToleranceConfig.weightRecoverRate;
            if (weight > DEFAULT_WEIGHT) {
              weight = DEFAULT_WEIGHT;
            }
          }
        }
        // 心跳，确保不会被断开
        conn.heartbeat();
      }
      if (preWeight !== weight) {
        table.cell('NO.', ++i);
        table.cell('Address', address.host);
        table.cell('Cur Weight', weight);
        table.cell('Pre Weight', preWeight);
        table.cell('Total Count', totalCount);
        table.cell('Error Count', errorCount);
        table.cell('Error Rate', errorRateStr + ' / ' + avgErrorRateStr + ' = ' + errorMultiple);
        table.cell('RT', rtStr + ' / ' + avgRTStr + ' = ' + rtMultiple);
        table.newRow();
        changed = true;
      }
      // 调控计数（比初始权重小则认为被调控）
      if (weight < DEFAULT_WEIGHT) {
        degradeCount++;
      }
      this._weightMap.set(address.host, weight);
    }
    // 避免太多日志
    if (changed || debug.enabled) {
      this.logger.info('[AddressGroup] group: %s weight %s, total request count: %d, avg rt: %s, avg error rate: %s, address count: %d\n%s',
        this.key, changed ? 'changed' : 'unchanged', totalRequestCount, avgRTStr, avgErrorRateStr, this._choosedSize, table.toString());
    }
    // 如果一次降级的太多，可能造成流量全部打到部分机器，从而雪崩，所以超过某个阀值后禁用调控
    if (degradeCount <= this._maxIsolatedNum) {
      this._degradeEnable = true;
    } else {
      this._degradeEnable = false;
      // 异常的机器过多，并且有足够多后补，则尝试刷新一批地址
      if (degradeCount - this._maxIsolatedNum < this._unChoosedAddressList.length) {
        this._refresh();
      }
    }
  }

  _connectAll(addressList) {
    return Promise.all(addressList.map(address => {
      return this.connectionManager
        .createAndGet(address, this.options.connectionOpts, this.options.connectionClass)
        .then(conn => {
          if (conn) {
            this._faultAddressMap.delete(address.host);
          } else if (this._weightMap.has(address.host)) {
            this._faultAddressMap.set(address.host, address);
          }
        });
    }));
  }

  // 定时重连失败的地址（这个时间不能太短）
  async _retryFaultAddresses() {
    await sleep(this.options.retryFaultInterval);

    while (!this._closed) {
      if (this._faultAddressMap.size) {
        const addressList = Array.from(this._faultAddressMap.values());
        this.logger.info('[AddressGroup] retry connect to fault addresses%s', printAddresses(addressList));
        await this._connectAll(addressList);
      }
      // 如果重连以后还是有失败的地址，并且存在未被选中的地址，则尝试替换一波
      if (this._faultAddressMap.size && this._unChoosedAddressList.length) {
        this._refresh();
      }
      await sleep(this.options.retryFaultInterval);
    }
  }

  getWeight(address) {
    const conn = this.connectionManager.get(address);
    // connection 为 null 说明地址根本连不上，直接跳过
    if (!conn) {
      this._faultAddressMap.set(address.host, address);
      return 0;
    }
    // 不支持降级的话，直接返回默认权重
    if (!this.degradeEnable) return DEFAULT_WEIGHT;

    let weight = this._weightMap.get(address.host) || DEFAULT_WEIGHT;
    // 长时间没有被路由到的话，需要给一次机会做 single check
    if (weight < DEFAULT_WEIGHT && Date.now() - conn.lastInvokeTime > this._maxIdleWindow) {
      weight = DEFAULT_WEIGHT;
    }
    return weight;
  }

  async getConnection(req) {
    const meta = req.meta;
    meta.connectionGroup = this.key;

    const address = this._loadbalancer.select(req);
    if (!address) return null;

    const { connectionOpts, connectionClass } = this.options;
    return await this.connectionManager.createAndGet(address, connectionOpts, connectionClass);
  }

  close() {
    this._weightMap.clear();
    this._faultAddressMap.clear();
    this._unChoosedAddressList = [];
    this._allAddressList = [];
    this._addressList = [];
    this._choosedSize = 0;
    this._closed = true;
    if (this._healthCounter) {
      this._healthCounter.close();
    }
  }
}

function printAddresses(addressList) {
  if (debug.enabled) {
    return '\n' + addressList.map(addr => '  - ' + addr.href).join('\n');
  }
  return '';
}

module.exports = AddressGroup;
