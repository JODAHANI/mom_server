const express = require('express');
const Admin = require('../models/Admin');
const { auth } = require('../middleware/auth');

const router = express.Router();

// 모든 라우트에 인증 필요
router.use(auth);

// GET /api/admins — 관리자 목록
router.get('/', async (req, res) => {
  try {
    const admins = await Admin.find().select('-password').sort({ createdAt: -1 }).lean();
    res.json(admins);
  } catch (error) {
    res.status(500).json({ message: '관리자 목록 조회 실패', error: error.message });
  }
});

// POST /api/admins — 관리자 생성
router.post('/', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: '아이디와 비밀번호는 필수입니다' });
    }

    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: '이미 등록된 아이디입니다' });
    }

    const admin = await Admin.create({ email, password, name, role });

    res.status(201).json({
      _id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      createdAt: admin.createdAt,
    });
  } catch (error) {
    res.status(500).json({ message: '관리자 생성 실패', error: error.message });
  }
});

// PUT /api/admins/:id — 관리자 수정
router.put('/:id', async (req, res) => {
  try {
    const { name, role, password } = req.body;
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({ message: '관리자를 찾을 수 없습니다' });
    }

    if (name !== undefined) admin.name = name;
    if (role !== undefined) admin.role = role;
    if (password) admin.password = password;

    await admin.save();

    res.json({
      _id: admin._id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      createdAt: admin.createdAt,
    });
  } catch (error) {
    res.status(500).json({ message: '관리자 수정 실패', error: error.message });
  }
});

// DELETE /api/admins/:id — 관리자 삭제
router.delete('/:id', async (req, res) => {
  try {
    // 자기 자신 삭제 방지
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: '자기 자신은 삭제할 수 없습니다' });
    }

    const admin = await Admin.findByIdAndDelete(req.params.id);
    if (!admin) {
      return res.status(404).json({ message: '관리자를 찾을 수 없습니다' });
    }

    res.json({ message: '관리자가 삭제되었습니다' });
  } catch (error) {
    res.status(500).json({ message: '관리자 삭제 실패', error: error.message });
  }
});

module.exports = router;
