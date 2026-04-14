const express = require('express');
const StaffCall = require('../models/StaffCall');
const Table = require('../models/Table');
const { auth } = require('../middleware/auth');
const { broadcast } = require('../websocket');

const router = express.Router();

// POST /api/staff-calls — 직원 호출 (고객용, 인증 불필요)
router.post('/', async (req, res) => {
  try {
    const { tableId, tableNumber, floor, sessionStartedAt } = req.body;

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

    const call = await StaffCall.create({ tableId, tableNumber, floor });

    // WebSocket으로 직원 호출 브로드캐스트
    broadcast('STAFF_CALL', call);

    res.status(201).json(call);
  } catch (error) {
    res.status(500).json({ message: '직원 호출 실패', error: error.message });
  }
});

// GET /api/staff-calls — 대기 중인 호출 목록 (인증 필요)
router.get('/', auth, async (req, res) => {
  try {
    const calls = await StaffCall.find({ status: 'pending' }).sort({ createdAt: -1 });
    res.json(calls);
  } catch (error) {
    res.status(500).json({ message: '호출 목록 조회 실패', error: error.message });
  }
});

// PATCH /api/staff-calls/:id/resolve — 호출 처리 완료 (인증 필요)
router.patch('/:id/resolve', auth, async (req, res) => {
  try {
    const call = await StaffCall.findByIdAndUpdate(
      req.params.id,
      { status: 'resolved' },
      { new: true }
    );
    if (!call) {
      return res.status(404).json({ message: '호출을 찾을 수 없습니다' });
    }
    res.json(call);
  } catch (error) {
    res.status(500).json({ message: '호출 처리 실패', error: error.message });
  }
});

module.exports = router;
