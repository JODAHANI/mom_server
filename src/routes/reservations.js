const express = require('express');
const Reservation = require('../models/Reservation');
const { auth } = require('../middleware/auth');

const router = express.Router();

function dayBounds(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date(dateStr + 'T23:59:59.999');
  return { start, end };
}

// GET /api/reservations — 목록 (인증 필요)
router.get('/', auth, async (req, res) => {
  try {
    const { date, startDate, endDate } = req.query;
    const filter = { isActive: true };

    if (date) {
      const { start, end } = dayBounds(date);
      filter.reservationDate = { $gte: start, $lte: end };
    } else if (startDate || endDate) {
      filter.reservationDate = {};
      if (startDate) filter.reservationDate.$gte = new Date(startDate + 'T00:00:00');
      if (endDate) filter.reservationDate.$lte = new Date(endDate + 'T23:59:59.999');
    }

    const reservations = await Reservation.find(filter)
      .populate('createdBy', '-password')
      .sort({ reservationDate: 1, reservationTime: 1, createdAt: 1 })
      .lean();
    res.json(reservations);
  } catch (error) {
    res.status(500).json({ message: '예약 목록 조회 실패', error: error.message });
  }
});

// GET /api/reservations/by-month?year=YYYY&month=M — 월별 일자별 카운트
router.get('/by-month', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);
    if (!year || !month) {
      return res.status(400).json({ message: 'year/month 쿼리가 필요합니다' });
    }
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const reservations = await Reservation.find({
      isActive: true,
      reservationDate: { $gte: start, $lte: end },
    })
      .select('reservationDate adults children')
      .lean();

    const byDay = {};
    for (const r of reservations) {
      const d = new Date(r.reservationDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!byDay[key]) byDay[key] = { count: 0, people: 0 };
      byDay[key].count += 1;
      byDay[key].people += (r.adults || 0) + (r.children || 0);
    }
    res.json({ year, month, byDay });
  } catch (error) {
    res.status(500).json({ message: '월별 예약 조회 실패', error: error.message });
  }
});

// GET /api/reservations/:id — 상세
router.get('/:id', auth, async (req, res) => {
  try {
    const reservation = await Reservation.findById(req.params.id)
      .populate('createdBy', '-password')
      .lean();
    if (!reservation || !reservation.isActive) {
      return res.status(404).json({ message: '예약을 찾을 수 없습니다' });
    }
    res.json(reservation);
  } catch (error) {
    res.status(500).json({ message: '예약 조회 실패', error: error.message });
  }
});

// POST /api/reservations — 생성
router.post('/', auth, async (req, res) => {
  try {
    const body = { ...req.body, createdBy: req.user._id };
    if (body.reservationDate && typeof body.reservationDate === 'string') {
      body.reservationDate = new Date(body.reservationDate + 'T00:00:00');
    }
    const reservation = await Reservation.create(body);
    res.status(201).json(reservation);
  } catch (error) {
    res.status(500).json({ message: '예약 생성 실패', error: error.message });
  }
});

// PUT /api/reservations/:id — 수정
router.put('/:id', auth, async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.reservationDate && typeof body.reservationDate === 'string') {
      body.reservationDate = new Date(body.reservationDate + 'T00:00:00');
    }
    const reservation = await Reservation.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    });
    if (!reservation) {
      return res.status(404).json({ message: '예약을 찾을 수 없습니다' });
    }
    res.json(reservation);
  } catch (error) {
    res.status(500).json({ message: '예약 수정 실패', error: error.message });
  }
});

// DELETE /api/reservations/:id — soft delete
router.delete('/:id', auth, async (req, res) => {
  try {
    const reservation = await Reservation.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!reservation) {
      return res.status(404).json({ message: '예약을 찾을 수 없습니다' });
    }
    res.json({ message: '예약이 삭제되었습니다', reservation });
  } catch (error) {
    res.status(500).json({ message: '예약 삭제 실패', error: error.message });
  }
});

module.exports = router;
