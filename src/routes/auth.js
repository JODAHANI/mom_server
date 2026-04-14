const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const router = express.Router();

// JWT 토큰 생성 헬퍼
function generateToken(admin) {
  return jwt.sign(
    { id: admin._id, email: admin.email, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register — 관리자 등록
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: '이미 등록된 아이디입니다' });
    }

    const admin = await Admin.create({ email, password, name, role });
    const token = generateToken(admin);

    res.status(201).json({
      token,
      user: { id: admin._id, email: admin.email, name: admin.name, role: admin.role },
    });
  } catch (error) {
    res.status(500).json({ message: '회원가입 실패', error: error.message });
  }
});

// POST /api/auth/login — 로그인
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다' });
    }

    const token = generateToken(admin);

    res.json({
      token,
      user: { id: admin._id, email: admin.email, name: admin.name, role: admin.role },
    });
  } catch (error) {
    res.status(500).json({ message: '로그인 실패', error: error.message });
  }
});

module.exports = router;
