const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app      = express();
const PORT     = process.env.PORT || 3002;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Convierte una clave localStorage en nombre de archivo seguro
function keyToFile(key) {
  return path.join(DATA_DIR, encodeURIComponent(key) + '.json');
}

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'server' }));

// ─── Obtener todos los pares clave-valor ────────────────────────────────────
app.get('/api/kv', (_req, res) => {
  const result = {};
  try {
    fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .forEach(file => {
        const key = decodeURIComponent(file.slice(0, -5));
        try { result[key] = fs.readFileSync(path.join(DATA_DIR, file), 'utf8'); } catch {}
      });
  } catch {}
  res.json(result);
});

// ─── Obtener un valor ────────────────────────────────────────────────────────
app.get('/api/kv/:key', (req, res) => {
  const key  = decodeURIComponent(req.params.key);
  const file = keyToFile(key);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  try {
    res.json({ value: fs.readFileSync(file, 'utf8') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Guardar un valor ────────────────────────────────────────────────────────
app.post('/api/kv', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    fs.writeFileSync(keyToFile(key), typeof value === 'string' ? value : JSON.stringify(value));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Borrar un valor ─────────────────────────────────────────────────────────
app.delete('/api/kv/:key', (req, res) => {
  const file = keyToFile(decodeURIComponent(req.params.key));
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`✅  Raydal Dashboard en http://localhost:${PORT}`));
