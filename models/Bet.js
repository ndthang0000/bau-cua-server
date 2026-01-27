const mongoose = require('mongoose');

const BetSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  roundId: { type: Number, required: true, index: true }, // ID của ván đấu hiện tại
  socketId: { type: String, required: true },
  userId: { type: String },
  nickname: String,
  door: { type: String, required: true }, // bau, cua, ca...
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'win', 'lose'], default: 'pending' },
  winAmount: { type: Number, default: 0 },
  results: [String], // Kết quả lắc bát
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Bet', BetSchema);