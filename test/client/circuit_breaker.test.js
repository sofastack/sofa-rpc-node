'use strict';

const mm = require('mm');
const assert = require('assert');
const sleep = require('mz-modules/sleep');
const DynamicConfig = require('../../').client.DynamicConfig;
const CircuitBreaker = require('../../lib/client/circuit_breaker');

describe('test/client/circuit_breaker.test.js', () => {
  let cb;
  beforeEach(() => {
    mm(DynamicConfig.instance.metric, 'numBuckets', 10);
    mm(DynamicConfig.instance.metric, 'bucketSizeInMs', 100);
    mm(DynamicConfig.instance.circuitBreaker, 'requestVolumeThreshold', 5);
    mm(DynamicConfig.instance.circuitBreaker, 'errorThresholdPercentage', 50);
    mm(DynamicConfig.instance.circuitBreaker, 'sleepWindowInMilliseconds', 500);
  });
  afterEach(() => {
    cb && cb.close();
    mm.restore();
  });

  it('should cb work', done => {
    cb = CircuitBreaker.getInstance('CMD-A');
    assert(cb.key === 'CMD-A');

    cb.on('status_changed', val => {
      console.log(val);

      if (val === 'HALF_OPEN') {
        cb.update({ resultCode: '00' });
      } else if (val === 'OPEN') {
        setTimeout(() => {
          cb.allowRequest();
        }, 1000);
      } else {
        cb.removeAllListeners('status_changed');
        done();
      }
    });

    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
  });

  it('should trips or NOT trip the circuit according to resultCode', async function() {
    cb = CircuitBreaker.getInstance('CMD-B');
    assert(cb.key === 'CMD-B');

    cb.update({ resultCode: '00', rt: 10 });
    cb.update({ resultCode: '00', rt: 10 });
    cb.update({ resultCode: '00', rt: 10 });
    cb.update({ resultCode: '00', rt: 10 });
    cb.update({ resultCode: '00', rt: 10 });

    await sleep(100);
    assert(!cb.isOpen);

    cb.update({ resultCode: '01', rt: 10 });
    cb.update({ resultCode: '01', rt: 10 });
    cb.update({ resultCode: '01', rt: 10 });
    cb.update({ resultCode: '01', rt: 10 });
    cb.update({ resultCode: '01', rt: 10 });

    await sleep(100);
    assert(cb.isOpen);
    assert(!cb.allowRequest());
  });

  it('Test that if the % of failures is higher than the threshold that the circuit trips', async function() {
    cb = CircuitBreaker.getInstance('CMD-C');
    assert(cb.key === 'CMD-C');

    assert(cb.allowRequest());
    assert(!cb.isOpen);

    setTimeout(() => { cb.update({ resultCode: '00', rt: 10 }); }, 60);
    setTimeout(() => { cb.update({ resultCode: '00', rt: 10 }); }, 1);
    setTimeout(() => { cb.update({ resultCode: '00', rt: 10 }); }, 1);
    setTimeout(() => { cb.update({ resultCode: '00', rt: 10 }); }, 1);
    setTimeout(() => { cb.update({ resultCode: '01', rt: 10 }); }, 1);
    setTimeout(() => { cb.update({ resultCode: '01', rt: 10 }); }, 1);
    setTimeout(() => { cb.update({ resultCode: '01', rt: 10 }); }, 1);
    setTimeout(() => { cb.update({ resultCode: '01', rt: 10 }); }, 1);

    await sleep(100);
    assert(!cb.allowRequest());
    assert(cb.isOpen);
  });

  it('forceOpen', () => {
    mm(DynamicConfig.instance.circuitBreaker, 'forceOpen', true);
    cb = CircuitBreaker.getInstance('CMD-D');
    assert(cb.key === 'CMD-D');

    assert(cb.isOpen);
    assert(!cb.allowRequest());
  });

  it('forceClosed', () => {
    mm(DynamicConfig.instance.circuitBreaker, 'forceClosed', true);
    cb = CircuitBreaker.getInstance('CMD-E');
    assert(cb.key === 'CMD-E');

    assert(!cb.isOpen);
    assert(cb.allowRequest());
  });

  it('single test, markSuccess()', async function() {
    cb = CircuitBreaker.getInstance('CMD-F');
    assert(cb.key === 'CMD-F');
    assert(cb.status === 'CLOSED');

    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });

    const status = await cb.await('status_changed');
    assert(status === 'OPEN');

    await sleep(1000);

    assert(cb.allowRequest());
    assert(cb.status === 'HALF_OPEN');
    assert(!cb.allowRequest());
    cb.update({ resultCode: '00' });
    assert(cb.status === 'CLOSED');
  });

  it('single test, markNonSuccess()', async function() {
    cb = CircuitBreaker.getInstance('CMD-G');
    assert(cb.key === 'CMD-G');
    assert(cb.status === 'CLOSED');

    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });
    cb.update({ resultCode: '03', rt: 10 });

    const status = await cb.await('status_changed');
    assert(status === 'OPEN');
    assert(cb.latestHealthCount);
    assert(cb.latestHealthCount.totalCount === 5);
    assert(cb.latestHealthCount.errorCount === 5);
    assert(cb.latestHealthCount.errorRate === 100);
    assert(cb.latestHealthCount.avgRT === 10);

    await sleep(1000);

    assert(cb.allowRequest());
    assert(cb.status === 'HALF_OPEN');
    assert(!cb.allowRequest());
    cb.update({ resultCode: '01' });
    assert(cb.status === 'OPEN');
  });
});
