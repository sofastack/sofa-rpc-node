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
    let infoLog;
    beforeEach(async () => {
      await utils.startServer(13201);
      mm(logger, 'warn', (...params) => {
        warnLog = util.format(...params);
      });
      mm(logger, 'info', (...params) => {
        infoLog = util.format(...params);
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

    it('should print connect error message', async () => {
      const mgr = new ConnectionManager({
        logger,
      });
      const conn = await mgr.createAndGet(urlparse('bolt://127.0.0.1:43999', true), {});
      assert(infoLog);
      assert(/\[ConnectionManager] create connection: bolt:\/\/127.0.0.1:43999 failed, caused by connect ECONNREFUSED 127.0.0.1:43999/.test(infoLog));
      assert(conn === null);
      await mgr.close();

      // override logConnectErrorMessage
      let fooMessage = '';
      class CustomConnectionManager extends ConnectionManager {
        logConnectErrorMessage(message) {
          fooMessage = message;
        }
      }
      const mgr2 = new CustomConnectionManager({
        logger,
      });
      const conn2 = await mgr2.createAndGet(urlparse('bolt://127.0.0.1:43999', true), {});
      assert(fooMessage);
      assert(/\[ConnectionManager] create connection: bolt:\/\/127.0.0.1:43999 failed, caused by connect ECONNREFUSED 127.0.0.1:43999/.test(fooMessage));
      assert(conn2 === null);
      await mgr2.close();
    });
  });
});
