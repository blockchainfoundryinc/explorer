const io = require('socket.io-client');
this.address = address;
this.socket = io('localhost:9999');
this.socket.on('connect', handleConnect);
this.socket.on('hashblock', handleMessage);
this.socket.on('disconnect', handleDisconnect);

function handleConnect() {
  console.log('websocket connected.');
}

function handleMessage(websocketMessage) {
  console.log('websocket message:', websocketMessage);
}

function handleDisconnect() {
  console.log('websocket disconnect.');
}
