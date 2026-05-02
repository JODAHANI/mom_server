const { WebSocketServer } = require('ws');
const { registerAgent, handleAgentMessage } = require('./services/printBridge');

let wss;

const AGENT_TOKEN = process.env.PRINT_AGENT_TOKEN || '';

/**
 * WebSocket 서버 설정
 * - 어드민 클라이언트: 기본 경로
 * - 프린트 에이전트: ?role=print-agent&token=XXX  (PRINT_AGENT_TOKEN 일치 시 인정)
 */
function setupWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const params = new URLSearchParams((req.url || '').split('?')[1] || '');
    const role = params.get('role');

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    if (role === 'print-agent') {
      const token = params.get('token');
      if (!AGENT_TOKEN) {
        console.warn('[WebSocket] PRINT_AGENT_TOKEN 미설정 — 에이전트 연결 거절');
        ws.close(4001, 'agent token not configured');
        return;
      }
      if (token !== AGENT_TOKEN) {
        console.warn('[WebSocket] 프린트 에이전트 토큰 불일치 — 연결 거절');
        ws.close(4001, 'invalid token');
        return;
      }
      ws.role = 'print-agent';
      registerAgent(ws);
      ws.on('message', (raw) => handleAgentMessage(ws, raw));
      ws.on('error', (err) => {
        console.error('[WebSocket] 에이전트 에러:', err.message);
      });
      return;
    }

    console.log('[WebSocket] 클라이언트 연결됨');

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

  // Heartbeat: 30초마다 ping
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
 * 어드민/고객 클라이언트에만 브로드캐스트 — 프린트 에이전트는 제외
 */
function broadcast(type, data) {
  if (!wss) return;

  const message = JSON.stringify({ type, data });

  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.role !== 'print-agent') {
      client.send(message);
    }
  });
}

module.exports = { setupWebSocket, broadcast };
