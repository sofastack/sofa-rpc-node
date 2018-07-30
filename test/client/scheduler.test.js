'use strict';

const assert = require('assert');
const sleep = require('mz-modules/sleep');
const Scheduler = require('../../lib/client/scheduler');

describe('test/client/scheduler.test.js', () => {
  const scheduler = Scheduler.instance;

  before(() => {
    scheduler.clear();
  });
  after(() => {
    scheduler.clear();
  });

  it('should interval(fn, period) ok', async function() {
    let i = 0;
    const counter = () => { i++; };
    const close = scheduler.interval(counter, 100);

    await sleep(1050);
    assert(i === 10);
    assert(scheduler._timers.has(100));
    close();
    assert(!scheduler._timers.has(100));

    await sleep(200);
    assert(i === 10);
  });

  it('should support multi-interval', async function() {
    let i = 0;
    let j = 0;
    const counter_1 = () => { i++; };
    const counter_2 = () => { j++; };
    const close_1 = scheduler.interval(counter_1, 100);
    const close_2 = scheduler.interval(counter_2, 100);

    await sleep(1050);
    assert(i === 10);
    assert(j === 10);
    assert(scheduler._timers.has(100));
    close_1();
    assert(scheduler._timers.has(100));

    await sleep(220);
    assert(i === 10);
    assert(j === 12);

    close_2();
    assert(!scheduler._timers.has(100));

    await sleep(200);
    assert(i === 10);
    assert(j === 12);
  });

  it('should support different interval', async function() {
    let i = 0;
    let j = 0;
    const counter_1 = () => { i++; };
    const counter_2 = () => { j++; };
    const close_1 = scheduler.interval(counter_1, 100);
    const close_2 = scheduler.interval(counter_2, 500);

    await sleep(1090);
    assert(i === 10);
    assert(j === 2);
    assert(scheduler._timers.has(100));
    assert(scheduler._timers.has(500));
    close_1();
    assert(!scheduler._timers.has(100));
    assert(scheduler._timers.has(500));

    await sleep(500);
    assert(i === 10);
    assert(j === 3);

    close_2();
    assert(!scheduler._timers.has(500));

    await sleep(500);
    assert(i === 10);
    assert(j === 3);
  });

  it('should support prepend', async function() {
    let i = 0;
    let j = 0;
    let k = 0;
    const counter_1 = () => {
      i++;
      assert(i > k);
    };
    const counter_2 = () => {
      j++;
      // 保证 counter_2 先执行
      assert(j > i);
      assert(j > k);
    };
    const counter_3 = () => { k++; };
    const close_1 = scheduler.interval(counter_1, 100);
    const close_2 = scheduler.interval(counter_2, 100, true);
    const close_3 = scheduler.interval(counter_3, 100);

    await sleep(1001);

    assert(i === 9);
    assert(j === 9);
    assert(k === 9);

    close_1();
    close_2();
    close_3();
  });
});
