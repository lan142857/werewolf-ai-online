const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function makeRoom(roomId) {
  return {
    id: roomId,
    hostId: null,
    players: {},
    createdAt: Date.now()
  };
}

function getRoomPlayers(room) {
  return Object.values(room.players).sort((a, b) => a.seat - b.seat);
}

function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit('roomState', {
    roomId,
    hostId: room.hostId,
    players: getRoomPlayers(room)
  });
}

function findPlayerByName(room, name) {
  return Object.values(room.players).find(p => p.name === name);
}

function findPlayerBySeat(room, seat) {
  return Object.values(room.players).find(p => p.seat === seat);
}
io.on('connection', (socket) => {
  console.log('连接:', socket.id);

  socket.on('joinRoom', ({ room, seat, name }) => {
    if (!room || !seat || !name) {
      socket.emit('joinError', '房间、座位、昵称不能为空');
      return;
    }

    if (!rooms[room]) {
      rooms[room] = makeRoom(room);
      rooms[room].hostId = socket.id;
    }

    const targetRoom = rooms[room];

    if (findPlayerByName(targetRoom, name)) {
      socket.emit('joinError', '昵称已被使用');
      return;
    }

    if (findPlayerBySeat(targetRoom, seat)) {
      socket.emit('joinError', '该座位已被占用');
      return;
    }

    if (socket.roomId && rooms[socket.roomId]) {
      delete rooms[socket.roomId].players[socket.id];
      broadcastRoomState(socket.roomId);
    }

    socket.roomId = room;
    socket.playerName = name;
    socket.seat = seat;

    targetRoom.players[socket.id] = {
      socketId: socket.id,
      name,
      seat,
      isHost: targetRoom.hostId === socket.id,
      joinedAt: Date.now()
    };

    socket.join(room);

    socket.emit('joinSuccess', {
      roomId: room,
      seat,
      name,
      isHost: targetRoom.hostId === socket.id
    });

    broadcastRoomState(room);

    io.to(room).emit('hostAnnounce', `${name} 加入了房间，座位 ${seat}`);
  });

  socket.on('publicChat', ({ text }) => {
    if (!socket.roomId || !rooms[socket.roomId]) return;
    if (!text || !String(text).trim()) return;

    const room = rooms[socket.roomId];
    const player = room.players[socket.id];

    io.to(socket.roomId).emit('publicMessage', {
      from: player ? player.name : '玩家',
      seat: player ? player.seat : null,
      text: String(text).trim(),
      time: Date.now()
    });
  });

  socket.on('privateChat', ({ toName, toSeat, text }) => {
    if (!socket.roomId || !rooms[socket.roomId]) return;
    if (!text || !String(text).trim()) return;

    const room = rooms[socket.roomId];
    const sender = room.players[socket.id];

    let target = null;
    if (toName) target = findPlayerByName(room, toName);
    if (!target && toSeat) target = findPlayerBySeat(room, toSeat);

    if (!target) {
      socket.emit('privateError', '找不到私聊目标');
      return;
    }

    io.to(target.socketId).emit('privateMessage', {
      from: sender ? sender.name : '玩家',
      fromSeat: sender ? sender.seat : null,
      text: String(text).trim(),
      time: Date.now()
    });

    socket.emit('privateMessage', {
      from: sender ? sender.name : '玩家',
      fromSeat: sender ? sender.seat : null,
      toName: target.name,
      toSeat: target.seat,
      text: String(text).trim(),
      time: Date.now(),
      self: true
    });
  });

  socket.on('hostAnnounce', ({ text }) => {
    if (!socket.roomId || !rooms[socket.roomId]) return;

    const room = rooms[socket.roomId];

    if (room.hostId !== socket.id) {
      socket.emit('hostError', '只有房主可以全体公告');
      return;
    }

    if (!text || !String(text).trim()) return;

    io.to(socket.roomId).emit('hostAnnounce', String(text).trim());
  });

  socket.on('disconnect', () => {
    console.log('断开:', socket.id);

    if (socket.roomId && rooms[socket.roomId]) {
      const room = rooms[socket.roomId];

      const player = room.players[socket.id];
      delete room.players[socket.id];

      if (room.hostId === socket.id) {
        const next = getRoomPlayers(room)[0];
        room.hostId = next ? next.socketId : null;
      }

      if (player) {
        io.to(socket.roomId).emit('hostAnnounce', `${player.name} 离开了房间`);
      }

      broadcastRoomState(socket.roomId);

      if (Object.keys(room.players).length === 0) {
        delete rooms[socket.roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`狼人杀联机服务器启动：http://0.0.0.0:${PORT}`);
});
