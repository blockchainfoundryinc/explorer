const io = require('socket.io-client');
const socket = io('http://localhost:9999');
const { spawn } = require('child_process');

socket.on('connect', handleConnect);
socket.on('hashblock', handleMessage);
socket.on('disconnect', handleDisconnect);

console.log('smartsync started.');

function handleConnect() {
  console.log('websocket connected.');
}

function handleMessage(websocketMessage) {
  console.log('websocket message:', websocketMessage);
  const child = spawn('pwd', );
  child.stdout.setEncoding('utf8');
  // use child.stdout.setEncoding('utf8'); if you want text chunks
  child.stdout.on('data', (chunk) => {
    console.log('child process:', chunk);
  });

  child.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });
}

function handleDisconnect() {
  console.log('websocket disconnect.');
}


