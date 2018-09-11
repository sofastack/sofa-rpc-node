'use strict';

const assert = require('assert');
const Metadata = require('../../lib/client/connection/grpc/metadata');

describe('test/grpc/metadata.test.js', () => {
  it('should normal opt ok', () => {
    const metadata = new Metadata();
    metadata.set('foo', 'bar');
    assert.deepEqual({ foo: [ 'bar' ] }, metadata.toHttp2Headers());

    metadata.add('foo', 'xxx');
    assert.deepEqual({ foo: [ 'bar', 'xxx' ] }, metadata.toHttp2Headers());

    metadata.add('yyy', 'xxx');
    assert.deepEqual({ foo: [ 'bar', 'xxx' ], yyy: [ 'xxx' ] }, metadata.toHttp2Headers());

    metadata.remove('yyy');
    assert.deepEqual({ foo: [ 'bar', 'xxx' ] }, metadata.toHttp2Headers());

    assert.deepEqual(metadata.get('foo'), [ 'bar', 'xxx' ]);
    assert.deepEqual(metadata.get('yyy'), []);

    assert.deepEqual({ foo: 'bar' }, metadata.getMap());

    assert.throws(() => {
      metadata.set('#', 'bar');
    }, /Metadata key "#" contains illegal characters/);

    assert.throws(() => {
      metadata.set('x-bin', 'bar');
    }, /keys that end with \'-bin\' must have Buffer values/);

    assert.throws(() => {
      metadata.set('x', Buffer.from('xxx'));
    }, /keys that don\'t end with \'-bin\' must have String values/);

    assert.throws(() => {
      metadata.set('x', '中文');
    }, /Metadata string value "中文" contains illegal characters/);
  });

  it('should fromHttp2Headers ok', () => {
    const metadata = new Metadata();
    metadata.fromHttp2Headers({
      foo: 'bar',
      'x-bin': Buffer.from('hello').toString('base64'),
      'y-bin': [ Buffer.from('hello').toString('base64') ],
      xxx: [ 'yyy' ],
      x: 'a,b,c',
    });

    const headers = metadata.toHttp2Headers();
    assert.deepEqual({
      foo: [ 'bar' ],
      'x-bin': [ 'aGVsbG8=' ],
      'y-bin': [ 'aGVsbG8=' ],
      xxx: [ 'yyy' ],
      x: [ 'a', 'b', 'c' ],
    }, headers);
  });

  it('should merge ok', () => {
    const metadata = new Metadata();
    metadata.set('foo', 'bar');

    const other = new Metadata();
    other.set('foo', 'xxx');
    other.set('a', 'a');

    metadata.merge(other);

    assert.deepEqual({ foo: [ 'bar', 'xxx' ], a: [ 'a' ] }, metadata.toHttp2Headers());
  });
});
