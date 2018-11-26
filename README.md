# sofa-rpc-node
[SOFARPC](https://github.com/alipay/sofa-rpc) Nodejs 实现版本

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![David deps][david-image]][david-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/sofa-rpc-node.svg?style=flat-square
[npm-url]: https://npmjs.org/package/sofa-rpc-node
[travis-image]: https://img.shields.io/travis/alipay/sofa-rpc-node.svg?style=flat-square
[travis-url]: https://travis-ci.org/alipay/sofa-rpc-node
[codecov-image]: https://codecov.io/gh/alipay/sofa-rpc-node/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/alipay/sofa-rpc-node
[david-image]: https://img.shields.io/david/alipay/sofa-rpc-node.svg?style=flat-square
[david-url]: https://david-dm.org/alipay/sofa-rpc-node
[snyk-image]: https://snyk.io/test/npm/sofa-rpc-node/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/sofa-rpc-node
[download-image]: https://img.shields.io/npm/dm/sofa-rpc-node.svg?style=flat-square
[download-url]: https://npmjs.org/package/sofa-rpc-node

## 一、SOFARPC Node 简介

简单说它是 [SOFARPC](https://github.com/alipay/sofa-rpc) 的 Nodejs 版实现，但本质上它是一个通用的 Nodejs RPC 解决方案。Nodejs RPC 在阿里和蚂蚁内部已经发展了四五年时间，如今广泛应用于各类业务场景，并经历了多次双 11 大促的考验。功能方面从基本的服务发布、寻址、点对点远程调用能力；到各种路由、负载均衡策略；再到故障隔离、熔断等高级功能，已逐渐发展成一个高可扩展性、高性能、生产级的 RPC 框架。

## 二、模块划分

SOFARPC Node 主要包含了四个子模块，分别是：

- __client：__ RPC 的客户端实现
- __server：__ RPC 的服务端实现
- __registry：__ 服务注册中心抽象及实现（目前提供 zookeeper 实现）
- __test：__ RPC 测试工具类

```
.
└── lib
    ├── client
    ├── registry
    ├── server
    └── test
```

## 三、快速上手

#### 安装

```bash
$ npm install sofa-rpc-node --save
```

#### 安装并启动 zookeeper

sofa-rpc-node 默认的注册中心实现基于 zookeeper，所以需要先启动一个 zookeeper 实例

从 Homebrew 安装（macOs）

```bash
$ brew install zookeeper
```

启动 zk server（默认端口为 2181）
```bash
$ zkServer start
ZooKeeper JMX enabled by default
Using config: /usr/local/etc/zookeeper/zoo.cfg
Starting zookeeper ... STARTED
```

#### 代码示例

- 暴露一个 RPC 服务，并发布到注册中心
```js
'use strict';

const { RpcServer } = require('sofa-rpc-node').server;
const { ZookeeperRegistry } = require('sofa-rpc-node').registry;
const logger = console;

// 1. 创建 zk 注册中心客户端
const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181', // 需要本地启动一个 zkServer
});

// 2. 创建 RPC Server 实例
const server = new RpcServer({
  logger,
  registry, // 传入注册中心客户端
  port: 12200,
});

// 3. 添加服务
server.addService({
  interfaceName: 'com.nodejs.test.TestService',
}, {
  async plus(a, b) {
    return a + b;
  },
});

// 4. 启动 Server 并发布服务
server.start()
  .then(() => {
    server.publish();
  });
```

- 调用 RPC 服务（从注册中心获取服务列表）
```js
'use strict';

const { RpcClient } = require('sofa-rpc-node').client;
const { ZookeeperRegistry } = require('sofa-rpc-node').registry;
const logger = console;

// 1. 创建 zk 注册中心客户端
const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

async function invoke() {
  // 2. 创建 RPC Client 实例
  const client = new RpcClient({
    logger,
    registry,
  });
  // 3. 创建服务的 consumer
  const consumer = client.createConsumer({
    interfaceName: 'com.nodejs.test.TestService',
  });
  // 4. 等待 consumer ready（从注册中心订阅服务列表...）
  await consumer.ready();

  // 5. 执行泛化调用
  const result = await consumer.invoke('plus', [ 1, 2 ], { responseTimeout: 3000 });
  console.log('1 + 2 = ' + result);
}

invoke().catch(console.error);
```

- 调用 RPC 服务（直连模式）
```js
'use strict';

const { RpcClient } = require('sofa-rpc-node').client;
const logger = console;

async function invoke() {
  // 不需要传入 registry 实例了
  const client = new RpcClient({
    logger,
  });
  const consumer = client.createConsumer({
    interfaceName: 'com.nodejs.test.TestService',
    serverHost: '127.0.0.1:12200', // 直接指定服务地址
  });
  await consumer.ready();

  const result = await consumer.invoke('plus', [ 1, 2 ], { responseTimeout: 3000 });
  console.log('1 + 2 = ' + result);
}

invoke().catch(console.error);
```

- 测试 RPC Server 的方法（用于单元测试）
```js
'use strict';

const request = require('sofa-rpc-node').test;
const { RpcServer } = require('sofa-rpc-node').server;
const logger = console;

describe('test/server.test.js', () => {
  let server;
  before(async function() {
    server = new RpcServer({
      logger,
      port: 12200,
    });
    server.addService({
      interfaceName: 'com.nodejs.test.TestService',
    }, {
      async plus(a, b) {
        return a + b;
      },
    });
    await server.start();
  });
  after(async function() {
    await server.close();
  });

  it('should call plus ok', async function() {
    await request(server)
      .service('com.nodejs.test.TestService')
      .invoke('plus')
      .send([ 1, 2 ])
      .expect(3);
  });
});
```

- 暴露和调用 protobuf 接口

通过 *.proto 来定义接口
```proto
syntax = "proto3";

package com.alipay.sofa.rpc.test;

// 可选
option java_multiple_files = false;

service ProtoService {
  rpc echoObj (EchoRequest) returns (EchoResponse) {}
}

message EchoRequest {
  string name = 1;
  Group group = 2;
}

message EchoResponse {
  int32 code = 1;
  string message = 2;
}

enum Group {
  A = 0;
  B = 1;
}
```

服务端代码
```js
'use strict';

const antpb = require('antpb');
const protocol = require('sofa-bolt-node');
const { RpcServer } = require('sofa-rpc-node').server;
const { ZookeeperRegistry } = require('sofa-rpc-node').registry;
const logger = console;

// 传入 *.proto 文件存放的目录，加载接口定义
const proto = antpb.loadAll('/path/proto');
// 将 proto 设置到协议中
protocol.setOptions({ proto });

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

const server = new RpcServer({
  logger,
  protocol, // 覆盖协议
  registry,
  codecType: 'protobuf', // 设置默认的序列化方式为 protobuf
  port: 12200,
});

server.addService({
  interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
}, {
  async echoObj(req) {
    req = req.toObject({ enums: String });
    return {
      code: 200,
      message: 'hello ' + req.name + ', you are in ' + req.group,
    };
  },
});
server.start()
  .then(() => {
    server.publish();
  });
```

客户端代码
```js
'use strict';

const antpb = require('antpb');
const protocol = require('sofa-bolt-node');
const { RpcClient } = require('sofa-rpc-node').client;
const { ZookeeperRegistry } = require('sofa-rpc-node').registry;
const logger = console;

// 传入 *.proto 文件存放的目录，加载接口定义
const proto = antpb.loadAll('/path/proto');
// 将 proto 设置到协议中
protocol.setOptions({ proto });

const registry = new ZookeeperRegistry({
  logger,
  address: '127.0.0.1:2181',
});

async function invoke() {
  const client = new RpcClient({
    logger,
    protocol,
    registry,
  });
  const consumer = client.createConsumer({
    interfaceName: 'com.alipay.sofa.rpc.test.ProtoService',
  });
  await consumer.ready();

  const result = await consumer.invoke('echoObj', [{
    name: 'gxcsoccer',
    group: 'B',
  }], { responseTimeout: 3000 });
  console.log(result);
}

invoke().catch(console.error);
```

#### 最佳实践

虽然上面我们提供了示例代码，但是我们并不推荐您直接使用该模块，因为它的定位是 RPC 基础模块，只提供基本的 API，对于业务开发者可能并不是非常友好。我们的最佳实践是通过插件将 RPC 能力集成到 [eggjs](https://github.com/eggjs/egg) 框架里，提供更加直观友好的用户接口，让您就像使用本地方法一样使用 RPC。这块也会在近期开放，敬请期待！


## 三、相关文档

- [聊聊 Node.js RPC（一）— 协议](https://www.yuque.com/egg/nodejs/dklip5)
- [聊聊 Node.js RPC（二）— 服务发现](https://www.yuque.com/egg/nodejs/mhgl9f)

## 四、如何贡献

请告知我们可以为你做些什么，不过在此之前，请检查一下是否有已经[存在的Bug或者意见](https://github.com/alipay/sofa-rpc-node/issues)。

如果你是一个代码贡献者，请参考[代码贡献规范](https://github.com/eggjs/egg/blob/master/CONTRIBUTING.zh-CN.md)。

## 五、开源协议

[MIT](https://github.com/alipay/sofa-rpc-node/blob/master/LICENSE)
