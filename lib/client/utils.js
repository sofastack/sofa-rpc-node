'use strict';

const crypto = require('crypto');
const MAX_PACKET_ID = Math.pow(2, 30); // 避免 hessian 写大整数

/**
 * 创建全局唯一的 packetId
 * @return {Number} packetId
 */
exports.nextId = () => {
  exports.id += 1;
  if (exports.id >= MAX_PACKET_ID) {
    exports.id = 1;
  }
  return exports.id;
};

exports.id = 0;

/* eslint-disable  no-bitwise */
exports.shuffle = arr => {
  let n = arr.length;
  let random;
  while (n) {
    random = (Math.random() * n--) >>> 0; // 无符号右移位运算符向下取整
    [ arr[n], arr[random] ] = [ arr[random], arr[n] ]; // ES6的结构赋值实现变量互换
  }
  return arr;
};
/* eslint-enable  no-bitwise */

exports.md5 = value => {
  const md5 = crypto.createHash('md5');
  return md5.update(value).digest();
};

exports.printAddresses = addressList => {
  let list = addressList.map(addr => '  - ' + addr.href);
  if (list.length > 20) {
    list = list.slice(0, 20);
    list.push('... only 20 first addresses will be shown here!');
  }
  return '\n' + list.join('\n');
};
