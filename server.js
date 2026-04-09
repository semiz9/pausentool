const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'teamleiter2026';
const DB_FILE = path.join(__dirname, 'pausentool.db');
const NUM_SLOTS = 4;

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const db = new sqlite3.Database(DB_FILE);

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS slots (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'free', agent_name TEXT, start_time TEXT, end_time TEXT, log_id INTEGER)`);
  await run(`CREATE TABLE IF NOT EXISTS pause_log (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_name TEXT NOT NULL, slot_id INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT, forced INTEGER DEFAULT 0, active INTEGER DEFAULT 1)`);
  for (let i = 1; i <= NUM_SLOTS; i++) await run(`INSERT OR IGNORE INTO slots (id, status) VALUES (?, 'free')`, [i]);
}

async function autoReleaseExpired() {
  const expired = await all(`SELECT * FROM slots WHERE status = 'occ' AND end_time IS NOT NULL AND end_time <= ?`, [new Date().toISOString()]);
  for (const slot of expired) {
    const end = new Date().toISOString();
    await run(`UPDATE pause_log SET end_time = COALESCE(end_time, ?), active = 0 WHERE id = ?`, [end, slot.log_id]);
    await run(`UPDATE slots SET status = 'free', agent_name = NULL, start_time = NULL, end_time = NULL, log_id = NULL WHERE id = ?`, [slot.id]);
  }
}

async function getState() {
  await autoReleaseExpired();
  const slots = await all(`SELECT * FROM slots ORDER BY id ASC`);
  const log = await all(`SELECT * FROM pause_log ORDER BY id DESC LIMIT 50`);
  return { slots, log };
}

async function broadcastState() { io.emit('state:update', await getState()); }

app.get('/api/state', async (req, res) => { try { res.json(await getState()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/admin/login', (req, res) => { const { password } = req.body || {}; password === ADMIN_PASSWORD ? res.json({ ok: true }) : res.status(401).json({ ok: false, error: 'Falsches Passwort' }); });
app.post('/api/pause/start', async (req, res) => {
  try {
    const { slotId, agentName, durationMinutes } = req.body || {};
    if (!slotId || !agentName || !durationMinutes) return res.status(400).json({ error: 'Fehlende Daten' });
    const slot = await get(`SELECT * FROM slots WHERE id = ?`, [slotId]);
    if (!slot) return res.status(404).json({ error: 'Slot nicht gefunden' });
    if (slot.status !== 'free') return res.status(409).json({ error: 'Slot ist nicht frei' });
    const start = new Date();
    const end = new Date(start.getTime() + Number(durationMinutes) * 60000);
    const logResult = await run(`INSERT INTO pause_log (agent_name, slot_id, start_time, active) VALUES (?, ?, ?, 1)`, [agentName, slotId, start.toISOString()]);
    await run(`UPDATE slots SET status = 'occ', agent_name = ?, start_time = ?, end_time = ?, log_id = ? WHERE id = ?`, [agentName, start.toISOString(), end.toISOString(), logResult.lastID, slotId]);
    await broadcastState();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/pause/end', async (req, res) => {
  try {
    const { slotId, forced = false } = req.body || {};
    const slot = await get(`SELECT * FROM slots WHERE id = ?`, [slotId]);
    if (!slot || slot.status !== 'occ') return res.status(404).json({ error: 'Aktive Pause nicht gefunden' });
    const end = new Date().toISOString();
    await run(`UPDATE pause_log SET end_time = ?, forced = ?, active = 0 WHERE id = ?`, [end, forced ? 1 : 0, slot.log_id]);
    await run(`UPDATE slots SET status = 'free', agent_name = NULL, start_time = NULL, end_time = NULL, log_id = NULL WHERE id = ?`, [slotId]);
    await broadcastState();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/slot/lock', async (req, res) => {
  try {
    const { slotId } = req.body || {};
    const slot = await get(`SELECT * FROM slots WHERE id = ?`, [slotId]);
    if (!slot || slot.status !== 'free') return res.status(409).json({ error: 'Nur freie Slots können gesperrt werden' });
    await run(`UPDATE slots SET status = 'locked' WHERE id = ?`, [slotId]);
    await broadcastState();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/slot/unlock', async (req, res) => {
  try {
    const { slotId } = req.body || {};
    const slot = await get(`SELECT * FROM slots WHERE id = ?`, [slotId]);
    if (!slot || slot.status !== 'locked') return res.status(409).json({ error: 'Slot ist nicht gesperrt' });
    await run(`UPDATE slots SET status = 'free' WHERE id = ?`, [slotId]);
    await broadcastState();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

io.on('connection', async socket => socket.emit('state:update', await getState()));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pausentool.html')));

initDb().then(() => server.listen(PORT, () => console.log(`Pausentool läuft auf http://localhost:${PORT}`)));
setInterval(() => broadcastState().catch(() => {}), 5000);
