const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

/**
 * JWT 인증 미들웨어
 * Authorization 헤더에서 토큰을 추출하고 검증한다
 */
const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: '인증 토큰이 필요합니다' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const admin = await Admin.findById(decoded.id).select('-password');
    if (!admin) {
      return res.status(401).json({ message: '유효하지 않은 토큰입니다' });
    }

    req.user = admin;
    next();
  } catch (error) {
    return res.status(401).json({ message: '인증에 실패했습니다' });
  }
};

/**
 * 관리자(owner) 전용 미들웨어
 * auth 미들웨어 이후에 사용해야 한다
 */
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: '관리자 권한이 필요합니다' });
  }
  next();
};

module.exports = { auth, adminOnly };
