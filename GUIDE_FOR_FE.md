# Bầu Cua Server - Frontend Integration Guide

## 📋 Table of Contents
1. [Connection Setup](#connection-setup)
2. [Room Management](#room-management)
3. [Betting Events](#betting-events)
4. [Manual Mode Events](#manual-mode-events)
5. [Auto Mode Events](#auto-mode-events)
6. [Real-time Updates](#real-time-updates)

---

## 🔌 Connection Setup

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3125', {
  transports: ['websocket'],
  autoConnect: true
});

socket.on('connect', () => {
  console.log('Connected to server:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
```

---

## 🏠 Room Management

### 1. Create Room (Join as Host)

**Event:** `join_room`

**Payload:**
```javascript
const roomData = {
  roomId: "ROOM123",
  userData: {
    id: "user-uuid-123",        // UUID (persistent user ID)
    nickname: "Player1",
    avatar: "https://example.com/avatar.jpg"
  },
  roomConfig: {                  // Only required when creating new room
    name: "Phòng của tôi",
    maxPlayers: 15,
    startingBalance: 100000,
    dealerMode: "rotate",        // "fixed" | "rotate"
    playMode: "auto",            // "auto" | "manual" ⭐ NEW
    rotateRounds: 3,             // How many rounds before dealer rotates
    minBet: 5000,
    maxBet: 50000
  }
};

socket.emit('join_room', roomData, (response) => {
  if (response.success) {
    console.log('Room created/joined successfully!');
  }
});
```

**Response:** Callback returns `{ success: true }`

---

### 2. Join Existing Room

**Event:** `join_room`

**Payload:**
```javascript
const joinData = {
  roomId: "ROOM123",
  userData: {
    id: "user-uuid-456",
    nickname: "Player2",
    avatar: "https://example.com/avatar2.jpg"
  }
  // No roomConfig needed when joining existing room
};

socket.emit('join_room', joinData, (response) => {
  if (response.success) {
    console.log('Joined room successfully!');
  }
});
```

---

### 3. Start Game

**Event:** `start_game`

**Payload:**
```javascript
socket.emit('start_game', { 
  roomId: "ROOM123" 
});
```

**Behavior:**
- **Auto Mode:** Game loop starts automatically (betting → shaking → result → loop)
- **Manual Mode:** Starts betting phase immediately, dealer controls each transition

---

### 4. Leave Room

**Event:** `leave_room`

**Payload:**
```javascript
socket.emit('leave_room', { 
  roomId: "ROOM123",
  userId: "user-uuid-123"
});
```

---

## 🎲 Betting Events

### 1. Place Single Bet

**Event:** `place_bet`

**Payload:**
```javascript
const betData = {
  roomId: "ROOM123",
  door: "bau",              // "bau" | "cua" | "tom" | "ca" | "ga" | "nai"
  amount: 10000,
  nickname: "Player1",
  userId: "user-uuid-123"
};

socket.emit('place_bet', betData, (response) => {
  if (response.success) {
    console.log('Bet placed!');
    console.log('New balance:', response.newBalance);
    console.log('Door:', response.door);
    console.log('Amount:', response.amount);
  } else {
    console.error('Error:', response.message);
  }
});
```

**Success Response:**
```javascript
{
  success: true,
  newBalance: 90000,
  door: "bau",
  amount: 10000
}
```

**Error Response:**
```javascript
{
  success: false,
  message: "Số dư không đủ!"
}
```

---

### 2. Place Batch Bets (Multiple Doors)

**Event:** `place_bet_batch`

**Payload:**
```javascript
const batchBetData = {
  roomId: "ROOM123",
  doors: ["bau", "cua", "tom"],    // Array of doors
  amountPerDoor: 5000,              // Same amount for each door
  totalAmount: 15000,               // Total: 5000 × 3 = 15000
  userId: "user-uuid-123",
  nickname: "Player1"
};

socket.emit('place_bet_batch', batchBetData, (response) => {
  if (response.success) {
    console.log('Batch bets placed!');
    console.log('New balance:', response.newBalance);
  } else {
    console.error('Error:', response.message);
  }
});
```

**Success Response:**
```javascript
{
  success: true,
  newBalance: 85000
}
```

---

### 3. Cancel Bet

**Event:** `cancel_bet`

**Payload:**
```javascript
const cancelData = {
  roomId: "ROOM123",
  betId: "507f1f77bcf86cd799439011",  // MongoDB ObjectId from bet record
  userId: "user-uuid-123"
};

socket.emit('cancel_bet', cancelData, (response) => {
  if (response.success) {
    console.log('Bet cancelled!');
    console.log('Refunded balance:', response.newBalance);
  } else {
    console.error('Error:', response.message);
  }
});
```

**Success Response:**
```javascript
{
  success: true,
  newBalance: 100000,
  message: "Đã hủy cược thành công!"
}
```

**Notes:**
- Can only cancel during `betting` phase
- Can only cancel your own bets
- Only `pending` bets can be cancelled

---

## 🎮 Manual Mode Events

### Overview
In **manual mode**, the dealer controls game progression through these phases:

**Game Flow:**
1. Lobby (`waiting` status) → [User clicks Start Game]
2. `betting` → [Dealer: manual_start_shaking]
3. `shaking` → [Dealer: manual_show_result]
4. `result` → [Dealer: manual_next_round]
5. Back to `betting` (continuous loop)

Only the **current dealer** (`room.currentDealer.userId`) can trigger phase transitions.

---

### 1. Start Shaking (End Betting)

**Event:** `manual_start_shaking`

**Payload:**
```javascript
socket.emit('manual_start_shaking', {
  roomId: "ROOM123",
  userId: "dealer-uuid"
}, (response) => {
  if (response.success) {
    console.log('Shaking started - no more bets!');
  } else {
    console.error('Error:', response.message);
  }
});
```

**Success Response:**
```javascript
{
  success: true,
  message: "Đã bắt đầu lắc bát!"
}
```

**Conditions:**
- Room must be in `betting` status
- User must be the current dealer

---

### 2. Show Result (Open Bowl)

**Event:** `manual_show_result`

**Payload:**
```javascript
socket.emit('manual_show_result', {
  roomId: "ROOM123",
  userId: "dealer-uuid"
}, (response) => {
  if (response.success) {
    console.log('Result:', response.result);  // e.g., ["bau", "cua", "tom"]
  } else {
    console.error('Error:', response.message);
  }
});
```

**Success Response:**
```javascript
{
  success: true,
  result: ["bau", "cua", "tom"],
  message: "Đã mở bát!"
}
```

**Conditions:**
- Room must be in `shaking` status
- User must be the current dealer
- Automatically calculates and distributes winnings
- Handles dealer rotation if configured

---

### 3. Next Round (Start New Game)

**Event:** `manual_next_round`

**Payload:**
```javascript
socket.emit('manual_next_round', {
  roomId: "ROOM123",
  userId: "dealer-uuid"
}, (response) => {
  if (response.success) {
    console.log('Ready for new round!');
  } else {
    console.error('Error:', response.message);
  }
});
```

**Success Response:**
```javascript
{
  success: true,
  message: "Đã bắt đầu ván mới!"
}
```

**Conditions:**
- Room must be in `result` status
- User must be the current dealer
- Automatically resets room data and starts `betting` phase

**Notes:**
- This replaces the old `manual_start_betting` event
- Room loops directly back to betting phase (no waiting state)

---

## ⚙️ Auto Mode Events

In **auto mode**, the game runs automatically with timers:

### Timeline:
1. **Betting Phase** - 15s (configurable)
2. **Shaking Phase** - 6s
3. **Result Phase** - 10s
4. **Auto-restart** - Back to betting

### Listen to Timer Updates

**Event:** `timer_update`

```javascript
socket.on('timer_update', (timeLeft) => {
  console.log('Time remaining:', timeLeft);
  // Update your countdown UI
});
```

**Notes:**
- Timer only runs in auto mode
- No manual intervention needed
- Game automatically loops until all users are offline

---

## 📡 Real-time Updates

### 1. Room Updates

**Event:** `room_update`

```javascript
socket.on('room_update', (room) => {
  console.log('Room updated:', room);
  
  // Room structure:
  // {
  //   roomId: "ROOM123",
  //   status: "betting",           // "waiting" | "betting" | "shaking" | "result" | "finished"
  //   lastResult: ["bau", "cua"],  // Latest game result
  //   timeLeft: 15,                // Countdown (auto mode only)
  //   config: { ... },             // Room configuration
  //   currentDealer: {
  //     userId: "dealer-uuid",
  //     socketId: "socket-id",
  //     roundsLeft: 3
  //   },
  //   members: [
  //     {
  //       userId: "user-uuid",
  //       nickname: "Player1",
  //       avatar: "...",
  //       currentBalance: 95000,
  //       initBalance: 100000,
  //       isOnline: true
  //     }
  //   ],
  //   totalBets: {
  //     bau: 50000,
  //     cua: 30000,
  //     tom: 20000,
  //     ca: 0,
  //     ga: 0,
  //     nai: 0
  //   },
  //   history: [
  //     {
  //       roundId: 1,
  //       result: ["bau", "cua", "tom"],
  //       time: "2026-01-30T12:00:00.000Z",
  //       totalPot: 100000
  //     }
  //   ]
  // }
});
```

---

### 2. New Bet Notification

**Event:** `new_bet`

```javascript
socket.on('new_bet', (betData) => {
  console.log('New bet placed:', betData);
  
  // betData structure:
  // {
  //   userId: "user-uuid",
  //   nickname: "Player1",
  //   avatar: "https://...",
  //   door: "bau",
  //   amount: 10000,
  //   timestamp: "2026-01-30T12:00:00.000Z"
  // }
  
  // Use this to show bet animations or update UI
});
```

---

### 3. Bet Cancelled Notification

**Event:** `bet_cancelled`

```javascript
socket.on('bet_cancelled', (data) => {
  console.log('Bet cancelled:', data);
  
  // data structure:
  // {
  //   betId: "507f1f77bcf86cd799439011",
  //   userId: "user-uuid",
  //   door: "bau",
  //   amount: 10000
  // }
});
```

---

### 4. Phase Change (Manual Mode)

**Event:** `phase_change`

```javascript
socket.on('phase_change', (data) => {
  console.log('Game phase changed:', data);
  
  // data structure:
  // {
  //   phase: "betting",            // "waiting" | "betting" | "shaking" | "result"
  //   message: "Bắt đầu đặt cược!",
  //   result: ["bau", "cua"]       // Only present in result phase
  // }
});
```

---

### 5. Individual Game Result

**Event:** `game_result_individual`

```javascript
socket.on('game_result_individual', (data) => {
  console.log('Your result:', data);
  
  // data structure:
  // {
  //   winAmount: 30000,   // Total amount returned (including bet)
  //   netProfit: 10000    // Actual profit (winAmount - totalBet)
  // }
  
  if (data.netProfit > 0) {
    console.log('You won!', data.netProfit);
  } else if (data.netProfit < 0) {
    console.log('You lost!', Math.abs(data.netProfit));
  }
});
```

---

### 6. Dealer Result (Dealer Only)

**Event:** `dealer_result`

```javascript
socket.on('dealer_result', (data) => {
  console.log('Dealer profit/loss:', data);
  
  // data structure:
  // {
  //   profit: 50000   // Positive = profit, Negative = loss
  // }
});
```

---

### 7. New Dealer Announcement

**Event:** `new_dealer`

```javascript
socket.on('new_dealer', (data) => {
  console.log('New dealer:', data);
  
  // data structure:
  // {
  //   msg: "Đã đến lượt Player2 làm cái!",
  //   dealerId: "user-uuid-456"
  // }
});
```

---

## 🎯 Complete React Integration Example

```jsx
import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function BauCuaGame() {
  const [socket, setSocket] = useState(null);
  const [room, setRoom] = useState(null);
  const [userId] = useState('user-uuid-' + Math.random());
  
  useEffect(() => {
    const newSocket = io('http://localhost:3125');
    setSocket(newSocket);
    
    // Listen to room updates
    newSocket.on('room_update', (roomData) => {
      setRoom(roomData);
    });
    
    // Listen to new bets
    newSocket.on('new_bet', (betData) => {
      console.log('New bet:', betData);
      // Show animation
    });
    
    // Listen to phase changes (manual mode)
    newSocket.on('phase_change', (data) => {
      console.log('Phase:', data.phase, data.message);
    });
    
    // Listen to individual results
    newSocket.on('game_result_individual', (data) => {
      if (data.netProfit > 0) {
        alert(`You won ${data.netProfit}!`);
      }
    });
    
    return () => newSocket.close();
  }, []);
  
  const createRoom = () => {
    socket.emit('join_room', {
      roomId: 'ROOM123',
      userData: {
        id: userId,
        nickname: 'Player1',
        avatar: 'https://example.com/avatar.jpg'
      },
      roomConfig: {
        name: 'My Room',
        maxPlayers: 15,
        startingBalance: 100000,
        dealerMode: 'rotate',
        playMode: 'manual',  // or 'auto'
        rotateRounds: 3,
        minBet: 5000,
        maxBet: 50000
      }
    }, (response) => {
      if (response.success) {
        console.log('Room created!');
      }
    });
  };
  
  const placeBet = (door, amount) => {
    socket.emit('place_bet', {
      roomId: 'ROOM123',
      door,
      amount,
      nickname: 'Player1',
      userId
    }, (response) => {
      if (response.success) {
        console.log('Bet placed! New balance:', response.newBalance);
      } else {
        alert(response.message);
      }
    });
  };
  
  const startBetting = () => {
    // ❌ NOT NEEDED - start_game already starts betting phase
  };

  const startShaking = () => {
    socket.emit('manual_start_shaking', {
      roomId: 'ROOM123',
      userId
    });
  };
  
  const showResult = () => {
    socket.emit('manual_show_result', {
      roomId: 'ROOM123',
      userId
    }, (response) => {
      if (response.success) {
        console.log('Result:', response.result);
      }
    });
  };

  const nextRound = () => {
    socket.emit('manual_next_round', {
      roomId: 'ROOM123',
      userId
    }, (response) => {
      if (response.success) {
        console.log('New round started!');
      }
    });
  };

  return (
    <div>
      <h1>Bầu Cua Game</h1>
      
      {/* Room status */}
      {room && (
        <div>
          <p>Status: {room.status}</p>
          <p>Time left: {room.timeLeft}s</p>
        </div>
      )}
      
      {/* Control buttons */}
      <button onClick={createRoom}>Create Room</button>
      <button onClick={() => placeBet('bau', 10000)}>Bet on Bầu</button>
      
      {/* Manual mode controls (dealer only) */}
      {room?.currentDealer?.userId === userId && room?.config?.playMode === 'manual' && (
        <div>
          <button onClick={startShaking}>Start Shaking</button>
          <button onClick={showResult}>Show Result</button>
          <button onClick={nextRound}>Next Round</button>
        </div>
      )}
    </div>
  );
}

export default BauCuaGame;
```

---

## 📊 Room Status Flow

### Auto Mode:
```
waiting (lobby) → [start_game] → betting (15s) → shaking (6s) → result (10s) → betting (loop)
```

### Manual Mode:
```
waiting (lobby) → [start_game] → betting → [manual_start_shaking] → 
shaking → [manual_show_result] → result → [manual_next_round] → betting (loop)
```

**Key Differences:**
- `waiting` status is ONLY for the lobby (before game starts)
- In manual mode, game loops through `betting → shaking → result → betting`
- No need to go back to `waiting` between rounds

---

## ⚠️ Important Notes

1. **User ID**: Use persistent UUID for `userId`, not socket.id
2. **Reconnection**: If user reconnects with same `userId`, their balance is preserved
3. **Dealer Control**: Only `currentDealer.userId` can trigger manual mode events
4. **Waiting Status**: Only used for lobby before game starts
5. **Bet Timing**: Bets can only be placed during `betting` phase
6. **Cancel Timing**: Bets can only be cancelled during `betting` phase
7. **Auto-Loop**: Auto mode stops when all users are offline
8. **Manual Loop**: Manual mode loops `betting → shaking → result → betting` continuously
9. **Validation**: All events include error handling and validation

---

## 🐛 Error Messages

Common error responses:

```javascript
// Betting errors
{ success: false, message: "Số tiền cược phải lớn hơn 0!" }
{ success: false, message: "Không trong thời gian đặt cược!" }
{ success: false, message: "Số dư không đủ!" }
{ success: false, message: "Tiền cược từ 5000 - 50000" }

// Cancel errors
{ success: false, message: "Chỉ có thể hủy cược trong thời gian đặt cược!" }
{ success: false, message: "Bạn không có quyền hủy cược này!" }

// Manual mode errors
{ success: false, message: "Phòng không ở chế độ manual!" }
{ success: false, message: "Chỉ nhà cái mới có thể điều khiển!" }
{ success: false, message: "Không thể bắt đầu cược lúc này!" }
```

---

## 📞 Support

For issues or questions, please contact the backend team or check the server logs.

Server running on: `http://localhost:3125`
