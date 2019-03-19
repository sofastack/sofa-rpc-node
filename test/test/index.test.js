'use strict';

const assert = require('assert');
const pedding = require('pedding');
const request = require('../../lib').test;
const server = require('../supports/server');

describe('test/test/index.test.js', () => {
  describe('bolt', () => {
    describe('timeout error', () => {
      it('should request delay ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'test')
          .expect('test')
          .error(function(err) {
            assert(err.message === 'expected exist error, but got undefined');
            done();
          });
      });

      it('should request delay ok check err.message', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'test')
          .error(/response timeout!/)
          .expect('test', function(err) {
            assert(err.message === 'expected exist error, but got undefined');
            done();
          });
      });

      it('should timeout', done => {
        done = pedding(3, done);
        const reg = /no response in/;
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'delay')
          .timeout(100)
          .error('message', reg)
          .error(reg)
          .error()
          .error('message', reg, done);

        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'delay')
          .timeout(100)
          .error('message', reg)
          .end(done);

        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'delay')
          .timeout(100)
          .error(reg)
          .end(done);
      });

      it('should message wrong', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'delay')
          .timeout(100)
          .error('wrong message', err => {
            assert(err.message.includes('wrong message at error.message'));
            done();
          });
      });

      it('should message reg wrong', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'delay')
          .timeout(100)
          .error(/wrong message/, err => {
            assert(err.message.includes('to match /wrong message/ at error.message'));
            done();
          });
      });
    });

    describe('expect object', () => {
      it('should string type ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror')
          .send([ 'foo string' ])
          .type('string')
          .expect('foo string', done);
      });

      it('should object type ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', { a: 1 })
          .type(Object)
          .expect({ a: 1 }, done);
      });

      it('should not string object ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 1)
          .expect(1)
          .type('object')
          .end((assertError, responseError, data) => {
            assert(assertError.message === 'expected 1 to be an object');
            assert(data === 1);
            done();
          });
      });

      it('should not object ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 1)
          .expect(1)
          .type(Object, err => {
            assert(err.message === 'expected 1 to be an instance of Object');
            done();
          });
      });

      it('should deepequal error', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', { a: 1 })
          .expect({ a: 2 }, err => {
            assert(err.message === 'expected { a: 1 } to equal { a: 2 }');
            done();
          });
      });
    });

    describe('expect array', () => {
      it('should string type ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror')
          .send([
            [ 1 ],
          ])
          .type('array')
          .expect([ 1 ], done);
      });

      it('should object type ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', [
            [ 1 ],
          ])
          .type(Array)
          .expect([ 1 ], done);
      });

      it('should not string array ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 1)
          .expect(1)
          .type('array')
          .end((assertError, responseError, data) => {
            console.log(assertError, responseError, data);
            assert(assertError.message === 'expected 1 to be an array');
            assert(data === 1);
            done();
          });
      });

      it('should not array ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 1)
          .expect(1)
          .type(Array, err => {
            assert(err.message === 'expected 1 to be an instance of Array');
            done();
          });
      });
    });

    describe.skip('expect null', () => {
      it('should null ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', [ null ])
          .expect(null, done);
      });

      it('should undefined ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', [ undefined ])
          .expect(undefined, done);
      });
    });

    describe('expect json', () => {
      it('should return JSON string', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('json')
          .send([{ hello: 'world', foo: 100 }])
          .type('json')
          .expect({ hello: 'world', foo: 100 }, done);
      });

      it('should return JSON string with regex', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('json')
          .send([{ hello: 'world', rid: '1.2.3.1,22,32', foo: 100 }])
          .type('json')
          .expect({
            hello: /^\w+$/,
            rid: /^\d+\.\d+\.\d+\.\d+,\d+,\d+$/,
            foo: 100,
          }, done);
      });

      it('should return not JSON string', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror')
          .send([{ hello: 'world', foo: 100 }])
          .type('json')
          .end(err => {
            assert(err);
            assert(err.message === "expected { foo: 100, hello: 'world' } to be a json");
            done();
          });
      });
    });

    describe('expect string', () => {
      it('should string ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 'test')
          .type('string')
          .expect('test', done);
      });

      it('should reg ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 'test')
          .expect(/test/, done);
      });

      it('should string not ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 123)
          .type('string')
          .end(err => {
            assert(err.message === 'expected 123 to be a string');
            done();
          });
      });

      it('should string not match', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 'test')
          .expect(/123/, err => {
            assert(err.message === 'expected \'test\' to match /123/');
            done();
          });
      });

      it('should string not equal', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 'test')
          .expect('123', err => {
            assert(err.message === 'expected \'test\' to equal \'123\'');
            done();
          });
      });
    });

    describe('expect function', () => {
      it('should assert with custom function ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 'test')
          .expect(res => {
            assert.equal(res, 'test');
          }, done);
      });
    });

    describe('support multi services', () => {
      it('should ping success', done => {
        request(server)
          .service('com.alipay.node.rpctest.echoService')
          .invoke('ping')
          .expect(res => {
            assert.equal(res, 'pong');
          }, done);
      });
    });

    describe('support multi version', () => {
      it('should ping success', done => {
        request(server)
          .service('com.alipay.node.rpctest.echoService:1.0')
          .invoke('ping')
          .expect(res => {
            assert.equal(res, 'pong');
          }, done);
      });

      it('should string ok', done => {
        request(server)
          .service('com.alipay.node.rpctest.helloService:1.0')
          .invoke('mirror', 'test')
          .type('string')
          .expect('test', done);
      });
    });

    describe('support promise', () => {
      it('should check timeout error success', () => {
        const reg = /no response in/;
        return request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'delay')
          .timeout(100)
          .error('message', reg)
          .error(reg)
          .error()
          .error('message', reg);
      });

      it('should string ok', () => {
        return request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('mirror', 'test')
          .type('string')
          .expect('test');
      });

      it('should work with generator function', () => {
        const reg = /no response in/;
        return request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('delay', 'delay')
          .timeout(100)
          .error('message', reg)
          .error(reg)
          .error()
          .error('message', reg);
      });

      it('should work with catch', async function() {
        await request(server)
          .service('com.alipay.node.rpctest.echoService')
          .invoke('ping')
          .expect('pong 2')
          .catch(err => {
            assert(err.message === 'expected \'pong\' to equal \'pong 2\'');
            assert(err.data === 'pong');
          });

        await request(server)
          .service('com.alipay.node.rpctest.echoService')
          .invoke('echo', { foo: 'bar' })
          .expect({
            foo: 'bar',
            xxx: 'yyy',
          })
          .catch(err => {
            assert(err.message === 'expected { foo: \'bar\' } to equal { foo: \'bar\', xxx: \'yyy\' }');
            assert.deepEqual(err.data, {
              foo: 'bar',
            });
          });

        await request(server)
          .service('com.alipay.node.rpctest.echoService')
          .invoke('echo', { foo: 'bar' })
          .expect({
            foo: /bar2/,
          })
          .catch(err => {
            assert(err.message === 'expected { foo: \'bar\' } to equal { foo: /bar2/ }');
            assert.deepEqual(err.data, {
              foo: 'bar',
            });
          });

        await request(server)
          .service('com.alipay.node.rpctest.echoService')
          .invoke('echo', { foo: { a: 'b' } })
          .expect({
            foo: { x: 'y' },
          })
          .catch(err => {
            assert(err.message === 'expected { foo: { a: \'b\' } } to equal { foo: { x: \'y\' } }');
            assert.deepEqual(err.data, { foo: { a: 'b' } });
          });
      });

      it('should throw expect no error but have one', () => {
        return request(server)
          .service('com.alipay.node.rpctest.helloService')
          .invoke('error')
          .then(() => {
            assert(false, 'should no run here');
          })
          .catch(err => {
            assert(err.message.includes('Error: mock error'));
          });
      });
    });
  });

  describe('support multi server', () => {
    it('should ping success', done => {
      const helloServer = require('../supports/hello_server');
      request(helloServer)
        .service('com.alipay.node.rpctest.echoService')
        .invoke('ping')
        .expect(res => {
          assert.equal(res, 'pong 2');
        }, done);
    });
  });
});
