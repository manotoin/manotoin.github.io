function uuidv4(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/x/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16)})}
const Engine = require('./hokm-engine');

const JOIN_MS = 5 * 60 * 1000;
const MAX_SETS = 5;

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.codeMap = new Map();
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (this.codeMap.has(code)) return this.generateCode();
    return code;
  }

  createRoom(name, socketId) {
    const id = uuidv4();
    const code = this.generateCode();
    const now = Date.now();
    const player = {
      id: uuidv4(), name, socketId, role: 'player',
      hand: [], isConnected: true, team: null, position: null
    };
    const room = {
      id, code, status: 'waiting', players: [player],
      supervisor: null, spectators: [],
      createdAt: now, joinDeadline: now + JOIN_MS,
      legs: [], currentLeg: null, maxSets: MAX_SETS,
      phase: 'waiting', currentTrick: null,
      turnPlayerId: null, dealerIndex: 0,
      _tempFirstFive: null, _tempRemaining: null
    };
    this.rooms.set(id, room);
    this.codeMap.set(code, id);
    setTimeout(() => this._checkTimeout(id), JOIN_MS + 500);
    return room;
  }

  _checkTimeout(id) {
    const room = this.rooms.get(id);
    if (room && room.status === 'waiting' && room.players.length < 4) {
      room.status = 'cancelled';
    }
  }

  getByCode(code) {
    const id = this.codeMap.get((code || '').toUpperCase());
    return id ? this.rooms.get(id) : null;
  }

  get(id) { return this.rooms.get(id); }

  joinPlayer(roomId, name, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.status !== 'waiting') return { ok: false, error: 'Game already started' };
    if (Date.now() > room.joinDeadline) {
      room.status = 'cancelled';
      return { ok: false, error: '5 minute join time expired' };
    }
    if (room.players.length >= 4) return { ok: false, error: 'Room full' };

    const player = {
      id: uuidv4(), name, socketId, role: 'player',
      hand: [], isConnected: true, team: null, position: null
    };
    room.players.push(player);
    if (room.players.length === 4) this._assignTeams(room);
    return { ok: true, player, room };
  }

  joinSupervisor(roomId, name, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.supervisor) return { ok: false, error: 'Supervisor already exists' };
    const sup = {
      id: uuidv4(), name, socketId, role: 'supervisor',
      hand: [], isConnected: true
    };
    room.supervisor = sup;
    return { ok: true, player: sup, room };
  }

  joinSpectator(roomId, name, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    const sp = {
      id: uuidv4(), name, socketId, role: 'spectator',
      hand: [], isConnected: true
    };
    room.spectators.push(sp);
    return { ok: true, player: sp, room };
  }

  _assignTeams(room) {
    const shuffled = Engine.shuffle([...room.players]);
    shuffled.forEach((p, i) => {
      p.position = i;
      p.team = i % 2; // 0,2 team0  |  1,3 team1
    });
    room.players.sort((a, b) => a.position - b.position);
  }

  startMatch(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.players.length !== 4) return { ok: false, error: 'Need 4 players' };
    if (room.status !== 'waiting') return { ok: false, error: 'Cannot start' };

    room.status = 'playing';
    room.phase = 'dealing';
    const leg = { legNumber: 1, sets: [], teamSets: [0, 0], winner: null, currentSet: null };
    room.legs.push(leg);
    room.currentLeg = leg;
    this._startSet(room);
    return { ok: true, room };
  }

  _startSet(room) {
    const setNum = room.currentLeg.sets.length + 1;
    const { firstFive, remaining } = Engine.dealFirstFive();
    const hakemId = Engine.determineHakem(room.players, firstFive);

    const set = {
      setNumber: setNum, tricks: [], teamTricks: [0, 0],
      hakemId, trump: null, winner: null, isKot: false
    };
    room.currentLeg.sets.push(set);
    room.currentLeg.currentSet = set;
    room._tempFirstFive = firstFive;
    room._tempRemaining = remaining;
    room.phase = 'choosing_trump';
    room.turnPlayerId = hakemId;
    // Give temporary 5 cards so hakem can see them
    room.players.forEach((p, i) => { p.hand = [...firstFive[i]]; });
  }

  chooseTrump(roomId, playerId, trump) {
    const room = this.rooms.get(roomId);
    if (!room || !room.currentLeg?.currentSet) return { ok: false, error: 'Bad state' };
    if (room.phase !== 'choosing_trump') return { ok: false, error: 'Not trump phase' };
    if (room.currentLeg.currentSet.hakemId !== playerId) return { ok: false, error: 'Only Hakem' };

    room.currentLeg.currentSet.trump = trump;
    Engine.finishDeal(room.players, room._tempFirstFive, room._tempRemaining);
    room._tempFirstFive = null;
    room._tempRemaining = null;

    room.phase = 'playing_trick';
    room.currentTrick = { cards: [], leaderId: playerId, ledSuit: null, winnerId: null };
    room.turnPlayerId = playerId;
    return { ok: true, room };
  }

  playCard(roomId, playerId, cardId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.currentLeg?.currentSet || !room.currentTrick) return { ok: false, error: 'Bad state' };
    if (room.phase !== 'playing_trick') return { ok: false, error: 'Not playing' };
    if (room.turnPlayerId !== playerId) return { ok: false, error: 'Not your turn' };

    const player = room.players.find(p => p.id === playerId);
    if (!player) return { ok: false, error: 'Player not found' };

    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'Card not in hand' };

    const card = player.hand[idx];
    if (!Engine.canPlayCard(player.hand, card, room.currentTrick.ledSuit)) {
      return { ok: false, error: 'Must follow suit' };
    }

    player.hand.splice(idx, 1);
    room.currentTrick.cards.push({ playerId, card });
    if (room.currentTrick.cards.length === 1) room.currentTrick.ledSuit = card.suit;

    let trickDone = false, setDone = false;

    if (room.currentTrick.cards.length === 4) {
      const trump = room.currentLeg.currentSet.trump;
      const winnerId = Engine.determineTrickWinner(room.currentTrick, trump);
      room.currentTrick.winnerId = winnerId;
      const winner = room.players.find(p => p.id === winnerId);
      room.currentLeg.currentSet.teamTricks[winner.team]++;
      room.currentLeg.currentSet.tricks.push({ ...room.currentTrick });
      trickDone = true;

      const result = Engine.checkSetOver(room.currentLeg.currentSet.teamTricks);
      if (result) {
        room.currentLeg.currentSet.winner = result.winner;
        room.currentLeg.currentSet.isKot = result.kot;
        room.currentLeg.teamSets[result.winner]++;
        setDone = true;
        room.phase = 'set_end';
        this._checkLegEnd(room);
      } else {
        room.currentTrick = { cards: [], leaderId: winnerId, ledSuit: null, winnerId: null };
        room.turnPlayerId = winnerId;
      }
    } else {
      room.turnPlayerId = Engine.nextPlayer(room.players, playerId);
    }

    return { ok: true, room, trickDone, setDone };
  }

  _checkLegEnd(room) {
    const needed = Math.ceil(room.maxSets / 2); // 3
    const [s0, s1] = room.currentLeg.teamSets;
    if (s0 >= needed || s1 >= needed) {
      room.currentLeg.winner = s0 > s1 ? 0 : 1;
      room.phase = 'leg_end';
      this._advance(room);
    }
  }

  _advance(room) {
    const done = room.legs.filter(l => l.winner !== null);
    const w0 = done.filter(l => l.winner === 0).length;
    const w1 = done.filter(l => l.winner === 1).length;

    if (done.length === 1) {
      const leg2 = { legNumber: 2, sets: [], teamSets: [0, 0], winner: null, currentSet: null };
      room.legs.push(leg2);
      room.currentLeg = leg2;
      room.phase = 'dealing';
      this._startSet(room);
    } else if (done.length === 2) {
      if (w0 === 1 && w1 === 1) {
        room.maxSets = 3;
        const leg3 = { legNumber: 3, sets: [], teamSets: [0, 0], winner: null, currentSet: null };
        room.legs.push(leg3);
        room.currentLeg = leg3;
        room.phase = 'dealing';
        this._startSet(room);
      } else {
        room.status = 'finished';
        room.phase = 'match_end';
      }
    } else {
      room.status = 'finished';
      room.phase = 'match_end';
    }
  }

  continueAfterSet(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.phase !== 'set_end') return { ok: false };
    if (room.currentLeg.winner === null) {
      room.phase = 'dealing';
      this._startSet(room);
    }
    return { ok: true, room };
  }

  publicState(room, forPlayerId) {
    return {
      id: room.id,
      code: room.code,
      status: room.status,
      phase: room.phase,
      joinDeadline: room.joinDeadline,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        team: p.team,
        position: p.position,
        isConnected: p.isConnected,
        handCount: p.hand.length,
        hand: (p.id === forPlayerId) ? p.hand : undefined
      })),
      supervisor: room.supervisor ? { id: room.supervisor.id, name: room.supervisor.name } : null,
      spectatorCount: room.spectators.length,
      turnPlayerId: room.turnPlayerId,
      currentTrick: room.currentTrick,
      currentLeg: room.currentLeg ? {
        legNumber: room.currentLeg.legNumber,
        teamSets: room.currentLeg.teamSets,
        winner: room.currentLeg.winner,
        currentSet: room.currentLeg.currentSet ? {
          setNumber: room.currentLeg.currentSet.setNumber,
          teamTricks: room.currentLeg.currentSet.teamTricks,
          trump: room.currentLeg.currentSet.trump,
          hakemId: room.currentLeg.currentSet.hakemId,
          winner: room.currentLeg.currentSet.winner,
          isKot: room.currentLeg.currentSet.isKot
        } : null
      } : null,
      legsSummary: room.legs.map(l => ({
        legNumber: l.legNumber,
        teamSets: l.teamSets,
        winner: l.winner
      }))
    };
  }
}

module.exports = new RoomManager();
