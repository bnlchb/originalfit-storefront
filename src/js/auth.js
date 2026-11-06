/* ============================================================================
   THE ORIGINAL FIT — auth.js
   Supabase authentication + login page + account (profile / orders / wishlist).
   ============================================================================ */
'use strict';

window.TOF = window.TOF || {};

(function authModule(T) {
  let sessionUser = null;   // { id, email, fullName, phone }
  let resolveUser;
  const userReady = new Promise((r) => { resolveUser = r; });

  T.auth = {
    ready: () => userReady,
    user: () => sessionUser,
    loggedIn: () => !!sessionUser,
  };

  /* ------------------------------------------------------------- bootstrap -- */
  async function fetchUser() {
    if (!T.sb) { resolveUser(); return null; }
    try {
      const { data, error } = await T.sb.auth.getSession();
      if (error) throw error;
      sessionUser = mapUser(data.session && data.session.user);
      T.wishlist.setUserId(sessionUser && sessionUser.id);
      resolveUser();
    } catch (err) {
      console.warn('[TOF] session fetch failed:', err && err.message);
      resolveUser();
    }
    return sessionUser;
  }

  function mapUser(u) {
    if (!u) return null;
    const meta = u.user_metadata || {};
    return {
      id: u.id,
      email: u.email || '',
      fullName: meta.full_name || '',
      phone: meta.phone || '',
    };
  }

  const bootAuth = () => {
    fetchUser();

    if (T.sb && T.sb.auth) {
      T.sb.auth.onAuthStateChange((_event, session) => {
        sessionUser = mapUser(session && session.user);
        T.wishlist.setUserId(sessionUser && sessionUser.id);
        document.dispatchEvent(new CustomEvent('tof:auth'));
      });
    }
    document.dispatchEvent(new CustomEvent('tof:auth'));
  };

  /* Supabase mode boots immediately; while mode is still pending (rare) wait
     so demo/local state stays correct. */
  if (T.mode && T.mode !== 'pending') bootAuth();
  else T.whenReady().then(bootAuth);

  /* -------------------------------------------------------------- actions -- */
  function demoGuard() {
    if (T.mode !== 'demo') return null;
    setTimeout(() => T.toast('Supabase is not connected — accounts need the backend (see README).'), 0);
    return { ok: false, demo: true };
  }

  T.auth.signUp = async (fullName, email, password) => {
    if (!T.mode || T.mode === 'pending') await T.whenReady();
    if (demoGuard()) return { ok: false, error: 'Connect Supabase to enable accounts — see README (2-minute setup).' };
    const { data, error } = await T.sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { ok: false, error: friendly(error) };
    const needsConfirm = !data.session;
    if (data.user && !needsConfirm && T.sb) T.wishlist.syncOnLogin(data.user.id);
    return { ok: true, needsConfirm, user: mapUser(data.user) };
  };

  T.auth.signIn = async (email, password) => {
    if (demoGuard()) return { ok: false, error: 'Connect Supabase to enable accounts — see README (2-minute setup).' };
    const { data, error } = await T.sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: friendly(error) };
    if (data.user) {
      T.wishlist.setUserId(data.user.id);
      T.wishlist.syncOnLogin(data.user.id);
    }
    return { ok: true, user: mapUser(data.user) };
  };

  T.auth.signOut = async () => {
    if (T.sb) {
      try { await T.sb.auth.signOut(); } catch (err) { console.warn(err); }
    }
    sessionUser = null;
    document.dispatchEvent(new CustomEvent('tof:auth'));
    T.toast('Signed out. See you soon.');
  };

  T.auth.resetPassword = async (email) => {
    if (demoGuard()) return { ok: false };
    const { error } = await T.sb.auth.resetPasswordForEmail(email);
    return { ok: !error, error };
  };

  T.auth.updateProfile = async (fields) => {
    if (!sessionUser) return { ok: false, error: 'Not signed in.' };
    if (T.sb) {
      const { error } = await T.sb.from('profiles')
        .update({ full_name: fields.fullName, phone: fields.phone })
        .match({ id: sessionUser.id });
      if (error) {
        console.warn('[TOF] profile update:', error.message);
        return { ok: false, error: /permission|row level/i.test(error.message || '')
          ? 'Profile updates need the schema (supabase/schema.sql) to be applied.'
          : 'Could not save your profile — try again.' };
      }
    }
    document.dispatchEvent(new CustomEvent('tof:auth'));
    return { ok: true };
  };

  async function loadProfile() {
    if (!T.sb || !sessionUser) return {};
    const { data, error } = await T.sb.from('profiles')
      .select('full_name, phone, email, created_at')
      .match({ id: sessionUser.id })
      .maybeSingle();
    if (error || !data) return {};
    return data;
  }

  function friendly(err) {
    const msg = (err && err.message) || '';
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/at least 6 characters|password.*least/i.test(msg)) return 'Password must be at least 6 characters.';
    if (/already registered/i.test(msg)) return 'This email already has an account — sign in instead.';
    if (/valid email/i.test(msg)) return 'Please enter a valid email address.';
    if (/rate/i.test(msg)) return 'Too many attempts — try again in a minute.';
    return msg || 'Something went wrong. Please try again.';
  }

  /* ------------------------------------------------------------ login page -- */
  function initLoginPage() {
    const shell = document.getElementById('page-login');
    if (!shell) return;

    // if already signed in → straight to account
    T.auth.ready().then(() => {
      if (sessionUser) {
        location.replace(T.url('account.html'));
      } else if (T.mode === 'demo') {
        const note = document.getElementById('auth-demo-note');
        if (note) note.hidden = false;
      }
    });

    const tabs = shell.querySelectorAll('.auth-tab');
    const formIn = shell.querySelector('form[data-mode="signin"]');
    const formUp = shell.querySelector('form[data-mode="signup"]');

    function switchMode(mode) {
      tabs.forEach((t) => t.classList.toggle('is-on', t.dataset.mode === mode));
      formIn.hidden = mode !== 'signin';
      formUp.hidden = mode !== 'signup';
    }
    tabs.forEach((t) => t.addEventListener('click', () => switchMode(t.dataset.mode)));
    switchMode('signin');

    function bindForm(form, action, btnLabel) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const errBox = form.querySelector('.form-error');
        const fname = (form.querySelector('input[name="full_name"]') || {}).value || '';
        const email = form.querySelector('input[name="email"]').value.trim();
        const pw = form.querySelector('input[name="password"]').value;

        errBox.hidden = true;

        // password visibility reset
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> ' + (form.dataset.mode === 'signup' ? 'Creating account…' : 'Signing in…');

        const res = await (action === 'signup'
          ? T.auth.signUp(fname && fname.trim(), email, pw)
          : T.auth.signIn(email, pw));

        if (!res.ok) {
          btn.disabled = false;
          btn.textContent = btnLabel;
          errBox.textContent = res.error || 'Something went wrong.';
          errBox.hidden = false;
          return;
        }

        if (res.needsConfirm) {
          btn.disabled = false;
          btn.textContent = btnLabel;
          errBox.textContent = 'Account created! Check your inbox to confirm your email, then sign in.';
          errBox.className = 'form-error form-success-on';
          errBox.hidden = false;
          errBox.style.background = '#f2f6f2';
          errBox.style.borderColor = '#d8e6d8';
          errBox.style.color = '#3d5c3d';
          return;
        }

        const next = new URLSearchParams(location.search).get('next');
        location.href = next || T.url('account.html');
      });
    }
    bindForm(formIn, 'signin', 'Sign In');
    bindForm(formUp, 'signup', 'Create Account');

    // password toggles
    shell.querySelectorAll('.pw-wrap').forEach((w) => {
      const input = w.querySelector('input');
      const btn = w.querySelector('.pw-toggle');
      if (!btn) return;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/></svg>';
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });

    // forgot password
    const forgot = shell.querySelector('#forgot-link');
    if (forgot) {
      forgot.addEventListener('click', async (e) => {
        e.preventDefault();
        const emailInput = formIn.querySelector('input[name="email"]');
        let email = emailInput.value.trim();
        if (!email) { email = window.prompt('Password reset for which email address?') || ''; }
        if (!email) return;
        const res = await T.auth.resetPassword(email);
        T.toast(res.ok ? 'Password reset email sent.' : 'Could not send reset email — check the address.');
      });
    }
  }

  /* ---------------------------------------------------------- account page -- */
  function initAccountPage() {
    const shell = document.getElementById('page-account');
    if (!shell) return;

    T.auth.ready().then(async () => {
      if (!sessionUser) {
        location.replace(T.url('login.html') + '?next=' + encodeURIComponent('account.html'));
        return;
      }

      const profile = await loadProfile();
      const fullName = profile.full_name || sessionUser.fullName || 'MEMBER';
      document.getElementById('acc-greeting').textContent = 'Hi, ' + (fullName.split(' ')[0] || 'Member');

      // profile form
      const nameInput = document.getElementById('acc-name');
      const emailInput = document.getElementById('acc-email');
      const phoneInput = document.getElementById('acc-phone');
      const joinedEl = document.getElementById('acc-joined');
      nameInput.value = profile.full_name || sessionUser.fullName || '';
      emailInput.value = profile.email || sessionUser.email;
      phoneInput.value = profile.phone || '';
      if (profile.created_at || sessionUser.createdAt) joinedEl.textContent = fmtDate(profile.created_at || Date.now());

      const profForm = document.getElementById('profile-form');
      profForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await T.auth.updateProfile({
          fullName: nameInput.value.trim(), phone: phoneInput.value.trim(),
        });
        T.toast(res.ok ? 'Profile saved.' : (res.error || 'Could not save profile'));
        document.getElementById('acc-greeting').textContent = 'Hi, ' + (nameInput.value.trim().split(' ')[0] || 'Member');
      });

      // sign out
      document.getElementById('acc-signout').addEventListener('click', async () => {
        await T.auth.signOut();
        location.href = T.url('login.html');
      });

      await Promise.all([renderOrders(), renderWishlistShelf()]);
    });
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return '—'; }
  }

  async function renderOrders() {
    const box = document.getElementById('orders-box');
    box.innerHTML = '<div class="skeleton sk-line w60"></div><div class="skeleton sk-line w40"></div>';
    const res = await T.api.listMyOrders();
    const orders = (res.data && res.data.length) ? res.data : [];
    if (T.mode === 'demo') {
      box.innerHTML = '<p class="order-empty-note">Orders appear after you connect Supabase and place your first order.</p>';
      return;
    }
    if (!orders.length) {
      box.innerHTML = '<p class="order-empty-note">No orders yet. Your first order will show up here.</p>';
      return;
    }
    box.innerHTML = orders.map((o) => `
      <div class="order-card">
        <div class="order-top">
          <span class="oid">#${String(o.id).slice(0, 8).toUpperCase()}</span>
          <span class="status-pill ${o.status}">${o.status}</span>
          <span class="oid">${fmtDate(o.created_at)}</span>
        </div>
        <ul class="order-items">
          ${(o.items || []).map((it) => `
            <li>
              <span>${it.quantity} × ${T.esc((it.product && it.product.name) || 'Item')}</span>
              <span>${T.money(it.unit_price * it.quantity)}</span>
            </li>`).join('')}
        </ul>
        <div class="order-total"><span>Total paid</span><span>${T.money(o.total_amount)}</span></div>
      </div>`).join('');
  }

  async function renderWishlistShelf() {
    const box = document.getElementById('wishlist-grid');
    box.innerHTML = T.products.skeletonCardsEl ? T.products.skeletonCardsEl(4) : `
      <div class="skeleton sk-media"></div><div class="skeleton sk-media"></div>`;
    const items = await T.wishlist.hydrated();
    if (!items.length) {
      box.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <p>Your wishlist is empty. Tap the heart on any product to save it here.</p>
          <a class="btn" href="${T.url('shop.html')}">Browse the shop <span class="arrow">→</span></a>
        </div>`;
      return;
    }
    box.classList.add('cols-3');
    await T.products.renderCards(box, items, { base: T.base });
  }

  /* global wishlist re-render (e.g. heart removed while viewing account) */
  document.addEventListener('tof:wishlist', () => {
    if (document.getElementById('page-account')) renderWishlistShelf();
  });

  T.whenReady().then(() => {
    initLoginPage();
    initAccountPage();
  });
})(window.TOF);
