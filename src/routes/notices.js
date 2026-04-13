const express = require('express');
const Notice = require('../models/Notice');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notices — 공지사항 목록
router.get('/', async (req, res) => {
  try {
    const notices = await Notice.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(notices);
  } catch (error) {
    res.status(500).json({ message: '공지사항 목록 조회 실패', error: error.message });
  }
});

// POST /api/notices — 공지사항 생성 (인증 필요)
router.post('/', auth, async (req, res) => {
  try {
    const notice = await Notice.create(req.body);
    res.status(201).json(notice);
  } catch (error) {
    res.status(500).json({ message: '공지사항 생성 실패', error: error.message });
  }
});

// PUT /api/notices/:id — 공지사항 수정 (인증 필요)
router.put('/:id', auth, async (req, res) => {
  try {
    const notice = await Notice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!notice) {
      return res.status(404).json({ message: '공지사항을 찾을 수 없습니다' });
    }
    res.json(notice);
  } catch (error) {
    res.status(500).json({ message: '공지사항 수정 실패', error: error.message });
  }
});

// DELETE /api/notices/:id — 공지사항 삭제 (소프트 삭제, 인증 필요)
router.delete('/:id', auth, async (req, res) => {
  try {
    const notice = await Notice.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!notice) {
      return res.status(404).json({ message: '공지사항을 찾을 수 없습니다' });
    }
    res.json({ message: '공지사항이 삭제되었습니다', notice });
  } catch (error) {
    res.status(500).json({ message: '공지사항 삭제 실패', error: error.message });
  }
});

module.exports = router;
