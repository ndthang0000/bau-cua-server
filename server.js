require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');

const Room = require('./models/Room');
const Bet = require('./models/Bet');
const { startGameLoop } = require('./utils/gameLogic');

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

  socket.on('join_room', async (data, callback) => {
    const { roomId, userData, roomConfig } = data

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
      room.members[existingMemberIndex].isOnline = true;
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
    room.markModified('members');
    await room.save();
    socket.join(roomId);
    console.log(`User ${socket.id} đã vào phòng: ${roomId}`);
    // Gửi thông tin phòng mới nhất cho tất cả mọi người
    const socketsInRoom = await io.in(roomId).allSockets();
    console.log(`Phòng ${roomId} hiện có ${socketsInRoom.size} người:`, socketsInRoom);
    // GỌI CALLBACK AN TOÀN
    if (typeof callback === 'function') {
      callback({ success: true });
    }
    io.to(roomId).emit('room_update', room);
  });

  socket.on('start_game', async ({ roomId }) => {

    startGameLoop(io, roomId);
    // Bắn tin cho cả làng chuyển sang màn hình Game
    console.log(`Phòng ${roomId} đã bắt đầu trò chơi.`);
    // Đồng thời cập nhật dữ liệu phòng mới nhất
  });

  socket.on('leave_room', async ({ roomId, userId }) => {
    socket.leave(roomId);

    let room = await Room.findOne({ roomId });
    if (room) {
      const member = room.members.find(m => m.userId === userId);

      if (member) {
        member.isOnline = false; // Vẫn giữ member trong mảng để hiện Leaderboard
        member.socketId = null;
      }
      room.markModified('members');
      await room.save();
      io.to(roomId).emit('room_update', room);
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
  socket.on('place_bet', async ({ roomId, door, amount, nickname, userId }, callback) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room || room.status !== 'betting') {
        return callback?.({ success: false, message: "Không trong thời gian đặt cược!" });
      }

      // 1. Kiểm tra luật phòng & số dư
      if (amount < room.config.minBet || amount > room.config.maxBet) {
        return callback?.({ success: false, message: `Tiền cược từ ${room.config.minBet} - ${room.config.maxBet}` });
      }

      const member = room.members.find(m => m.userId === userId); // Dùng UUID cho chắc chắn
      if (!member || member.currentBalance < amount) {
        return callback?.({ success: false, message: "Số dư không đủ!" });
      }

      // 2. Lưu lệnh Bet
      const currentRoundId = Array.isArray(room.history) ? room.history.length + 1 : 1;
      const newBet = new Bet({
        roomId,
        roundId: currentRoundId,
        socketId: socket.id,
        userId: member.userId,
        nickname,
        door,
        amount
      });
      await newBet.save();

      // 3. Cập nhật số dư thành viên & Tổng cược phòng (totalBets)
      member.currentBalance -= amount;

      // Khởi tạo nếu chưa có field này
      if (!room.totalBets) room.totalBets = {};
      room.totalBets[door] = (room.totalBets[door] || 0) + amount;

      await room.save();

      // 4. Thông báo cho cả làng cập nhật tổng cược
      io.to(roomId).emit('room_update', room);

      // 5. Trả về thành công cho người đặt
      callback?.({
        success: true,
        newBalance: member.currentBalance,
        door,
        amount
      });

    } catch (error) {
      console.error("Place bet error:", error);
      callback?.({ success: false, message: "Lỗi hệ thống khi đặt cược" });
    }
  });

  // server.js
  socket.on('place_bet_batch', async (data, callback) => {
    const { roomId, doors, amountPerDoor, totalAmount, userId, nickname } = data;

    try {
      // 1. Kiểm tra trạng thái phòng
      const room = await Room.findOne({ roomId });
      if (!room || room.status !== 'betting') {
        return callback?.({ success: false, message: "Không trong thời gian đặt cược!" });
      }

      // 2. Tìm thành viên và kiểm tra số dư tổng
      const member = room.members.find(m => m.userId === userId);
      if (!member || member.currentBalance < totalAmount) {
        return callback?.({ success: false, message: "Số dư không đủ để đặt tất cả các ô!" });
      }

      // 3. Chuẩn bị Update Object
      const updateQuery = {
        $inc: { "members.$.currentBalance": -totalAmount }
      };

      // Tăng totalBets cho từng cửa trong mảng
      doors.forEach(door => {
        updateQuery.$inc[`totalBets.${door}`] = amountPerDoor;
      });

      // 4. Cập nhật Database (Atomic)
      const updatedRoom = await Room.findOneAndUpdate(
        { roomId, "members.userId": userId },
        updateQuery,
        { new: true }
      );

      // 5. Lưu lịch sử cược (Dùng insertMany để lưu nhanh nhiều bản ghi)
      const currentRoundId = updatedRoom.history?.length + 1 || 1;
      const betRecords = doors.map(door => ({
        roomId,
        roundId: currentRoundId,
        socketId: socket.id,
        userId,
        nickname,
        door,
        amount: amountPerDoor
      }));
      await Bet.insertMany(betRecords);

      // 6. Đồng bộ toàn phòng
      io.to(roomId).emit('room_update', updatedRoom);

      // 7. Trả về kết quả
      callback?.({
        success: true,
        newBalance: updatedRoom.members.find(m => m.userId === userId).currentBalance
      });

    } catch (error) {
      console.error("Batch bet error:", error);
      callback?.({ success: false, message: "Lỗi hệ thống!" });
    }
  });

  // 4. Mở bát & Tính tiền (Lưu DB)
  socket.on('open_bowl', async (roomId) => {
    const room = await Room.findOne({ roomId });
    const currentRoundId = Array.isArray(room.history) ? room.history.length + 1 : 1;

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

  socket.on('get_recent_rooms_info', async ({ roomIds, userId }, callback) => {
    try {
  // 1. Tìm các phòng chưa kết thúc, nằm trong danh sách ID gửi lên
  // VÀ user này phải là một thành viên (để đảm bảo tính riêng tư)
    const rooms = await Room.find({
      roomId: { $in: roomIds },
      // status: { $ne: 'finished' },
      "members.userId": userId // Chỉ lấy những phòng user này từng tham gia
    }).select('roomId members status createdAt').sort({ createdAt: -1 }).limit(3);
      // 2. Format dữ liệu trả về
    const info = rooms.map(r => ({
      id: r.roomId,
      players: r.members.length,
      avatars: r.members.map(m => m.avatar).slice(0, 3),
      status: r.status
    }));

      // 3. Thực thi callback trả về cho Frontend
      callback({
        success: true,
        data: info
      });
    } catch (error) {
      console.error("Error fetching recent rooms:", error);
      callback({
        success: false,
        message: "Internal Server Error"
      });
    }
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

  // Sự kiện lấy lịch sử cược có phân trang và lọc
  socket.on('get_bet_history', async (params, callback) => {
    try {
      const { roomId, userId, filterType, selectedUserId, page = 1, limit = 10 } = params;

      let query = { roomId: roomId };

      // Lọc theo "Của tôi" hoặc "Cả phòng/Thành viên cụ thể"
      if (filterType === 'mine') {
        query.userId = userId;
      } else if (selectedUserId && selectedUserId !== 'all') {
        query.userId = selectedUserId;
      }

      const skip = (page - 1) * limit;

      // Truy vấn dữ liệu từ MongoDB
      const history = await Bet.find(query)
        .sort({ createdAt: -1 }) // Ván mới nhất lên đầu
        .skip(skip)
        .limit(limit);

      const totalCount = await Bet.countDocuments(query);

      callback({
        success: true,
        data: history,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: page
      });
    } catch (error) {
      console.error("Lỗi get_bet_history:", error);
      callback({ success: false, message: "Không thể lấy lịch sử cược" });
    }
  });
  socket.on('disconnect', async () => {
    const room = await Room.findOne({ "members.socketId": socket.id, status: { $ne: 'finished' } });
    if (room) {
      const member = room.members.find(m => m.socketId === socket.id);
      if (member) {
        member.isOnline = false; // Vẫn giữ member trong mảng để hiện Leaderboard
        member.socketId = null;
      }
      room.markModified('members');
      await room.save();

      // Nếu hết người, đợi 1 phút rồi kiểm tra để kết thúc phòng
      if (room.members.every(m => !m.isOnline)) {
        setTimeout(() => handleRoomCleanup(room.roomId), 60000);
      }

      io.to(room.roomId).emit('room_update', room);
    }
  });
});

const PORT = process.env.PORT || 3125;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));