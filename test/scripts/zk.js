'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const cwd = path.join(__dirname, '../..');

async function detectZookeeper() {
  return new Promise(resolve => {
    const netstat = cp.spawn('netstat', [ '-an' ]);
    const grep = cp.spawn('grep', [ '2181' ]);

    netstat.stdout.on('data', data => {
      grep.stdin.write(data);
    });

    netstat.stderr.on('data', data => {
      console.error(`netstat stderr: ${data}`);
    });

    netstat.on('close', code => {
      if (code !== 0) {
        console.log(`netstat process exited with code ${code}`);
      }
      grep.stdin.end();
    });

    grep.stdout.on('data', data => {
      console.log(data.toString());
    });

    grep.stderr.on('data', data => {
      console.error(`grep stderr: ${data}`);
    });

    grep.on('close', code => {
      if (code !== 0) {
        console.log(`grep process exited with code ${code}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
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
