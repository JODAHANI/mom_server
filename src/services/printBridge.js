const crypto = require('crypto');

// 연결된 프린트 에이전트 목록 — 단일 프린터 가정, 첫 번째 연결로 라우팅
const agents = new Set();
// jobId → { resolve, reject, timer, ws }
const pending = new Map();

const DEFAULT_TIMEOUT_MS = 30000;

function registerAgent(ws) {
  agents.add(ws);
  console.log('[PrintBridge] 에이전트 연결됨 (현재', agents.size, '대)');

  ws.on('close', () => {
    agents.delete(ws);
    console.log('[PrintBridge] 에이전트 연결 해제 (현재', agents.size, '대)');
    // 이 에이전트로 보낸 미완료 잡은 즉시 실패 처리 — 재시도는 호출자(어드민) 책임
    for (const [jobId, p] of pending) {
      if (p.ws === ws) {
        clearTimeout(p.timer);
        pending.delete(jobId);
        const err = new Error('프린트 에이전트 연결이 끊겼습니다');
        err.code = 'PRINTER_OFFLINE';
        p.reject(err);
      }
    }
  });
}

function handleAgentMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (msg.type !== 'PRINT_ACK' || !msg.jobId) return;

  const p = pending.get(msg.jobId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(msg.jobId);

  if (msg.ok) {
    p.resolve();
  } else {
    const err = new Error(msg.message || '프린트 실패');
    err.code = msg.code || 'PRINT_FAILED';
    p.reject(err);
  }
}

function pickAgent() {
  for (const ws of agents) {
    if (ws.readyState === 1) return ws;
  }
  return null;
}

/**
 * 프린트 잡을 에이전트에 위임하고 ACK까지 대기한다.
 * jobType: 'order_receipt' | 'session_receipt' | 'table_qr'
 *
 * 에러 코드:
 *  - PRINTER_OFFLINE : 연결된 에이전트 없음 / 도중 끊김
 *  - PRINT_FAILED    : 에이전트가 실패 응답 / 타임아웃 / 송신 실패
 */
function requestPrint(jobType, payload, opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = pickAgent();
    if (!ws) {
      const err = new Error('프린트 에이전트가 연결되어 있지 않습니다');
      err.code = 'PRINTER_OFFLINE';
      return reject(err);
    }

    const jobId = crypto.randomUUID();
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      pending.delete(jobId);
      const err = new Error('프린트 응답 시간 초과');
      err.code = 'PRINT_FAILED';
      reject(err);
    }, timeoutMs);

    pending.set(jobId, { resolve, reject, timer, ws });

    try {
      ws.send(JSON.stringify({ type: 'PRINT_JOB', jobId, jobType, payload }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(jobId);
      const err = new Error('프린트 잡 전송 실패: ' + e.message);
      err.code = 'PRINT_FAILED';
      reject(err);
    }
  });
}

function getAgentCount() {
  return agents.size;
}

module.exports = { registerAgent, handleAgentMessage, requestPrint, getAgentCount };
