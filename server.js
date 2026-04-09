const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'teamleiter2026';
const NUM_SLOTS = 4;

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const slots = Array.from({ length: NUM_SLOTS }, (_, i) => ({
  id: i + 1, status: 'free', agent_name: null, start_time: null, end_time: null,
}));
const pauseLog = [];
let logIdCounter = 1;

function autoReleaseExpired() {
  const now = new Date();
  slots.forEach(slot => {
    if (slot.status === 'occ' && slot.end_time && new Date(slot.end_time) <= now) {
      const entry = pauseLog.find(e => e.slot_id === slot.id && e.active);
      if (entry) { entry.end_time = now.toISOString(); entry.active = false; }
      slot.status = 'free'; slot.agent_name = null; slot.start_time = null; slot.end_time = null;
    }
  });
}

function getState() { autoReleaseExpired(); return { slots, log: pauseLog }; }
function broadcastState() { io.emit('state:update', getState()); }

app.get('/api/state', (req, res) => res.json(getState()));
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  password === ADMIN_PASSWORD ? res.json({ ok: true }) : res.status(401).json({ ok: false, error: 'Falsches Passwort' });
});
app.post('/api/pause/start', (req, res) => {
  const { slotId, agentName, durationMinutes } = req.body || {};
  if (!slotId || !agentName || !durationMinutes) return res.status(400).json({ error: 'Fehlende Daten' });
  const slot = slots.find(s => s.id === Number(slotId));
  if (!slot) return res.status(404).json({ error: 'Slot nicht gefunden' });
  if (slot.status !== 'free') return res.status(409).json({ error: 'Slot ist nicht frei' });
  const start = new Date();
  const end = new Date(start.getTime() + Number(durationMinutes) * 60000);
  slot.status = 'occ'; slot.agent_name = agentName; slot.start_time = start.toISOString(); slot.end_time = end.toISOString();
  pauseLog.unshift({ id: logIdCounter++, agent_name: agentName, slot_id: Number(slotId), start_time: start.toISOString(), end_time: end.toISOString(), active: true, forced: false });
  if (pauseLog.length > 50) pauseLog.splice(50);
  broadcastState();
  res.json({ ok: true });
});
app.post('/api/pause/end', (req, res) => {
  const { slotId, forced = false } = req.body || {};
  const slot = slots.find(s => s.id === Number(slotId));
  if (!slot || slot.status !== 'occ') return res.status(404).json({ error: 'Aktive Pause nicht gefunden' });
  const entry = pauseLog.find(e => e.slot_id === Number(slotId) && e.active);
  if (entry) { entry.end_time = new Date().toISOString(); entry.active = false; entry.forced = !!forced; }
  slot.status = 'free'; slot.agent_name = null; slot.start_time = null; slot.end_time = null;
  broadcastState();
  res.json({ ok: true });
});
app.post('/api/slot/lock', (req, res) => {
  const { slotId } = req.body || {};
  const slot = slots.find(s => s.id === Number(slotId));
  if (!slot || slot.status !== 'free') return res.status(409).json({ error: 'Nur freie Slots können gesperrt werden' });
  slot.status = 'locked';
  broadcastState();
  res.json({ ok: true });
});
app.post('/api/slot/unlock', (req, res) => {
  const { slotId } = req.body || {};
  const slot = slots.find(s => s.id === Number(slotId));
  if (!slot || slot.status !== 'locked') return res.status(409).json({ error: 'Slot ist nicht gesperrt' });
  slot.status = 'free';
  broadcastState();
  res.json({ ok: true });
});

io.on('connection', socket => socket.emit('state:update', getState()));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pausentool.html')));

server.listen(PORT, () => console.log(`Pausentool läuft auf http://localhost:${PORT}`));
setInterval(broadcastState, 5000);
