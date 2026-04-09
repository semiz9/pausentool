const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'teamleiter2026';

const app = express();
const server = require('http').createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(path.join(__dirname, 'pausentool.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS slots (
    slot INTEGER PRIMARY KEY,
    status TEXT DEFAULT 'free',
    name TEXT,
    start_time INTEGER,
    end_time INTEGER,
    locked INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    slot INTEGER,
    start_time INTEGER,
    end_time INTEGER,
    status TEXT DEFAULT 'active'
  )`);
});

app.get('/api/slots', (req, res) => {
  db.all('SELECT * FROM slots ORDER BY slot', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ slots: rows || [] });
  });
});

app.get('/api/log', (req, res) => {
  db.all('SELECT * FROM log_entries ORDER BY id DESC LIMIT 50', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ log: rows || [] });
  });
});

app.post('/api/slot', (req, res) => {
  const { slotId, lock } = req.body;
  if (lock) {
    db.run('UPDATE slots SET status="locked", name=NULL, start_time=NULL, end_time=NULL, locked=1 WHERE slot=?', [slotId], err => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('state', getFullState());
      res.json({ success: true });
    });
  } else {
    db.run('UPDATE slots SET status="free", name=NULL, start_time=NULL, end_time=NULL, locked=0 WHERE slot=?', [slotId], err => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('state', getFullState());
      res.json({ success: true });
    });
  }
});

app.post('/api/pause', (req, res) => {
  const { slotId, name, duration } = req.body;
  const now = Date.now();
  const endTime = now + duration * 60000;
  db.serialize(() => {
    db.run('INSERT INTO log_entries (name, slot, start_time, end_time, status) VALUES (?, ?, ?, ?, "active")',
      [name, slotId, now, endTime],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run('UPDATE slots SET status="occ", name=?, start_time=?, end_time=? WHERE slot=?',
          [name, now, endTime, slotId], err2 => {
            if (err2) return res.status(500).json({ error: err2.message });
            io.emit('state', getFullState());
            res.json({ success: true });
          });
      });
  });
});

app.post('/api/pause/end', (req, res) => {
  const { slotId, forced } = req.body;
  const now = Date.now();
  db.serialize(() => {
    db.run('UPDATE log_entries SET end_time=?, status="done" WHERE slot=? AND status="active"',
      [now, slotId], err => {
        if (err) return res.status(500).json({ error: err.message });
        db.run('UPDATE slots SET status="free", name=NULL, start_time=NULL, end_time=NULL WHERE slot=?',
          [slotId], err2 => {
            if (err2) return res.status(500).json({ error: err2.message });
            io.emit('state', getFullState());
            res.json({ success: true });
          });
      });
  });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Falsches Passwort' });
  }
});

function getFullState() {
  return new Promise((resolve) => {
    db.all('SELECT * FROM slots ORDER BY slot', (err, slots) => {
      db.all('SELECT * FROM log_entries ORDER BY id DESC LIMIT 50', (err2, log) => {
        resolve({ slots: slots || [], log: log || [] });
      });
    });
  });
}

io.on('connection', (socket) => {
  getFullState().then(state => {
    socket.emit('state', state);
  });
});

function initSlots() {
  db.get('SELECT COUNT(*) as cnt FROM slots', (err, row) => {
    if (row.cnt === 0) {
      for (let i = 1; i <= 4; i++) {
        db.run('INSERT INTO slots (slot, status) VALUES (?, "free")', [i]);
      }
    }
  });
}
initSlots();

server.listen(PORT, () => console.log('Pausentool läuft auf Port', PORT));
