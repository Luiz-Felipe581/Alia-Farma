const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';
const PORT = process.env.PORT || 3000;

// ---------- Banco de dados em arquivo JSON (sem dependências nativas) ----------
const DB_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
fs.mkdirSync(DB_DIR, { recursive: true });

let db = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  : { seq: { users: 0, categories: 0, products: 0, orders: 0 }, users: [], categories: [], products: [], orders: [] };

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
const nextId = t => ++db.seq[t];

function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, ''); if (!d) return '';
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}
db.banners = db.banners || [];
db.seq.banners = db.seq.banners || 0;
db.settings = db.settings || { phone: normPhone(process.env.PHARMACIST_PHONE) || '' };

// ---------- Dados iniciais ----------
if (!db.categories.length) {
  ['Medicamentos', 'Vitaminas', 'Mamãe e bebê', 'Beleza', 'Higiene pessoal']
    .forEach(name => db.categories.push({ id: nextId('categories'), name }));
  [
    ['Dipirona 1g, 20 comprimidos', 'Analgésico e antitérmico.', 14.9, 80, '💊', 1],
    ['Ibuprofeno 400mg, 20 cápsulas', 'Anti-inflamatório para dor e febre.', 22.5, 60, '💊', 1],
    ['Loratadina 10mg, 12 comprimidos', 'Antialérgico de uso diário.', 18.4, 50, '💊', 1],
    ['Soro fisiológico 500ml', 'Higiene nasal e ocular.', 9.9, 100, '🧴', 1],
    ['Vitamina D 2000UI, 60 cápsulas', 'Suplemento de vitamina D.', 39.9, 40, '🌤️', 2],
    ['Vitamina C 1g, 30 comprimidos', 'Efervescente sabor laranja.', 24.9, 70, '🍊', 2],
    ['Ômega 3, 120 cápsulas', 'Suplemento de óleo de peixe.', 79.9, 30, '🐟', 2],
    ['Multivitamínico, 90 cápsulas', 'Complexo de vitaminas e minerais.', 54.9, 45, '💚', 2],
    ['Fralda calça XG, 80 unidades', 'Proteção acolchoada.', 119.9, 25, '👶', 3],
    ['Lenço umedecido, 100 unidades', 'Sem álcool, para pele sensível.', 16.9, 90, '🧻', 3],
    ['Pomada para assaduras 45g', 'Protege e acalma a pele do bebê.', 21.5, 55, '🧸', 3],
    ['Hidratante corporal 473ml', 'Pele seca a extra seca.', 89.9, 35, '🧴', 4],
    ['Protetor solar facial FPS 60', 'Toque seco, 50ml.', 69.9, 40, '☀️', 4],
    ['Sérum facial antissinais 30ml', 'Uso noturno.', 99.9, 20, '✨', 4],
    ['Sabonete líquido 300ml', 'Refrescante, uso diário.', 12.9, 120, '🧼', 5],
    ['Creme dental 90g', 'Proteção contra cáries.', 7.9, 150, '🦷', 5],
    ['Desodorante roll-on 50ml', '48 horas de proteção.', 13.5, 110, '🌿', 5],
    ['Escova de dente macia', 'Cerdas macias, 2 unidades.', 11.9, 90, '🪥', 5],
  ].forEach(([name, description, price, stock, emoji, category_id]) =>
    db.products.push({ id: nextId('products'), name, description, price, stock, emoji, category_id }));
}
if (!db.banners.length) {
  const cid = n => (db.categories.find(c => c.name === n) || {}).id || null;
  [['Cuidado em até uma hora', 'Medicamentos e itens de saúde com entrega rápida na sua porta.', 'Medicamentos'],
   ['Vitaminas para a rotina', 'Vitamina D, C e ômega 3 com 5% off no Pix.', 'Vitaminas'],
   ['Tudo para o bebê', 'Fraldas, lenços e pomadas para cada fase.', 'Mamãe e bebê'],
   ['Pele protegida o ano todo', 'Protetor solar, hidratantes e séruns.', 'Beleza']]
    .forEach(([title, text, cat]) => db.banners.push({ id: nextId('banners'), title, text, image: '', category_id: cid(cat) }));
}
if (!db.users.some(u => u.role === 'admin')) {
  const email = (process.env.ADMIN_EMAIL || 'admin@aliafarma.com').toLowerCase();
  let pass = process.env.ADMIN_PASSWORD;
  if (!pass && process.env.RENDER) {           // publicado sem senha definida: gera uma aleatória
    pass = crypto.randomBytes(9).toString('base64url');
    console.log(`>>> Admin criado: ${email} | senha gerada: ${pass}`);
  }
  db.users.push({ id: nextId('users'), name: 'Administrador', email, password: bcrypt.hashSync(pass || 'admin123', 10), role: 'admin' });
}
save();

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.get('/healthz', (_, res) => res.send('ok'));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  next();
});
const hits = new Map();
setInterval(() => hits.clear(), 30 * 60 * 1000).unref();
const limit = (max, ms) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < ms);
  a.push(now); hits.set(k, a);
  if (a.length > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  next();
};
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sign = u => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '7d' });
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const findUser = id => db.users.find(u => u.id === id);

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(t, SECRET);
    if (!findUser(req.user.id)) throw new Error('sem usuário');
    next();
  } catch { res.status(401).json({ error: 'Faça login para continuar.' }); }
}
function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  next();
}

// Autenticação
app.post('/api/register', limit(20, 15 * 60 * 1000), (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Informe nome, e-mail e senha com 6+ caracteres.' });
  const mail = email.trim().toLowerCase();
  if (db.users.some(u => u.email === mail)) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
  const u = { id: nextId('users'), name: name.trim(), email: mail, password: bcrypt.hashSync(password, 10), role: 'cliente' };
  db.users.push(u); save();
  res.status(201).json({ token: sign(u), user: pub(u) });
});
app.post('/api/login', limit(20, 15 * 60 * 1000), (req, res) => {
  const u = db.users.find(x => x.email === (req.body.email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  res.json({ token: sign(u), user: pub(u) });
});

// Conta do usuário: ler, atualizar, excluir
app.get('/api/me', auth, (req, res) => res.json(pub(findUser(req.user.id))));
app.put('/api/me', auth, (req, res) => {
  const u = findUser(req.user.id);
  if (req.body.name) u.name = req.body.name.trim();
  if (req.body.password && req.body.password.length >= 6) u.password = bcrypt.hashSync(req.body.password, 10);
  save(); res.json(pub(u));
});
app.delete('/api/me', auth, (req, res) => {
  db.orders = db.orders.filter(o => o.user_id !== req.user.id);
  db.users = db.users.filter(u => u.id !== req.user.id);
  save(); res.json({ ok: true });
});

// Categorias
app.get('/api/categories', (_, res) => res.json(db.categories));
app.post('/api/categories', auth, admin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome da categoria.' });
  if (db.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'Categoria já existe.' });
  const c = { id: nextId('categories'), name };
  db.categories.push(c); save(); res.status(201).json(c);
});
app.delete('/api/categories/:id', auth, admin, (req, res) => {
  const id = +req.params.id;
  if (db.products.some(p => p.category_id === id))
    return res.status(409).json({ error: 'Remova ou mova os produtos desta categoria antes.' });
  db.categories = db.categories.filter(c => c.id !== id);
  save(); res.json({ ok: true });
});

// Banners da página inicial
app.get('/api/banners', (_, res) => res.json(db.banners));
app.post('/api/banners', auth, admin, (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 60);
  if (!title) return res.status(400).json({ error: 'Informe o título do banner.' });
  const cat = +req.body.category_id;
  const b = { id: nextId('banners'), title, text: (req.body.text || '').trim().slice(0, 120), image: normImage(req.body.image),
    category_id: db.categories.some(c => c.id === cat) ? cat : null };
  db.banners.push(b); save(); res.status(201).json(b);
});
app.delete('/api/banners/:id', auth, admin, (req, res) => {
  db.banners = db.banners.filter(b => b.id !== +req.params.id); save(); res.json({ ok: true });
});

// Contato do farmacêutico
app.get('/api/config', (_, res) => res.json({ phone: db.settings.phone || '' }));
app.put('/api/config', auth, admin, (req, res) => {
  const p = normPhone(req.body.phone);
  if (p === null) return res.status(400).json({ error: 'Telefone inválido. Use DDD + número, ex.: (62) 99999-9999.' });
  db.settings.phone = p; save(); res.json({ phone: p });
});

// Produtos (CRUD)
app.get('/api/products', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  res.json(db.products.filter(p => p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
});
function normImage(raw) {
  const u = (raw || '').trim(); if (!u) return '';
  const drive = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/) || u.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/);
  if (drive) return `https://drive.google.com/uc?export=view&id=${drive[1]}`;
  if (/^\/[^/]/.test(u) || /^https?:\/\//i.test(u)) return u.slice(0, 2000);
  if (/^(www\.)?[\w-]+(\.[\w-]+)+(\/|$)/i.test(u)) return ('https://' + u).slice(0, 2000);
  return '';
}
function cleanProduct(b) {
  const p = { name: (b.name || '').trim(), description: b.description || '', price: +b.price, stock: Math.floor(+b.stock),
    emoji: b.emoji || '💊', category_id: +b.category_id,
    image: normImage(b.image) };
  const ok = p.name && p.price > 0 && p.stock >= 0 && db.categories.some(c => c.id === p.category_id);
  return ok ? p : null;
}
app.post('/api/products', auth, admin, (req, res) => {
  const p = cleanProduct(req.body);
  if (!p) return res.status(400).json({ error: 'Preencha nome, preço, estoque e categoria.' });
  const novo = { id: nextId('products'), ...p };
  db.products.push(novo); save(); res.status(201).json(novo);
});
app.put('/api/products/:id', auth, admin, (req, res) => {
  const atual = db.products.find(p => p.id === +req.params.id);
  if (!atual) return res.status(404).json({ error: 'Produto não encontrado.' });
  const p = cleanProduct(req.body);
  if (!p) return res.status(400).json({ error: 'Preencha nome, preço, estoque e categoria.' });
  Object.assign(atual, p); save(); res.json(atual);
});
app.delete('/api/products/:id', auth, admin, (req, res) => {
  db.products = db.products.filter(p => p.id !== +req.params.id);
  save(); res.json({ ok: true });
});

// Pedidos e pagamento (simulado)
const baseUrl = req => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const rand = n => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
app.post('/api/orders', auth, async (req, res) => {
  const { items, method, address, card, installments } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Carrinho vazio.' });
  if (!address || address.length < 8) return res.status(400).json({ error: 'Informe o endereço de entrega.' });
  if (!['pix', 'card', 'boleto'].includes(method)) return res.status(400).json({ error: 'Forma de pagamento inválida.' });
  if (method === 'card') {
    const num = (card?.number || '').replace(/\D/g, '');
    if (num.length < 13 || num.length > 19 || !card.name || !/^\d{2}\/\d{2}$/.test(card.expiry || '') || !/^\d{3,4}$/.test(card.cvv || ''))
      return res.status(400).json({ error: 'Dados do cartão inválidos.' });
  }
  const parc = method === 'card' ? Math.min(3, Math.max(1, +installments || 1)) : 1;

  // Junta itens repetidos e valida tudo antes de mexer no estoque
  const wanted = new Map();
  for (const it of items) {
    const qty = Math.floor(+it.qty);
    if (!(qty >= 1)) return res.status(409).json({ error: 'Quantidade inválida no carrinho.' });
    wanted.set(+it.id, (wanted.get(+it.id) || 0) + qty);
  }
  const lines = [];
  for (const [id, qty] of wanted) {
    const p = db.products.find(x => x.id === id);
    if (!p) return res.status(409).json({ error: 'Um produto do carrinho não existe mais.' });
    if (p.stock < qty) return res.status(409).json({ error: `Estoque insuficiente: ${p.name}.` });
    lines.push({ p, qty });
  }
  const subtotal = lines.reduce((s, { p, qty }) => s + p.price * qty, 0);
  const shipping = subtotal >= 150 ? 0 : 12.9;
  const discount = method === 'pix' ? subtotal * 0.05 : 0;
  const order = {
    id: nextId('orders'), user_id: req.user.id, total: +(subtotal - discount + shipping).toFixed(2), shipping, method,
    installments: parc, status: method === 'card' ? 'Pago' : 'Aguardando pagamento', address,
    payToken: method === 'pix' ? crypto.randomBytes(16).toString('hex') : null,
    created_at: new Date().toISOString(),
    items: lines.map(({ p, qty }) => ({ product_id: p.id, name: p.name, price: p.price, qty })),
  };
  lines.forEach(({ p, qty }) => { p.stock -= qty; });
  db.orders.push(order); save();

  const out = { id: order.id, total: order.total, shipping, status: order.status };
  if (method === 'pix') {
    out.pixCode = `00020126-SIMULADO-ALIAFARMA-${order.id}-${rand(12)}`;
    out.payUrl = `${baseUrl(req)}/pagar/${order.payToken}`;
    try { out.pixQr = await QRCode.toDataURL(out.payUrl, { margin: 1, width: 300, errorCorrectionLevel: 'M' }); } catch (e) { console.error('QR:', e.message); }
  }
  if (method === 'boleto') out.boleto = `${rand(5)}.${rand(5)} ${rand(5)}.${rand(6)} ${rand(5)}.${rand(6)} ${rand(1)} ${rand(14)}`;
  res.status(201).json(out);
});
app.get('/api/orders', auth, (req, res) =>
  res.json(db.orders.filter(o => o.user_id === req.user.id).sort((a, b) => b.id - a.id).map(o => ({
    ...o, payToken: undefined, payUrl: o.payToken && o.status !== 'Pago' ? `${baseUrl(req)}/pagar/${o.payToken}` : undefined }))));
app.get('/api/orders/:id/status', auth, (req, res) => {
  const o = db.orders.find(x => x.id === +req.params.id && x.user_id === req.user.id);
  o ? res.json({ status: o.status }) : res.status(404).json({ error: 'Pedido não encontrado.' });
});
app.delete('/api/orders/:id', auth, (req, res) => {
  const o = db.orders.find(x => x.id === +req.params.id && x.user_id === req.user.id);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (o.status === 'Pago') return res.status(409).json({ error: 'Pedidos pagos não podem ser cancelados aqui.' });
  o.items.forEach(i => { const p = db.products.find(x => x.id === i.product_id); if (p) p.stock += i.qty; });
  db.orders = db.orders.filter(x => x.id !== o.id);
  save(); res.json({ ok: true });
});

// Link de pagamento Pix (aberto ao escanear o QR Code)
const money = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const payPage = o => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pagamento Pix · Aliá Farma</title>
<style>body{font-family:system-ui,sans-serif;background:#eceeed;color:#24292b;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}main{background:#f8f9f8;border:1px solid #d3d8d6;border-radius:18px;padding:1.6rem;width:min(400px,100%);text-align:center}h1{font-size:1.25rem;margin:0}.v{font-size:2rem;font-weight:800;margin:.8rem 0}button{width:100%;padding:.9rem;border:0;border-radius:10px;background:#24292b;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}small{color:#5d6669;display:block;margin-top:1rem}.ok{color:#4d6256;font-weight:700}</style></head><body><main>
<h1>Pagamento Pix · Pedido #${o.id}</h1><div class="v">${money(o.total)}</div>
<div id="box">${o.status === 'Pago' ? '<p class="ok">Pagamento confirmado ✓</p>' : '<button id="pay">Simular pagamento</button>'}</div>
<small>Página de demonstração da Aliá Farma. Nenhuma cobrança real é feita.</small></main>
<script>const b=document.getElementById('pay');if(b)b.onclick=async()=>{b.disabled=true;const r=await fetch('/api/pay/${o.payToken}',{method:'POST'});document.getElementById('box').innerHTML=r.ok?'<p class="ok">Pagamento confirmado ✓</p>':'<p>Não foi possível confirmar.</p>'}</script></body></html>`;
app.get('/pagar/:token', (req, res) => {
  const o = db.orders.find(x => x.payToken && x.payToken === req.params.token);
  o ? res.send(payPage(o)) : res.status(404).send('Link de pagamento inválido ou expirado.');
});
app.post('/api/pay/:token', (req, res) => {
  const o = db.orders.find(x => x.payToken && x.payToken === req.params.token);
  if (!o) return res.status(404).json({ error: 'Link inválido.' });
  o.status = 'Pago'; save(); res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Aliá Farma rodando em http://localhost:${PORT}`));
