const mongoose = require('mongoose');

const noticeSchema = new mongoose.Schema(
  {
    content: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notice', noticeSchema);
