'use strict';

const zookeeper = require('zookeeper-cluster-client');
const { ACL, Permission, Id } = require('node-zookeeper-client');

async function main() {
  const client = zookeeper.createClient('127.0.0.1:2181', {
    authInfo: {
      scheme: 'digest',
      auth: 'gxcsoccer:123456',
    },
  });
  await client.mkdirp('/acl');
  await client.setACL('/acl', [
    new ACL(
      Permission.ALL,
      new Id('auth', 'gxcsoccer:123456')
    ),
  ], -1);

  const acls = await client.getACL('/acl');
  console.log('acls', acls);
}

main().then(() => {
  process.exit(0);
});
