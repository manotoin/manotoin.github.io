const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const roomManager = require('./room-manager');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', game: 'Hokm Online', version: '1.0.0' });
});

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('create_room', ({ name }, cb) => {
    try {
      const room = roomManager.createRoom(name || 'Player', socket.id);
      socket.join(room.id);
      socket.data.playerId = room.players[0].id;
      socket.data.roomId = room.id;
      socket.data.role = 'player';
      cb({ ok: true, room: roomManager.publicState(room, room.players[0].id), playerId: room.players[0].id });
      io.to(room.id).emit('room_updated', roomManager.publicState(room));
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('join_room', ({ code, name, asRole }, cb) => {
    try {
      const room = roomManager.getByCode(code);
      if (!room) return cb({ ok: false, error: 'Room not found' });

      let result;
      if (asRole === 'supervisor') result = roomManager.joinSupervisor(room.id, name || 'ناظر', socket.id);
      else if (asRole === 'spectator') result = roomManager.joinSpectator(room.id, name || 'بیننده', socket.id);
      else result = roomManager.joinPlayer(room.id, name || 'Player', socket.id);

      if (!result.ok) return cb(result);

      socket.join(room.id);
      socket.data.playerId = result.player.id;
      socket.data.roomId = room.id;
      socket.data.role = result.player.role;

      cb({ ok: true, room: roomManager.publicState(room, result.player.id), playerId: result.player.id });
      io.to(room.id).emit('room_updated', roomManager.publicState(room));

      if (room.players.length === 4) {
        io.to(room.id).emit('ready_to_start', { msg: '۴ بازیکن کامل شد. می‌توانید بازی را شروع کنید.' });
      }
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('start_match', (cb) => {
    const roomId = socket.data.roomId;
    if (!roomId) return cb({ ok: false, error: 'Not in room' });
    const result = roomManager.startMatch(roomId);
    if (!result.ok) return cb(result);

    const room = result.room;
    room.players.forEach(p => {
      io.to(p.socketId).emit('room_updated', roomManager.publicState(room, p.id));
    });
    io.to(roomId).emit('room_updated', roomManager.publicState(room));
    cb({ ok: true });
  });

  socket.on('choose_trump', ({ trump }, cb) => {
    const { roomId, playerId } = socket.data;
    if (!roomId || !playerId) return cb({ ok: false, error: 'Not in room' });
    const result = roomManager.chooseTrump(roomId, playerId, trump);
    if (!result.ok) return cb(result);

    const room = result.room;
    room.players.forEach(p => {
      io.to(p.socketId).emit('room_updated', roomManager.publicState(room, p.id));
    });
    io.to(roomId).emit('room_updated', roomManager.publicState(room));
    cb({ ok: true });
  });

  socket.on('play_card', ({ cardId }, cb) => {
    const { roomId, playerId } = socket.data;
    if (!roomId || !playerId) return cb({ ok: false, error: 'Not in room' });
    const result = roomManager.playCard(roomId, playerId, cardId);
    if (!result.ok) return cb(result);

    const room = result.room;
    room.players.forEach(p => {
      io.to(p.socketId).emit('room_updated', roomManager.publicState(room, p.id));
    });
    io.to(roomId).emit('room_updated', roomManager.publicState(room));

    if (result.trickDone) {
      io.to(roomId).emit('trick_finished', {
        winnerId: room.currentTrick?.winnerId,
        teamTricks: room.currentLeg?.currentSet?.teamTricks
      });
    }
    if (result.setDone) {
      io.to(roomId).emit('set_finished', {
        winner: room.currentLeg?.currentSet?.winner,
        isKot: room.currentLeg?.currentSet?.isKot,
        teamSets: room.currentLeg?.teamSets
      });
      setTimeout(() => {
        const cont = roomManager.continueAfterSet(roomId);
        if (cont.ok) {
          cont.room.players.forEach(p => {
            io.to(p.socketId).emit('room_updated', roomManager.publicState(cont.room, p.id));
          });
          io.to(roomId).emit('room_updated', roomManager.publicState(cont.room));
        }
      }, 2500);
    }
    cb({ ok: true });
  });

  socket.on('supervisor_action', ({ action, data }, cb) => {
    if (socket.data.role !== 'supervisor') return cb({ ok: false, error: 'Only supervisor' });
    const roomId = socket.data.roomId;
    if (action === 'pause') {
      io.to(roomId).emit('game_paused', { by: 'supervisor' });
    } else if (action === 'flag') {
      io.to(roomId).emit('player_flagged', data);
    }
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`\n🃏  Hokm Online Server running on http://localhost:${PORT}`);
  console.log(`    Open the browser and go to the address above\n`);
});
