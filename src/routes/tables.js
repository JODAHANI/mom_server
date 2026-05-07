const express = require('express');
const Table = require('../models/Table');
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');
const { broadcast } = require('../websocket');
const { requestPrint } = require('../services/printBridge');

const router = express.Router();

// GET /api/tables — 테이블 목록 (인증 필요)
router.get('/', auth, async (req, res) => {
  try {
    const tables = await Table.find().sort({ floor: 1, number: 1 });
    res.json(tables);
  } catch (error) {
    res.status(500).json({ message: '테이블 목록 조회 실패', error: error.message });
  }
});

// POST /api/tables — 테이블 생성 (인증 필요, 토큰 자동 생성)
router.post('/', auth, async (req, res) => {
  try {
    const table = await Table.create(req.body);
    res.status(201).json(table);
  } catch (error) {
    res.status(500).json({ message: '테이블 생성 실패', error: error.message });
  }
});

// GET /api/tables/status — 테이블 현황 + 활성 주문 (인증 필요)
// 세션 윈도우 = (table.lastClearedAt, now]. 한 번도 비운 적 없으면 (오늘 자정, now].
// 자정 컷을 별도로 두지 않는 이유: 비우기 안 하고 자정 넘긴 잔여 세션이
// admin에서 silently 사라지면 직원이 비울 수가 없어 손님 화면에 영구 잔류함.
router.get('/status', auth, async (req, res) => {
  try {
    const tables = await Table.find().sort({ floor: 1, number: 1 }).lean();
    const activeStatuses = ['pending', 'accepted', 'preparing', 'ready'];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const startOf = (t) => (t.lastClearedAt ? new Date(t.lastClearedAt) : todayStart);

    // 모든 테이블 시작점 중 최솟값을 글로벌 컷으로 — DB 쿼리 1회.
    // 메모리에서 테이블별 startOf로 정밀 컷.
    const globalMin = tables.reduce(
      (min, t) => (startOf(t) < min ? startOf(t) : min),
      todayStart
    );

    const recentOrders = await Order.find({
      tableId: { $in: tables.map((t) => t._id) },
      createdAt: { $gt: globalMin },
    }).sort({ createdAt: -1 }).lean();

    const result = tables.map((table) => {
      const startTime = startOf(table);
      const tableOrders = recentOrders.filter(
        (o) =>
          String(o.tableId) === String(table._id) &&
          new Date(o.createdAt) > startTime
      );
      const activeOrders = tableOrders.filter((o) => activeStatuses.includes(o.status));
      const lastOrderTime = tableOrders.length > 0 ? tableOrders[tableOrders.length - 1].createdAt : null;

      return {
        ...table,
        activeOrders,
        allOrders: tableOrders,
        activeOrderCount: activeOrders.length,
        lastOrderTime,
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: '테이블 현황 조회 실패', error: error.message });
  }
});

// GET /api/tables/token/:token — QR 코드 스캔용 (공개)
router.get('/token/:token', async (req, res) => {
  try {
    const table = await Table.findOne({ token: req.params.token });
    if (!table) {
      return res.status(404).json({ message: '테이블을 찾을 수 없습니다' });
    }
    res.json(table);
  } catch (error) {
    res.status(500).json({ message: '테이블 조회 실패', error: error.message });
  }
});

// PUT /api/tables/:id — 테이블 수정 (인증 필요)
router.put('/:id', auth, async (req, res) => {
  try {
    const update = { ...req.body };

    // 비우기 시: lastClearedAt을 먼저 갱신해서 새 POST /orders를 차단한 뒤 활성 주문을 스윕
    if (update.lastClearedAt) {
      update.currentSessionSeq = 0;
    }

    const table = await Table.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (req.body.lastClearedAt && table) {
      const activeStatuses = ['pending', 'accepted', 'preparing', 'ready'];
      await Order.updateMany(
        { tableId: req.params.id, status: { $in: activeStatuses } },
        { status: 'served' }
      );
    }
    if (!table) {
      return res.status(404).json({ message: '테이블을 찾을 수 없습니다' });
    }

    // 비우기가 실행되면 해당 테이블 브라우저 세션에 만료 알림
    if (req.body.lastClearedAt) {
      broadcast('TABLE_CLEARED', {
        tableId: String(table._id),
        lastClearedAt: table.lastClearedAt,
      });
    }

    res.json(table);
  } catch (error) {
    res.status(500).json({ message: '테이블 수정 실패', error: error.message });
  }
});

// POST /api/tables/:id/print-qr — 테이블 QR 영수증 출력 (인증 필요)
router.post('/:id/print-qr', auth, async (req, res) => {
  try {
    const table = await Table.findById(req.params.id);
    if (!table) {
      return res.status(404).json({ message: '테이블을 찾을 수 없습니다' });
    }
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ message: 'url이 필요합니다' });
    }
    await requestPrint('table_qr', {
      table: table.toObject ? table.toObject() : table,
      url,
    });
    res.json({ message: 'QR 출력 완료' });
  } catch (error) {
    const code = error.code || 'PRINT_FAILED';
    const statusCode = code === 'PRINTER_OFFLINE' ? 503 : 500;
    const messages = {
      PRINTER_OFFLINE: '프린트 에이전트가 연결되어 있지 않습니다. 매장 PC의 에이전트를 확인해주세요',
      PRINT_FAILED: 'QR 출력에 실패했습니다',
    };
    res.status(statusCode).json({
      code,
      message: messages[code] || error.message || 'QR 출력 실패',
      error: error.message,
    });
  }
});

// DELETE /api/tables/:id — 테이블 삭제 (인증 필요)
router.delete('/:id', auth, async (req, res) => {
  try {
    const table = await Table.findByIdAndDelete(req.params.id);
    if (!table) {
      return res.status(404).json({ message: '테이블을 찾을 수 없습니다' });
    }
    res.json({ message: '테이블이 삭제되었습니다' });
  } catch (error) {
    res.status(500).json({ message: '테이블 삭제 실패', error: error.message });
  }
});

module.exports = router;
