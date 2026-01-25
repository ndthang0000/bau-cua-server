require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');

const Room = require('./models/Room');
const Bet = require('./models/Bet');
const { calculateSettlement } = require('./utils/gameLogic');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bau-cua')
  .then(() => console.log('✅ Đã kết nối MongoDB'))
  .catch(err => console.error('❌ Lỗi kết nối DB:', err));

// Lưu trữ cược tạm thời trong RAM để đạt tốc độ cao
const currentBetsByRoom = {};

io.on('connection', (socket) => {

  // 1. Tham gia phòng

  socket.on('join_room', async ({ roomId, userData, roomConfig }) => {
    console.log({ roomId, userData, roomConfig })

    let room = await Room.findOne({ roomId, status: { $ne: 'finished' } });

    if (!room && !roomConfig) {
      return socket.emit('error_msg', `Mã phòng [${roomId}] không tồn tại hoặc đã bị giải tán!`);
    }
    // 1. Khởi tạo phòng nếu chưa tồn tại (Dành cho chủ phòng)
    if (!room && roomConfig) {
      room = new Room({
        roomId,
        hostId: userData.id, // Nên dùng userData.id (UUID) thay vì socket.id để cố định host
        config: roomConfig,
        currentDealer: {
          socketId: socket.id,
          roundsLeft: roomConfig.rotateRounds,
          userId: userData.id
        },
        members: []
      });
    }

    if (!room) return; // Trường hợp vào phòng không tồn tại và không có config

    // 2. Kiểm tra xem User (UUID) đã có trong danh sách members chưa
    const existingMemberIndex = room.members.findIndex(m => m.userId === userData.id);

    if (existingMemberIndex !== -1) {
      // NẾU ĐÃ TỒN TẠI: Cập nhật socketId mới nhất
      // Việc này giúp xử lý trường hợp rớt mạng/F5 mà tiền vẫn giữ nguyên
      room.members[existingMemberIndex].socketId = socket.id;
      console.log(`User ${userData.nickname} re-joined. Updated socketId.`);
    } else {
      // NẾU CHƯA TỒN TẠI: Kiểm tra giới hạn người chơi trước khi thêm
      if (room.members.length >= room.config.maxPlayers) {
        return socket.emit('error_msg', 'Phòng đã đầy!');
      }

      const newMember = {
        socketId: socket.id,
        userId: userData.id,
        nickname: userData.nickname,
        avatar: userData.avatar,
        initBalance: room.config.startingBalance,
        currentBalance: room.config.startingBalance
      };

      room.members.push(newMember);
      console.log(`User ${userData.nickname} joined for the first time.`);
    }

    // 3. Cập nhật lại hostId nếu socketId của chủ phòng thay đổi (optional nhưng nên có)
    if (room.hostId === userData.id) {
      room.hostId = userData.id; // Luôn dùng UUID làm định danh Host cho bền vững
    }

    await room.save();
    socket.join(roomId);
    console.log(`User ${socket.id} đã vào phòng: ${roomId}`);
    // Gửi thông tin phòng mới nhất cho tất cả mọi người
    const socketsInRoom = await io.in(roomId).allSockets();
    console.log(`Phòng ${roomId} hiện có ${socketsInRoom.size} người:`, socketsInRoom);
    io.to(roomId).emit('room_update', room);
  });


  socket.on('leave_room', async ({ roomId, userId }) => {
    socket.leave(roomId);

    let room = await Room.findOne({ roomId });
    if (room) {
      // Xóa thành viên khỏi mảng members
      room.members = room.members.filter(m => m.userId !== userId);

      // Nếu phòng không còn ai, có thể xóa phòng hoặc giữ lại tùy bạn
      if (room.members.length === 0) {
        // await Room.deleteOne({ roomId }); 
      } else {
        await room.save();
        // Thông báo cho những người còn lại
        io.to(roomId).emit('room_update', room);
      }
    }
    console.log(`User ${userId} đã rời phòng ${roomId}`);
  });

  // 2. Bắt đầu xóc (Chuyển trạng thái)
  socket.on('start_shake', async (roomId) => {
    await Room.findOneAndUpdate({ roomId }, { status: 'shaking' });
    currentBetsByRoom[roomId] = []; // Reset cược ván mới
    io.to(roomId).emit('game_status', 'shaking');

    setTimeout(async () => {
      await Room.findOneAndUpdate({ roomId }, { status: 'betting' });
      io.to(roomId).emit('game_status', 'betting');
    }, 2000);
  });

  // 3. Đặt cược
  socket.on('place_bet', async ({ roomId, door, amount, nickname }) => {
    const room = await Room.findOne({ roomId });
    if (!room || room.status !== 'betting') return;

    // KIỂM TRA LUẬT PHÒNG
    if (amount < room.config.minBet || amount > room.config.maxBet) {
      return socket.emit('error_msg', `Tiền cược phải từ ${room.config.minBet} đến ${room.config.maxBet}`);
    }

    const member = room.members.find(m => m.socketId === socket.id);
    if (member.currentBalance < amount) {
      return socket.emit('error_msg', "Hết tiền rồi, cược ít thôi!");
    }

    // Lưu lệnh Bet vào Database (Bảng Bet đã tạo ở bước trước)
    const newBet = new Bet({
      roomId,
      roundId: `R-${room.roomId}-${room.history.length + 1}`,
      socketId: socket.id,
      nickname,
      door,
      amount
    });
    await newBet.save();

    // Trừ tiền member trong DB
    member.currentBalance -= amount;
    await room.save();

    io.to(roomId).emit('bet_update', { door, amount, socketId: socket.id, currentBalance: member.currentBalance });
  });

  // 4. Mở bát & Tính tiền (Lưu DB)
  socket.on('open_bowl', async (roomId) => {
    const room = await Room.findOne({ roomId });
    const currentRoundId = `R-${room.roomId}-${room.history.length + 1}`;

    // Random kết quả
    const result = getRandomResult(); // Hàm random 3 con

    // 1. Tìm tất cả lệnh bet của ván này
    const allBets = await Bet.find({ roomId, roundId: currentRoundId });

    // 2. Tính toán thắng thua và cập nhật từng lệnh Bet
    for (let bet of allBets) {
      const matchCount = result.filter(r => r === bet.door).length;
      if (matchCount > 0) {
        const winMoney = bet.amount + (bet.amount * matchCount);
        bet.status = 'win';
        bet.winAmount = winMoney;

        // Cộng tiền lại cho người chơi trong Room
        await Room.updateOne(
          { roomId, "members.socketId": bet.socketId },
          { $inc: { "members.$.currentBalance": winMoney } }
        );
      } else {
        bet.status = 'lose';
      }
      await bet.save();
    }

    // 3. Cập nhật lịch sử Room
    room.history.unshift({ roundId: currentRoundId, result });
    room.status = 'result';
    await room.save();

    io.to(roomId).emit('game_result', { result, history: room.history });



    if (room.config.dealerMode === 'rotate') {
      room.currentDealer.roundsLeft -= 1;

      if (room.currentDealer.roundsLeft <= 0) {
        // Tìm index của người đang làm cái hiện tại
        const currentIndex = room.members.findIndex(m => m.socketId === room.currentDealer.socketId);
        // Chuyển sang người tiếp theo (theo vòng tròn)
        const nextIndex = (currentIndex + 1) % room.members.length;

        room.currentDealer = {
          socketId: room.members[nextIndex].socketId,
          roundsLeft: room.config.rotateRounds,
          userId: room.members[nextIndex].userId
        };

        io.to(roomId).emit('new_dealer', {
          msg: `Đã đến lượt ${room.members[nextIndex].nickname} làm cái!`,
          dealerId: room.members[nextIndex].socketId
        });
      }
    }
    await room.save();

  });

  socket.on('get_rooms_info', async (roomIds) => {
    // Tìm các phòng chưa finished trong danh sách ID gửi lên
    const rooms = await Room.find({
      roomId: { $in: roomIds },
      status: { $ne: 'finished' }
    });

    const info = rooms.map(r => ({
      id: r.roomId,
      players: r.members.length,
      avatars: r.members.map(m => m.avatar).slice(0, 3),
      status: r.status
    }));

    socket.emit('rooms_info_res', info);
  });

  const handleRoomCleanup = async (roomId) => {
    const room = await Room.findOne({ roomId, status: { $ne: 'finished' } });

    if (room && room.members.length === 0) {
      // Thay vì xóa, chúng ta đánh dấu là đã kết thúc
      room.status = 'finished';
      room.finishedAt = new Date();
      await room.save();
      console.log(`Phòng ${roomId} đã được đánh dấu là FINISHED.`);
    }
  };

  socket.on('disconnect', async () => {
    const room = await Room.findOne({ "members.socketId": socket.id, status: { $ne: 'finished' } });
    if (room) {
      room.members = room.members.filter(m => m.socketId !== socket.id);
      await room.save();

      // Nếu hết người, đợi 1 phút rồi kiểm tra để kết thúc phòng
      if (room.members.length === 0) {
        setTimeout(() => handleRoomCleanup(room.roomId), 60000);
      }

      io.to(room.roomId).emit('room_update', room);
    }
  });
});

const PORT = process.env.PORT || 3125;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));