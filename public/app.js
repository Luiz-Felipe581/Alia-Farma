const $ = s => document.querySelector(s);
const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  products: [], cats: [], active: null, q: '',
  cart: JSON.parse(localStorage.getItem('cart') || '[]'),
  cep: JSON.parse(localStorage.getItem('cep') || 'null'), banners: [], cfg: {},
  token: localStorage.getItem('token'), user: null, authMode: 'login',
};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (data === null) throw new Error('O servidor da API não respondeu. Abra o site pelo endereço do Node (ex.: http://localhost:3000).');
  if (!res.ok) throw new Error(data.error || 'Algo deu errado. Tente novamente.');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

// ---------- Produtos e abas (Read) ----------
async function load() {
  try {
    [state.cats, state.products, state.banners] = await Promise.all([api('/categories'), api('/products'), api('/banners')]);
  } catch (err) {
    $('#grid').innerHTML = `<p class="empty">Não foi possível carregar os produtos. ${esc(err.message)}</p>`;
    return;
  }
  if (!state.cats.some(c => c.id === state.active)) state.active = state.cats[0]?.id ?? null;
  renderTabs(); renderGrid(); renderBanners();
}
function renderTabs() {
  const all = [{ id: 0, name: 'Todos' }, ...state.cats];
  $('#tabs').innerHTML = all.map(c =>
    `<button class="tab" role="tab" data-id="${c.id}" aria-selected="${(state.active ?? 0) === c.id}">${esc(c.name)}</button>`).join('');
}
function renderGrid() {
  const q = state.q.toLowerCase();
  const list = state.products.filter(p => (!state.active || q || p.category_id === state.active) && p.name.toLowerCase().includes(q));
  const cat = state.cats.find(c => c.id === state.active);
  $('#secTitle').textContent = q ? 'Resultados da busca' : cat ? cat.name : 'Todos os produtos';
  $('#secCount').textContent = `${list.length} ${list.length === 1 ? 'produto' : 'produtos'}`;
  $('#grid').innerHTML = list.length ? list.map((p, i) => `
    <article class="card" tabindex="0" data-open="${p.id}" style="animation-delay:${Math.min(i, 12) * 30}ms">
      <div class="pic">${art(p)}</div>
      <div class="body">
        <h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>
        <div class="price">${brl(p.price)}<small>${brl(p.price * 0.95)} no Pix</small></div>
        ${p.stock > 0 && p.stock < 10 ? `<span class="stock">Restam ${p.stock}</span>` : ''}
        <button class="add" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>${p.stock < 1 ? 'Indisponível' : 'Adicionar'}</button>
      </div>
    </article>`).join('') : '<p class="empty">Nenhum produto encontrado. Tente outra busca ou categoria.</p>';
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  state.active = +b.dataset.id || null; renderTabs(); renderGrid();
});
$('#search').addEventListener('input', e => { state.q = e.target.value; renderGrid(); });
$('#grid').addEventListener('click', e => {
  const b = e.target.closest('[data-add]');
  if (b) {
    const ok = addToCart(+b.dataset.add, 1, b.closest('.card').querySelector('.pic svg, .pic img'));
    if (ok) { b.textContent = 'Adicionado ✓'; b.classList.add('done'); setTimeout(() => { b.textContent = 'Adicionar'; b.classList.remove('done'); }, 1000); }
    return;
  }
  const card = e.target.closest('[data-open]'); if (card) openProduct(+card.dataset.open);
});
$('#grid').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('[data-open]')) openProduct(+e.target.dataset.open);
});

// ---------- Carrinho ----------
const saveCart = () => localStorage.setItem('cart', JSON.stringify(state.cart));
const cartSubtotal = () => state.cart.reduce((s, i) => s + i.price * i.qty, 0);
function addToCart(id, qty = 1, srcEl) {
  const p = state.products.find(x => x.id === id); if (!p) return false;
  const line = state.cart.find(i => i.id === id);
  if ((line ? line.qty : 0) + qty > p.stock) { toast('Limite de estoque atingido.'); return false; }
  if (line) line.qty += qty; else state.cart.push({ id, name: p.name, price: p.price, emoji: p.emoji, qty });
  saveCart(); renderCart(); toast('Adicionado ao carrinho'); fly(srcEl);
  const b = $('#btnCart'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  return true;
}
function renderCart() {
  $('#cartCount').textContent = state.cart.reduce((s, i) => s + i.qty, 0);
  const sub = cartSubtotal();
  $('#subtotal').textContent = brl(sub);
  $('#shipHint').textContent = !state.cart.length ? '' : sub >= 150 ? 'Você ganhou frete grátis.' : `Faltam ${brl(150 - sub)} para o frete grátis.`;
  $('#cartItems').innerHTML = state.cart.length ? state.cart.map(i => `
    <div class="line"><div class="e">${thumb(i)}</div>
      <div><div class="n">${esc(i.name)}</div>
        <div class="qty"><button data-dec="${i.id}" aria-label="Diminuir">−</button><span>${i.qty}</span><button data-inc="${i.id}" aria-label="Aumentar">+</button></div></div>
      <div><b>${brl(i.price * i.qty)}</b><br><button class="danger" data-rm="${i.id}">Remover</button></div>
    </div>`).join('') : '<p class="hint">Seu carrinho está vazio. Escolha produtos nas abas de categorias.</p>';
}
$('#cartItems').addEventListener('click', e => {
  const t = e.target, id = +(t.dataset.inc || t.dataset.dec || t.dataset.rm);
  const l = state.cart.find(i => i.id === id); if (!l) return;
  const p = state.products.find(x => x.id === id);
  if (t.dataset.inc) { if (p && l.qty >= p.stock) return toast('Limite de estoque atingido.'); l.qty++; }
  if (t.dataset.dec) l.qty--;
  if (t.dataset.rm || l.qty < 1) state.cart = state.cart.filter(i => i.id !== id);
  saveCart(); renderCart();
});
const drawer = open => { $('#drawer').classList.toggle('on', open); $('#scrim').classList.toggle('on', open); };
$('#btnCart').onclick = () => drawer(true);
$('#scrim').onclick = () => drawer(false);
document.querySelector('[data-close-drawer]').onclick = () => drawer(false);
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

// ---------- Login e conta ----------
function setUser(u) {
  state.user = u;
  $('#btnAccount').textContent = u ? u.name.split(' ')[0] : 'Entrar';
  $('#btnOrders').classList.toggle('hidden', !u);
  $('#btnAdmin').classList.toggle('hidden', u?.role !== 'admin');
}
async function restore() {
  if (!state.token) return;
  try { setUser(await api('/me')); } catch { state.token = null; localStorage.removeItem('token'); }
}
function setAuthMode(m) {
  state.authMode = m;
  $('#authTitle').textContent = m === 'login' ? 'Entrar' : 'Criar conta';
  $('#lblName').classList.toggle('hidden', m === 'login');
  $('#toggleAuth').textContent = m === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta';
  $('#authErr').textContent = '';
}
$('#toggleAuth').onclick = () => setAuthMode(state.authMode === 'login' ? 'register' : 'login');
$('#btnAccount').onclick = () => {
  if (!state.user) { setAuthMode('login'); return $('#dlgAuth').showModal(); }
  $('#formAccount').name.value = state.user.name; $('#formAccount').password.value = ''; $('#accErr').textContent = '';
  $('#dlgAccount').showModal();
};
$('#formAuth').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const body = { email: f.email.value, password: f.password.value, ...(state.authMode === 'register' ? { name: f.name.value } : {}) };
    const r = await api(state.authMode === 'login' ? '/login' : '/register', { method: 'POST', body });
    state.token = r.token; localStorage.setItem('token', r.token); setUser(r.user);
    $('#dlgAuth').close(); f.reset(); toast(`Olá, ${r.user.name.split(' ')[0]}!`);
  } catch (err) { $('#authErr').textContent = err.message; }
});
$('#formAccount').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const body = { name: e.target.name.value }; if (e.target.password.value) body.password = e.target.password.value;
    setUser(await api('/me', { method: 'PUT', body })); $('#dlgAccount').close(); toast('Dados atualizados');
  } catch (err) { $('#accErr').textContent = err.message; }
});
function logout() { state.token = null; localStorage.removeItem('token'); setUser(null); $('#dlgAccount').close(); toast('Você saiu da conta'); }
$('#btnLogout').onclick = logout;
$('#btnDeleteAcc').onclick = async () => {
  if (!confirm('Excluir sua conta e todos os seus pedidos? Esta ação não pode ser desfeita.')) return;
  try { await api('/me', { method: 'DELETE' }); logout(); } catch (err) { $('#accErr').textContent = err.message; }
};

// ---------- Checkout e pagamento ----------
function checkoutTotals() {
  const sub = cartSubtotal(), method = $('#formCheckout').method.value;
  const ship = sub >= 150 ? 0 : 12.9, disc = method === 'pix' ? sub * 0.05 : 0;
  return { sub, ship, disc, total: sub - disc + ship };
}
function renderSummary() {
  const t = checkoutTotals();
  $('#checkoutSummary').innerHTML = `<div class="row"><span>Produtos</span><span>${brl(t.sub)}</span></div>
    ${t.disc ? `<div class="row"><span>Desconto Pix</span><span>− ${brl(t.disc)}</span></div>` : ''}
    <div class="row"><span>Frete</span><span>${t.ship ? brl(t.ship) : 'Grátis'}</span></div>
    <div class="total"><span>Total</span><span>${brl(t.total)}</span></div>`;
}
$('#btnCheckout').onclick = () => {
  if (!state.cart.length) return toast('Adicione produtos ao carrinho.');
  if (!state.user) { drawer(false); toast('Entre na sua conta para finalizar.'); setAuthMode('login'); return $('#dlgAuth').showModal(); }
  drawer(false); $('#coErr').textContent = ''; renderSummary();
  const ad = $('#formCheckout').address;
  if (!ad.value && state.cep) ad.value = [state.cep.street, state.cep.district, `${state.cep.city}/${state.cep.uf}`, 'CEP ' + state.cep.cep].filter(Boolean).join(', ');
  $('#dlgCheckout').showModal();
};
function showPanel(m) {
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== m));
}
$('#formCheckout').addEventListener('change', e => {
  if (e.target.name === 'method') showPanel(e.target.value);
  renderSummary();
});
// Cartão: prévia animada que vira ao digitar o CVV
function updateCC() {
  const f = $('#formCheckout');
  const d = f.number.value.replace(/\D/g, '').slice(0, 16);
  $('#ccNum').textContent = d ? d.replace(/(\d{4})(?=\d)/g, '$1 ') : '•••• •••• •••• ••••';
  $('#ccName').textContent = f.cname.value.toUpperCase() || 'NOME NO CARTÃO';
  $('#ccExp').textContent = f.expiry.value || 'MM/AA';
  $('#ccCvv').textContent = f.cvv.value || '•••';
}
{
  const f = $('#formCheckout');
  f.number.addEventListener('input', () => { f.number.value = f.number.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '); updateCC(); });
  f.expiry.addEventListener('input', () => { const d = f.expiry.value.replace(/\D/g, '').slice(0, 4); f.expiry.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; updateCC(); });
  f.cvv.addEventListener('input', () => { f.cvv.value = f.cvv.value.replace(/\D/g, ''); updateCC(); });
  f.cname.addEventListener('input', updateCC);
  f.cvv.addEventListener('focus', () => $('#cc').classList.add('flip'));
  f.cvv.addEventListener('blur', () => $('#cc').classList.remove('flip'));
}
$('#formCheckout').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, method = f.method.value;
  try {
    const r = await api('/orders', { method: 'POST', body: {
      items: state.cart.map(i => ({ id: i.id, qty: i.qty })), method, address: f.address.value, installments: f.installments.value,
      card: method === 'card' ? { number: f.number.value, name: f.cname.value, expiry: f.expiry.value, cvv: f.cvv.value } : undefined,
    } });
    state.cart = []; saveCart(); renderCart(); f.reset(); showPanel('pix'); updateCC();
    $('#dlgCheckout').close(); await load();
    showDone(r, method);
  } catch (err) { $('#coErr').textContent = err.message; }
});

// ---------- Pedidos ----------
const methodName = { pix: 'Pix', card: 'Cartão', boleto: 'Boleto' };
async function openOrders() {
  const orders = await api('/orders');
  $('#ordersList').innerHTML = orders.length ? orders.map(o => `
    <div class="order"><div><b>Pedido #${o.id}</b> <span class="badge">${esc(o.status)}</span></div>
      <div>${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join('<br>')}</div>
      <div>${methodName[o.method]} · ${brl(o.total)} · ${new Date(o.created_at).toLocaleDateString('pt-BR')}</div>
      ${o.payUrl ? `<a class="link-btn" href="${esc(o.payUrl)}" target="_blank" rel="noopener">Abrir link de pagamento Pix</a>` : ''}
      ${o.status !== 'Pago' ? `<button class="danger" data-cancel="${o.id}">Cancelar pedido</button>` : ''}</div>`).join('')
    : '<p class="hint">Você ainda não fez pedidos.</p>';
  $('#dlgOrders').showModal();
}
$('#btnOrders').onclick = () => openOrders().catch(e => toast(e.message));
$('#ordersList').addEventListener('click', async e => {
  const id = e.target.dataset.cancel; if (!id || !confirm('Cancelar este pedido?')) return;
  try { await api('/orders/' + id, { method: 'DELETE' }); await load(); openOrders(); toast('Pedido cancelado'); } catch (err) { toast(err.message); }
});

// ---------- Painel admin (CRUD) ----------
const pf = $('#formProduct');
function resetProdForm() { pf.reset(); pf.id.value = ''; pf.emoji.value = '💊'; $('#btnSaveProd').textContent = 'Adicionar produto'; $('#admErr').textContent = ''; }
function renderAdmin() {
  const opts = state.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#selBanCat').innerHTML = '<option value="">Sem botão</option>' + opts;
  $('#banAdmin').innerHTML = state.banners.map(b => `<span class="chip">${esc(b.title)}<button data-delban="${b.id}" aria-label="Excluir banner ${esc(b.title)}">✕</button></span>`).join('') || '<span class="hint">Nenhum banner.</span>';
  $('#formCfg').phone.value = state.cfg.phone ? fmtPhone(state.cfg.phone) : '';
  $('#selCat').innerHTML = state.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#catAdmin').innerHTML = state.cats.map(c => `<span class="chip">${esc(c.name)}<button data-delcat="${c.id}" aria-label="Excluir ${esc(c.name)}">✕</button></span>`).join('');
  $('#prodTable').innerHTML = '<tr><th></th><th>Produto</th><th>Preço</th><th>Est.</th><th></th></tr>' + state.products.map(p =>
    `<tr><td>${esc(p.emoji)}</td><td>${esc(p.name)}</td><td>${brl(p.price)}</td><td>${p.stock}</td>
     <td><button data-edit="${p.id}">Editar</button><button class="del" data-del="${p.id}">Excluir</button></td></tr>`).join('');
}
$('#btnAdmin').onclick = () => { resetProdForm(); renderAdmin(); $('#dlgAdmin').showModal(); };
$('#btnCancelEdit').onclick = resetProdForm;
pf.addEventListener('submit', async e => {
  e.preventDefault();
  const body = { name: pf.name.value, description: pf.description.value, price: +pf.price.value, stock: +pf.stock.value, emoji: pf.emoji.value, image: pf.image.value, category_id: +pf.category_id.value };
  try {
    pf.id.value ? await api('/products/' + pf.id.value, { method: 'PUT', body }) : await api('/products', { method: 'POST', body });
    toast(pf.id.value ? 'Produto atualizado' : 'Produto adicionado'); resetProdForm(); await load(); renderAdmin();
  } catch (err) { $('#admErr').textContent = err.message; }
});
$('#prodTable').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.edit) {
    const p = state.products.find(x => x.id == t.dataset.edit);
    pf.id.value = p.id; pf.name.value = p.name; pf.description.value = p.description; pf.price.value = p.price;
    pf.stock.value = p.stock; pf.emoji.value = p.emoji; pf.image.value = p.image || ''; updatePrev(); pf.category_id.value = p.category_id;
    $('#btnSaveProd').textContent = 'Salvar produto'; pf.scrollIntoView({ behavior: 'smooth' });
  }
  if (t.dataset.del && confirm('Excluir este produto?')) {
    try { await api('/products/' + t.dataset.del, { method: 'DELETE' }); toast('Produto excluído'); await load(); renderAdmin(); } catch (err) { toast(err.message); }
  }
});
$('#formCat').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/categories', { method: 'POST', body: { name: e.target.name.value } }); e.target.reset(); await load(); renderAdmin(); }
  catch (err) { $('#admErr').textContent = err.message; }
});
$('#catAdmin').addEventListener('click', async e => {
  const id = e.target.dataset.delcat; if (!id || !confirm('Excluir esta categoria?')) return;
  try { await api('/categories/' + id, { method: 'DELETE' }); await load(); renderAdmin(); } catch (err) { $('#admErr').textContent = err.message; }
});

// ---------- Ilustrações dos produtos ----------
const COLORS = ['#56705f', '#5f6f80', '#7b6c5d', '#566b73', '#6d7358', '#6f6275'];
const KINDS = [
  [/escova/, 'escova'], [/fralda/, 'pack'], [/len[cç]o/, 'lenco'], [/desodorante/, 'roll'],
  [/s[ée]rum|protetor/, 'serum'], [/creme|pomada|gel |dental|pasta/, 'tubo'],
  [/sabonete|shampoo|hidratante|lo[cç][aã]o|condicionador/, 'pump'], [/soro|xarope|col[ií]rio|spray/, 'frasco'],
  [/vitamina|[oô]mega|multivit|c[aá]lcio|col[aá]geno|suplemento/, 'pote'],
];
const kindOf = n => (KINDS.find(([re]) => re.test(n.toLowerCase())) || [0, 'caixa'])[1];
function labelOf(n) {
  const w = n.split(/[ ,]+/); const two = w[1] ? `${w[0]} ${w[1]}` : w[0];
  return esc((two.length <= 10 ? two : w[0]).slice(0, 10));
}
function svgArt(p) {
  const c = COLORS[[...p.name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % COLORS.length], t = labelOf(p.name);
  const A = `style="fill:${c}"`, T = y => `<text x="80" y="${y}" text-anchor="middle" class="a-tw">${t}</text>`;
  const shapes = {
    caixa: `<rect class="a-body" x="38" y="36" width="84" height="100" rx="6"/><rect ${A} x="38" y="36" width="84" height="26" rx="6"/>${T(54)}<path d="M72 106h16M80 98v16" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
    frasco: `<rect class="a-body" x="52" y="58" width="56" height="78" rx="10"/><rect class="a-body" x="66" y="40" width="28" height="18" rx="3"/><rect ${A} x="62" y="30" width="36" height="12" rx="3"/><rect ${A} x="52" y="82" width="56" height="34"/>${T(103)}`,
    pote: `<rect class="a-body" x="50" y="60" width="60" height="76" rx="8"/><rect ${A} x="46" y="40" width="68" height="20" rx="5"/><rect ${A} x="50" y="82" width="60" height="36"/>${T(104)}`,
    tubo: `<path class="a-body" d="M54 44h52l-6 82H60z"/><rect ${A} x="54" y="34" width="52" height="10" rx="2"/><rect ${A} x="66" y="126" width="28" height="14" rx="3"/><text x="80" y="90" text-anchor="middle" class="a-t">${t}</text>`,
    pack: `<path d="M64 50c0-16 32-16 32 0" fill="none" stroke="var(--ink)" stroke-width="2"/><rect class="a-body" x="34" y="50" width="92" height="86" rx="10"/><rect ${A} x="34" y="82" width="92" height="34"/>${T(103)}`,
    lenco: `<path d="M74 62c0-14 10-18 14-28" fill="none" stroke="var(--ink)" stroke-width="2"/><rect class="a-body" x="36" y="76" width="88" height="60" rx="10"/><rect ${A} x="36" y="62" width="88" height="18" rx="6"/><text x="80" y="112" text-anchor="middle" class="a-t">${t}</text>`,
    pump: `<rect class="a-body" x="54" y="66" width="52" height="70" rx="12"/><rect class="a-body" x="74" y="50" width="12" height="16"/><rect ${A} x="70" y="40" width="36" height="9" rx="3"/><rect ${A} x="54" y="88" width="52" height="28"/>${T(106)}`,
    roll: `<rect class="a-body" x="58" y="64" width="44" height="72" rx="14"/><rect ${A} x="62" y="40" width="36" height="28" rx="14"/><text x="80" y="106" text-anchor="middle" class="a-t">${t}</text>`,
    escova: `<g transform="rotate(-25 80 80)"><rect class="a-body" x="72" y="34" width="16" height="104" rx="8"/><rect ${A} x="68" y="22" width="24" height="30" rx="6"/><rect x="70" y="12" width="20" height="12" rx="2" fill="#aab0ae"/></g>`,
    serum: `<rect class="a-body" x="56" y="70" width="48" height="66" rx="10"/><rect ${A} x="66" y="52" width="28" height="18" rx="3"/><rect ${A} x="70" y="28" width="20" height="26" rx="10"/><rect ${A} x="56" y="92" width="48" height="26"/>${T(109)}`,
  };
  return `<svg viewBox="0 0 160 160" role="img" aria-label="${esc(p.name)}"><ellipse class="a-sh" cx="80" cy="144" rx="42" ry="6"/>${shapes[kindOf(p.name)]}</svg>`;
}
function art(p) {
  return p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer" data-pid="${p.id}">` : svgArt(p);
}
// se a foto não carregar, volta para a ilustração
document.addEventListener('error', e => {
  const im = e.target; if (im.tagName !== 'IMG' || !im.dataset.pid) return;
  const p = state.products.find(x => x.id == im.dataset.pid); if (p) im.outerHTML = svgArt(p);
}, true);
const thumb = i => { const p = state.products.find(x => x.id === i.id); return p ? art(p) : esc(i.emoji); };

// ---------- Animações de clique ----------
function fly(src) {
  if (!src || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = src.getBoundingClientRect(), b = $('#btnCart').getBoundingClientRect();
  const g = src.cloneNode(true); g.classList.add('fly');
  Object.assign(g.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  document.body.append(g);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  g.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * .5}px,${dy * .5 - 60}px) scale(.6) rotate(12deg)`, opacity: .9, offset: .5 },
    { transform: `translate(${dx}px,${dy}px) scale(.1) rotate(25deg)`, opacity: .3 }],
    { duration: 750, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => g.remove();
}
function openProduct(id) {
  const p = state.products.find(x => x.id === id); if (!p) return;
  let qty = 1;
  $('#prodBody').innerHTML = `<div class="big" id="bigArt">${art(p)}</div>
    <h2>${esc(p.name)}</h2><p class="hint">${esc(p.description)}</p>
    <div class="price">${brl(p.price)}<small>${brl(p.price * 0.95)} no Pix</small></div>
    ${p.stock < 10 && p.stock > 0 ? `<span class="stock">Restam ${p.stock}</span>` : ''}
    <div class="big-qty"><button type="button" data-q="-1" aria-label="Diminuir">−</button><b id="mq">1</b><button type="button" data-q="1" aria-label="Aumentar">+</button></div>
    <button class="primary" id="mAdd" ${p.stock < 1 ? 'disabled' : ''}>${p.stock < 1 ? 'Indisponível' : 'Adicionar ao carrinho'}</button>`;
  $('#prodBody').onclick = e => {
    const q = e.target.dataset.q; if (!q) return;
    qty = Math.min(Math.max(1, qty + +q), Math.max(1, p.stock)); $('#mq').textContent = qty;
  };
  $('#mAdd').onclick = () => { if (addToCart(id, qty, $('#bigArt').firstElementChild)) setTimeout(() => $('#dlgProduct').close(), 350); };
  $('#dlgProduct').showModal();
}

// ---------- Confirmação do pedido: Pix com QR Code ----------
let pollTimer;
$('#dlgDone').addEventListener('close', () => clearInterval(pollTimer));
const successMark = () => '<svg class="ok" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M14 27l8 8 16-17"/></svg>';
function markPaid() {
  const w = $('#qrWrap'); if (!w) return;
  document.querySelectorAll('#doneBody .wait, #doneBody .code, #copyPix, #doneBody .link-btn, #doneBody .hint').forEach(n => n.remove());
  w.outerHTML = successMark();
  $('#doneBody').insertAdjacentHTML('beforeend', '<p><b>Pagamento aprovado!</b></p>'); toast('Pagamento confirmado');
}
function showDone(r, method) {
  clearInterval(pollTimer);
  let html = `<h2>Pedido #${r.id} confirmado</h2><p>Total: <b>${brl(r.total)}</b></p>`;
  if (r.status === 'Pago') html += `${successMark()}<p><b>Pagamento aprovado!</b></p>`;
  else if (method === 'pix') html += `${r.pixQr ? `<div class="qr-wrap" id="qrWrap"><img class="qr" src="${r.pixQr}" alt="QR Code do pagamento Pix"><i class="scan"></i></div>` : ''}
    <p class="wait"><span class="dot"></span> Aguardando pagamento…</p>
    <p class="hint">Escaneie o QR Code com a câmera do celular. Ele abre o link de pagamento (demonstração).</p>
    <a class="link-btn" href="${esc(r.payUrl)}" target="_blank" rel="noopener">Abrir link de pagamento</a>
    <div class="code">${esc(r.pixCode)}</div><button type="button" class="link" id="copyPix">Copiar código</button>`;
  else html += `<p>${esc(r.status)}</p><p>Linha digitável (simulada):</p><div class="code">${esc(r.boleto)}</div>`;
  html += '<p class="hint">Ambiente de demonstração: nenhuma cobrança real foi feita.</p>';
  $('#doneBody').innerHTML = html;
  const cp = $('#copyPix');
  if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(r.pixCode); toast('Código copiado'); } catch { prompt('Copie o código:', r.pixCode); } };
  if (method === 'pix' && r.status !== 'Pago') {
    pollTimer = setInterval(async () => {
      try { const s = await api(`/orders/${r.id}/status`); if (s.status === 'Pago') { clearInterval(pollTimer); markPaid(); load(); } } catch {}
    }, 3000);
  }
  $('#dlgDone').showModal();
}

// ---------- Prévia da foto no painel ----------
const prev = $('#imgPrev');
function updatePrev() {
  let v = pf.image.value.trim();
  const g = v.match(/drive\.google\.com\/file\/d\/([\w-]+)/); if (g) v = `https://drive.google.com/uc?export=view&id=${g[1]}`;
  if (v && !/^(https?:\/\/|\/)/i.test(v)) v = 'https://' + v;
  prev.classList.toggle('hidden', !v); if (v) prev.src = v;
}
prev.onerror = () => prev.classList.add('hidden');
pf.image.addEventListener('input', updatePrev);
pf.addEventListener('reset', () => setTimeout(updatePrev));

// ---------- App instalável e ajuste de altura do cabeçalho ----------
if ('ResizeObserver' in window) new ResizeObserver(() =>
  document.documentElement.style.setProperty('--hh', document.querySelector('.header').offsetHeight + 'px')).observe(document.querySelector('.header'));
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

// ---------- Contato do farmacêutico ----------
const fmtPhone = p => {
  const d = String(p || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
};
function applyConfig() {
  const p = state.cfg.phone || '';
  const url = p ? `https://wa.me/${p}?text=${encodeURIComponent('Olá! Preciso falar com o farmacêutico.')}` : '';
  const wa = $('#waBtn'); wa.classList.toggle('hidden', !p); if (p) wa.href = url;
}
api('/config').then(c => { state.cfg = c; applyConfig(); }).catch(() => {});
$('#formCfg').addEventListener('submit', async e => {
  e.preventDefault();
  try { state.cfg = await api('/config', { method: 'PUT', body: { phone: e.target.phone.value } }); applyConfig(); $('#admErr').textContent = ''; toast('Contato salvo'); }
  catch (err) { $('#admErr').textContent = err.message; }
});

// ---------- CEP ----------
function renderCep() {
  $('#cepLabel').textContent = state.cep ? `${state.cep.city}/${state.cep.uf} · ${state.cep.cep}` : 'informe seu CEP';
}
renderCep();
$('#btnCep').onclick = () => { $('#cepErr').textContent = ''; $('#cepRes').textContent = ''; $('#dlgCep').showModal(); $('#formCep').cep.focus(); };
$('#formCep').cep.addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 8); e.target.value = d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
});
$('#formCep').addEventListener('submit', async e => {
  e.preventDefault();
  const d = e.target.cep.value.replace(/\D/g, '');
  if (d.length !== 8) return ($('#cepErr').textContent = 'Digite um CEP com 8 números.');
  $('#cepErr').textContent = ''; $('#cepRes').textContent = 'Buscando…';
  try {
    const r = await (await fetch(`https://viacep.com.br/ws/${d}/json/`)).json();
    if (r.erro) throw new Error('CEP não encontrado.');
    state.cep = { cep: `${d.slice(0, 5)}-${d.slice(5)}`, street: r.logradouro, district: r.bairro, city: r.localidade, uf: r.uf };
    localStorage.setItem('cep', JSON.stringify(state.cep)); renderCep();
    $('#cepRes').textContent = `${[r.logradouro, r.bairro].filter(Boolean).join(', ')} — ${r.localidade}/${r.uf}. Frete R$ 12,90 (grátis acima de R$ 150).`;
    toast('CEP atualizado'); setTimeout(() => $('#dlgCep').close(), 1400);
  } catch (err) { $('#cepRes').textContent = ''; $('#cepErr').textContent = err.message === 'CEP não encontrado.' ? err.message : 'Não foi possível consultar o CEP agora. Tente de novo.'; }
});

// ---------- Carrossel de banners ----------
const car = { i: 0, n: 0, timer: null, paused: false };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function renderBanners() {
  const list = state.banners || [];
  $('#banners').classList.toggle('hidden', !list.length);
  $('#bTrack').innerHTML = list.map((b, i) => {
    const items = state.products.filter(p => p.category_id === b.category_id).slice(0, 3).map(art).join('');
    return `<article class="slide tone${i % 4}${b.image ? ' photo' : ''}" aria-roledescription="slide" aria-label="${i + 1} de ${list.length}">
      ${b.image ? `<img class="b-photo" src="${esc(b.image)}" alt="" referrerpolicy="no-referrer">` : ''}
      <div class="b-copy"><h2>${esc(b.title)}</h2><p>${esc(b.text)}</p>${b.category_id ? `<button type="button" class="b-cta" data-cat="${b.category_id}">Ver produtos</button>` : ''}</div>
      ${!b.image && items ? `<div class="b-art" aria-hidden="true">${items}</div>` : ''}</article>`;
  }).join('');
  $('#bDots').innerHTML = list.map((_, i) => `<button type="button" class="dot-b" data-go="${i}" aria-label="Ir para o banner ${i + 1}"></button>`).join('');
  car.n = list.length; goBanner(Math.min(car.i, Math.max(0, car.n - 1))); autoplay();
}
function goBanner(i) {
  if (!car.n) return;
  car.i = (i + car.n) % car.n;
  $('#bTrack').style.transform = `translateX(-${car.i * 100}%)`;
  document.querySelectorAll('.slide').forEach((s, k) => s.classList.toggle('on', k === car.i));
  document.querySelectorAll('.dot-b').forEach((d, k) => d.setAttribute('aria-current', String(k === car.i)));
}
function autoplay() {
  clearInterval(car.timer);
  if (reduceMotion || car.paused || car.n < 2) return;
  car.timer = setInterval(() => goBanner(car.i + 1), 5500);
}
function openCategory(id) {
  state.active = +id; state.q = ''; $('#search').value = ''; renderTabs(); renderGrid();
  $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const bn = $('#banners');
bn.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('.prev')) goBanner(car.i - 1);
  else if (t.closest('.next')) goBanner(car.i + 1);
  else if (t.dataset.go) goBanner(+t.dataset.go);
  else if (t.dataset.cat) return openCategory(t.dataset.cat);
  else if (t.id === 'bPause') {
    car.paused = !car.paused; t.textContent = car.paused ? 'Reproduzir' : 'Pausar'; t.setAttribute('aria-label', car.paused ? 'Reproduzir banners' : 'Pausar banners');
  } else return;
  autoplay();
});
bn.addEventListener('mouseenter', () => clearInterval(car.timer));
bn.addEventListener('mouseleave', autoplay);
let tx = null;
bn.addEventListener('touchstart', e => { tx = e.touches[0].clientX; clearInterval(car.timer); }, { passive: true });
bn.addEventListener('touchend', e => {
  if (tx !== null) { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 40) goBanner(car.i + (dx < 0 ? 1 : -1)); }
  tx = null; autoplay();
});

// ---------- Painel: banners ----------
$('#formBan').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  try {
    await api('/banners', { method: 'POST', body: { title: f.title.value, text: f.text.value, image: f.image.value, category_id: +f.category_id.value || null } });
    e.target.reset(); $('#admErr').textContent = ''; await load(); renderAdmin(); toast('Banner adicionado');
  } catch (err) { $('#admErr').textContent = err.message; }
});
$('#banAdmin').addEventListener('click', async e => {
  const id = e.target.dataset.delban; if (!id || !confirm('Excluir este banner?')) return;
  try { await api('/banners/' + id, { method: 'DELETE' }); await load(); renderAdmin(); } catch (err) { $('#admErr').textContent = err.message; }
});

renderCart(); restore(); load();
