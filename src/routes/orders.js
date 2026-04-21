const express = require('express');
const Order = require('../models/Order');
const Table = require('../models/Table');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');
const { broadcast } = require('../websocket');

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
