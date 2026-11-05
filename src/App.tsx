import { useCallback, useEffect, useState, type FormEvent } from 'react';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
const TOKEN_KEY = 'e-duuka-platform-admin-token';
const EMAIL_KEY = 'e-duuka-platform-admin-email';

type View = 'overview' | 'shops' | 'users' | 'finances';
type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'suspended';
type AdminSession = { token: string; email: string };
type Overview = {
  totalShops: number;
  activeShops: number;
  totalUsers: number;
  activeUsers30d: number;
  subscriptions: Record<SubscriptionStatus, number>;
  recentLogins: RecentLogin[];
};
type RecentLogin = {
  id: string;
  name: string;
  phone: string;
  accountType: 'owner' | 'staff';
  shopName: string;
  lastLoginAt: string;
};
type ShopRow = {
  id: string;
  name: string;
  location: string;
  phone?: string | null;
  isActive: boolean;
  plan: string;
  subscriptionAmount: string;
  subscriptionCurrency: string;
  billingInterval: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionStartedAt?: string;
  subscriptionEndsAt?: string;
  createdAt: string;
  owner: { name: string; phone: string; email?: string; lastLoginAt?: string } | null;
  userCount: number;
};
type AccountRow = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: string;
  status: string;
  shopId: string;
  shopName: string;
  lastLoginAt?: string;
  createdAt: string;
};
type Page<T> = { items: T[]; total: number; page: number; limit: number };
type FinanceReport = {
  currency: string;
  activeSubscriptions: number;
  monthlyExpected: number;
  yearlyExpected: number;
  basis: string;
  subscriptions: Array<{
    shopId: string;
    shopName: string;
    plan: string;
    amount: number;
    currency: string;
    billingInterval: string;
    subscriptionStartedAt?: string;
    subscriptionEndsAt?: string;
  }>;
};
type Editor = { kind: 'shop'; item: ShopRow } | { kind: 'account'; item: AccountRow } | null;

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new RequestError(Array.isArray(body.message) ? body.message[0] : body.message || `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

function formatDate(value?: string) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function dateInputValue(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'ED';
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`status-badge status-${value.toLowerCase()}`}>{value.replaceAll('_', ' ')}</span>;
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(() => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    return token ? { token, email: sessionStorage.getItem(EMAIL_KEY) || '' } : null;
  });
  const [view, setView] = useState<View>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [shops, setShops] = useState<Page<ShopRow> | null>(null);
  const [users, setUsers] = useState<Page<AccountRow> | null>(null);
  const [finances, setFinances] = useState<FinanceReport | null>(null);
  const [accountsType, setAccountsType] = useState<'owner' | 'staff'>('owner');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor>(null);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
    setSession(null);
    setOverview(null);
    setShops(null);
    setUsers(null);
    setFinances(null);
  }, []);

  const loadPage = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      if (view === 'overview') {
        setOverview(await request<Overview>('/admin/overview', session.token));
      } else if (view === 'shops') {
        const params = new URLSearchParams({ page: String(page), limit: '20' });
        if (search) params.set('q', search);
        setShops(await request<Page<ShopRow>>(`/admin/shops?${params}`, session.token));
      } else if (view === 'users') {
        const params = new URLSearchParams({ page: String(page), limit: '20', accountType: accountsType });
        if (search) params.set('q', search);
        setUsers(await request<Page<AccountRow>>(`/admin/users?${params}`, session.token));
      } else {
        setFinances(await request<FinanceReport>('/admin/finances', session.token));
      }
    } catch (caught) {
      if (caught instanceof RequestError && caught.status === 401) {
        signOut();
        setError('Your admin session expired. Sign in again.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not load platform data.');
      }
    } finally {
      setLoading(false);
    }
  }, [accountsType, page, search, session, signOut, view]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message[0] : body.message || 'Sign in failed.');
      const nextSession = { token: body.token as string, email: body.admin.email as string };
      sessionStorage.setItem(TOKEN_KEY, nextSession.token);
      sessionStorage.setItem(EMAIL_KEY, nextSession.email);
      setSession(nextSession);
      setView('overview');
      setPage(1);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.');
    } finally {
      setLoading(false);
    }
  }

  async function saveShop(event: FormEvent<HTMLFormElement>, shopId: string) {
    event.preventDefault();
    if (!session) return;
    const values = new FormData(event.currentTarget);
    const body = {
      plan: String(values.get('plan') || ''),
      subscriptionStatus: values.get('subscriptionStatus'),
      subscriptionStartedAt: values.get('subscriptionStartedAt') ? new Date(`${values.get('subscriptionStartedAt')}T00:00:00`).toISOString() : null,
      subscriptionEndsAt: values.get('subscriptionEndsAt') ? new Date(`${values.get('subscriptionEndsAt')}T23:59:59`).toISOString() : null,
      isActive: values.get('isActive') === 'true',
    };
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await request(`/admin/shops/${shopId}`, session.token, { method: 'PATCH', body: JSON.stringify(body) });
      setNotice('Subscription settings saved.');
      await loadPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update subscription.');
    } finally {
      setLoading(false);
    }
  }

  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !editor) return;
    const values = new FormData(event.currentTarget);
    const body = editor.kind === 'shop'
      ? {
          name: String(values.get('name') || '').trim(),
          location: String(values.get('location') || '').trim(),
          phone: String(values.get('phone') || '').trim() || null,
        }
      : {
          accountType: accountsType,
          name: String(values.get('name') || '').trim(),
          phone: String(values.get('phone') || '').trim(),
          ...(accountsType === 'owner'
            ? { email: String(values.get('email') || '').trim() || null }
            : { role: values.get('role'), status: values.get('status') }),
        };
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const path = editor.kind === 'shop' ? `/admin/shops/${editor.item.id}` : `/admin/users/${editor.item.id}`;
      await request(path, session.token, { method: 'PATCH', body: JSON.stringify(body) });
      setEditor(null);
      setNotice(editor.kind === 'shop' ? 'Shop details updated.' : 'Account details updated.');
      await loadPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save changes.');
    } finally {
      setLoading(false);
    }
  }

  async function setShopActive(shop: ShopRow) {
    const action = shop.isActive ? 'deactivate' : 'reactivate';
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${shop.name}? Shop history will be preserved.`)) return;
    if (!session) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await request(`/admin/shops/${shop.id}`, session.token, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !shop.isActive }),
      });
      setNotice(`Shop ${shop.isActive ? 'deactivated' : 'reactivated'}; its history was preserved.`);
      await loadPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} shop.`);
    } finally {
      setLoading(false);
    }
  }

  async function setAccountActive(account: AccountRow) {
    const active = account.status === 'active';
    const action = active ? 'deactivate' : 'reactivate';
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${account.name}'s account? Account history will be preserved.`)) return;
    if (!session) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await request(`/admin/users/${account.id}`, session.token, {
        method: 'PATCH',
        body: JSON.stringify(accountsType === 'owner'
          ? { accountType: 'owner', isActive: !active }
          : { accountType: 'staff', status: active ? 'inactive' : 'active' }),
      });
      setNotice(`Account ${active ? 'deactivated' : 'reactivated'}; its history was preserved.`);
      await loadPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} account.`);
    } finally {
      setLoading(false);
    }
  }

  function navigate(nextView: View) {
    setView(nextView);
    setPage(1);
    setSearch('');
    setQuery('');
    setError('');
    setNotice('');
  }

  function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  }

  if (!session) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="brand-lockup"><span className="brand-mark">e</span><span>E-Duuka<span className="brand-sub">PLATFORM ADMIN</span></span></div>
          <div className="login-copy">
            <p className="eyebrow">ADMINISTRATION</p>
            <h1>Welcome back.</h1>
            <p>Sign in to manage subscriptions, shops and platform access.</p>
          </div>
          <form onSubmit={login} className="login-form">
            <label>Email address<input name="email" type="email" autoComplete="username" placeholder="admin@yourcompany.com" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary button-wide" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in to admin'}</button>
          </form>
          <p className="security-note"><span className="lock-icon">⌑</span> Restricted to authorized E-Duuka administrators</p>
        </section>
        <div className="login-aside"><div className="aside-glow" /><div className="aside-content"><span className="aside-label">E-DUUKA OPERATIONS</span><h2>One clear view<br />of your platform.</h2><p>Keep tabs on shops, subscriptions, and account activity — all in one place.</p><div className="aside-divider" /><div className="aside-foot"><span className="online-dot" /> PLATFORM ADMINISTRATION <span>•</span> PRIVATE ACCESS</div></div></div>
      </main>
    );
  }

  const title = view === 'overview' ? 'Overview' : view === 'shops' ? 'Shops & subscriptions' : view === 'users' ? 'User accounts' : 'Subscription finances';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup sidebar-brand"><span className="brand-mark">e</span><span>E-Duuka<span className="brand-sub">ADMIN CONSOLE</span></span></div>
        <div className="nav-section-label">PLATFORM</div>
        <nav className="main-nav" aria-label="Admin navigation">
          <button className={view === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('overview')}><span className="nav-icon">◫</span>Overview</button>
          <button className={view === 'shops' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('shops')}><span className="nav-icon">▦</span>Shops<span className="nav-pill">Subscriptions</span></button>
          <button className={view === 'users' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('users')}><span className="nav-icon">♙</span>User accounts</button>
          <button className={view === 'finances' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('finances')}><span className="nav-icon">◉</span>Finances</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon">i</span><div><strong>Platform admin</strong><p>Operational data only.<br />No customer financials.</p></div></div>
          <button className="profile-button" onClick={signOut}><span className="avatar">{initials(session.email)}</span><span className="profile-copy"><strong>{session.email || 'Administrator'}</strong><small>Platform admin</small></span><span className="signout-icon">↗</span></button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">e</span>E-Duuka</div><div className="breadcrumb">Platform <span>/</span> <strong>{title}</strong></div><div className="topbar-right"><span className="secure-label"><span className="online-dot" /> SECURE ADMIN</span><button className="icon-button" aria-label="Refresh data" onClick={() => void loadPage()}>↻</button></div></header>
        <div className="content">
          <div className="page-heading"><div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>{title}</h1><p className="page-description">{view === 'overview' ? 'A high-level view of shops, accounts and subscription health.' : view === 'shops' ? 'Review shop activity and update subscription access.' : view === 'users' ? 'Review owner and staff accounts and their recent sign-ins.' : 'Review projected recurring subscription value.'}</p></div>{(view === 'shops' || view === 'users') && <form className="search-form" onSubmit={runSearch}><span>⌕</span><input aria-label="Search" value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'shops' ? 'Search shops…' : 'Search accounts…'} /><button type="submit">Search</button></form>}</div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {notice && <div className="alert alert-success" role="status">{notice}</div>}
          {loading && <div className="loading-bar" />}
          {view === 'overview' && <OverviewPanel data={overview} onNavigate={navigate} />}
          {view === 'shops' && <ShopsPanel data={shops} onSave={saveShop} onEdit={shop => setEditor({ kind: 'shop', item: shop })} onToggle={setShopActive} page={page} onPage={setPage} />}
          {view === 'users' && <UsersPanel data={users} type={accountsType} onType={value => { setAccountsType(value); setPage(1); }} onEdit={account => setEditor({ kind: 'account', item: account })} onToggle={setAccountActive} page={page} onPage={setPage} />}
          {view === 'finances' && <FinancesPanel report={finances} />}
          <footer className="content-footer"><span>© {new Date().getFullYear()} E-Duuka</span><span>Platform administration <i /> Operational data only</span></footer>
        </div>
      </main>
      {editor && <EditModal editor={editor} accountType={accountsType} onClose={() => setEditor(null)} onSave={saveEditor} />}
    </div>
  );
}

function OverviewPanel({ data, onNavigate }: { data: Overview | null; onNavigate: (view: View) => void }) {
  const statuses: SubscriptionStatus[] = ['active', 'trial', 'expired', 'suspended'];
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="Total shops" value={data?.totalShops} detail={`${data?.activeShops ?? 0} currently active`} icon="▦" tone="green" />
        <MetricCard label="User accounts" value={data?.totalUsers} detail="Shop owners and staff" icon="♙" tone="blue" />
        <MetricCard label="Active in 30 days" value={data?.activeUsers30d} detail="Based on last sign-in" icon="↗" tone="violet" />
        <MetricCard label="Active subscriptions" value={data?.subscriptions.active} detail={`${data?.subscriptions.trial ?? 0} currently on trial`} icon="◷" tone="amber" />
      </section>
      <section className="overview-grid">
        <div className="panel subscription-panel">
          <div className="panel-heading"><div><p className="eyebrow">SUBSCRIPTION HEALTH</p><h2>Current subscriptions</h2></div><button className="text-button" onClick={() => onNavigate('shops')}>Manage subscriptions <span>→</span></button></div>
          <div className="subscription-list">
            {statuses.map(status => <div className="subscription-line" key={status}><div className={`subscription-dot dot-${status}`} /><span className="subscription-name">{status[0].toUpperCase() + status.slice(1)}</span><strong>{data?.subscriptions[status] ?? '—'}</strong><span className="subscription-track"><i className={`track-${status}`} style={{ width: `${data?.totalShops ? Math.max((data.subscriptions[status] / data.totalShops) * 100, data.subscriptions[status] ? 4 : 0) : 0}%` }} /></span></div>)}
          </div>
          <div className="panel-note"><span>i</span> Subscription amounts and payments are not collected or shown in this console.</div>
        </div>
        <div className="panel quick-panel"><div className="panel-heading"><div><p className="eyebrow">QUICK LINKS</p><h2>Manage E-Duuka</h2></div></div><button className="quick-link" onClick={() => onNavigate('shops')}><span className="quick-link-icon icon-green">▦</span><span><strong>Shops & subscriptions</strong><small>Update plan and access status</small></span><b>→</b></button><button className="quick-link" onClick={() => onNavigate('users')}><span className="quick-link-icon icon-blue">♙</span><span><strong>User accounts</strong><small>Review recent activity and logins</small></span><b>→</b></button><button className="quick-link" onClick={() => onNavigate('finances')}><span className="quick-link-icon icon-amber">◉</span><span><strong>Subscription finances</strong><small>View monthly and yearly projections</small></span><b>→</b></button></div>
      </section>
      <section className="panel activity-panel">
        <div className="panel-heading"><div><p className="eyebrow">ACCOUNT ACTIVITY</p><h2>Recent sign-ins</h2></div><button className="text-button" onClick={() => onNavigate('users')}>View accounts <span>→</span></button></div>
        <LoginTable items={data?.recentLogins ?? []} compact />
      </section>
    </>
  );
}

function MetricCard({ label, value, detail, icon, tone }: { label: string; value?: number; detail: string; icon: string; tone: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon tone-${tone}`}>{icon}</span></div><strong>{value ?? '—'}</strong><small>{detail}</small></div>;
}

function FinancesPanel({ report }: { report: FinanceReport | null }) {
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const expected = period === 'month' ? report?.monthlyExpected : report?.yearlyExpected;
  const formatMoney = (amount: number) => new Intl.NumberFormat('en-UG', {
    style: 'currency',
    currency: report?.currency ?? 'UGX',
    maximumFractionDigits: 0,
  }).format(amount);

  return (
    <div className="finance-page">
      <section className="finance-hero">
        <div className="finance-hero-copy"><span className="finance-kicker"><i /> SUBSCRIPTION REVENUE</span><h2>{period === 'month' ? 'Monthly projection' : 'Yearly projection'}</h2><p>Recurring value from active subscriptions at UGX 30,000 per month.</p></div>
        <div className="finance-period-toggle" role="group" aria-label="Revenue reporting period"><button className={period === 'month' ? 'selected' : ''} onClick={() => setPeriod('month')}>Monthly</button><button className={period === 'year' ? 'selected' : ''} onClick={() => setPeriod('year')}>Yearly</button></div>
        <div className="finance-total"><span>{period === 'month' ? 'EXPECTED PER MONTH' : 'EXPECTED PER YEAR'}</span><strong>{expected === undefined ? '—' : formatMoney(expected)}</strong><small>{report?.activeSubscriptions ?? '—'} active subscriptions included</small></div>
        <div className="finance-orbit finance-orbit-one" /><div className="finance-orbit finance-orbit-two" />
      </section>
      <div className="finance-stat-grid">
        <article className="finance-stat finance-stat-green"><span className="finance-stat-icon">↻</span><small>MONTHLY RECURRING</small><strong>{report ? formatMoney(report.monthlyExpected) : '—'}</strong><p>Active subscriptions × monthly plan rate</p></article>
        <article className="finance-stat finance-stat-gold"><span className="finance-stat-icon">▤</span><small>YEARLY RUN RATE</small><strong>{report ? formatMoney(report.yearlyExpected) : '—'}</strong><p>Monthly recurring value × 12 months</p></article>
        <article className="finance-stat finance-stat-blue"><span className="finance-stat-icon">♙</span><small>ACTIVE SUBSCRIPTIONS</small><strong>{report?.activeSubscriptions ?? '—'}</strong><p>Enabled shops on an active subscription</p></article>
      </div>
      <section className="panel table-panel finance-table-panel">
        <div className="table-panel-heading"><div><h2>Active subscriptions</h2><p>Shops included in this revenue projection</p></div><span className="privacy-chip"><span>↻</span> Recurring</span></div>
        <div className="table-wrap"><table><thead><tr><th>SHOP</th><th>PLAN</th><th>BILLING</th><th>SUBSCRIPTION VALUE</th><th>START DATE</th><th>STATUS</th></tr></thead><tbody>
          {report?.subscriptions.map(subscription => <tr key={subscription.shopId}><td><div className="shop-cell"><span className="avatar shop-avatar">{initials(subscription.shopName)}</span><span><strong>{subscription.shopName}</strong></span></div></td><td>{subscription.plan}</td><td><span className="billing-chip">{subscription.billingInterval}</span></td><td className="revenue-cell">{formatMoney(subscription.amount)} <small>/ {subscription.billingInterval === 'yearly' ? 'year' : 'month'}</small></td><td className="date-cell">{formatDate(subscription.subscriptionStartedAt)}</td><td><StatusBadge value="active" /></td></tr>)}
          {!report?.subscriptions.length && <tr><td className="empty-cell" colSpan={6}>No active subscriptions yet. Activate a shop subscription to include its expected recurring value.</td></tr>}
        </tbody></table></div>
      </section>
      <div className="finance-disclaimer"><span>i</span><p><strong>Projection, not confirmed receipts.</strong> {report?.basis ?? 'This estimates recurring subscription value from active plans.'} Record payment receipts separately when payment tracking is added.</p></div>
    </div>
  );
}

function ShopsPanel({ data, onSave, onEdit, onToggle, page, onPage }: {
  data: Page<ShopRow> | null;
  onSave: (event: FormEvent<HTMLFormElement>, id: string) => void;
  onEdit: (shop: ShopRow) => void;
  onToggle: (shop: ShopRow) => void;
  page: number;
  onPage: (page: number) => void;
}) {
  return (
    <>
      <section className="panel table-panel">
        <div className="table-panel-heading"><div><h2>Shops</h2><p>{data ? `${data.total} shops registered` : 'Shop details and subscription controls'}</p></div><span className="privacy-chip"><span>✓</span> No financial data</span></div>
        <div className="table-wrap">
          <table><thead><tr><th>SHOP</th><th>OWNER</th><th>USERS</th><th>CREATED</th><th>SUBSCRIPTION MANAGEMENT</th><th>ACTIONS</th></tr></thead>
            <tbody>{data?.items.map(shop => <tr key={shop.id}>
              <td><div className="shop-cell"><span className="avatar shop-avatar">{initials(shop.name)}</span><span><strong>{shop.name}</strong><small>{shop.location || 'Location not set'}</small></span></div></td>
              <td>{shop.owner ? <div className="owner-cell"><strong>{shop.owner.name}</strong><small>{shop.owner.phone}</small></div> : <span className="muted">No owner</span>}</td>
              <td><span className="user-count">{shop.userCount}</span></td>
              <td className="date-cell">{formatDate(shop.createdAt)}</td>
              <td><form className="subscription-form" onSubmit={event => onSave(event, shop.id)}>
                <input aria-label={`${shop.name} plan`} name="plan" defaultValue={shop.plan === 'unassigned' ? 'Monthly' : shop.plan} className="plan-input" maxLength={40} />
                <span className="subscription-price">{shop.subscriptionCurrency} {Number(shop.subscriptionAmount).toLocaleString()} / {shop.billingInterval}</span>
                <select aria-label={`${shop.name} subscription status`} name="subscriptionStatus" defaultValue={shop.subscriptionStatus}>
                  <option value="trial">Trial</option><option value="active">Active</option><option value="expired">Expired</option><option value="suspended">Suspended</option>
                </select>
                <select aria-label={`${shop.name} shop access`} name="isActive" defaultValue={String(shop.isActive)}><option value="true">Shop enabled</option><option value="false">Shop disabled</option></select>
                <div className="date-inputs"><label>Start<input name="subscriptionStartedAt" type="date" defaultValue={dateInputValue(shop.subscriptionStartedAt)} /></label><label>End<input name="subscriptionEndsAt" type="date" defaultValue={dateInputValue(shop.subscriptionEndsAt)} /></label></div>
                <button className="button button-small" type="submit">Save</button>
              </form></td>
              <td><div className="row-actions"><button className="action-button action-edit" onClick={() => onEdit(shop)}>Edit details</button><button className={shop.isActive ? 'action-button action-deactivate' : 'action-button action-reactivate'} onClick={() => void onToggle(shop)}>{shop.isActive ? 'Deactivate' : 'Reactivate'}</button></div></td>
            </tr>)}
            {!data?.items.length && <tr><td className="empty-cell" colSpan={6}>No shops found. Try adjusting your search.</td></tr>}
            </tbody></table>
        </div>
        <Pagination page={page} limit={data?.limit ?? 20} total={data?.total ?? 0} onPage={onPage} />
      </section>
    </>
  );
}

function UsersPanel({ data, type, onType, onEdit, onToggle, page, onPage }: {
  data: Page<AccountRow> | null;
  type: 'owner' | 'staff';
  onType: (type: 'owner' | 'staff') => void;
  onEdit: (account: AccountRow) => void;
  onToggle: (account: AccountRow) => void;
  page: number;
  onPage: (page: number) => void;
}) {
  return (
    <section className="panel table-panel">
      <div className="table-panel-heading"><div><h2>Account activity</h2><p>{data ? `${data.total} ${type === 'owner' ? 'owner' : 'staff'} accounts` : 'Last sign-in and account status'}</p></div><div className="segmented-control"><button className={type === 'owner' ? 'selected' : ''} onClick={() => onType('owner')}>Owners</button><button className={type === 'staff' ? 'selected' : ''} onClick={() => onType('staff')}>Staff</button></div></div>
      <div className="table-wrap">
        <table><thead><tr><th>ACCOUNT</th><th>SHOP</th><th>ROLE</th><th>STATUS</th><th>LAST SIGN-IN</th><th>JOINED</th><th>ACTIONS</th></tr></thead>
          <tbody>{data?.items.map(account => <tr key={account.id}>
            <td><div className="shop-cell"><span className="avatar account-avatar">{initials(account.name)}</span><span><strong>{account.name}</strong><small>{account.phone}{account.email ? ` · ${account.email}` : ''}</small></span></div></td>
            <td>{account.shopName}</td><td><span className="role-label">{account.role.replaceAll('_', ' ')}</span></td><td><StatusBadge value={account.status} /></td><td className="date-cell">{formatDate(account.lastLoginAt)}</td><td className="date-cell">{formatDate(account.createdAt)}</td>
            <td><div className="row-actions"><button className="action-button action-edit" onClick={() => onEdit(account)}>Edit</button><button className={account.status === 'active' ? 'action-button action-deactivate' : 'action-button action-reactivate'} onClick={() => void onToggle(account)}>{account.status === 'active' ? 'Deactivate' : 'Reactivate'}</button></div></td>
          </tr>)}
          {!data?.items.length && <tr><td className="empty-cell" colSpan={7}>No accounts found. Try adjusting your search.</td></tr>}
          </tbody></table>
      </div>
      <Pagination page={page} limit={data?.limit ?? 20} total={data?.total ?? 0} onPage={onPage} />
      <div className="panel-note note-bottom"><span>i</span> Sign-in times are recorded after a successful login. Account activity does not include shop sales, balances, or payment information.</div>
    </section>
  );
}

function EditModal({ editor, accountType, onClose, onSave }: {
  editor: Exclude<Editor, null>;
  accountType: 'owner' | 'staff';
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isShop = editor.kind === 'shop';
  const shop = editor.kind === 'shop' ? editor.item : null;
  const account = editor.kind === 'account' ? editor.item : null;
  const title = isShop ? 'Edit shop details' : accountType === 'owner' ? 'Edit owner account' : 'Edit staff account';
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
        <div className="edit-modal-heading"><div><p className="eyebrow">{isShop ? 'SHOP MANAGEMENT' : 'ACCOUNT MANAGEMENT'}</p><h2 id="edit-modal-title">{title}</h2></div><button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button></div>
        <form className="edit-form" onSubmit={onSave}>
          <label>{isShop ? 'Shop name' : 'Full name'}<input name="name" defaultValue={shop?.name ?? account?.name ?? ''} required maxLength={100} /></label>
          {!isShop && accountType === 'owner' && <label>Email address<input name="email" type="email" defaultValue={account?.email ?? ''} maxLength={254} /></label>}
          <label>{isShop ? 'Location' : 'Phone number'}<input name={isShop ? 'location' : 'phone'} defaultValue={shop?.location ?? account?.phone ?? ''} required maxLength={isShop ? 120 : 30} /></label>
          {isShop && <label>Contact phone<input name="phone" defaultValue={shop?.phone ?? ''} maxLength={30} /></label>}
          {!isShop && accountType === 'staff' && account && <>
            <label>Role<select name="role" defaultValue={account.role}><option value="manager">Manager</option><option value="cashier">Cashier</option><option value="sales">Sales</option><option value="stock_keeper">Stock keeper</option><option value="owner">Owner</option></select></label>
            <label>Account status<select name="status" defaultValue={account.status}><option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On leave</option></select></label>
          </>}
          <p className="edit-history-note">Changes preserve shop and account history. Customer financial details are not shown here.</p>
          <div className="edit-modal-actions"><button type="button" className="modal-cancel" onClick={onClose}>Cancel</button><button type="submit" className="button modal-save">Save changes</button></div>
        </form>
      </section>
    </div>
  );
}

function LoginTable({ items, compact = false }: { items: RecentLogin[]; compact?: boolean }) {
  if (!items.length) return <div className="empty-activity">No sign-ins have been recorded yet.</div>;
  return <div className={compact ? 'login-list compact' : 'login-list'}>{items.map(item => <div className="login-row" key={`${item.accountType}-${item.id}`}><span className="avatar login-avatar">{initials(item.name)}</span><span className="login-person"><strong>{item.name}</strong><small>{item.shopName} · {item.accountType}</small></span><span className="login-device"><span className="online-dot" /> Sign-in recorded</span><span className="login-time">{formatDate(item.lastLoginAt)}</span></div>)}</div>;
}

function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div className="pagination"><span>Showing <strong>{total ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, total)}</strong> of <strong>{total}</strong></span><div><button disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button></div></div>;
}
