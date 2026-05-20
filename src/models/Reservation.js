const mongoose = require('mongoose');

const reservationItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
  },
  { _id: false }
);

const reservationSchema = new mongoose.Schema(
  {
    customerName: { type: String, default: '' },
    phone: { type: String, default: '' },
    reservationDate: { type: Date, required: true },
    reservationTime: { type: String, default: '' },
    adults: { type: Number, default: 0 },
    children: { type: Number, default: 0 },
    items: { type: [reservationItemSchema], default: [] },
    notes: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

reservationSchema.index({ reservationDate: 1, reservationTime: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);
