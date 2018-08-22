'ues strict';

module.exports = {
  write: true,
  prefix: '^',
  devprefix: '^',
  exclude: [
    'test/fixtures',
  ],
  devdep: [
    'autod',
    'egg-bin',
    'eslint',
    'eslint-config-egg',
    'contributors',
  ],
  keep: [],
  semver: [],
};
