const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---- Full roster. This never changes. ----
const ALL_PEOPLE = ['Yared', 'Yilkal', 'Temesgen', 'Mengistu', 'Melaku', 'Amanuel'];
// ---------------------------------------------

const SPIN_DURATION_MS = 6000;
const START_BUFFER_MS = 700;

let excludedManually = new Set(); // people toggled OFF the wheel by hand (e.g. absent)
let winnersHistory = [];          // { name, timestamp } — already won, auto-removed
let currentSpin = null;
let spinning = false;

function wonNames() {
  return new Set(winnersHistory.map((w) => w.name));
}

// The people currently active on the wheel right now
function activePool() {
  const won = wonNames();
  return ALL_PEOPLE.filter((name) => !excludedManually.has(name) && !won.has(name));
}

function broadcastState() {
  io.emit('state', {
    allPeople: ALL_PEOPLE,
    pool: activePool(),
    excluded: [...excludedManually],
    winnersHistory,
    spinning,
  });
}

io.on('connection', (socket) => {
  socket.emit('init', {
    allPeople: ALL_PEOPLE,
    pool: activePool(),
    excluded: [...excludedManually],
    winnersHistory,
    currentSpin,
    spinning,
  });

  // Toggle a person on/off the wheel manually, before spinning.
  // Not allowed once they've already won (must Reset for that).
  socket.on('toggleExclude', (name) => {
    if (spinning) return;
    if (wonNames().has(name)) return;
    if (excludedManually.has(name)) {
      excludedManually.delete(name);
    } else {
      excludedManually.add(name);
    }
    broadcastState();
  });

  socket.on('startSpin', () => {
    if (spinning) return;
    const pool = activePool();
    if (pool.length === 0) return;

    spinning = true;

    const winnerIndex = Math.floor(Math.random() * pool.length);
    const winner = pool[winnerIndex];

    const sliceAngle = 360 / pool.length;
    const extraFullSpins = 6;
    const landingAngle =
      360 * extraFullSpins + (360 - winnerIndex * sliceAngle - sliceAngle / 2);

    const startAt = Date.now() + START_BUFFER_MS;
    const timestamp = new Date(startAt).toISOString();

    currentSpin = {
      winner,
      winnerIndex,
      landingAngle,
      startAt,
      duration: SPIN_DURATION_MS,
      timestamp,
    };

    io.emit('spin', currentSpin);

    setTimeout(() => {
      winnersHistory.push({ name: winner, timestamp });
      spinning = false;
      io.emit('spinEnd', currentSpin);
      broadcastState();
    }, startAt - Date.now() + SPIN_DURATION_MS);
  });

  socket.on('resetSpin', () => {
    if (spinning) return;
    excludedManually = new Set();
    winnersHistory = [];
    currentSpin = null;
    broadcastState();
    io.emit('resetDone');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Lottery spinner running at http://localhost:${PORT}`);
});
