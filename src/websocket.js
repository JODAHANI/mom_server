const { WebSocketServer } = require('ws');

let wss;

/**
 * WebSocket 서버 설정
 * HTTP 서버에 WebSocket을 연결하고 heartbeat를 관리한다
 */
function setupWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('[WebSocket] 클라이언트 연결됨');
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('[WebSocket] 메시지 수신:', data);
      } catch (err) {
        // 일반 텍스트 메시지 무시
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] 클라이언트 연결 해제');
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] 에러:', err.message);
    });
  });

  // Heartbeat: 30초마다 ping을 보내 연결 상태 확인
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  console.log('[WebSocket] 서버 준비 완료');
  return wss;
}

/**
 * 모든 연결된 클라이언트에 메시지 브로드캐스트
 */
function broadcast(type, data) {
  if (!wss) return;

  const message = JSON.stringify({ type, data });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

module.exports = { setupWebSocket, broadcast };
