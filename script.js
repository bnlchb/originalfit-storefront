/* ============ ORIGINALFIT — interactions ============ */

// Produits de secours (utilisés si Supabase est injoignable)
const FALLBACK_PRODUCTS = [
  {id:1,name:'Sneakers sport',type:'Chaussures · visuel d’inspiration',category:'bas',image:'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=900&q=80',tag:'Style sport'},
  {id:2,name:'T-shirt training',type:'Haut · visuel d’inspiration',category:'haut',image:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80',tag:'Essentiel'},
  {id:3,name:'Veste sport',type:'Haut · visuel d’inspiration',category:'haut',image:'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=80',tag:'Layering'},
  {id:4,name:'Sac crossbody',type:'Accessoire · visuel d’inspiration',category:'accessoires',image:'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80',tag:'Accessoire'},
  {id:5,name:'Short training',type:'Bas · visuel d’inspiration',category:'bas',image:'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?auto=format&fit=crop&w=900&q=80',tag:'Training'},
  {id:6,name:'Hoodie sport',type:'Haut · visuel d’inspiration',category:'haut',image:'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80',tag:'Daily fit'}
];

let products = FALLBACK_PRODUCTS.slice();
let sizeIds = {};            // libellé taille -> id Supabase
let selection = [];
let filter = 'Tout';

const grid = document.getElementById('product-grid');

// Vérifie que config.js est bien rempli
const supabaseReady =
  typeof SUPABASE_URL === 'string' && SUPABASE_URL.startsWith('http') &&
  typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 30 &&
  (SUPABASE_ANON_KEY.startsWith('eyJ') || SUPABASE_ANON_KEY.startsWith('sb_publishable_'));

// ---------- Appels à l'API Supabase (PostgREST) ----------
async function api(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status} : ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

// Charge produits + tailles depuis la base
async function loadData() {
  if (!supabaseReady) return;
  try {
    const [rows, sizes] = await Promise.all([
      api('products?select=id,name,type_label,image_url,tag,category:categories(slug,name)&is_active=eq.true&order=id.asc'),
      api('sizes?select=id,label')
    ]);
    if (rows.length) {
      products = rows.map(r => ({
        id: Number(r.id),
        name: r.name,
        type: r.type_label,
        category: r.category ? r.category.slug : '',
        image: r.image_url,
        tag: r.tag || ''
      }));
      renderProducts();
    }
    sizeIds = Object.fromEntries(sizes.map(s => [s.label, Number(s.id)]));
  } catch (err) {
    console.warn('Supabase injoignable → produits locaux utilisés.', err);
  }
}

// ---------- Produits ----------
function renderProducts(){
  grid.innerHTML = products
    .filter(p => filter === 'Tout' || p.category === filter)
    .map(p => `<article class="card"><div class="card-img"><img src="${p.image}" alt="Visuel d’inspiration : ${p.name}" loading="lazy"><span class="card-chip">${p.tag}</span></div><div class="card-content"><div class="card-top"><div><h3>${p.name}</h3><p class="card-type">${p.type}</p></div><span class="ask-price">Prix sur demande</span></div><div class="card-actions"><select class="size" aria-label="Taille souhaitée pour ${p.name}"><option value="">Taille souhaitée</option><option>XS</option><option>S</option><option>M</option><option>L</option><option>XL</option><option>Unique</option></select><button class="add" data-id="${p.id}">+ Ajouter</button></div><p class="card-note">Disponibilité à confirmer avec Originalfit</p></div></article>`)
    .join('');

  grid.querySelectorAll('.add').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('.card');
    const size = card.querySelector('.size').value;
    if (!size) { toast('Choisis la taille souhaitée.'); return; }
    const product = products.find(p => p.id === Number(button.dataset.id));
    if (!product) return;
    selection.push({ product, size });
    renderSelection();
    toast('Ajouté à ta sélection ✓');
  }));
}

// ---------- Sélection ----------
function renderSelection(){
  document.getElementById('selection-count').textContent = selection.length;
  document.getElementById('panel-count').textContent = `(${selection.length})`;
  const list = document.getElementById('selection-list');
  list.innerHTML = selection.length
    ? selection.map((item, index) => `<div class="selection-item"><img src="${item.product.image}" alt=""><div><strong>${item.product.name}</strong><small>Taille souhaitée : ${item.size}<br>Prix et disponibilité à confirmer</small></div><button class="remove" data-index="${index}">Retirer</button></div>`).join('')
    : '<p class="empty">Ta sélection est vide. Choisis les styles que tu aimerais demander à Originalfit.</p>';
  list.querySelectorAll('.remove').forEach(button => button.addEventListener('click', () => {
    selection.splice(Number(button.dataset.index), 1);
    renderSelection();
  }));
}

// ---------- Envoi de la demande à Supabase ----------
async function submitRequest(event){
  event.preventDefault();
  if (!selection.length) { toast('Ajoute d’abord un style à ta sélection.'); return; }

  const clientName = document.getElementById('req-name').value.trim();
  const clientCity = document.getElementById('req-city').value.trim();
  const instagram  = document.getElementById('req-instagram').value.trim();
  if (!clientName || !clientCity) { toast('Indique ton prénom et ta ville.'); return; }

  if (!supabaseReady) {
    toast('Envoi non configuré — écris-nous sur Instagram.');
    window.open(INSTAGRAM_URL, '_blank', 'noopener');
    return;
  }

  const button = document.getElementById('req-send');
  button.disabled = true;
  button.textContent = 'Envoi en cours…';
  try {
    await api('rpc/creer_demande', {
      method: 'POST',
      body: {
        p_client_name: clientName,
        p_client_city: clientCity,
        p_instagram: instagram || null,
        p_items: selection.map(item => ({
          product_id: item.product.id,
          size_id: sizeIds[item.size] || null,
          quantity: 1
        }))
      }
    });
    selection = [];
    renderSelection();
    document.getElementById('request-form').reset();
    showPanel(false);
    toast('Sélection envoyée ✓ On te répond vite.');
  } catch (err) {
    console.error(err);
    toast('Erreur d’envoi. Réessaie ou écris sur Instagram.');
  } finally {
    button.disabled = false;
    button.textContent = 'Envoyer ma sélection ↗';
  }
}

// ---------- Divers ----------
function toast(message){
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2200);
}

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  filter = button.dataset.filter;
  renderProducts();
}));

const backdrop = document.getElementById('panel-backdrop');
function showPanel(open){
  backdrop.classList.toggle('open', open);
  backdrop.setAttribute('aria-hidden', String(!open));
}
document.getElementById('selection-open').addEventListener('click', () => showPanel(true));
document.getElementById('panel-close').addEventListener('click', () => showPanel(false));
backdrop.addEventListener('click', event => { if (event.target === backdrop) showPanel(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') showPanel(false); });

document.getElementById('request-form').addEventListener('submit', submitRequest);

document.getElementById('menu-btn').addEventListener('click', () => document.getElementById('nav-links').classList.toggle('open'));
document.querySelectorAll('.nav-links a').forEach(link => link.addEventListener('click', () => document.getElementById('nav-links').classList.remove('open')));

const observer = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
}), { threshold: .12 });
document.querySelectorAll('.reveal').forEach(node => observer.observe(node));

renderProducts();
renderSelection();
loadData();
