'use strict';

const net = require('net');
const awaitEvent = require('await-event');

const map = new Map();
const connections = new Set();

exports.startServer = async port => {
  if (map.has(port)) return map.get(port);

  const server = net.createServer();
  map.set(port, server);
  server.on('connection', socket => {
    connections.add(socket);
  });
  server.listen(port);
  await awaitEvent(server, 'listening');
  return server;
};

exports.closeAll = async () => {
  for (const socket of connections.values()) {
    socket.destroy();
  }
  const task = [];
  for (const server of map.values()) {
    server.close();
    task.push(awaitEvent(server, 'close'));
  }
  await Promise.all(task);
  map.clear();
  connections.clear();
};
