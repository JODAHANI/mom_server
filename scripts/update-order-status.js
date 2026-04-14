const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Order = require('../src/models/Order');

const suffix = (process.argv[2] || '').toLowerCase();
const newStatus = process.argv[3];

if (!suffix || !newStatus) {
  console.error('Usage: node update-order-status.js <id-suffix> <status>');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const orders = await Order.find().select('_id status tableNumber floor totalPrice createdAt');
  const matches = orders.filter((o) => String(o._id).toLowerCase().endsWith(suffix));

  if (matches.length === 0) {
    console.log(`No order found with _id ending in "${suffix}"`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(`Multiple matches (${matches.length}):`);
    matches.forEach((o) => console.log(' -', o._id, o.status, o.createdAt));
    process.exit(1);
  }

  const order = matches[0];
  console.log('Found:', {
    _id: String(order._id),
    currentStatus: order.status,
    table: `${order.floor}층 ${order.tableNumber}번`,
    total: order.totalPrice,
    createdAt: order.createdAt,
  });

  order.status = newStatus;
  await order.save();
  console.log(`Updated status → ${newStatus}`);

  await mongoose.disconnect();
})();
