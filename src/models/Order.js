const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    variantName: { type: String, default: '' },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, default: 1 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table' },
    tableNumber: { type: Number },
    floor: { type: Number },
    sessionSeq: { type: Number, default: 1 },
    items: [orderItemSchema],
    totalPrice: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'],
      default: 'pending',
    },
    servedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    servedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
