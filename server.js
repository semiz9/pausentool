const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'teamleiter2026';

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log('Pausentool läuft auf Port', PORT));
