// ==================== HOKM ENGINE (Pure JS) ====================
const SUIT_PRIORITY = ['spades', 'hearts', 'clubs', 'diamonds'];
const RANK_ORDER = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUIT_SYMBOL = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };

function createDeck() {
  const suits = ['spades', 'hearts', 'clubs', 'diamonds'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of RANK_ORDER) {
      deck.push({ suit, rank, id: `${suit}-${rank}` });
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function compareCards(a, b, trump, ledSuit) {
  const aTrump = a.suit === trump;
  const bTrump = b.suit === trump;
  if (aTrump && !bTrump) return 1;
  if (!aTrump && bTrump) return -1;
  if (a.suit === ledSuit && b.suit !== ledSuit && !bTrump) return 1;
  if (b.suit === ledSuit && a.suit !== ledSuit && !aTrump) return -1;
  return RANK_ORDER.indexOf(b.rank) - RANK_ORDER.indexOf(a.rank);
}

function determineHakem(players, firstFive) {
  const holders = [];
  players.forEach((p, i) => {
    firstFive[i].filter(c => c.rank === 'A').forEach(ace => {
      holders.push({ playerId: p.id, suit: ace.suit });
    });
  });
  if (!holders.length) return players[0].id;
  holders.sort((a, b) => SUIT_PRIORITY.indexOf(a.suit) - SUIT_PRIORITY.indexOf(b.suit));
  return holders[0].playerId;
}

function canPlayCard(hand, card, ledSuit) {
  if (!ledSuit) return true;
  const hasLed = hand.some(c => c.suit === ledSuit);
  return hasLed ? card.suit === ledSuit : true;
}

function getValidCards(hand, ledSuit) {
  if (!ledSuit) return [...hand];
  const ofLed = hand.filter(c => c.suit === ledSuit);
  return ofLed.length ? ofLed : [...hand];
}

function determineTrickWinner(trick, trump) {
  const led = trick.ledSuit;
  let winner = trick.cards[0];
  for (let i = 1; i < trick.cards.length; i++) {
    if (compareCards(trick.cards[i].card, winner.card, trump, led) > 0) {
      winner = trick.cards[i];
    }
  }
  return winner.playerId;
}

function dealFirstFive() {
  const deck = createDeck();
  const firstFive = [[], [], [], []];
  for (let i = 0; i < 5; i++) {
    for (let p = 0; p < 4; p++) firstFive[p].push(deck.pop());
  }
  return { firstFive, remaining: deck };
}

function finishDeal(players, firstFive, remaining) {
  players.forEach((p, i) => { p.hand = [...firstFive[i]]; });
  for (let i = 0; i < 8; i++) {
    for (let p = 0; p < 4; p++) players[p].hand.push(remaining.pop());
  }
  players.forEach(p => {
    p.hand.sort((a, b) => {
      if (a.suit !== b.suit) return SUIT_PRIORITY.indexOf(a.suit) - SUIT_PRIORITY.indexOf(b.suit);
      return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
    });
  });
}

function nextPlayer(players, currentId) {
  const sorted = [...players].sort((a, b) => a.position - b.position);
  const idx = sorted.findIndex(p => p.id === currentId);
  return sorted[(idx + 1) % 4].id;
}

function checkSetOver(teamTricks) {
  if (teamTricks[0] >= 7) return { winner: 0, kot: teamTricks[1] === 0 };
  if (teamTricks[1] >= 7) return { winner: 1, kot: teamTricks[0] === 0 };
  return null;
}

module.exports = {
  createDeck, shuffle, compareCards, determineHakem, canPlayCard,
  getValidCards, determineTrickWinner, dealFirstFive, finishDeal,
  nextPlayer, checkSetOver, SUIT_PRIORITY, RANK_ORDER, SUIT_SYMBOL
};
