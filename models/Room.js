const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, required: true },
  hostId: String,
  status: { type: String, enum: ['waiting', 'shaking', 'betting', 'result', 'finished'], default: 'waiting' },
  config: {
    name: { type: String, default: 'Phòng Bầu Cua' },
    maxPlayers: { type: Number, default: 15 },
    startingBalance: { type: Number, default: 100000 },
    dealerMode: { type: String, enum: ['fixed', 'rotate'], default: 'rotate' },
    rotateRounds: { type: Number, default: 3 },
    minBet: { type: Number, default: 5000 },
    maxBet: { type: Number, default: 50000 },
  },
  currentDealer: {
    socketId: String,
    userId: String,
    roundsLeft: Number // Số ván còn lại trước khi đổi cái
  },
  members: [{
    userId: String,
    nickname: String,
    avatar: String,
    socketId: String,
    initBalance: Number,      // Vốn lúc vào phòng
    currentBalance: Number,   // Tiền hiện tại trong phòng
  }],
  history: [{
    roundId: String,
    result: [String],
    time: { type: Date, default: Date.now },
    totalPot: Number
  }],
  createdAt: { type: Date, default: Date.now, expires: 86400 } // Tự xóa sau 24h
});

RoomSchema.index({ roomId: 1, status: 1 });

module.exports = mongoose.model('Room', RoomSchema);