'use strict';

const mm = require('mm');
const assert = require('assert');
const utils = require('../../lib/client/utils');

describe('test/client/utils.test.js', () => {
  it('should nextId ok', () => {
    mm(utils, 'id', Math.pow(2, 30));
    assert(utils.nextId() === 1);
    assert(utils.nextId() === 2);
  });

  it('should shuffle ok', () => {
    const arr = utils.shuffle([ 1, 2, 3, 4, 5, 6 ]);
    console.log(arr);
    assert.notDeepEqual(arr, [ 1, 2, 3, 4, 5, 6 ]);
  });
});
