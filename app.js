/* =============================================================
 * Household Finance — app.js
 *
 * A dependency-free, offline-first budgeting app.
 *
 * Architecture (module pattern, three clean layers):
 *   • Utils   — small pure helpers (dates, numbers, escaping)
 *   • Store   — the ONLY code that talks to localStorage
 *   • Model   — data shape, defaults, migrations, CRUD
 *   • Calc    — pure business logic / derived numbers
 *   • UI      — Toast, Modal, Form: generic presentation primitives
 *   • Render  — turns state into DOM
 *   • App     — wiring, events, bootstrap
 *
 * Data shape (schema 1):
 * {
 *   schema: 1,
 *   settings: { currency: "USD", theme: "light" | "dark" },
 *   months: {
 *     "2026-09": {
 *       income:      [{ id, name, planned, actual, note }],
 *       categories:  [{ id, name, planned, note }],
 *       allocations: [{ id, name, planned, actual, note }],
 *       transactions:[{ id, date, type, refId, description, amount, createdAt }]
 *     }
 *   },
 *   updatedAt: "ISO string"
 * }
 *
 * Actual amounts:
 *   • Category actual  = sum of its expense transactions (always derived)
 *   • Income actual    = the source's recorded "actual" + its income transactions
 *   • Allocation actual= the allocation's recorded "actual" + its allocation transactions
 * ============================================================= */

(function () {
  'use strict';

  /* ===========================================================
   * 1. UTILS
   * =========================================================== */
  const Utils = (() => {
    const $  = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));

    /** Unique id, with a fallback for browsers without crypto.randomUUID. */
    function uid(prefix) {
      const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
          + '-' + Date.now().toString(36);
      return (prefix || 'id') + '_' + rand;
    }

    /** Escape text before it is injected through innerHTML. */
    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /** Round to cents, avoiding float drift such as 0.1 + 0.2. */
    function round2(n) {
      return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    }

    /** Accepts "1,234.50", "$1234.5", " 12 " → Number. Returns NaN when invalid. */
    function parseAmount(raw) {
      if (typeof raw === 'number') return isFinite(raw) ? round2(raw) : NaN;
      const cleaned = String(raw == null ? '' : raw).replace(/[\s,_]/g, '').replace(/[^\d.\-]/g, '');
      if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
      const n = Number(cleaned);
      return isFinite(n) ? round2(n) : NaN;
    }

    function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

    /* ---------- Month / date helpers (all local time, no UTC drift) ---------- */

    function pad2(n) { return String(n).padStart(2, '0'); }

    /** "YYYY-MM" for a Date (defaults to today). */
    function monthKey(date) {
      const d = date || new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    }

    /** "YYYY-MM-DD" for a Date (defaults to today). */
    function dateKey(date) {
      const d = date || new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function isMonthKey(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)); }
    function isDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)); }

    /** Shift a month key by N months (negative goes back). */
    function shiftMonth(key, delta) {
      const parts = key.split('-');
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
      return monthKey(d);
    }

    function daysInMonth(key) {
      const parts = key.split('-');
      return new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
    }

    function monthStart(key) { return key + '-01'; }
    function monthEnd(key) { return key + '-' + pad2(daysInMonth(key)); }

    /** "September 2026" */
    function monthLabel(key) {
      const parts = key.split('-');
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
      return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }

    /** "Sep 4" — short label for transaction rows. */
    function shortDate(iso) {
      if (!isDateKey(iso)) return iso || '';
      const p = iso.split('-');
      const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    /** Percentage of `part` against `whole`, 0 when whole is 0. */
    function percent(part, whole) {
      if (!whole || whole <= 0) return part > 0 ? 100 : 0;
      return (part / whole) * 100;
    }

    function debounce(fn, wait) {
      let t = null;
      return function () {
        const args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(ctx, args), wait);
      };
    }

    return {
      $, $$, uid, esc, round2, parseAmount, clamp, pad2, monthKey, dateKey,
      isMonthKey, isDateKey, shiftMonth, daysInMonth, monthStart, monthEnd,
      monthLabel, shortDate, percent, debounce
    };
  })();

  const { $, $$, esc, uid, round2, parseAmount } = Utils;

  /* ===========================================================
   * 2. STORE — the only layer that touches localStorage
   * =========================================================== */
  const Store = (() => {
    const KEY = 'householdFinance.v1';
    let available = true;
    let memoryFallback = null; // used when storage is blocked (private mode, etc.)

    function probe() {
      try {
        const probeKey = '__hf_probe__';
        window.localStorage.setItem(probeKey, '1');
        window.localStorage.removeItem(probeKey);
        available = true;
      } catch (err) {
        available = false;
      }
      return available;
    }

    function read() {
      if (!available) return memoryFallback;
      try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : null;
      } catch (err) {
        console.error('[Store] Could not read saved data:', err);
        return null;
      }
    }

    function write(data) {
      if (!available) { memoryFallback = data; return { ok: true, fallback: true }; }
      try {
        window.localStorage.setItem(KEY, JSON.stringify(data));
        return { ok: true };
      } catch (err) {
        console.error('[Store] Could not save data:', err);
        memoryFallback = data;
        const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
        return { ok: false, error: quota ? 'Storage is full — export a backup and remove old months.'
                                         : 'Changes could not be saved to this browser.' };
      }
    }

    function clear() {
      memoryFallback = null;
      if (!available) return;
      try { window.localStorage.removeItem(KEY); }
      catch (err) { console.error('[Store] Could not clear data:', err); }
    }

    probe();

    return {
      read, write, clear,
      isAvailable() { return available; },
      storageKey: KEY
    };
  })();

  /* ===========================================================
   * 3. MODEL — shape, defaults, migration, CRUD
   * =========================================================== */
  const Model = (() => {
    const SCHEMA = 1;

    const DEFAULT_CATEGORIES = [
      'Housing', 'Groceries', 'Transportation', 'Utilities',
      'Entertainment', 'Health & Medical', 'Personal & Shopping', 'Miscellaneous'
    ];
    const DEFAULT_ALLOCATIONS = ['Savings', 'Emergency Fund', 'Debt Payments', 'Investments'];

    const TX_TYPES = ['expense', 'income', 'allocation'];

    /** Map a transaction type to the month collection it references. */
    const REF_COLLECTION = { expense: 'categories', income: 'income', allocation: 'allocations' };

    let state = null;

    function emptyMonth() {
      return { income: [], categories: [], allocations: [], transactions: [] };
    }

    function blankState() {
      return {
        schema: SCHEMA,
        settings: { currency: 'USD', theme: null },
        months: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    /** Defensive normaliser — also acts as the migration entry point. */
    function normalise(raw) {
      const base = blankState();
      if (!raw || typeof raw !== 'object') return base;

      base.schema = SCHEMA;
      base.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt;

      if (raw.settings && typeof raw.settings === 'object') {
        if (typeof raw.settings.currency === 'string' && raw.settings.currency.length === 3) {
          base.settings.currency = raw.settings.currency.toUpperCase();
        }
        if (raw.settings.theme === 'light' || raw.settings.theme === 'dark') {
          base.settings.theme = raw.settings.theme;
        }
      }

      const months = (raw.months && typeof raw.months === 'object') ? raw.months : {};
      Object.keys(months).forEach((key) => {
        if (!Utils.isMonthKey(key)) return;
        const src = months[key] || {};
        const month = emptyMonth();

        month.income = toArray(src.income).map((item) => ({
          id: safeId(item.id, 'inc'),
          name: safeName(item.name, 'Income'),
          planned: safeMoney(item.planned),
          actual: safeMoney(item.actual),
          note: safeNote(item.note)
        }));

        month.categories = toArray(src.categories).map((item) => ({
          id: safeId(item.id, 'cat'),
          name: safeName(item.name, 'Category'),
          planned: safeMoney(item.planned),
          note: safeNote(item.note)
        }));

        month.allocations = toArray(src.allocations).map((item) => ({
          id: safeId(item.id, 'alc'),
          name: safeName(item.name, 'Allocation'),
          planned: safeMoney(item.planned),
          actual: safeMoney(item.actual),
          note: safeNote(item.note)
        }));

        month.transactions = toArray(src.transactions).map((item) => ({
          id: safeId(item.id, 'tx'),
          date: Utils.isDateKey(item.date) ? item.date : Utils.monthStart(key),
          type: TX_TYPES.indexOf(item.type) >= 0 ? item.type : 'expense',
          refId: typeof item.refId === 'string' ? item.refId : null,
          description: safeName(item.description, 'Transaction'),
          amount: safeMoney(item.amount),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString()
        }));

        base.months[key] = month;
      });

      return base;
    }

    function toArray(v) { return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []; }
    function safeId(v, p) { return (typeof v === 'string' && v) ? v : uid(p); }
    function safeName(v, fallback) {
      const s = String(v == null ? '' : v).trim().slice(0, 80);
      return s || fallback;
    }
    function safeNote(v) { return String(v == null ? '' : v).trim().slice(0, 240); }
    function safeMoney(v) {
      const n = parseAmount(v);
      if (!isFinite(n) || n < 0) return 0;
      return Math.min(n, 1e12);
    }

    /* ---------- lifecycle ---------- */

    function load() {
      state = normalise(Store.read());
      return state;
    }

    function persist() {
      state.updatedAt = new Date().toISOString();
      return Store.write(state);
    }

    function getState() { return state; }

    function replaceState(nextRaw) {
      state = normalise(nextRaw);
      return persist();
    }

    function mergeState(incomingRaw) {
      const incoming = normalise(incomingRaw);
      Object.keys(incoming.months).forEach((key) => { state.months[key] = incoming.months[key]; });
      state.settings = incoming.settings;
      return persist();
    }

    function resetAll() {
      state = blankState();
      Store.clear();
      return persist();
    }

    /* ---------- months ---------- */

    function hasMonth(key) { return Object.prototype.hasOwnProperty.call(state.months, key); }

    /** Returns the month, creating it on first access. The very first month is seeded. */
    function getMonth(key) {
      if (!hasMonth(key)) {
        const isFirstEver = Object.keys(state.months).length === 0;
        state.months[key] = emptyMonth();
        if (isFirstEver) seedDefaults(key, { silent: true });
        persist();
      }
      return state.months[key];
    }

    /** Read-only peek that never creates a month. */
    function peekMonth(key) { return hasMonth(key) ? state.months[key] : null; }

    function monthKeys() { return Object.keys(state.months).sort(); }

    function isMonthEmpty(key) {
      const m = peekMonth(key);
      if (!m) return true;
      return !m.income.length && !m.categories.length && !m.allocations.length && !m.transactions.length;
    }

    function seedDefaults(key) {
      const month = state.months[key] || (state.months[key] = emptyMonth());
      const existing = month.categories.map((c) => c.name.toLowerCase());
      DEFAULT_CATEGORIES.forEach((name) => {
        if (existing.indexOf(name.toLowerCase()) === -1) {
          month.categories.push({ id: uid('cat'), name: name, planned: 0, note: '' });
        }
      });
      const existingAlloc = month.allocations.map((a) => a.name.toLowerCase());
      DEFAULT_ALLOCATIONS.forEach((name) => {
        if (existingAlloc.indexOf(name.toLowerCase()) === -1) {
          month.allocations.push({ id: uid('alc'), name: name, planned: 0, actual: 0, note: '' });
        }
      });
      return persist();
    }

    /** Copy the *plan* (not the transactions) from one month into another. */
    function copyPlan(fromKey, toKey) {
      const from = peekMonth(fromKey);
      if (!from) return { ok: false, error: 'There is no data in ' + Utils.monthLabel(fromKey) + '.' };

      const to = getMonth(toKey);
      to.income = from.income.map((i) => ({ id: uid('inc'), name: i.name, planned: i.planned, actual: 0, note: i.note }));
      to.categories = from.categories.map((c) => ({ id: uid('cat'), name: c.name, planned: c.planned, note: c.note }));
      to.allocations = from.allocations.map((a) => ({ id: uid('alc'), name: a.name, planned: a.planned, actual: 0, note: a.note }));
      const res = persist();
      return res.ok ? { ok: true } : res;
    }

    function clearMonth(key) {
      state.months[key] = emptyMonth();
      return persist();
    }

    /* ---------- generic entity CRUD ---------- */

    function collectionOf(monthKey, kind) {
      const month = getMonth(monthKey);
      if (kind === 'income') return month.income;
      if (kind === 'category') return month.categories;
      if (kind === 'allocation') return month.allocations;
      if (kind === 'transaction') return month.transactions;
      throw new Error('Unknown entity kind: ' + kind);
    }

    function findEntity(monthKey, kind, id) {
      const list = collectionOf(monthKey, kind);
      for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    }

    function addEntity(monthKey, kind, data) {
      const list = collectionOf(monthKey, kind);
      const prefix = { income: 'inc', category: 'cat', allocation: 'alc', transaction: 'tx' }[kind];
      const record = Object.assign({ id: uid(prefix) }, data);
      if (kind === 'transaction') record.createdAt = new Date().toISOString();
      list.push(record);
      const res = persist();
      return res.ok ? { ok: true, record: record } : res;
    }

    function updateEntity(monthKey, kind, id, data) {
      const record = findEntity(monthKey, kind, id);
      if (!record) return { ok: false, error: 'That item no longer exists.' };
      Object.assign(record, data);
      const res = persist();
      return res.ok ? { ok: true, record: record } : res;
    }

    function removeEntity(monthKey, kind, id) {
      const list = collectionOf(monthKey, kind);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return { ok: false, error: 'That item no longer exists.' };
      list.splice(index, 1);

      // Orphaned transactions keep their history but lose the reference.
      if (kind !== 'transaction') {
        const month = getMonth(monthKey);
        month.transactions.forEach((tx) => { if (tx.refId === id) tx.refId = null; });
      }
      const res = persist();
      return res.ok ? { ok: true } : res;
    }

    /** How many transactions point at a given income/category/allocation. */
    function countLinkedTransactions(monthKey, id) {
      const month = getMonth(monthKey);
      return month.transactions.filter((tx) => tx.refId === id).length;
    }

    function setSetting(name, value) {
      state.settings[name] = value;
      return persist();
    }

    return {
      SCHEMA, TX_TYPES, REF_COLLECTION, DEFAULT_CATEGORIES, DEFAULT_ALLOCATIONS,
      load, persist, getState, replaceState, mergeState, resetAll, normalise,
      hasMonth, getMonth, peekMonth, monthKeys, isMonthEmpty, seedDefaults,
      copyPlan, clearMonth,
      findEntity, addEntity, updateEntity, removeEntity, countLinkedTransactions,
      setSetting
    };
  })();

  /* ===========================================================
   * 4. CALC — pure derived numbers, no DOM, no storage
   * =========================================================== */
  const Calc = (() => {
    const sum = (list, pick) => round2(list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0));

    /** Transactions of a type, optionally for one reference id. */
    function txOf(month, type, refId) {
      return month.transactions.filter((tx) =>
        tx.type === type && (refId === undefined || tx.refId === refId));
    }

    function incomeRows(month) {
      return month.income.map((src) => {
        const logged = sum(txOf(month, 'income', src.id), (t) => t.amount);
        const actual = round2(Number(src.actual || 0) + logged);
        return {
          id: src.id,
          name: src.name,
          note: src.note,
          planned: round2(src.planned || 0),
          recorded: round2(src.actual || 0),
          logged: logged,
          actual: actual,
          variance: round2(actual - (src.planned || 0)),
          pct: Utils.percent(actual, src.planned || 0)
        };
      });
    }

    function categoryRows(month) {
      const rows = month.categories.map((cat) => {
        const actual = sum(txOf(month, 'expense', cat.id), (t) => t.amount);
        const planned = round2(cat.planned || 0);
        const balance = round2(planned - actual);
        const pct = Utils.percent(actual, planned);
        return {
          id: cat.id,
          name: cat.name,
          note: cat.note,
          planned: planned,
          actual: actual,
          balance: balance,
          pct: pct,
          txCount: txOf(month, 'expense', cat.id).length,
          status: statusFor(planned, actual)
        };
      });

      // Expenses whose category was deleted still need to be visible.
      const orphan = month.transactions.filter((tx) =>
        tx.type === 'expense' && !month.categories.some((c) => c.id === tx.refId));
      if (orphan.length) {
        const actual = sum(orphan, (t) => t.amount);
        rows.push({
          id: null,
          name: 'Uncategorised',
          note: '',
          planned: 0,
          actual: actual,
          balance: round2(-actual),
          pct: 100,
          txCount: orphan.length,
          status: 'over',
          isOrphan: true
        });
      }
      return rows;
    }

    function allocationRows(month) {
      return month.allocations.map((alloc) => {
        const logged = sum(txOf(month, 'allocation', alloc.id), (t) => t.amount);
        const actual = round2(Number(alloc.actual || 0) + logged);
        const planned = round2(alloc.planned || 0);
        return {
          id: alloc.id,
          name: alloc.name,
          note: alloc.note,
          planned: planned,
          recorded: round2(alloc.actual || 0),
          logged: logged,
          actual: actual,
          remaining: round2(planned - actual),
          pct: Utils.percent(actual, planned),
          status: planned > 0 && actual >= planned ? 'ok' : (actual > 0 ? 'partial' : 'none')
        };
      });
    }

    /** Traffic-light status for a spending category. */
    function statusFor(planned, actual) {
      if (planned <= 0) return actual > 0 ? 'over' : 'none';
      const pct = (actual / planned) * 100;
      if (pct > 100) return 'over';
      if (pct >= 85) return 'warn';
      return 'ok';
    }

    /** The headline figures for a month. */
    function summary(month) {
      const inc = incomeRows(month);
      const cats = categoryRows(month);
      const allocs = allocationRows(month);

      const incomePlanned = sum(inc, (r) => r.planned);
      const incomeActual = sum(inc, (r) => r.actual);

      const expensePlanned = sum(cats, (r) => r.planned);
      const expenseActual = sum(month.transactions.filter((t) => t.type === 'expense'), (t) => t.amount);

      const allocPlanned = sum(allocs, (r) => r.planned);
      const allocActual = sum(allocs, (r) => r.actual);

      return {
        income:      { planned: incomePlanned,  actual: incomeActual },
        expenses:    { planned: expensePlanned, actual: expenseActual },
        allocations: { planned: allocPlanned,   actual: allocActual },
        remaining: {
          planned: round2(incomePlanned - expensePlanned - allocPlanned),
          actual: round2(incomeActual - expenseActual - allocActual)
        },
        budgetLeft: round2(expensePlanned - expenseActual),
        counts: {
          income: month.income.length,
          categories: month.categories.length,
          allocations: month.allocations.length,
          transactions: month.transactions.length
        }
      };
    }

    /** Transactions sorted newest first, with their reference name resolved. */
    function transactionRows(month) {
      const nameFor = (tx) => {
        const listName = Model.REF_COLLECTION[tx.type];
        const list = month[listName] || [];
        const match = list.find((item) => item.id === tx.refId);
        return match ? match.name : null;
      };
      return month.transactions
        .slice()
        .sort((a, b) => {
          if (a.date === b.date) return String(b.createdAt).localeCompare(String(a.createdAt));
          return b.date.localeCompare(a.date);
        })
        .map((tx) => Object.assign({}, tx, { refName: nameFor(tx) }));
    }

    return { summary, incomeRows, categoryRows, allocationRows, transactionRows, statusFor, txOf };
  })();

  /* ===========================================================
   * 5. UI PRIMITIVES — money format, toast, modal, form builder
   * =========================================================== */

  /** Currency formatting that follows the user's locale. */
  const Money = (() => {
    let formatter = null;
    let currency = 'USD';

    function configure(code) {
      currency = code || 'USD';
      try {
        formatter = new Intl.NumberFormat(undefined, {
          style: 'currency', currency: currency,
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });
      } catch (err) {
        formatter = null;
      }
    }

    function format(value) {
      const n = Number(value) || 0;
      if (formatter) return formatter.format(n);
      return (n < 0 ? '-' : '') + currency + ' ' + Math.abs(n).toFixed(2);
    }

    /** Explicit sign — used for variances. */
    function signed(value) {
      const n = round2(Number(value) || 0);
      if (n === 0) return format(0);
      return (n > 0 ? '+' : '') + format(n);
    }

    function code() { return currency; }

    configure('USD');
    return { configure, format, signed, code };
  })();

  const Toast = (() => {
    const host = $('#toasts');

    function show(message, kind, ms) {
      const el = document.createElement('div');
      el.className = 'toast' + (kind ? ' toast--' + kind : '');
      el.textContent = message;
      host.appendChild(el);
      const life = ms || (kind === 'error' ? 5200 : 2800);
      setTimeout(() => {
        el.classList.add('is-leaving');
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
      }, life);
    }

    return {
      info: (m) => show(m, null),
      ok: (m) => show(m, 'ok'),
      error: (m) => show(m, 'error', 5200)
    };
  })();

  const Modal = (() => {
    const root = $('#modal');
    const panel = $('#modalPanel');
    const titleEl = $('#modalTitle');
    const bodyEl = $('#modalBody');
    let lastFocused = null;
    let onCloseCb = null;

    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function open(title, contentNode, onClose) {
      lastFocused = document.activeElement;
      onCloseCb = onClose || null;
      titleEl.textContent = title;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(contentNode);
      root.hidden = false;
      document.body.style.overflow = 'hidden';

      const first = panel.querySelector('input:not([type=hidden]),select,textarea') ||
                    panel.querySelector(FOCUSABLE);
      if (first) setTimeout(() => first.focus(), 30);
    }

    function close() {
      if (root.hidden) return;
      root.hidden = true;
      bodyEl.innerHTML = '';
      document.body.style.overflow = '';
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      const cb = onCloseCb;
      onCloseCb = null;
      if (cb) cb();
    }

    function isOpen() { return !root.hidden; }

    /* Close on backdrop / close button */
    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-close]');
      if (target) { e.preventDefault(); close(); }
    });

    /* Escape + focus trap */
    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;

      const items = $$(FOCUSABLE, panel).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    return { open, close, isOpen };
  })();

  /**
   * Generic, validated form inside the modal.
   * Handles HTML5 constraints (required/min/step/type) *and* JS rules,
   * rendering inline messages next to the offending field.
   */
  const Form = (() => {

    function buildField(field) {
      const wrap = document.createElement('div');
      wrap.className = 'field' + (field.className ? ' ' + field.className : '');
      wrap.dataset.field = field.name;
      if (field.full) wrap.style.gridColumn = '1 / -1';

      const id = 'f_' + field.name;
      const labelHtml = esc(field.label) + (field.required ? '<span class="req" aria-hidden="true">*</span>' : '');

      let control = '';
      const common = 'id="' + id + '" name="' + esc(field.name) + '"' +
        (field.required ? ' required' : '') +
        (field.autocomplete ? ' autocomplete="' + esc(field.autocomplete) + '"' : ' autocomplete="off"') +
        (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '') +
        (field.hint ? ' aria-describedby="' + id + '_hint"' : '');

      if (field.type === 'select') {
        const opts = (field.options || []).map((o) =>
          '<option value="' + esc(o.value) + '"' + (String(o.value) === String(field.value) ? ' selected' : '') + '>' +
          esc(o.label) + '</option>').join('');
        control = '<select ' + common + '>' + opts + '</select>';
      } else if (field.type === 'textarea') {
        control = '<textarea ' + common + ' maxlength="' + (field.maxLength || 240) + '" rows="3">' +
          esc(field.value == null ? '' : field.value) + '</textarea>';
      } else if (field.type === 'money') {
        control = '<input type="number" ' + common +
          ' inputmode="decimal" step="0.01" min="' + (field.min != null ? field.min : 0) + '"' +
          (field.max != null ? ' max="' + field.max + '"' : '') +
          ' value="' + esc(field.value == null ? '' : field.value) + '">';
      } else if (field.type === 'date') {
        control = '<input type="date" ' + common +
          (field.min ? ' min="' + esc(field.min) + '"' : '') +
          (field.max ? ' max="' + esc(field.max) + '"' : '') +
          ' value="' + esc(field.value || '') + '">';
      } else {
        control = '<input type="' + esc(field.type || 'text') + '" ' + common +
          ' maxlength="' + (field.maxLength || 80) + '"' +
          ' value="' + esc(field.value == null ? '' : field.value) + '">';
      }

      wrap.innerHTML =
        '<label for="' + id + '">' + labelHtml + '</label>' +
        control +
        (field.hint ? '<p class="field__hint" id="' + id + '_hint">' + esc(field.hint) + '</p>' : '') +
        '<p class="field__error" role="alert"></p>';

      return wrap;
    }

    function open(config) {
      const form = document.createElement('form');
      form.className = 'form';
      form.noValidate = true; // we render our own messages, but still use checkValidity()

      const errorBox = document.createElement('div');
      errorBox.className = 'form__error';
      errorBox.setAttribute('role', 'alert');
      form.appendChild(errorBox);

      if (config.intro) {
        const intro = document.createElement('p');
        intro.className = 'card__sub';
        intro.textContent = config.intro;
        form.appendChild(intro);
      }

      const grid = document.createElement('div');
      grid.className = 'form__grid' + (config.columns === 2 ? ' form__grid--2' : '');
      config.fields.forEach((f) => grid.appendChild(buildField(f)));
      form.appendChild(grid);

      const actions = document.createElement('div');
      actions.className = 'form__actions';
      actions.innerHTML =
        '<button type="button" class="btn" data-close="true">Cancel</button>' +
        '<button type="submit" class="btn ' + (config.danger ? 'btn--danger' : 'btn--primary') + '">' +
        esc(config.submitLabel || 'Save') + '</button>';
      form.appendChild(actions);

      /* --- helpers exposed to onChange callbacks --- */
      const api = {
        form: form,
        get: (name) => form.elements[name],
        setOptions: function (name, options, selected) {
          const el = form.elements[name];
          if (!el) return;
          el.innerHTML = options.map((o) =>
            '<option value="' + esc(o.value) + '"' + (String(o.value) === String(selected) ? ' selected' : '') + '>' +
            esc(o.label) + '</option>').join('');
        },
        setLabel: function (name, text) {
          const wrap = form.querySelector('[data-field="' + name + '"] > label');
          if (wrap) wrap.innerHTML = esc(text) + '<span class="req" aria-hidden="true">*</span>';
        },
        setHint: function (name, text) {
          const hint = form.querySelector('[data-field="' + name + '"] .field__hint');
          if (hint) hint.textContent = text;
        }
      };

      function clearErrors() {
        errorBox.classList.remove('is-visible');
        errorBox.textContent = '';
        $$('.field', form).forEach((f) => {
          f.classList.remove('has-error');
          const msg = f.querySelector('.field__error');
          if (msg) msg.textContent = '';
        });
      }

      function showFieldError(name, message) {
        const wrap = form.querySelector('[data-field="' + name + '"]');
        if (!wrap) return;
        wrap.classList.add('has-error');
        const msg = wrap.querySelector('.field__error');
        if (msg) msg.textContent = message;
        const control = form.elements[name];
        if (control) control.setAttribute('aria-invalid', 'true');
      }

      function readValues() {
        const values = {};
        config.fields.forEach((f) => {
          const el = form.elements[f.name];
          if (!el) return;
          const raw = el.value;
          values[f.name] = (f.type === 'money') ? parseAmount(raw) : String(raw).trim();
          values['__raw_' + f.name] = raw;
        });
        return values;
      }

      function validate(values) {
        const errors = [];
        config.fields.forEach((f) => {
          const el = form.elements[f.name];
          if (!el) return;
          el.removeAttribute('aria-invalid');
          const raw = String(el.value).trim();

          if (f.required && raw === '') {
            errors.push({ name: f.name, message: f.label + ' is required.' });
            return;
          }
          if (raw === '' && !f.required) return;

          if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
            errors.push({ name: f.name, message: el.validationMessage || ('Please check ' + f.label + '.') });
            return;
          }

          if (f.type === 'money') {
            const n = values[f.name];
            if (!isFinite(n)) {
              errors.push({ name: f.name, message: 'Enter a valid amount, for example 1250.00.' });
              return;
            }
            const min = f.min != null ? f.min : 0;
            if (n < min) {
              errors.push({ name: f.name, message: f.label + ' cannot be less than ' + Money.format(min) + '.' });
              return;
            }
            if (f.max != null && n > f.max) {
              errors.push({ name: f.name, message: f.label + ' cannot be more than ' + Money.format(f.max) + '.' });
              return;
            }
          }

          if (f.type === 'date' && !Utils.isDateKey(raw)) {
            errors.push({ name: f.name, message: 'Enter a valid date.' });
            return;
          }

          if (typeof f.validate === 'function') {
            const custom = f.validate(values[f.name], values);
            if (custom) errors.push({ name: f.name, message: custom });
          }
        });
        return errors;
      }

      form.addEventListener('input', (e) => {
        const wrap = e.target.closest('.field');
        if (wrap && wrap.classList.contains('has-error')) {
          wrap.classList.remove('has-error');
          const msg = wrap.querySelector('.field__error');
          if (msg) msg.textContent = '';
          e.target.removeAttribute('aria-invalid');
        }
      });

      if (typeof config.onChange === 'function') {
        form.addEventListener('change', (e) => {
          if (!e.target.name) return;
          config.onChange(e.target.name, readValues(), api);
        });
      }

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        clearErrors();
        const values = readValues();
        const errors = validate(values);

        if (errors.length) {
          errors.forEach((err) => showFieldError(err.name, err.message));
          errorBox.textContent = errors.length === 1
            ? errors[0].message
            : 'Please fix the ' + errors.length + ' highlighted fields.';
          errorBox.classList.add('is-visible');
          const firstBad = form.elements[errors[0].name];
          if (firstBad && firstBad.focus) firstBad.focus();
          return;
        }

        const result = config.onSubmit(values);
        if (result && result.ok === false) {
          errorBox.textContent = result.error || 'Something went wrong. Please try again.';
          errorBox.classList.add('is-visible');
          return;
        }
        Modal.close();
      });

      Modal.open(config.title, form);
      if (typeof config.onChange === 'function') {
        config.onChange('__init__', readValues(), api);
      }
    }

    return { open };
  })();

  /** Promise-based confirmation dialog. */
  function confirmDialog(options) {
    return new Promise((resolve) => {
      let settled = false;
      const wrap = document.createElement('div');
      wrap.innerHTML =
        '<p class="confirm__text">' + esc(options.message) + '</p>' +
        '<div class="form__actions">' +
        '<button type="button" class="btn" data-choice="no">' + esc(options.cancelLabel || 'Cancel') + '</button>' +
        '<button type="button" class="btn ' + (options.danger ? 'btn--danger' : 'btn--primary') + '" data-choice="yes">' +
        esc(options.confirmLabel || 'Confirm') + '</button>' +
        '</div>';

      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-choice]');
        if (!btn) return;
        settled = true;
        Modal.close();
        resolve(btn.dataset.choice === 'yes');
      });

      Modal.open(options.title, wrap, () => { if (!settled) resolve(false); });
      const confirmBtn = wrap.querySelector('[data-choice="yes"]');
      if (confirmBtn) setTimeout(() => confirmBtn.focus(), 30);
    });
  }

  /* ===========================================================
   * 6. RENDER — state ➜ DOM
   * =========================================================== */
  const Render = (() => {

    const TONE_CLASS = { ok: 'ok', warn: 'warn', over: 'over', none: 'none', info: 'info', partial: 'info' };

    function progressBar(pct, tone) {
      const width = Utils.clamp(isFinite(pct) ? pct : 0, 0, 100);
      const cls = TONE_CLASS[tone] || 'ok';
      return '<div class="progress progress--' + cls + '" role="progressbar" ' +
        'aria-valuenow="' + Math.round(isFinite(pct) ? pct : 0) + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="progress__bar" style="width:' + width.toFixed(1) + '%"></div></div>';
    }

    function emptyState(icon, title, text, actions) {
      return '<div class="empty">' +
        '<span class="empty__icon" aria-hidden="true">' + icon + '</span>' +
        '<p class="empty__title">' + esc(title) + '</p>' +
        '<p class="empty__text">' + esc(text) + '</p>' +
        (actions ? '<div class="empty__actions">' + actions + '</div>' : '') +
        '</div>';
    }

    function statusPill(status, pct) {
      const rounded = Math.round(isFinite(pct) ? pct : 0);
      if (status === 'over') return '<span class="pill pill--over">Over · ' + rounded + '%</span>';
      if (status === 'warn') return '<span class="pill pill--warn">Close · ' + rounded + '%</span>';
      if (status === 'none') return '<span class="pill">No budget set</span>';
      return '<span class="pill pill--ok">On track · ' + rounded + '%</span>';
    }

    function rowActions(kind, id) {
      return '<div class="row__actions">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-edit="' + kind + '" data-id="' + esc(id) + '">Edit</button>' +
        '<button type="button" class="icon-btn icon-btn--danger" data-delete="' + kind + '" data-id="' + esc(id) + '" ' +
        'aria-label="Delete"><span aria-hidden="true">🗑</span></button>' +
        '</div>';
    }

    /* ---------------- Dashboard ---------------- */

    function dashboard(month, monthKey) {
      const s = Calc.summary(month);

      /* Summary tiles */
      const remainingTone = s.remaining.actual < 0 ? 'neg' : 'pos';
      $('#summaryGrid').innerHTML = [
        tile('income', 'Income received', s.income.actual,
          'Planned ' + Money.format(s.income.planned),
          Money.signed(s.income.actual - s.income.planned) + ' vs plan'),
        tile('expense', 'Spent', s.expenses.actual,
          'Budget ' + Money.format(s.expenses.planned),
          (s.budgetLeft >= 0 ? Money.format(s.budgetLeft) + ' left' : Money.format(Math.abs(s.budgetLeft)) + ' over')),
        tile('allocation', 'Allocated', s.allocations.actual,
          'Target ' + Money.format(s.allocations.planned),
          (s.allocations.planned - s.allocations.actual > 0
            ? Money.format(s.allocations.planned - s.allocations.actual) + ' to go'
            : 'Fully funded')),
        tile('remaining', 'Unallocated', s.remaining.actual,
          'Planned ' + Money.format(s.remaining.planned),
          s.remaining.actual < 0 ? 'Overcommitted' : 'Available', remainingTone)
      ].join('');

      /* Planned vs actual */
      $('#planActual').innerHTML = (s.income.planned + s.expenses.planned + s.allocations.planned === 0 &&
        s.income.actual + s.expenses.actual + s.allocations.actual === 0)
        ? emptyState('📊', 'Nothing planned yet',
            'Add income and budget categories to see how ' + Utils.monthLabel(monthKey) + ' is tracking.',
            '<button type="button" class="btn btn--primary btn--sm" data-add="income">Add income</button>' +
            '<button type="button" class="btn btn--sm" data-add="category">Add a category</button>')
        : '<div class="compare">' +
            compareRow('Income', s.income.actual, s.income.planned, 'ok') +
            compareRow('Expenses', s.expenses.actual, s.expenses.planned,
              Calc.statusFor(s.expenses.planned, s.expenses.actual)) +
            compareRow('Allocations', s.allocations.actual, s.allocations.planned, 'info') +
          '</div>';

      /* Category health */
      const cats = Calc.categoryRows(month)
        .filter((c) => c.planned > 0 || c.actual > 0)
        .sort((a, b) => b.pct - a.pct || b.actual - a.actual);

      $('#categoryHealth').innerHTML = cats.length
        ? '<div class="compare">' + cats.map((c) =>
            '<div class="compare__row">' +
              '<div class="compare__top">' +
                '<span class="compare__name">' + esc(c.name) + ' ' + statusPill(c.status, c.pct) + '</span>' +
                '<span class="compare__nums num">' + Money.format(c.actual) + ' / ' + Money.format(c.planned) + '</span>' +
              '</div>' +
              progressBar(c.pct, c.status) +
              '<p class="row__sub ' + (c.balance < 0 ? 'neg' : 'muted') + '">' +
                (c.balance < 0 ? Money.format(Math.abs(c.balance)) + ' over budget'
                               : Money.format(c.balance) + ' remaining') +
              '</p>' +
            '</div>').join('') + '</div>'
        : emptyState('🎯', 'No budgets set',
            'Set a budget limit on a category to track spending against it.',
            '<button type="button" class="btn btn--primary btn--sm" data-add="category">Add a category</button>');

      /* Allocation progress */
      const allocs = Calc.allocationRows(month).filter((a) => a.planned > 0 || a.actual > 0);
      $('#allocationProgress').innerHTML = allocs.length
        ? '<div class="compare">' + allocs.map((a) =>
            '<div class="compare__row">' +
              '<div class="compare__top">' +
                '<span class="compare__name">' + esc(a.name) + '</span>' +
                '<span class="compare__nums num">' + Money.format(a.actual) + ' / ' + Money.format(a.planned) + '</span>' +
              '</div>' +
              progressBar(a.pct, a.pct >= 100 ? 'ok' : 'info') +
            '</div>').join('') + '</div>'
        : emptyState('🏦', 'No allocations yet',
            'Set targets for savings, debt payments or investments.',
            '<button type="button" class="btn btn--primary btn--sm" data-add="allocation">Add an allocation</button>');

      /* Recent activity */
      const recent = Calc.transactionRows(month).slice(0, 5);
      $('#recentActivity').innerHTML = recent.length
        ? '<div class="rows">' + recent.map((tx) =>
            '<div class="row">' +
              '<div class="row__main">' +
                '<span class="row__title">' + esc(tx.description) + '</span>' +
                '<span class="row__sub">' + Utils.shortDate(tx.date) + ' · ' +
                  esc(tx.refName || 'Uncategorised') + '</span>' +
              '</div>' +
              '<div class="row__amounts">' +
                '<span class="row__amount num ' + (tx.type === 'income' ? 'pos' : '') + '">' +
                  (tx.type === 'income' ? '+' : '−') + Money.format(tx.amount) + '</span>' +
              '</div>' +
            '</div>').join('') + '</div>'
        : emptyState('🧾', 'No transactions yet',
            'Nothing logged for ' + Utils.monthLabel(monthKey) + ' yet. Add your first one to get started.',
            '<button type="button" class="btn btn--primary btn--sm" data-add="transaction">Add a transaction</button>');
    }

    function tile(kind, label, value, metaA, metaB, tone) {
      return '<article class="tile tile--' + kind + '">' +
        '<p class="tile__label">' + esc(label) + '</p>' +
        '<p class="tile__value num ' + (tone || '') + '">' + Money.format(value) + '</p>' +
        '<p class="tile__meta"><span>' + esc(metaA) + '</span><span>·</span><span>' + esc(metaB) + '</span></p>' +
        '</article>';
    }

    function compareRow(name, actual, planned, tone) {
      const pct = Utils.percent(actual, planned);
      return '<div class="compare__row">' +
        '<div class="compare__top">' +
          '<span class="compare__name">' + esc(name) + '</span>' +
          '<span class="compare__nums num">' + Money.format(actual) + ' of ' + Money.format(planned) +
            ' <strong>(' + Math.round(pct) + '%)</strong></span>' +
        '</div>' +
        progressBar(pct, tone) +
        '</div>';
    }

    /* ---------------- Income ---------------- */

    function income(month, monthKey) {
      const rows = Calc.incomeRows(month);
      const host = $('#incomeList');

      host.innerHTML = rows.length
        ? '<div class="rows">' + rows.map((r) =>
            '<div class="row">' +
              '<div class="row__main">' +
                '<span class="row__title">' + esc(r.name) +
                  (r.variance >= 0 && r.planned > 0
                    ? '<span class="pill pill--ok">' + Math.round(r.pct) + '% received</span>'
                    : (r.planned > 0 ? '<span class="pill pill--warn">' + Math.round(r.pct) + '% received</span>' : '')) +
                '</span>' +
                '<span class="row__sub">' +
                  'Planned ' + Money.format(r.planned) +
                  (r.logged > 0 ? ' · recorded ' + Money.format(r.recorded) + ' + logged ' + Money.format(r.logged) : '') +
                  (r.note ? ' · ' + esc(r.note) : '') +
                '</span>' +
              '</div>' +
              '<div class="row__amounts">' +
                '<span class="row__amount num">' + Money.format(r.actual) + '</span>' +
                '<span class="row__sub num ' + (r.variance < 0 ? 'neg' : 'pos') + '">' +
                  Money.signed(r.variance) + ' vs plan</span>' +
              '</div>' +
              rowActions('income', r.id) +
            '</div>').join('') + '</div>'
        : emptyState('💵', 'No income sources yet',
            'Add salaries, freelance work or any other money coming in during ' + Utils.monthLabel(monthKey) + '.',
            '<button type="button" class="btn btn--primary btn--sm" data-add="income">Add income source</button>' +
            copyPlanButton(monthKey));

      const s = Calc.summary(month);
      $('#incomeFoot').innerHTML = rows.length ? totals([
        ['Planned', Money.format(s.income.planned)],
        ['Received', Money.format(s.income.actual)],
        ['Difference', Money.signed(s.income.actual - s.income.planned)]
      ]) : '';
    }

    /* ---------------- Budget ---------------- */

    function budget(month, monthKey) {
      const rows = Calc.categoryRows(month);
      const host = $('#categoryList');

      host.innerHTML = rows.length
        ? '<div class="rows">' + rows.map((c) =>
            '<div class="row">' +
              '<div class="row__main">' +
                '<span class="row__title">' + esc(c.name) + ' ' + statusPill(c.status, c.pct) + '</span>' +
                '<span class="row__sub">' + c.txCount + ' transaction' + (c.txCount === 1 ? '' : 's') +
                  (c.note ? ' · ' + esc(c.note) : '') + '</span>' +
              '</div>' +
              '<div class="row__amounts">' +
                '<span class="row__amount num">' + Money.format(c.actual) + '</span>' +
                '<span class="row__sub num">of ' + Money.format(c.planned) + '</span>' +
              '</div>' +
              (c.isOrphan ? '' : rowActions('category', c.id)) +
              '<div class="row__progress">' + progressBar(c.pct, c.status) +
                '<p class="row__sub ' + (c.balance < 0 ? 'neg' : 'muted') + '" style="margin-top:4px">' +
                  (c.balance < 0 ? Money.format(Math.abs(c.balance)) + ' over budget'
                                 : Money.format(c.balance) + ' left to spend') + '</p>' +
              '</div>' +
            '</div>').join('') + '</div>'
        : emptyState('🗂️', 'No budget categories yet',
            'Create categories such as Housing or Groceries, then give each one a monthly limit.',
            '<button type="button" class="btn btn--primary btn--sm" data-add="category">Add category</button>' +
            '<button type="button" class="btn btn--sm" data-menu-action="seed-defaults">Use starter set</button>' +
            copyPlanButton(monthKey));

      const s = Calc.summary(month);
      $('#categoryFoot').innerHTML = rows.length ? totals([
        ['Budgeted', Money.format(s.expenses.planned)],
        ['Spent', Money.format(s.expenses.actual)],
        [s.budgetLeft >= 0 ? 'Left' : 'Over', Money.format(Math.abs(s.budgetLeft))]
      ]) : '';
    }

    /* ---------------- Allocations ---------------- */

    function allocations(month, monthKey) {
      const rows = Calc.allocationRows(month);

      $('#allocationList').innerHTML = rows.length
        ? '<div class="rows">' + rows.map((a) =>
            '<div class="row">' +
              '<div class="row__main">' +
                '<span class="row__title">' + esc(a.name) +
                  (a.planned > 0 && a.actual >= a.planned
                    ? '<span class="pill pill--ok">Funded</span>'
                    : '<span class="pill pill--info">' + Math.round(a.pct) + '%</span>') +
                '</span>' +
                '<span class="row__sub">' +
                  (a.remaining > 0 ? Money.format(a.remaining) + ' still to set aside' : 'Target met') +
                  (a.logged > 0 ? ' · includes ' + Money.format(a.logged) + ' logged' : '') +
                  (a.note ? ' · ' + esc(a.note) : '') +
                '</span>' +
              '</div>' +
              '<div class="row__amounts">' +
                '<span class="row__amount num">' + Money.format(a.actual) + '</span>' +
                '<span class="row__sub num">of ' + Money.format(a.planned) + '</span>' +
              '</div>' +
              rowActions('allocation', a.id) +
              '<div class="row__progress">' + progressBar(a.pct, a.pct >= 100 ? 'ok' : 'info') + '</div>' +
            '</div>').join('') + '</div>'
        : emptyState('🏦', 'No allocations yet',
            'Track where the leftover money goes: savings, emergency fund, debt payments and investments.',
            '<button type="button" class="btn btn--primary btn--sm" data-add="allocation">Add allocation</button>' +
            '<button type="button" class="btn btn--sm" data-menu-action="seed-defaults">Use starter set</button>' +
            copyPlanButton(monthKey));

      const s = Calc.summary(month);
      $('#allocationFoot').innerHTML = rows.length ? totals([
        ['Target', Money.format(s.allocations.planned)],
        ['Funded', Money.format(s.allocations.actual)],
        ['Remaining', Money.format(Math.max(0, s.allocations.planned - s.allocations.actual))]
      ]) : '';
    }

    /* ---------------- Transactions ---------------- */

    function transactions(month, monthKey, filters) {
      const all = Calc.transactionRows(month);
      const q = (filters.search || '').trim().toLowerCase();

      const rows = all.filter((tx) => {
        if (filters.type !== 'all' && tx.type !== filters.type) return false;
        if (filters.ref !== 'all') {
          if (filters.ref === 'none' ? tx.refId : tx.refId !== filters.ref) return false;
        }
        if (q && (tx.description + ' ' + (tx.refName || '')).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });

      $('#txCount').textContent = all.length
        ? rows.length + ' of ' + all.length + ' transaction' + (all.length === 1 ? '' : 's') + ' in ' + Utils.monthLabel(monthKey)
        : 'Nothing logged in ' + Utils.monthLabel(monthKey) + ' yet';

      const typePill = {
        expense: '<span class="pill pill--over">Expense</span>',
        income: '<span class="pill pill--ok">Income</span>',
        allocation: '<span class="pill pill--info">Allocation</span>'
      };

      $('#transactionList').innerHTML = rows.length
        ? '<table class="tx-table"><caption class="sr-only">Transactions for ' + esc(Utils.monthLabel(monthKey)) + '</caption>' +
          '<thead><tr><th scope="col">Description</th><th scope="col">Amount</th><th scope="col">Actions</th></tr></thead>' +
          '<tbody>' + rows.map((tx) =>
            '<tr>' +
              '<td class="tx-desc">' + esc(tx.description) + '</td>' +
              '<td class="tx-amount num ' + (tx.type === 'income' ? 'pos' : (tx.type === 'expense' ? 'neg' : '')) + '">' +
                (tx.type === 'income' ? '+' : '−') + Money.format(tx.amount) + '</td>' +
              '<td class="tx-meta">' + typePill[tx.type] +
                '<span>' + Utils.shortDate(tx.date) + '</span>' +
                '<span>' + esc(tx.refName || 'Unassigned') + '</span></td>' +
              '<td class="tx-actions">' +
                '<button type="button" class="btn btn--ghost btn--sm" data-edit="transaction" data-id="' + esc(tx.id) + '">Edit</button>' +
                '<button type="button" class="icon-btn icon-btn--danger" data-delete="transaction" data-id="' + esc(tx.id) + '" ' +
                'aria-label="Delete transaction"><span aria-hidden="true">🗑</span></button>' +
              '</td>' +
            '</tr>').join('') + '</tbody></table>'
        : (all.length
            ? emptyState('🔍', 'No matches',
                'No transactions match the current filters. Try clearing the search or filters.',
                '<button type="button" class="btn btn--sm" id="btnClearFilters2">Reset filters</button>')
            : emptyState('🧾', 'No transactions yet',
                'No transactions yet for ' + Utils.monthLabel(monthKey) + '. Tap “+” to add one.',
                '<button type="button" class="btn btn--primary btn--sm" data-add="transaction">Add transaction</button>'));

      const shown = rows.reduce((acc, tx) => {
        acc[tx.type] = round2((acc[tx.type] || 0) + tx.amount);
        return acc;
      }, {});
      $('#transactionFoot').innerHTML = rows.length ? totals([
        ['Expenses', Money.format(shown.expense || 0)],
        ['Income', Money.format(shown.income || 0)],
        ['Allocations', Money.format(shown.allocation || 0)]
      ]) : '';
    }

    function totals(pairs) {
      return '<div class="totals">' + pairs.map((p) =>
        '<span class="totals__item"><span class="totals__label">' + esc(p[0]) + '</span>' +
        '<span class="totals__value num">' + esc(p[1]) + '</span></span>').join('') + '</div>';
    }

    function copyPlanButton(monthKey) {
      const prev = Utils.shiftMonth(monthKey, -1);
      if (Model.isMonthEmpty(prev)) return '';
      return '<button type="button" class="btn btn--sm" data-menu-action="copy-prev">Copy plan from ' +
        esc(Utils.monthLabel(prev)) + '</button>';
    }

    return { dashboard, income, budget, allocations, transactions, progressBar, emptyState };
  })();

  /* ===========================================================
   * 7. APP — state wiring, events, bootstrap
   * =========================================================== */
  const App = (() => {
    let currentMonth = Utils.monthKey();
    let currentView = 'dashboard';
    const filters = { search: '', type: 'all', ref: 'all' };

    /* ---------------- theme ---------------- */

    function applyTheme(theme) {
      const resolved = theme || (window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', resolved);
      $('#themeIcon').textContent = resolved === 'dark' ? '☀️' : '🌙';
      $('#btnTheme').setAttribute('aria-label',
        resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }

    function toggleTheme() {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      const res = Model.setSetting('theme', next);
      applyTheme(next);
      if (!res.ok) Toast.error(res.error);
    }

    /* ---------------- navigation ---------------- */

    function setMonth(key) {
      if (!Utils.isMonthKey(key)) return;
      currentMonth = key;
      filters.ref = 'all';
      $('#txRef').value = 'all';
      renderAll();
    }

    function setView(view) {
      currentView = view;
      $$('[role="tab"]').forEach((tab) => {
        const active = tab.dataset.view === view;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        if (panel) panel.hidden = !active;
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---------------- rendering ---------------- */

    function renderAll() {
      const month = Model.getMonth(currentMonth);

      $('#monthLabel').textContent = Utils.monthLabel(currentMonth);
      $('#monthPicker').value = currentMonth;
      document.title = 'Household Finance — ' + Utils.monthLabel(currentMonth);
      $$('.js-month-name').forEach((el) => { el.textContent = Utils.monthLabel(currentMonth); });

      refreshRefFilter(month);

      Render.dashboard(month, currentMonth);
      Render.income(month, currentMonth);
      Render.budget(month, currentMonth);
      Render.allocations(month, currentMonth);
      Render.transactions(month, currentMonth, filters);
    }

    function refreshRefFilter(month) {
      const select = $('#txRef');
      const previous = filters.ref;
      const options = ['<option value="all">All categories</option>']
        .concat(month.categories.map((c) =>
          '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'))
        .concat(['<option value="none">Unassigned</option>']);
      select.innerHTML = options.join('');
      select.value = month.categories.some((c) => c.id === previous) || previous === 'all' || previous === 'none'
        ? previous : 'all';
      filters.ref = select.value;
    }

    /* ---------------- entity forms ---------------- */

    function openIncomeForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'income', id) : null;
      Form.open({
        title: existing ? 'Edit income source' : 'Add income source',
        columns: 2,
        submitLabel: existing ? 'Save changes' : 'Add income',
        fields: [
          { name: 'name', label: 'Source name', type: 'text', required: true, full: true,
            value: existing ? existing.name : '', placeholder: 'e.g. Salary — Acme Corp',
            hint: 'Household income only; no need to say whose it is.' },
          { name: 'planned', label: 'Planned amount', type: 'money', required: true, min: 0,
            value: existing ? existing.planned : '', placeholder: '0.00',
            hint: 'What you expect to receive this month.' },
          { name: 'actual', label: 'Actually received', type: 'money', required: true, min: 0,
            value: existing ? existing.actual : 0, placeholder: '0.00',
            hint: 'Income transactions you log are added on top of this.' },
          { name: 'note', label: 'Note (optional)', type: 'textarea', full: true,
            value: existing ? existing.note : '' }
        ],
        onSubmit: (v) => {
          const data = { name: v.name, planned: v.planned, actual: v.actual, note: v.note };
          const res = existing
            ? Model.updateEntity(currentMonth, 'income', id, data)
            : Model.addEntity(currentMonth, 'income', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(existing ? 'Income source updated.' : 'Income source added.');
        }
      });
    }

    function openCategoryForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'category', id) : null;
      const spent = existing
        ? Calc.categoryRows(Model.getMonth(currentMonth)).find((c) => c.id === id)
        : null;

      Form.open({
        title: existing ? 'Edit category' : 'Add budget category',
        columns: 2,
        submitLabel: existing ? 'Save changes' : 'Add category',
        intro: spent ? 'Spent so far: ' + Money.format(spent.actual) +
          ' across ' + spent.txCount + ' transaction' + (spent.txCount === 1 ? '' : 's') + '.' : null,
        fields: [
          { name: 'name', label: 'Category name', type: 'text', required: true, full: true,
            value: existing ? existing.name : '', placeholder: 'e.g. Groceries',
            validate: (value) => {
              const clash = Model.getMonth(currentMonth).categories
                .some((c) => c.id !== id && c.name.toLowerCase() === String(value).toLowerCase());
              return clash ? 'A category with that name already exists this month.' : null;
            } },
          { name: 'planned', label: 'Monthly budget', type: 'money', required: true, min: 0,
            value: existing ? existing.planned : '', placeholder: '0.00',
            hint: 'Spending is tracked from your transactions.' },
          { name: 'note', label: 'Note (optional)', type: 'textarea', full: true,
            value: existing ? existing.note : '' }
        ],
        onSubmit: (v) => {
          const data = { name: v.name, planned: v.planned, note: v.note };
          const res = existing
            ? Model.updateEntity(currentMonth, 'category', id, data)
            : Model.addEntity(currentMonth, 'category', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(existing ? 'Category updated.' : 'Category added.');
        }
      });
    }

    function openAllocationForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'allocation', id) : null;
      Form.open({
        title: existing ? 'Edit allocation' : 'Add allocation',
        columns: 2,
        submitLabel: existing ? 'Save changes' : 'Add allocation',
        fields: [
          { name: 'name', label: 'Allocation name', type: 'text', required: true, full: true,
            value: existing ? existing.name : '', placeholder: 'e.g. Emergency Fund' },
          { name: 'planned', label: 'Target this month', type: 'money', required: true, min: 0,
            value: existing ? existing.planned : '', placeholder: '0.00' },
          { name: 'actual', label: 'Set aside so far', type: 'money', required: true, min: 0,
            value: existing ? existing.actual : 0, placeholder: '0.00',
            hint: 'Allocation transactions are added on top of this.' },
          { name: 'note', label: 'Note (optional)', type: 'textarea', full: true,
            value: existing ? existing.note : '' }
        ],
        onSubmit: (v) => {
          const data = { name: v.name, planned: v.planned, actual: v.actual, note: v.note };
          const res = existing
            ? Model.updateEntity(currentMonth, 'allocation', id, data)
            : Model.addEntity(currentMonth, 'allocation', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(existing ? 'Allocation updated.' : 'Allocation added.');
        }
      });
    }

    /** Options for the "assign to" select, which depends on the chosen type. */
    function refOptions(type) {
      const month = Model.getMonth(currentMonth);
      const listName = Model.REF_COLLECTION[type] || 'categories';
      const items = month[listName] || [];
      const head = { expense: '— Uncategorised —', income: '— Unassigned —', allocation: '— Unassigned —' }[type];
      return [{ value: '', label: head }].concat(items.map((i) => ({ value: i.id, label: i.name })));
    }

    function openTransactionForm(id) {
      const existing = id ? Model.findEntity(currentMonth, 'transaction', id) : null;

      const today = Utils.dateKey();
      const defaultDate = existing ? existing.date
        : (today.slice(0, 7) === currentMonth ? today : Utils.monthStart(currentMonth));
      const initialType = existing ? existing.type : 'expense';

      Form.open({
        title: existing ? 'Edit transaction' : 'Add transaction',
        columns: 2,
        submitLabel: existing ? 'Save changes' : 'Add transaction',
        fields: [
          { name: 'description', label: 'Description', type: 'text', required: true, full: true,
            value: existing ? existing.description : '', placeholder: 'e.g. Weekly grocery run' },
          { name: 'type', label: 'Type', type: 'select', required: true, value: initialType,
            options: [
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'allocation', label: 'Allocation' }
            ] },
          { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01,
            value: existing ? existing.amount : '', placeholder: '0.00' },
          { name: 'refId', label: 'Category', type: 'select',
            value: existing ? (existing.refId || '') : '', options: refOptions(initialType),
            hint: 'Assign it so the right budget updates.' },
          { name: 'date', label: 'Date', type: 'date', required: true, value: defaultDate,
            min: Utils.monthStart(currentMonth), max: Utils.monthEnd(currentMonth),
            hint: 'Must fall inside ' + Utils.monthLabel(currentMonth) + '.',
            validate: (value) => (value >= Utils.monthStart(currentMonth) && value <= Utils.monthEnd(currentMonth))
              ? null
              : 'Pick a date inside ' + Utils.monthLabel(currentMonth) + '. Switch months to log it elsewhere.' }
        ],
        onChange: function (changedName, values, api) {
          if (changedName !== 'type' && changedName !== '__init__') return;
          const type = values.type || 'expense';
          api.setOptions('refId', refOptions(type), values.refId);
          const label = { expense: 'Category', income: 'Income source', allocation: 'Allocation' }[type];
          const wrap = api.form.querySelector('[data-field="refId"] > label');
          if (wrap) wrap.textContent = label;
          api.setHint('refId', {
            expense: 'Spending counts towards this category’s budget.',
            income: 'Adds to what this source has received.',
            allocation: 'Counts towards this allocation’s target.'
          }[type]);
        },
        onSubmit: (v) => {
          const data = {
            description: v.description,
            type: v.type,
            amount: v.amount,
            refId: v.refId || null,
            date: v.date
          };
          const res = existing
            ? Model.updateEntity(currentMonth, 'transaction', id, data)
            : Model.addEntity(currentMonth, 'transaction', data);
          if (!res.ok) return res;
          renderAll();
          Toast.ok(existing ? 'Transaction updated.' : 'Transaction added.');
        }
      });
    }

    /* ---------------- delete flows ---------------- */

    const KIND_LABEL = { income: 'income source', category: 'category', allocation: 'allocation', transaction: 'transaction' };

    async function handleDelete(kind, id) {
      const record = Model.findEntity(currentMonth, kind, id);
      if (!record) { Toast.error('That item no longer exists.'); renderAll(); return; }

      const name = kind === 'transaction' ? record.description : record.name;
      let message = 'Delete “' + name + '” from ' + Utils.monthLabel(currentMonth) + '? This cannot be undone.';

      if (kind !== 'transaction') {
        const linked = Model.countLinkedTransactions(currentMonth, id);
        if (linked > 0) {
          message += ' ' + linked + ' transaction' + (linked === 1 ? '' : 's') +
            ' will be kept but marked as unassigned.';
        }
      }

      const yes = await confirmDialog({
        title: 'Delete ' + KIND_LABEL[kind],
        message: message,
        confirmLabel: 'Delete',
        danger: true
      });
      if (!yes) return;

      const res = Model.removeEntity(currentMonth, kind, id);
      if (!res.ok) { Toast.error(res.error); return; }
      renderAll();
      Toast.ok(KIND_LABEL[kind].charAt(0).toUpperCase() + KIND_LABEL[kind].slice(1) + ' deleted.');
    }

    /* ---------------- backup / restore ---------------- */

    function exportData() {
      try {
        const data = JSON.stringify(Model.getState(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'household-finance-backup-' + Utils.dateKey() + '.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        Toast.ok('Backup downloaded.');
      } catch (err) {
        console.error(err);
        Toast.error('Could not create the backup file.');
      }
    }

    function importData(file) {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { Toast.error('That file is too large to be a backup.'); return; }

      const reader = new FileReader();
      reader.onerror = () => Toast.error('The file could not be read.');
      reader.onload = () => {
        let parsed;
        try {
          parsed = JSON.parse(String(reader.result));
        } catch (err) {
          Toast.error('That file is not valid JSON.');
          return;
        }
        if (!parsed || typeof parsed !== 'object' || !parsed.months || typeof parsed.months !== 'object') {
          Toast.error('That file is not a Household Finance backup.');
          return;
        }
        const monthCount = Object.keys(parsed.months).filter(Utils.isMonthKey).length;
        if (!monthCount) { Toast.error('The backup contains no months of data.'); return; }

        Form.open({
          title: 'Restore backup',
          submitLabel: 'Restore',
          danger: true,
          intro: 'This backup contains ' + monthCount + ' month' + (monthCount === 1 ? '' : 's') +
            ' of data. Export your current data first if you want to keep it.',
          fields: [{
            name: 'mode', label: 'How should it be applied?', type: 'select', required: true, value: 'replace', full: true,
            options: [
              { value: 'replace', label: 'Replace — delete everything and use the backup' },
              { value: 'merge', label: 'Merge — keep my months, overwrite ones in the backup' }
            ]
          }],
          onSubmit: (v) => {
            const res = v.mode === 'merge' ? Model.mergeState(parsed) : Model.replaceState(parsed);
            if (!res.ok) return res;
            const settings = Model.getState().settings;
            Money.configure(settings.currency);
            applyTheme(settings.theme);
            const keys = Model.monthKeys();
            if (keys.indexOf(currentMonth) === -1 && keys.length) currentMonth = keys[keys.length - 1];
            renderAll();
            Toast.ok('Backup restored — ' + monthCount + ' month' + (monthCount === 1 ? '' : 's') + ' loaded.');
          }
        });
      };
      reader.readAsText(file);
    }

    function openSettings() {
      const settings = Model.getState().settings;
      const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'JPY',
        'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'INR', 'ZAR', 'PHP', 'SGD'];

      Form.open({
        title: 'Settings',
        submitLabel: 'Save settings',
        intro: 'Everything is stored in this browser only. Nothing is uploaded anywhere.',
        fields: [{
          name: 'currency', label: 'Currency', type: 'select', required: true, full: true,
          value: settings.currency,
          options: currencies.map((c) => ({ value: c, label: c })),
          hint: 'Amounts are formatted using your device’s regional settings.'
        }],
        onSubmit: (v) => {
          const res = Model.setSetting('currency', v.currency);
          if (!res.ok) return res;
          Money.configure(v.currency);
          renderAll();
          Toast.ok('Settings saved.');
        }
      });
    }

    /* ---------------- menu actions ---------------- */

    async function runMenuAction(action) {
      const menu = $('#dataMenu');
      if (menu) menu.open = false;

      if (action === 'export') { exportData(); return; }
      if (action === 'import') { $('#importFile').click(); return; }
      if (action === 'settings') { openSettings(); return; }

      if (action === 'seed-defaults') {
        const res = Model.seedDefaults(currentMonth);
        if (!res.ok) { Toast.error(res.error); return; }
        renderAll();
        Toast.ok('Starter categories and allocations added.');
        return;
      }

      if (action === 'copy-prev') {
        const prev = Utils.shiftMonth(currentMonth, -1);
        if (Model.isMonthEmpty(prev)) {
          Toast.error('There is nothing to copy from ' + Utils.monthLabel(prev) + '.');
          return;
        }
        const yes = await confirmDialog({
          title: 'Copy plan forward',
          message: 'Copy income sources, budget limits and allocation targets from ' +
            Utils.monthLabel(prev) + ' into ' + Utils.monthLabel(currentMonth) +
            '? Existing plan entries for ' + Utils.monthLabel(currentMonth) +
            ' will be replaced. Transactions are not copied.',
          confirmLabel: 'Copy plan'
        });
        if (!yes) return;
        const res = Model.copyPlan(prev, currentMonth);
        if (!res.ok) { Toast.error(res.error); return; }
        renderAll();
        Toast.ok('Plan copied from ' + Utils.monthLabel(prev) + '.');
        return;
      }

      if (action === 'clear-month') {
        const yes = await confirmDialog({
          title: 'Clear this month',
          message: 'Remove all income, categories, allocations and transactions for ' +
            Utils.monthLabel(currentMonth) + '? Other months are not affected. This cannot be undone.',
          confirmLabel: 'Clear month', danger: true
        });
        if (!yes) return;
        const res = Model.clearMonth(currentMonth);
        if (!res.ok) { Toast.error(res.error); return; }
        renderAll();
        Toast.ok(Utils.monthLabel(currentMonth) + ' cleared.');
        return;
      }

      if (action === 'reset-all') {
        const yes = await confirmDialog({
          title: 'Delete all data',
          message: 'This permanently deletes every month stored in this browser. ' +
            'Export a backup first if you might want it back. Continue?',
          confirmLabel: 'Delete everything', danger: true
        });
        if (!yes) return;
        Model.resetAll();
        currentMonth = Utils.monthKey();
        Money.configure(Model.getState().settings.currency);
        renderAll();
        Toast.ok('All data deleted.');
      }
    }

    /* ---------------- events ---------------- */

    function bindEvents() {
      /* Month navigation */
      $('#btnPrevMonth').addEventListener('click', () => setMonth(Utils.shiftMonth(currentMonth, -1)));
      $('#btnNextMonth').addEventListener('click', () => setMonth(Utils.shiftMonth(currentMonth, 1)));
      $('#btnThisMonth').addEventListener('click', () => setMonth(Utils.monthKey()));
      $('#monthPicker').addEventListener('change', (e) => {
        if (Utils.isMonthKey(e.target.value)) setMonth(e.target.value);
        else e.target.value = currentMonth;
      });

      /* Tabs: click + roving keyboard focus */
      const tabs = $$('[role="tab"]');
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => setView(tab.dataset.view));
        tab.addEventListener('keydown', (e) => {
          const map = { ArrowRight: 1, ArrowLeft: -1 };
          let next = null;
          if (map[e.key] != null) next = (index + map[e.key] + tabs.length) % tabs.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = tabs.length - 1;
          if (next == null) return;
          e.preventDefault();
          tabs[next].focus();
          setView(tabs[next].dataset.view);
        });
      });

      /* Theme */
      $('#btnTheme').addEventListener('click', toggleTheme);

      /* Data menu */
      $('#dataMenu').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        runMenuAction(btn.dataset.action);
      });
      document.addEventListener('click', (e) => {
        const menu = $('#dataMenu');
        if (menu.open && !menu.contains(e.target)) menu.open = false;
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !Modal.isOpen()) $('#dataMenu').open = false;
      });

      /* Import file picker */
      $('#importFile').addEventListener('change', (e) => {
        importData(e.target.files && e.target.files[0]);
        e.target.value = '';
      });

      /* Delegated actions across every panel */
      document.addEventListener('click', (e) => {
        const addBtn = e.target.closest('[data-add]');
        if (addBtn) {
          const kind = addBtn.dataset.add;
          if (kind === 'income') openIncomeForm();
          else if (kind === 'category') openCategoryForm();
          else if (kind === 'allocation') openAllocationForm();
          else if (kind === 'transaction') openTransactionForm();
          return;
        }

        const editBtn = e.target.closest('[data-edit]');
        if (editBtn) {
          const kind = editBtn.dataset.edit, id = editBtn.dataset.id;
          if (kind === 'income') openIncomeForm(id);
          else if (kind === 'category') openCategoryForm(id);
          else if (kind === 'allocation') openAllocationForm(id);
          else if (kind === 'transaction') openTransactionForm(id);
          return;
        }

        const delBtn = e.target.closest('[data-delete]');
        if (delBtn) { handleDelete(delBtn.dataset.delete, delBtn.dataset.id); return; }

        const gotoBtn = e.target.closest('[data-goto]');
        if (gotoBtn) { setView(gotoBtn.dataset.goto); return; }

        const menuAction = e.target.closest('[data-menu-action]');
        if (menuAction) { runMenuAction(menuAction.dataset.menuAction); return; }

        if (e.target.id === 'btnClearFilters2') resetFilters();
      });

      /* Transaction filters */
      const applySearch = Utils.debounce(() => {
        filters.search = $('#txSearch').value;
        Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
      }, 180);
      $('#txSearch').addEventListener('input', applySearch);
      $('#txType').addEventListener('change', (e) => {
        filters.type = e.target.value;
        Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
      });
      $('#txRef').addEventListener('change', (e) => {
        filters.ref = e.target.value;
        Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
      });
      $('#btnClearFilters').addEventListener('click', resetFilters);

      /* Keep multiple tabs of the app in sync */
      window.addEventListener('storage', (e) => {
        if (e.key !== Store.storageKey) return;
        Model.load();
        Money.configure(Model.getState().settings.currency);
        renderAll();
        Toast.info('Updated with changes from another tab.');
      });
    }

    function resetFilters() {
      filters.search = '';
      filters.type = 'all';
      filters.ref = 'all';
      $('#txSearch').value = '';
      $('#txType').value = 'all';
      $('#txRef').value = 'all';
      Render.transactions(Model.getMonth(currentMonth), currentMonth, filters);
    }

    /* ---------------- bootstrap ---------------- */

    function init() {
      Model.load();
      const settings = Model.getState().settings;
      Money.configure(settings.currency);
      applyTheme(settings.theme);

      if (!Store.isAvailable()) {
        $('#storageNote').textContent = 'Storage blocked — changes will not be kept';
        $('#storageNote').style.color = 'var(--c-danger)';
        Toast.error('This browser is blocking local storage, so your data cannot be saved. ' +
          'Check your privacy settings, and export a backup before closing the tab.');
      }

      bindEvents();
      setView('dashboard');
      renderAll();
    }

    return { init };
  })();

  /* Boot once the DOM is parsed (the script uses `defer`, so this is immediate). */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
})();
