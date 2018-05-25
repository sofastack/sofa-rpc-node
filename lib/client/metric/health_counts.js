'use strict';

const _avgRT = Symbol.for('HealthCounts#avgRT');
const _errorRate = Symbol.for('HealthCounts#errorRate');

class HealthCounts {
  constructor(total, error, totalRT) {
    this.totalCount = total;
    this.errorCount = error;
    this.totalRT = totalRT;
  }

  // 延迟计算
  get errorRate() {
    if (this[_errorRate] == null) {
      this[_errorRate] = this.totalCount === 0 ? 0 : Math.round(this.errorCount / this.totalCount * 100);
    }
    return this[_errorRate];
  }

  get avgRT() {
    if (this[_avgRT] == null) {
      this[_avgRT] = this.totalCount === 0 ? 0 : Math.round(this.totalRT / this.totalCount);
    }
    return this[_avgRT];
  }

  plus(info) {
    let updatedTotalCount = this.totalCount;
    let updatedErrorCount = this.errorCount;
    let updatedTotalRT = this.totalRT;

    updatedTotalCount += (info['00'] + info['01'] + info['02'] + info['03'] + info['04']);
    updatedErrorCount += (info['01'] + info['02'] + info['03'] + info['04']);
    updatedTotalRT += info.rt;

    return new HealthCounts(updatedTotalCount, updatedErrorCount, updatedTotalRT);
  }

  toString() {
    return 'HealthCounts[' + this.errorCount + ' / ' + this.totalCount + ' : ' +
      this.errorRate + '%, avg rt : ' + this.avgRT + 'ms]';
  }
}

HealthCounts.empty = new HealthCounts(0, 0, 0);

module.exports = HealthCounts;
