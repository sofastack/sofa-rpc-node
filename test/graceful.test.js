'use strict';

const path = require('path');
const cp = require('child_process');
const sleep = require('mz-modules/sleep');
const assert = require('assert');

describe('test/graceful.test.js', () => {
  it('should support cluster server', async function() {
    let exit = false;
    const serverPath = path.join(__dirname, 'fixtures', 'server_3.js');
    console.log('serverPath:', serverPath, process.env.NODE_ENV);
    const proc = cp.spawn('node', [ serverPath ], {
      stdio: 'inherit',
      env: Object.assign({},
        process.env, {
          NODE_ENV: 'prod',
        }),
    });
    proc.on('close', function() {
      exit = true;
    });
    await sleep(5000);
    assert(!exit, 'should not exit with ignoreCode');
  });
});
