'use strict';

const mm = require('mm');
const assert = require('assert');
const urlparse = require('url').parse;
const logger = console;
const ConnectionManager = require('../../').client.RpcConnectionMgr;
const utils = require('../utils');
const util = require('util');

describe('test/client/connection_mgr.test.js', () => {
  describe('connection count great than warn count', () => {
    let warnLog;
    beforeEach(async () => {
      await utils.startServer(13201);
      mm(logger, 'warn', (...params) => {
        warnLog = util.format(...params);
      });
    });

    afterEach(async () => {
      await utils.closeAll();
    });

    it('should print warn log', async () => {
      const mgr = new ConnectionManager({
        logger,
        warnConnectionCount: 0,
      });
      const conn = await mgr.createAndGet(urlparse('bolt://127.0.0.1:13201', true), {});
      assert(warnLog);
      assert(/\[ConnectionManager] current connection count is 1, great than warn count 0/.test(warnLog));
      await conn.close();
      await mgr.close();
    });
  });
});
