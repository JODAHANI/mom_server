const mongoose = require('mongoose');
const crypto = require('crypto');

const tableSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    floor: { type: Number, default: 1 },
    token: { type: String, unique: true },
    currentOrderCount: { type: Number, default: 0 },
    isOccupied: { type: Boolean, default: false },
    lastClearedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// 저장 전 토큰 자동 생성
tableSchema.pre('save', function () {
  if (!this.token) {
    this.token = crypto.randomBytes(16).toString('hex');
  }
});

module.exports = mongoose.model('Table', tableSchema);
