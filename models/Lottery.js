const mongoose = require('mongoose');

const LotterySchema = new mongoose.Schema({
    drawId: { type: String, required: true, unique: true },
    numbers: { type: [String], required: true },
    drawTime: { type: String, required: true }
}, { timestamps: true });  // Tự động thêm createdAt & updatedAt

const Lottery = mongoose.model('Lottery', LotterySchema);

module.exports = Lottery; 