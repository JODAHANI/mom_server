const { printer: ThermalPrinter, types: PrinterTypes } = require('node-thermal-printer');
const usb = require('usb');

const LINE_WIDTH = 48; // 80mm, Font A

function parseHex(v, def) {
  if (v == null || v === '') return def;
  const s = String(v).trim();
  return s.startsWith('0x') || s.startsWith('0X') ? parseInt(s, 16) : parseInt(s, 10);
}

// 콤마로 구분된 VID/PID 목록을 파싱한다 — 예: "0x1fc9,0x0639"
function parseHexList(v, def) {
  if (v == null || v === '') return def;
  return String(v)
    .split(',')
    .map((s) => parseHex(s, null))
    .filter((n) => Number.isFinite(n));
}

function fmtHex(n) {
  return '0x' + n.toString(16).padStart(4, '0');
}

// PRINTER_USB_VID / PRINTER_USB_PID가 인덱스 매칭된 쌍 목록을 만든다.
// VID=[A,B], PID=[X,Y] → [(A,X),(B,Y)]. 길이가 다르면 최소 길이까지만.
function getPrinterCandidates() {
  const vids = parseHexList(process.env.PRINTER_USB_VID, [0x1fc9]);
  const pids = parseHexList(process.env.PRINTER_USB_PID, [0x2016]);
  const n = Math.min(vids.length, pids.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ vid: vids[i], pid: pids[i] });
  return out;
}

// USB ESC/POS 프린터에 raw 바이트를 직접 전송한다.
// libusb 경유 — CUPS/드라이버 불필요. macOS/Linux/Windows 공통.
function sendBufferViaUsb(buffer) {
  const candidates = getPrinterCandidates();

  return new Promise((resolve, reject) => {
    let device;
    let matched;
    try {
      for (const c of candidates) {
        const d = usb.findByIds(c.vid, c.pid);
        if (d) { device = d; matched = c; break; }
      }
    } catch (e) {
      const err = new Error(e.message || 'USB 접근 실패');
      err.code = 'PRINT_FAILED';
      return reject(err);
    }

    if (!device) {
      const list = candidates.map((c) => `${fmtHex(c.vid)}:${fmtHex(c.pid)}`).join(', ');
      const err = new Error(`USB 프린터를 찾을 수 없습니다 (시도: ${list})`);
      err.code = 'PRINTER_OFFLINE';
      return reject(err);
    }

    let iface;
    const closeDevice = () => {
      try { iface && iface.release(true, () => { try { device.close(); } catch (e) {} }); }
      catch (e) { try { device.close(); } catch (e2) {} }
    };

    try {
      device.open();
      iface = device.interfaces[0];

      // macOS/Linux: 기본 kernel driver 분리
      try {
        if (iface.isKernelDriverActive && iface.isKernelDriverActive()) {
          iface.detachKernelDriver();
        }
      } catch (e) { /* 지원 안 하는 OS는 무시 */ }

      iface.claim();

      const outEp = iface.endpoints.find((ep) => ep.direction === 'out');
      if (!outEp) {
        closeDevice();
        const err = new Error('USB OUT 엔드포인트를 찾을 수 없습니다');
        err.code = 'PRINT_FAILED';
        return reject(err);
      }

      // 한 번에 전송 — ESC/POS 명령이 청크 경계에서 쪼개지면 파서가 놓침
      outEp.timeout = 60000;
      outEp.transfer(buffer, (err) => {
        if (err) {
          closeDevice();
          const e = new Error(err.message || 'USB 전송 실패');
          e.code = 'PRINT_FAILED';
          return reject(e);
        }
        // 마지막 바이트 처리 + 커트 완료 여유
        setTimeout(() => {
          closeDevice();
          resolve();
        }, 800);
      });
    } catch (error) {
      closeDevice();
      if (!error.code) {
        // LIBUSB_ERROR_ACCESS, LIBUSB_ERROR_BUSY 등
        error.code = /access|permission/i.test(error.message)
          ? 'PRINT_FAILED'
          : 'PRINTER_OFFLINE';
      }
      reject(error);
    }
  });
}

const STATUS_LABELS = {
  pending: '조리대기',
  accepted: '접수',
  preparing: '조리시작',
  ready: '조리완료',
  served: '전달완료',
  cancelled: '취소',
};

function visualWidth(str) {
  let w = 0;
  for (const ch of String(str || '')) {
    const code = ch.codePointAt(0);
    // 한글/한자/일본어/전각문자 2칸
    w += code > 0x2E80 ? 2 : 1;
  }
  return w;
}

function padRight(str, width) {
  const diff = width - visualWidth(str);
  return diff > 0 ? str + ' '.repeat(diff) : str;
}

function padLeft(str, width) {
  const diff = width - visualWidth(str);
  return diff > 0 ? ' '.repeat(diff) + str : str;
}

function formatOrderNo(id) {
  return `#${String(id).slice(-6).toUpperCase()}`;
}

function formatDateTime(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

function formatHM(d) {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

function formatWon(n) {
  return `${Number(n || 0).toLocaleString('ko-KR')}원`;
}

function buildItemLine(name, qty, price) {
  // [이름 (최대 24칸, 초과시 다음 줄)] [수량 6칸 우정렬] [금액 18칸 우정렬]
  const qtyStr = padLeft(String(qty), 6);
  const priceStr = padLeft(formatWon(price), 18);
  const nameMaxWidth = LINE_WIDTH - 6 - 18;

  if (visualWidth(name) <= nameMaxWidth) {
    return [padRight(name, nameMaxWidth) + qtyStr + priceStr];
  }

  // 이름이 길면 두 줄로 쪼개기
  const lines = [];
  let buf = '';
  for (const ch of name) {
    if (visualWidth(buf + ch) > nameMaxWidth) {
      lines.push(buf);
      buf = ch;
    } else {
      buf += ch;
    }
  }
  if (buf) lines.push(buf);

  const result = [];
  lines.forEach((line, idx) => {
    if (idx === lines.length - 1) {
      result.push(padRight(line, nameMaxWidth) + qtyStr + priceStr);
    } else {
      result.push(line);
    }
  });
  return result;
}

/**
 * 주문 한 건을 80mm 영수증으로 출력한다 (USB 직접).
 *
 * 에러 코드:
 *  - PRINTER_OFFLINE : USB 장치 없음/오픈 실패 (전원·케이블·VID/PID 확인)
 *  - PRINT_FAILED    : 전송 실패 (용지/커버/권한 등)
 */
async function printOrderReceipt(order) {
  // interface는 실제 사용하지 않지만 생성자 요구사항으로 dummy 값 전달
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: 'tcp://localhost:9999',
    characterSet: 'KOREA',
    removeSpecialCharacters: false,
    lineCharacter: '-',
  });

  const storeName = process.env.STORE_NAME || '';
  const storeBizNo = process.env.STORE_BIZ_NO || '';
  const storePhone = process.env.STORE_PHONE || '';
  const storeAddress = process.env.STORE_ADDRESS || '';

  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println(storeName);
  printer.bold(false);
  printer.setTextNormal();
  printer.newLine();

  printer.alignLeft();
  if (storeBizNo) printer.println(`사업자 번호: ${storeBizNo}`);
  if (storePhone) printer.println(`연락처: ${storePhone}`);
  if (storeAddress) printer.println(`주소: ${storeAddress}`);

  printer.drawLine();

  // 주문 메타
  printer.println(`주문번호: ${formatOrderNo(order._id)}`);
  printer.println(`일  시 : ${formatDateTime(order.createdAt || new Date())}`);

  if (order.tableNumber) {
    const seqTxt = order.sessionSeq ? ` (#${order.sessionSeq})` : '';
    printer.println(`테이블 : ${order.floor || 1}층 ${order.tableNumber}번${seqTxt}`);
  }

  // 취소 주문이면 강조
  if (order.status === 'cancelled') {
    printer.drawLine();
    printer.alignCenter();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.println('*** 취 소 됨 ***');
    printer.setTextNormal();
    printer.bold(false);
    printer.alignLeft();
  } else if (order.status && order.status !== 'served') {
    printer.println(`상  태 : ${STATUS_LABELS[order.status] || order.status}`);
  }

  printer.drawLine();

  // 헤더
  const nameCol = padRight('메뉴', LINE_WIDTH - 6 - 18);
  const qtyCol = padLeft('수량', 6);
  const priceCol = padLeft('금액', 18);
  printer.println(nameCol + qtyCol + priceCol);
  printer.drawLine();

  // 아이템
  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
    const lines = buildItemLine(item.name || '상품', item.quantity || 0, lineTotal);
    for (const line of lines) printer.println(line);
  }

  printer.drawLine();

  // 합계
  printer.alignRight();
  printer.bold(true);
  printer.setTextDoubleWidth();
  printer.println(`합계 ${formatWon(order.totalPrice)}`);
  printer.setTextNormal();
  printer.bold(false);
  printer.alignLeft();

  printer.newLine();
  printer.newLine();
  printer.newLine();
  printer.alignCenter();
  printer.println('방문해 주셔서 감사합니다:)');
  printer.newLine();
  printer.newLine();

  printer.cut();

  const buffer = printer.getBuffer();
  await sendBufferViaUsb(buffer);
}

/**
 * 세션(여러 주문을 묶은 것)을 한 장 영수증으로 출력한다.
 * session: { tableNumber, floor, startedAt, endedAt, orderCount, cancelledCount,
 *            items[{name,price,quantity}], totalPrice, cancelledTotal, orderIds[] }
 */
async function printSessionReceipt(session) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: 'tcp://localhost:9999',
    characterSet: 'KOREA',
    removeSpecialCharacters: false,
    lineCharacter: '-',
  });

  const storeName = process.env.STORE_NAME || '';
  const storeBizNo = process.env.STORE_BIZ_NO || '';
  const storePhone = process.env.STORE_PHONE || '';
  const storeAddress = process.env.STORE_ADDRESS || '';

  // 헤더
  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println(storeName);
  printer.bold(false);
  printer.setTextNormal();
  printer.newLine();

  printer.alignLeft();
  if (storeBizNo) printer.println(`사업자 번호: ${storeBizNo}`);
  if (storePhone) printer.println(`연락처: ${storePhone}`);
  if (storeAddress) printer.println(`주소: ${storeAddress}`);

  printer.drawLine();

  // 세션 메타
  const firstOrderNo = formatOrderNo(session.orderIds?.[0] || '');
  printer.println(`영수증번호 : ${firstOrderNo}`);

  // 계산 완료 시 비우기 시점, 아니면 첫 주문시간
  const timeValue = session.clearedAt || session.startedAt;
  printer.println(`시간 : ${formatDateTime(timeValue)}`);

  if (session.tableNumber) {
    printer.println(`테이블 : ${session.floor || 1}층 ${session.tableNumber}번`);
  }

  printer.drawLine();

  // 아이템 테이블
  const nameCol = padRight('메뉴', LINE_WIDTH - 6 - 18);
  const qtyCol = padLeft('수량', 6);
  const priceCol = padLeft('금액', 18);
  printer.println(nameCol + qtyCol + priceCol);
  printer.drawLine();

  const items = Array.isArray(session.items) ? session.items : [];
  if (items.length === 0) {
    printer.alignCenter();
    printer.println('(유효한 주문 없음)');
    printer.alignLeft();
  } else {
    for (const item of items) {
      const lines = buildItemLine(item.name || '상품', item.quantity || 0, Number(item.price || 0));
      for (const line of lines) printer.println(line);
    }
  }

  printer.drawLine();

  // 취소 안내 (합계에서 제외됨)
  if (session.cancelledCount > 0) {
    printer.alignLeft();
    printer.println(
      `취소 ${session.cancelledCount}건 제외 (${formatWon(session.cancelledTotal || 0)})`,
    );
    printer.drawLine();
  }

  // 합계 (취소 제외 금액)
  printer.alignRight();
  printer.bold(true);
  printer.setTextDoubleWidth();
  printer.println(`합계 ${formatWon(session.totalPrice)}`);
  printer.setTextNormal();
  printer.bold(false);
  printer.alignLeft();

  printer.newLine();
  printer.newLine();
  printer.newLine();
  printer.alignCenter();
  printer.println('방문해 주셔서 감사합니다:)');
  printer.newLine();
  printer.newLine();

  printer.cut();

  const buffer = printer.getBuffer();
  await sendBufferViaUsb(buffer);
}

/**
 * 테이블 QR 코드를 80mm 영수증으로 출력한다 (USB 직접).
 *
 * 에러 코드:
 *  - PRINTER_OFFLINE : USB 장치 없음/오픈 실패
 *  - PRINT_FAILED    : 전송 실패
 */
async function printTableQR(table, url) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: 'tcp://localhost:9999',
    characterSet: 'KOREA',
    removeSpecialCharacters: false,
    lineCharacter: '-',
  });

  const storeName = process.env.STORE_NAME || '';

  printer.alignCenter();

  if (storeName) {
    printer.bold(true);
    printer.println(storeName);
    printer.bold(false);
    printer.newLine();
  }

  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println(`${table.floor || 1}층 ${table.number}번`);
  printer.bold(false);
  printer.setTextNormal();
  printer.newLine();

  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println('휴대폰 카메라로 QR코드를 찍으면,');
  printer.println('주문 화면으로 이동합니다');
  printer.bold(false);
  printer.setTextNormal();
  printer.newLine();
  printer.newLine();
  printer.newLine();

  printer.printQR(url, {
    cellSize: 8,
    correction: 'H',
    model: 2,
  });

  printer.newLine();
  printer.println('감사합니다 :)');
  printer.newLine();
  printer.newLine();

  printer.cut();

  const buffer = printer.getBuffer();
  await sendBufferViaUsb(buffer);
}

module.exports = { printOrderReceipt, printSessionReceipt, printTableQR };
