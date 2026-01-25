/**
 * Tính toán tiền thắng thua sau khi mở bát
 * @param {Array} result - Mảng 3 linh vật [nai, cua, ca]
 * @param {Array} bets - Mảng cược [{userId, door, amount}]
 */
const calculateSettlement = (result, bets) => {
  const reports = {};

  bets.forEach(bet => {
    if (!reports[bet.userId]) {
      reports[bet.userId] = { userId: bet.userId, totalWin: 0, totalBet: 0 };
    }

    reports[bet.userId].totalBet += bet.amount;
    const matchCount = result.filter(r => r === bet.door).length;

    if (matchCount > 0) {
      // Tiền thắng = Gốc + (Gốc * số lần xuất hiện)
      reports[bet.userId].totalWin += bet.amount + (bet.amount * matchCount);
    }
  });

  return reports;
};

module.exports = { calculateSettlement };