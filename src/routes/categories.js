const express = require('express');
const Category = require('../models/Category');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/categories — 카테고리 목록
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ order: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: '카테고리 목록 조회 실패', error: error.message });
  }
});

// PATCH /api/categories/reorder — 카테고리 순서 변경 (인증 필요)
router.patch('/reorder', auth, async (req, res) => {
  try {
    const { ids } = req.body;
    const ops = ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { order: index } },
    }));
    await Category.bulkWrite(ops);
    const categories = await Category.find({ isActive: true }).sort({ order: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: '순서 변경 실패', error: error.message });
  }
});

// GET /api/categories/:id — 카테고리 상세
router.get('/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: '카테고리를 찾을 수 없습니다' });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: '카테고리 조회 실패', error: error.message });
  }
});

// POST /api/categories — 카테고리 생성 (인증 필요)
router.post('/', auth, async (req, res) => {
  try {
    const category = await Category.create(req.body);
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ message: '카테고리 생성 실패', error: error.message });
  }
});

// PUT /api/categories/:id — 카테고리 수정 (인증 필요)
router.put('/:id', auth, async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!category) {
      return res.status(404).json({ message: '카테고리를 찾을 수 없습니다' });
    }
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: '카테고리 수정 실패', error: error.message });
  }
});

// DELETE /api/categories/:id — 카테고리 삭제 (소프트 삭제, 인증 필요)
router.delete('/:id', auth, async (req, res) => {
  try {
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({ message: '카테고리를 찾을 수 없습니다' });
    }
    res.json({ message: '카테고리가 삭제되었습니다', category });
  } catch (error) {
    res.status(500).json({ message: '카테고리 삭제 실패', error: error.message });
  }
});

module.exports = router;
