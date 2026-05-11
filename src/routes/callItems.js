const express = require('express');
const CallItem = require('../models/CallItem');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/call-items — 호출 항목 목록 (Public)
router.get('/', async (req, res) => {
  try {
    const items = await CallItem.find({ isActive: true }).sort({ order: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: '호출 항목 목록 조회 실패', error: error.message });
  }
});

// PATCH /api/call-items/reorder — 순서 변경 (Auth)
router.patch('/reorder', auth, async (req, res) => {
  try {
    const { ids } = req.body;
    const ops = ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { order: index } },
    }));
    await CallItem.bulkWrite(ops);
    const items = await CallItem.find({ isActive: true }).sort({ order: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: '순서 변경 실패', error: error.message });
  }
});

// POST /api/call-items — 호출 항목 생성 (Auth)
router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: '항목명은 필수입니다' });
    }
    const last = await CallItem.findOne({ isActive: true }).sort({ order: -1 });
    const order = last ? (last.order || 0) + 1 : 0;
    const item = await CallItem.create({ name: name.trim(), order });
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: '호출 항목 생성 실패', error: error.message });
  }
});

// PUT /api/call-items/:id — 호출 항목 수정 (Auth)
router.put('/:id', auth, async (req, res) => {
  try {
    const { name } = req.body;
    const update = {};
    if (typeof name === 'string') update.name = name.trim();
    const item = await CallItem.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!item) {
      return res.status(404).json({ message: '호출 항목을 찾을 수 없습니다' });
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: '호출 항목 수정 실패', error: error.message });
  }
});

// DELETE /api/call-items/:id — 호출 항목 삭제 (소프트, Auth)
router.delete('/:id', auth, async (req, res) => {
  try {
    const item = await CallItem.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!item) {
      return res.status(404).json({ message: '호출 항목을 찾을 수 없습니다' });
    }
    res.json({ message: '호출 항목이 삭제되었습니다', item });
  } catch (error) {
    res.status(500).json({ message: '호출 항목 삭제 실패', error: error.message });
  }
});

module.exports = router;
