'use strict';

const { stop } = require('./zk');

stop().catch(err => { console.log(err); });
