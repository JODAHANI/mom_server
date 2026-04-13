const express = require('express');
const Table = require('../models/Table');
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');

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
router.get('/status', auth, async (req, res) => {
  try {
    const tables = await Table.find().sort({ floor: 1, number: 1 }).lean();
    const activeStatuses = ['pending', 'accepted', 'preparing', 'ready'];

    // 오늘 자정 (로컬 시간) 기준
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayOrders = await Order.find({ createdAt: { $gte: todayStart } }).sort({ createdAt: -1 }).lean();

    const result = tables.map((table) => {
      const tableOrders = todayOrders.filter(
        (o) =>
          String(o.tableId) === String(table._id) &&
          (!table.lastClearedAt || new Date(o.createdAt) > new Date(table.lastClearedAt))
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
    // 테이블 비우기 시 활성 주문을 served로 일괄 변경
    if (req.body.lastClearedAt) {
      const activeStatuses = ['pending', 'accepted', 'preparing', 'ready'];
      await Order.updateMany(
        { tableId: req.params.id, status: { $in: activeStatuses } },
        { status: 'served' }
      );
    }

    const table = await Table.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!table) {
      return res.status(404).json({ message: '테이블을 찾을 수 없습니다' });
    }
    res.json(table);
  } catch (error) {
    res.status(500).json({ message: '테이블 수정 실패', error: error.message });
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
