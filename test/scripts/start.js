'use strict';

const { start } = require('./zk');

start().catch(err => { console.log(err); });
