'use strict';

const Base = require('sdk-base');

class Scheduler extends Base {
  /**
   * 循环任务调度器，复用 timer
   */
  constructor() {
    super();
    this._timers = new Map(); // <period, timerId>
    // NOTE: 这里是按照单进程最多 6000 个 socket 连接来设置的，
    // 如果超过了要么是需要做连接数控制，要么就是代码有问题，忘记清理事件监听
    this.setMaxListeners(6000);
  }

  // 相同 period 的任务复用相同的定时器，以避免创建大量定时器
  interval(fn, period, prepend) {
    const eventName = 'period_' + period;
    if (!this._timers.has(period)) {
      const timerId = setInterval(() => {
        this.emit(eventName);
      }, period);
      this._timers.set(period, timerId);
    }
    if (prepend) {
      this.prependListener(eventName, fn);
    } else {
      this.on(eventName, fn);
    }
    return () => {
      this.removeListener(eventName, fn);
      if (this.listenerCount(eventName) === 0) {
        const timerId = this._timers.get(period);
        clearInterval(timerId);
        this._timers.delete(period);
      }
    };
  }

  clear() {
    for (const timerId of this._timers.values()) {
      clearInterval(timerId);
    }
    this._timers.clear();
    this.removeAllListeners();
  }
}

const _instance = Symbol.for('Scheduler#instance');

module.exports = {
  // singleton
  get instance() {
    if (!this[_instance]) {
      this[_instance] = new Scheduler();
    }
    return this[_instance];
  },
};
