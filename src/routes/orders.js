const express = require('express');
const Order = require('../models/Order');
const Table = require('../models/Table');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');
const { broadcast } = require('../websocket');
const { printOrderReceipt, printSessionReceipt } = require('../utils/receiptPrinter');
const { groupOrdersIntoSessions, finalizeSession } = require('../utils/sessionGrouping');

const router = express.Router();

// POST /api/orders — 주문 생성 (고객용, 인증 불필요)
router.post('/', async (req, res) => {
  try {
    const { tableId, tableNumber, floor, items, sessionStartedAt } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: '주문 항목이 없습니다' });
    }

    // 세션 검증 + 시퀀스 atomic 증가 (findOneAndUpdate 조건부 쓰기)
    const sessionStartDate = sessionStartedAt ? new Date(sessionStartedAt) : null;
    const tableFilter = { _id: tableId };
    if (sessionStartDate) {
      tableFilter.$or = [
        { lastClearedAt: null },
        { lastClearedAt: { $lte: sessionStartDate } },
      ];
    } else {
      tableFilter.lastClearedAt = null;
    }

    const table = await Table.findOneAndUpdate(
      tableFilter,
      { $inc: { currentSessionSeq: 1 } },
      { new: true }
    );

    if (!table) {
      // 존재 여부 확인해서 404 / 409 구분
      const exists = await Table.exists({ _id: tableId });
      if (!exists) {
        return res.status(404).json({ message: '테이블을 찾을 수 없습니다' });
      }
      return res.status(409).json({
        code: 'SESSION_EXPIRED',
        message: '테이블이 정리되었습니다. QR을 다시 스캔해주세요.',
      });
    }

    // 서버에서 최신 Product 가격으로 재계산 (클라 값은 신뢰하지 않음)
    const productIds = items.map((i) => i.productId || i.product).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const priceMap = new Map(products.map((p) => [String(p._id), p]));

    const safeItems = items.map((item) => {
      const pid = item.productId || item.product;
      const p = pid ? priceMap.get(String(pid)) : null;
      return {
        productId: pid,
        name: p?.name || item.name,
        price: p ? p.price : item.price,
        quantity: item.quantity,
      };
    });
    const totalPrice = safeItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const order = await Order.create({
      tableId,
      tableNumber,
      floor,
      sessionSeq: table.currentSessionSeq,
      items: safeItems,
      totalPrice,
    });

    // WebSocket으로 새 주문 알림 브로드캐스트
    broadcast('NEW_ORDER', order);

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: '주문 생성 실패', error: error.message });
  }
});

// GET /api/orders — 주문 목록 (인증 필요)
router.get('/', auth, async (req, res) => {
  try {
    const { status, excludeStatus, startDate, endDate, search, tableNumber, page, limit, servedBy } = req.query;
    const filter = {};

    if (status) {
      const statuses = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length === 1) {
        filter.status = statuses[0];
      } else if (statuses.length > 1) {
        filter.status = { $in: statuses };
      }
    } else if (excludeStatus) {
      filter.status = { $ne: excludeStatus };
    }

    if (servedBy) {
      filter.servedBy = servedBy;
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate + 'T00:00:00');
        filter.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate + 'T23:59:59.999');
        filter.createdAt.$lte = end;
      }
    }

    if (search) {
      filter['items.name'] = { $regex: search, $options: 'i' };
    }

    if (tableNumber) {
      filter.tableNumber = Number(tableNumber);
    }

    // 페이지네이션
    if (page && limit) {
      const p = Math.max(1, parseInt(page));
      const l = Math.min(100, Math.max(1, parseInt(limit)));
      const total = await Order.countDocuments(filter);
      const orders = await Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate('servedBy', 'name email');
      return res.json({ orders, total, page: p, limit: l });
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate('servedBy', 'name email');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: '주문 목록 조회 실패', error: error.message });
  }
});

// GET /api/orders/sessions — 세션 단위 주문내역 (인증 필요)
// 같은 테이블의 연속 주문들을 "비우기 경계"로 묶어서 반환
router.get('/sessions', auth, async (req, res) => {
  try {
    const { status, startDate, endDate, search, tableNumber, page, limit, servedBy } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate + 'T00:00:00');
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999');
    }
    if (search) filter['items.name'] = { $regex: search, $options: 'i' };
    if (tableNumber) filter.tableNumber = Number(tableNumber);
    if (servedBy) filter.servedBy = servedBy;

    const orders = await Order.find(filter)
      .sort({ createdAt: 1 })
      .populate('servedBy', 'name email')
      .lean();
    let sessions = groupOrdersIntoSessions(orders);

    // 세션에 clearedAt 부착 — "테이블 비우기 시점". 테이블별 가장 최근 세션에만,
    // lastClearedAt > 해당 세션 endedAt 인 경우에만 유효 (그 외 과거 세션은 null)
    if (sessions.length > 0) {
      const tableIds = [...new Set(sessions.map((s) => String(s.tableId)).filter(Boolean))];
      const tables = await Table.find({ _id: { $in: tableIds } })
        .select('_id lastClearedAt')
        .lean();
      const tableMap = new Map(tables.map((t) => [String(t._id), t]));

      // sessions는 startedAt DESC 정렬 — 테이블별 첫 등장이 가장 최근 세션
      const seenTables = new Set();
      for (const s of sessions) {
        const key = String(s.tableId);
        const table = tableMap.get(key);
        const isMostRecent = !seenTables.has(key);
        seenTables.add(key);

        const cleared = table?.lastClearedAt &&
          new Date(table.lastClearedAt) > new Date(s.endedAt);
        s.clearedAt = isMostRecent && cleared ? table.lastClearedAt : null;
      }
    }

    // 세션 단위 상태 필터
    if (status && status !== 'all') {
      sessions = sessions.filter((s) => {
        if (status === 'served') return s.status === 'served';
        if (status === 'cancelled') return s.cancelledCount > 0 && s.servedCount === 0 && s.activeCount === 0;
        if (['pending', 'accepted', 'preparing', 'ready', 'active'].includes(status)) {
          return s.activeCount > 0;
        }
        return true;
      });
    }

    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const total = sessions.length;
    const paginated = sessions.slice((p - 1) * l, p * l);

    // 세션 통계 (필터 적용 후 전체 기준)
    const summary = sessions.reduce(
      (acc, s) => {
        acc.sessionCount += 1;
        acc.orderCount += s.orderCount;
        acc.totalRevenue += s.totalPrice;
        acc.cancelledOrderCount += s.cancelledCount;
        return acc;
      },
      { sessionCount: 0, orderCount: 0, totalRevenue: 0, cancelledOrderCount: 0 },
    );
    summary.avgSession = summary.sessionCount > 0
      ? Math.round(summary.totalRevenue / summary.sessionCount)
      : 0;

    res.json({ sessions: paginated, total, page: p, limit: l, summary });
  } catch (error) {
    res.status(500).json({ message: '세션 목록 조회 실패', error: error.message });
  }
});

// POST /api/orders/print-session — 세션(여러 주문) 통합 영수증 출력
router.post('/print-session', auth, async (req, res) => {
  try {
    const { orderIds, withQR } = req.body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ message: 'orderIds가 필요합니다' });
    }

    const orders = await Order.find({ _id: { $in: orderIds } }).sort({ createdAt: 1 }).lean();
    if (orders.length === 0) {
      return res.status(404).json({ message: '주문을 찾을 수 없습니다' });
    }

    const uniqTables = new Set(orders.map((o) => String(o.tableId || '')));
    if (uniqTables.size > 1) {
      return res.status(400).json({ message: '다른 테이블 주문은 한 장에 합쳐 출력할 수 없습니다' });
    }

    const session = finalizeSession({
      tableId: orders[0].tableId,
      tableNumber: orders[0].tableNumber,
      floor: orders[0].floor,
      orders,
    });

    // 테이블 비우기 시점 조회 — 해당 테이블 lastClearedAt이 세션 endedAt 이후면 "계산 완료"
    const table = orders[0].tableId
      ? await Table.findById(orders[0].tableId).select('lastClearedAt').lean()
      : null;
    session.clearedAt =
      table?.lastClearedAt && new Date(table.lastClearedAt) > new Date(session.endedAt)
        ? table.lastClearedAt
        : null;

    await printSessionReceipt(session, { withQR: !!withQR });
    res.json({ ok: true });
  } catch (error) {
    const code = error.code || 'PRINT_FAILED';
    const statusCode = code === 'PRINTER_OFFLINE' || code === 'PRINTER_NOT_CONFIGURED' ? 503 : 500;
    const messages = {
      PRINTER_OFFLINE: '프린터를 찾을 수 없습니다. USB 연결을 확인해주세요',
      PRINTER_NOT_CONFIGURED: '프린터가 설정되지 않았습니다',
      PRINT_FAILED: '영수증 출력에 실패했습니다. 용지·커버·전원을 확인해주세요',
    };
    res.status(statusCode).json({
      code,
      message: messages[code] || '영수증 출력에 실패했습니다',
      error: error.message,
    });
  }
});

// GET /api/orders/table/:tableId — 테이블별 주문내역 (고객용, 인증 불필요)
// after 파라미터: 세션 만료 직후 "방금 내 주문" 조회용 (ExpiredScreen 경로)
// 없으면 table.lastClearedAt 이후를 반환 — 같은 테이블 모든 기기가 동일한 내역을 봄
router.get('/table/:tableId', async (req, res) => {
  try {
    const { after } = req.query;
    let startTime;
    if (after) {
      startTime = new Date(after);
    } else {
      const table = await Table.findById(req.params.tableId).select('lastClearedAt').lean();
      if (table?.lastClearedAt) {
        startTime = new Date(table.lastClearedAt);
      } else {
        startTime = new Date();
        startTime.setHours(0, 0, 0, 0);
      }
    }
    const orders = await Order.find({
      tableId: req.params.tableId,
      createdAt: { $gte: startTime },
    }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: '주문내역 조회 실패', error: error.message });
  }
});

// GET /api/orders/:id — 주문 상세
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate(
      'servedBy',
      'name email'
    );
    if (!order) {
      return res.status(404).json({ message: '주문을 찾을 수 없습니다' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: '주문 조회 실패', error: error.message });
  }
});

// POST /api/orders/:id/print — 영수증 출력 (인증 필요)
router.post('/:id/print', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: '주문을 찾을 수 없습니다' });
    }

    await printOrderReceipt(order, { withQR: !!req.body?.withQR });
    res.json({ ok: true });
  } catch (error) {
    const code = error.code || 'PRINT_FAILED';
    const statusCode = code === 'PRINTER_OFFLINE' || code === 'PRINTER_NOT_CONFIGURED' ? 503 : 500;
    const messages = {
      PRINTER_OFFLINE: '프린터를 찾을 수 없습니다. USB 연결과 프린터 이름을 확인해주세요',
      PRINTER_NOT_CONFIGURED: '프린터가 설정되지 않았습니다 (PRINTER_NAME)',
      PRINT_FAILED: '영수증 출력에 실패했습니다. 용지·커버·전원을 확인해주세요',
    };
    res.status(statusCode).json({
      code,
      message: messages[code] || '영수증 출력에 실패했습니다',
      error: error.message,
    });
  }
});

// PATCH /api/orders/:id/status — 주문 상태 변경 (인증 필요)
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const update = { status };
    // 전달완료 시점에 담당자/시각 기록
    if (status === 'served') {
      update.servedBy = req.user._id;
      update.servedAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    ).populate('servedBy', 'name email');

    if (!order) {
      return res.status(404).json({ message: '주문을 찾을 수 없습니다' });
    }

    // WebSocket으로 주문 상태 변경 브로드캐스트
    broadcast('ORDER_STATUS', order);

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: '주문 상태 변경 실패', error: error.message });
  }
});

module.exports = router;
