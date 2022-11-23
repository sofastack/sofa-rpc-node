const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const runscript = require('runscript');

const cwd = path.join(__dirname, '../..');

async function detectZookeeper() {
  try {
    await runscript('netstat -an | grep 2181');
    return true;
  } catch {
    return false;
  }
}

async function extract() {
  cp.execSync('tar xf zookeeper-3.4.6.tar.gz', { cwd });
}

exports.start = async () => {
  if (await detectZookeeper()) {
    return;
  }

  if (!fs.existsSync(path.join(cwd, 'zookeeper-3.4.6'))) {
    await extract();
  }

  cp.execSync('cp zookeeper-3.4.6/conf/zoo_sample.cfg zookeeper-3.4.6/conf/zoo.cfg', { cwd });
  cp.execSync('./zookeeper-3.4.6/bin/zkServer.sh start', { cwd });
};

exports.stop = async () => {
  const running = await detectZookeeper();
  if (!running) {
    return;
  }
  cp.execSync('./zookeeper-3.4.6/bin/zkServer.sh stop', { cwd });
};
