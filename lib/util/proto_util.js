'use strict';

const methodMap = new Map();

exports.getMethodInfo = (proto, interfaceName, methodName) => {
  const key = interfaceName + '#' + methodName;
  let method = methodMap.get(key);
  if (!method) {
    const service = proto.lookupService(interfaceName);
    method = service.get(methodName);
    if (!method) {
      throw new Error(`no such Method '${methodName}' in Service '${interfaceName}'`);
    }
    method = method.resolve();
    methodMap.set(key, method);
  }
  return method;
};
