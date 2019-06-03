'use strict';

const _instance = Symbol.for('DynamicConfig#instance');

module.exports = {
  get instance() {
    if (!this[_instance]) {
      this[_instance] = {
        // metric 相关的
        metric: {
          // 滑动窗口的 bucket 个数
          numBuckets: 6,
          // 每个 bucket 的大小（时间跨度）
          bucketSizeInMs: 10000,
        },

        // 熔断相关的配置
        circuitBreaker: {
          forceOpen: false,
          forceClosed: false,
          requestVolumeThreshold: 20, // 请求数小于该值不开启熔断
          errorThresholdPercentage: 50, // 开启熔断的阀值
          sleepWindowInMilliseconds: 5000,
        },

        // 单机故障摘除相关的配置
        faultTolerance: {
          // 如果 connection 非健康状态，要判断是否开启单机故障摘除，如果摘除的机器太多可能导致雪崩
          //
          // 比如10台服务器，每台服务器容量为100，平时每台机器的流量为60。
          // (10-x)*40 = x * 60
          // x = 4
          // 4台机器被熔断后，这4台机器的 4*60 的流量平摊到另外6台机器，正好将另外6台机器打满。如果有超过4台机器被熔断，那么极有可能导致雪崩。
          // 那么max_isolated_machine_percentage的最大值是 4/10，  保守一点，可以设得更小。
          maxIsolatedPercentage: 0.4,
          leastWindowCount: 10,

          leastWindowRtMultiple: 10,
          recoverWindowRtMultiple: 1.5,

          // 时间窗口内异常率与服务平均异常率的降级比值：在对统计信息进行计算的时候，
          // 会计算出该服务所有有效调用ip的平均异常率，如果某个ip的异常率大于等于了这个最低比值，则会被降级。
          leastWindowExceptionRateMultiple: 3,
          // 如果错误率和平均异常率的比值小于该值，则开始逐步恢复
          recoverWindowExceptionRateMultiple: 1.5,
          // 降级比率：地址在进行权重降级时的降级比率
          weightDegradeRate: 0.05,
          // 恢复比率：地址在进行权重恢复时的恢复比率
          weightRecoverRate: 2,
          degradeLeastWeight: 1,
          // 降级开关：如果应用打开了这个开关，则会对符合降级的地址进行降级，否则只会进行日志打印
          degradeEffective: true,
          // 全局开关：如果应用打开了这个开关，则会开启整个单点故障自动剔除摘除功能，否则完全不进入该功能的逻辑。 false(关闭)
          regulationEffective: true,
        },

        // 连接池配置
        connectionPoolConfig: {
          enableThreshold: 50,
          minAddressCount: 5,
          maxAddressCount: 50,
          initConnectionSize: 6,
          elasticControl: true,
          // 单个 connection 的容量（1 分钟）
          capacityPerConnection: 300,
        },
      };
    }
    return this[_instance];
  },
  set instance(val) {
    /* istanbul ignore next */
    this[_instance] = val;
  },
};
