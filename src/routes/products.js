const express = require('express');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/products — 상품 목록 조회
// 기본: 숨김 카테고리에 속한 상품 제외 (고객용). ?includeHidden=true 로 전체(관리자용) 조회.
router.get('/', async (req, res) => {
  try {
    const { category, search, channel, includeHidden } = req.query;
    const filter = { isActive: true };

    // 카테고리 필터
    if (category) {
      filter.categoryIds = category;
    }

    // 이름 검색
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    // 채널 필터 (키오스크 또는 테이블)
    if (channel === 'kiosk') {
      filter.showOnKiosk = true;
    } else if (channel === 'table') {
      filter.showOnTable = true;
    }

    // 숨김 카테고리 cascade: categoryIds 중 하나라도 숨김이면 제외
    if (!includeHidden) {
      const hidden = await Category.find(
        { isHidden: true, isActive: true },
        '_id'
      );
      const hiddenIds = hidden.map((c) => c._id);
      if (hiddenIds.length > 0) {
        // 특정 카테고리 요청이 숨김이면 빈 배열 반환
        if (
          category &&
          hiddenIds.some((id) => id.toString() === category.toString())
        ) {
          return res.json([]);
        }
        filter.categoryIds = category
          ? { $all: [category], $nin: hiddenIds }
          : { $nin: hiddenIds };
      }
    }

    const products = await Product.find(filter)
      .populate('categoryIds', 'name slug')
      .sort({ order: 1, createdAt: -1 });

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: '상품 목록 조회 실패', error: error.message });
  }
});

// PATCH /api/products/reorder — 상품 순서 변경 (인증 필요)
router.patch('/reorder', auth, async (req, res) => {
  try {
    const { ids } = req.body;
    const ops = ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { order: index } },
    }));
    await Product.bulkWrite(ops);
    res.json({ message: '순서가 변경되었습니다' });
  } catch (error) {
    res.status(500).json({ message: '순서 변경 실패', error: error.message });
  }
});

// GET /api/products/:id — 상품 상세 조회
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('categoryIds', 'name slug');
    if (!product) {
      return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: '상품 조회 실패', error: error.message });
  }
});

// POST /api/products — 상품 등록 (인증 필요)
router.post('/', auth, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: '상품 등록 실패', error: error.message });
  }
});

// PUT /api/products/:id — 상품 수정 (인증 필요)
router.put('/:id', auth, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!product) {
      return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
    }
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: '상품 수정 실패', error: error.message });
  }
});

// DELETE /api/products/:id — 상품 삭제 (소프트 삭제, 인증 필요)
router.delete('/:id', auth, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!product) {
      return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
    }
    res.json({ message: '상품이 삭제되었습니다', product });
  } catch (error) {
    res.status(500).json({ message: '상품 삭제 실패', error: error.message });
  }
});

// PATCH /api/products/:id/sold-out — 품절 토글 (인증 필요)
router.patch('/:id/sold-out', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
    }

    product.isSoldOut = !product.isSoldOut;
    await product.save();

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: '품절 상태 변경 실패', error: error.message });
  }
});

// PATCH /api/products/:id/toggle-channel — 채널 노출 토글 (인증 필요)
router.patch('/:id/toggle-channel', auth, async (req, res) => {
  try {
    const { channel } = req.body; // 'kiosk' 또는 'table'
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: '상품을 찾을 수 없습니다' });
    }

    if (channel === 'kiosk') {
      product.showOnKiosk = !product.showOnKiosk;
    } else if (channel === 'table') {
      product.showOnTable = !product.showOnTable;
    } else {
      return res.status(400).json({ message: 'channel은 kiosk 또는 table이어야 합니다' });
    }

    await product.save();
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: '채널 설정 변경 실패', error: error.message });
  }
});

module.exports = router;
