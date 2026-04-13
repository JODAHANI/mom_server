const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    badges: [
      {
        type: String,
        enum: ['추천', '사장님 추천', '인기', '시그니처', 'BEST', 'NEW'],
      },
    ],
    stock: { type: Number, default: 0 },
    isSoldOut: { type: Boolean, default: false },
    showOnKiosk: { type: Boolean, default: true },
    showOnTable: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
