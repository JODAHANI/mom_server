const mongoose = require('mongoose');

const staffCallSchema = new mongoose.Schema(
  {
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table' },
    tableNumber: { type: Number },
    floor: { type: Number },
    items: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['pending', 'resolved'],
      default: 'pending',
    },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StaffCall', staffCallSchema);
