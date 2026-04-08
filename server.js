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

// ─── GitHub auto-commit ───────────────────────────────────────────────────────
// Cuando GITHUB_TOKEN está configurado, cada guardado se commitea a git
// automáticamente para que los datos sobrevivan los redeploys de Railway.
const GH_TOKEN  = process.env.GITHUB_TOKEN;
const GH_OWNER  = process.env.GITHUB_OWNER  || 'jveganube';
const GH_REPO   = process.env.GITHUB_REPO   || 'raydal-dashboard';
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';

async function ghRequest(method, filePath, body) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res;
}

async function getFileSHA(filePath) {
  try {
    const res = await ghRequest('GET', filePath);
    if (!res.ok) return null;
    const data = await res.json();
    return data.sha || null;
  } catch { return null; }
}

// Commitea un archivo al repo (create o update)
async function gitPush(key, content) {
  if (!GH_TOKEN) return;
  try {
    const filePath = `data/${encodeURIComponent(key)}.json`;
    const sha = await getFileSHA(filePath);
    const body = {
      message: `data: update ${key} [skip ci]`,
      content: Buffer.from(content).toString('base64'),
      branch:  GH_BRANCH,
      ...(sha && { sha })
    };
    await ghRequest('PUT', filePath, body);
  } catch (e) {
    console.warn('[github-sync] push error:', e.message);
  }
}

// Elimina un archivo del repo
async function gitDelete(key) {
  if (!GH_TOKEN) return;
  try {
    const filePath = `data/${encodeURIComponent(key)}.json`;
    const sha = await getFileSHA(filePath);
    if (!sha) return;
    await ghRequest('DELETE', filePath, {
      message: `data: delete ${key} [skip ci]`,
      sha,
      branch: GH_BRANCH
    });
  } catch (e) {
    console.warn('[github-sync] delete error:', e.message);
  }
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
app.post('/api/kv', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const content = typeof value === 'string' ? value : JSON.stringify(value);
    fs.writeFileSync(keyToFile(key), content);
    res.json({ ok: true });
    gitPush(key, content); // fire-and-forget, no bloquea la respuesta
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Borrar un valor ─────────────────────────────────────────────────────────
app.delete('/api/kv/:key', async (req, res) => {
  const key  = decodeURIComponent(req.params.key);
  const file = keyToFile(key);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
  gitDelete(key); // fire-and-forget
});

app.listen(PORT, () => console.log(`✅  Raydal Dashboard en http://localhost:${PORT}`));
