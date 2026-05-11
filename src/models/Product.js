const mongoose = require('mongoose');

// 종류 선택형 상품(소주/맥주 등): variants가 있으면 고객은 변형 시트에서 한 종류를 선택
// price 미설정(null/undefined)이면 상품 기본가 사용
const variantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: null },
    isSoldOut: { type: Boolean, default: false },
  },
  { _id: true }
);

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
    variants: { type: [variantSchema], default: [] },
    stock: { type: Number, default: 0 },
    isSoldOut: { type: Boolean, default: false },
    showOnKiosk: { type: Boolean, default: true },
    showOnTable: { type: Boolean, default: true },
    showOnAdminOrder: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
