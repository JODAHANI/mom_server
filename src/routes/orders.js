const express = require('express');
const Order = require('../models/Order');
const Table = require('../models/Table');
const { auth } = require('../middleware/auth');
const { broadcast } = require('../websocket');

const router = express.Router();

// POST /api/orders — 주문 생성 (고객용, 인증 불필요)
router.post('/', async (req, res) => {
  try {
    const { tableId, tableNumber, floor, items, sessionStartedAt } = req.body;

    const table = await Table.findById(tableId);
    if (!table) {
      return res.status(404).json({ message: '테이블을 찾을 수 없습니다' });
    }
    if (
      table.lastClearedAt &&
      (!sessionStartedAt ||
        new Date(table.lastClearedAt).getTime() > new Date(sessionStartedAt).getTime())
    ) {
      return res.status(409).json({
        code: 'SESSION_EXPIRED',
        message: '테이블이 정리되었습니다. QR을 다시 스캔해주세요.',
      });
    }

    // 총 금액 계산
    const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const order = await Order.create({
      tableId,
      tableNumber,
      floor,
      items,
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
    const { status, excludeStatus, startDate, endDate, search, tableNumber, page, limit } = req.query;
    const filter = {};

    if (status) {
      filter.status = status;
    } else if (excludeStatus) {
      filter.status = { $ne: excludeStatus };
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
        .limit(l);
      return res.json({ orders, total, page: p, limit: l });
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: '주문 목록 조회 실패', error: error.message });
  }
});

// GET /api/orders/table/:tableId — 테이블별 주문내역 (고객용, 인증 불필요)
router.get('/table/:tableId', async (req, res) => {
  try {
    const { after } = req.query;
    let startTime;
    if (after) {
      startTime = new Date(after);
    } else {
      startTime = new Date();
      startTime.setHours(0, 0, 0, 0);
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
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: '주문을 찾을 수 없습니다' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: '주문 조회 실패', error: error.message });
  }
});

// PATCH /api/orders/:id/status — 주문 상태 변경 (인증 필요)
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

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
