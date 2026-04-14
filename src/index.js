require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { setupWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);

// WebSocket 서버 설정
const wss = setupWebSocket(server);

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 라우트 마운트
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/tables', require('./routes/tables'));
app.use('/api/staff-calls', require('./routes/staffCalls'));
app.use('/api/notices', require('./routes/notices'));
app.use('/api/admins', require('./routes/admins'));
app.use('/api/upload', require('./routes/upload'));

// 헬스 체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: '테이블 홈 (Table Home)' });
});

// MongoDB 연결 및 서버 시작
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/table-home';

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('[MongoDB] 데이터베이스 연결 성공');
    server.listen(PORT, () => {
      console.log(`[Server] 테이블 홈 서버가 포트 ${PORT}에서 실행 중`);
    });
  })
  .catch((err) => {
    console.error('[MongoDB] 연결 실패:', err.message);
    process.exit(1);
  });

module.exports = { app, server, wss };
