'use strict';

const utility = require('utility');
const LoadBalancer = require('./base');

// 负载均衡随机算法:全部列表按权重随机选择
class RandomLoadBalancer extends LoadBalancer {
  _doSelect(request, addressList) {
    const len = addressList.length;
    let totalWeight = 0;
    let isWeightSame = true;
    let address;
    for (let i = 0; i < len; i++) {
      const weigit = this.getWeight(addressList[i]);
      totalWeight += weigit;
      if (isWeightSame && i > 0 && weigit !== this.getWeight(addressList[i - 1])) {
        isWeightSame = false;
      }
    }
    if (totalWeight > 0 && !isWeightSame) {
      // 如果权重不相同且权重大于0则按总权重数随机
      let offset = utility.random(totalWeight);
      for (let i = 0; i < len; i++) {
        // 并确定随机值落在哪个片断上
        offset -= this.getWeight(addressList[i]);
        if (offset < 0) {
          address = addressList[i];
          break;
        }
      }
    } else {
      const index = utility.random(len); // math.randomInt(len);
      address = addressList[index];
    }
    return address;
  }
}

module.exports = RandomLoadBalancer;
