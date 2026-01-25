const Bet = require("../models/Bet");
const Room = require("../models/Room");

const GAME_TIMES = {
  shaking: 8, // 10s lắc bát
  betting: 15, // 15s đặt cược
  result: 10    // 10s hiển thị kết quả và trả thưởng
};

async function updateStatus(io, roomId, status, time, result = null) {
  const room = await Room.findOneAndUpdate(
    { roomId },
    { status, lastResult: result, timeLeft: time },
    { new: true }
  );
  io.to(roomId).emit('room_update', room);
}

// gameLogic.js
async function calculateRewards(roomId, roundId, finalResult) {
  const room = await Room.findOne({ roomId });
  if (!room) return null;

  const bets = await Bet.find({ roomId, roundId, status: 'pending' });
  let totalDealerProfit = 0;
  const userChanges = {}; // Cấu trúc: { socketId: { winAmount: 100, isWin: true } }

  for (const bet of bets) {
    const matchCount = finalResult.filter(r => r === bet.door).length;
    // Khởi tạo object cho user nếu chưa có
    if (!userChanges[bet.socketId]) {
      userChanges[bet.socketId] = { winAmount: 0, totalBet: 0 };
    }
    userChanges[bet.socketId].totalBet += bet.amount;

    if (matchCount > 0) {
      const winProfit = bet.amount * matchCount;
      const totalReturn = bet.amount + winProfit;
      bet.winAmount = totalReturn;
      bet.status = 'win';

      totalDealerProfit -= winProfit;
      userChanges[bet.socketId].winAmount += totalReturn;
    } else {
      bet.winAmount = 0;
      bet.status = 'lose';
      totalDealerProfit += bet.amount;
    }
    await bet.save();
  }

  // Cập nhật members
  room.members = room.members.map(member => {
    if (userChanges[member.socketId]) {
      member.currentBalance += userChanges[member.socketId].winAmount;
    }
    // Nhà cái ăn/thua
    if (member.userId === room.currentDealer.userId) {
      member.currentBalance += totalDealerProfit;
    }
    return member;
  });
  room.history.unshift({ roundId, result: finalResult, totalPot: Object.values(room.totalBets).reduce((a, b) => a + b, 0) });
  room.lastResult = finalResult;
  room.markModified('members');
  room.markModified('history');
  await room.save();

  // TRẢ VỀ userChanges ĐỂ DÙNG Ở startGameLoop
  return { room, userChanges, totalDealerProfit };
}

// server.js (Logic: Betting -> Shaking -> Result)

// gameLogic.js

const startGameLoop = async (io, roomId) => {
  let room = await Room.findOne({ roomId });

  // Kiểm tra: Chỉ chạy nếu đang ở trạng thái có thể bắt đầu
  if (!room || !['waiting', 'result'].includes(room.status)) return;

  const currentRoundId = (room.history ? room.history.length : 0) + 1;

  // --- RESET DỮ LIỆU VÁN MỚI ---
  // Xóa kết quả cũ, reset cược để chuẩn bị cho phase Betting
  room.status = 'betting';
  room.lastResult = [];
  room.totalBets = { bau: 0, cua: 0, tom: 0, ca: 0, ga: 0, nai: 0 };
  room.timeLeft = GAME_TIMES.betting;
  await room.save();

  io.to(roomId).emit('room_update', room);

  // --- PHASE 1: BETTING (15s) ---
  let timeLeft = GAME_TIMES.betting;
  const timer = setInterval(async () => {
    timeLeft--;
    io.to(roomId).emit('timer_update', timeLeft);

    if (timeLeft <= 0) {
      clearInterval(timer);

      // --- PHASE 2: SHAKING (10s) ---
      await updateStatus(io, roomId, 'shaking', GAME_TIMES.shaking);

      setTimeout(async () => {
        // --- PHASE 3: RESULT ---
        const results = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];
        const finalResult = [
          results[Math.floor(Math.random() * 6)],
          results[Math.floor(Math.random() * 6)],
          results[Math.floor(Math.random() * 6)]
        ];

        // 1. Tính tiền & Lưu lịch sử (hàm calculateRewards của bạn)
        const { room: updatedRoom, userChanges, totalDealerProfit } = await calculateRewards(roomId, currentRoundId, finalResult);
        Object.keys(userChanges).forEach(socketId => {
          const change = userChanges[socketId];
          io.to(socketId).emit('game_result_individual', {
            winAmount: change.winAmount,
            netProfit: change.winAmount - change.totalBet // Tiền lãi thực tế
          });
        });
        // Báo tin cho Nhà cái
        const dealerSocketId = updatedRoom.currentDealer.socketId;
        io.to(dealerSocketId).emit('dealer_result', {
          profit: totalDealerProfit
        });
        // 2. Cập nhật status Result để nắp bát bay ra
        await updateStatus(io, roomId, 'result', GAME_TIMES.result, finalResult);

        // --- BƯỚC QUAN TRỌNG: TỰ ĐỘNG LOOP VÁN MỚI SAU 5 GIÂY ---
        setTimeout(() => {
          console.log(`--- Tự động bắt đầu ván mới cho phòng ${roomId} ---`);
          startGameLoop(io, roomId); // Đệ quy gọi lại chính nó
        }, GAME_TIMES.result * 1000);

      }, GAME_TIMES.shaking * 1000);
    }
  }, 1000);
};

module.exports = {
  startGameLoop,
}