'use strict';

module.exports = {
  'com.alipay.sofa.rpc.core.response.SofaResponse': {
    isError: {
      type: 'boolean',
      defaultValue: false,
    },
    errorMsg: {
      type: 'java.lang.String',
    },
    appResponse: {
      type: 'java.lang.Object',
    },
    responseProps: {
      type: 'java.util.Map',
      generic: [
        { type: 'java.lang.String' },
        { type: 'java.lang.Object' },
      ],
    },
  },
  'com.alipay.test.TestObj': {
    staticField: {
      type: 'java.lang.String',
      isStatic: true,
    },
    transientField: {
      type: 'java.lang.String',
      isTransient: true,
    },
    b: {
      type: 'boolean',
      defaultValue: false,
    },
    testObj2: {
      type: 'com.alipay.test.sub.TestObj2',
    },
    name: {
      type: 'java.lang.String',
    },
    field: {
      type: 'java.lang.String',
    },
    testEnum: {
      type: 'com.alipay.test.TestEnum',
      isEnum: true,
    },
    testEnum2: {
      type: 'com.alipay.test.TestEnum',
      isArray: true,
      arrayDepth: 1,
      isEnum: true,
    },
    bs: {
      type: 'byte',
      isArray: true,
      arrayDepth: 1,
    },
    list1: {
      type: 'java.util.List',
      generic: [
        { isEnum: true, type: 'com.alipay.test.TestEnum' },
      ],
    },
    list2: {
      type: 'java.util.List',
      generic: [
        { type: 'java.lang.Integer' },
      ],
    },
    list3: {
      type: 'java.util.List',
      generic: [
        { type: 'com.alipay.test.sub.TestObj2' },
      ],
    },
    list4: {
      type: 'java.util.List',
      generic: [
        { type: 'java.lang.String' },
      ],
    },
    list5: {
      type: 'java.util.List',
      generic: [
        { isArray: true, type: 'byte' },
      ],
    },
    map1: {
      type: 'java.util.Map',
      generic: [
        { type: 'java.lang.Long' },
        { isEnum: true, type: 'com.alipay.test.TestEnum' },
      ],
    },
    map2: {
      type: 'java.util.Map',
      generic: [
        { type: 'java.lang.Integer' },
        { type: 'java.lang.Integer' },
      ],
    },
    map3: {
      type: 'java.util.Map',
      generic: [
        { type: 'java.lang.Boolean' },
        { type: 'com.alipay.test.sub.TestObj2' },
      ],
    },
    map4: {
      type: 'java.util.Map',
      generic: [
        { type: 'java.lang.String' },
        { type: 'java.lang.String' },
      ],
    },
    map5: {
      type: 'java.util.Map',
      generic: [
        { type: 'java.lang.String' },
        { isArray: true, type: 'byte' },
      ],
    },
  },
  'com.alipay.test.sub.TestObj2': {
    name: {
      type: 'java.lang.String',
    },
    transientField: {
      type: 'java.lang.String',
      isTransient: true,
    },
    finalField: {
      type: 'java.lang.String',
      defaultValue: 'xxx',
    },
    staticField: {
      type: 'java.lang.String',
      isStatic: true,
    },
  },
};
