'use strict';

const path = require('path');
const antpb = require('antpb');
const assert = require('assert');
const proto = antpb.loadAll(path.join(__dirname, '../fixtures/proto'));
const ProtoUtil = require('../../lib/util/proto_util');

describe('test/grpc/proto_util.test.js', () => {
  it('should ok', () => {
    let methodInfo = ProtoUtil.getMethodInfo(proto, 'helloworld.Greeter', 'SayHello');
    assert(methodInfo);
    methodInfo = ProtoUtil.getMethodInfo(proto, 'helloworld.Greeter', 'SayHello');
    assert(methodInfo);

    assert.throws(() => {
      ProtoUtil.getMethodInfo(proto, 'helloworld.Greeter', 'SayGoodbye');
    }, /no such Method 'SayGoodbye' in Service 'helloworld\.Greeter'/);
  });
});
