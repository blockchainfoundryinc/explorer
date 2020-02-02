const io = require('socket.io-client');
const socket = io('localhost:9999');
socket.on('connect', handleConnect);
socket.on('hashblock', handleMessage);
socket.on('disconnect', handleDisconnect);

function handleConnect() {
  console.log('websocket connected.');
}

function handleMessage(websocketMessage) {
  console.log('websocket message:', websocketMessage);
}

function handleDisconnect() {
  console.log('websocket disconnect.');
}
