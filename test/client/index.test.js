'use strict';

const path = require('path');
const coffee = require('coffee');

describe('test/client/index.test.js', () => {
  it('should not have stderr', done => {
    coffee.fork(path.join(__dirname, 'require.js'), [])
      .expect('stdout', 'hello world\n')
      .expect('stderr', '')
      .expect('code', 0)
      .end(done);
  });
});
