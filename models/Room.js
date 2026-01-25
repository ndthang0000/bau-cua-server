const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  userId: String,
  nickname: String,
  avatar: String,
  currentBalance: Number,
  initBalance: Number, // Để tính toán lời/lỗ: current - init
  isOnline: { type: Boolean, default: true }, // Quan trọng: Đánh dấu trạng thái
  socketId: String
});

const RoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, required: true },
  hostId: String,
  status: { type: String, enum: ['waiting', 'shaking', 'betting', 'result', 'finished'], default: 'waiting' },
  // Bổ sung: Để Client biết cần đếm ngược bao nhiêu giây
  timeLeft: { type: Number, default: 0 },

  // Bổ sung: Kết quả ván vừa lắc xong để DiceBowl.js hiển thị ngay
  lastResult: { type: [String], default: [] },
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
  members: [memberSchema],
  history: [{
    roundId: String,
    result: [String],
    time: { type: Date, default: Date.now },
    totalPot: Number
  }],
  totalBets: {
    bau: { type: Number, default: 0 },
    cua: { type: Number, default: 0 },
    tom: { type: Number, default: 0 },
    ca: { type: Number, default: 0 },
    ga: { type: Number, default: 0 },
    nai: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // Tự xóa sau 24h
});

RoomSchema.index({ roomId: 1, status: 1 });

module.exports = mongoose.model('Room', RoomSchema);