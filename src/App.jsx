import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])
  if (session === undefined) return null
  return session ? <Main email={session.user.email} /> : <Login />
}

function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) setErr('Correo o contraseña incorrectos.')
    setBusy(false)
  }
  return (
    <div className="login">
      <h1 className="brand" style={{ textAlign: 'center', fontSize: 40 }}>Must Beauty</h1>
      <form className="card" onSubmit={submit}>
        <label>Correo<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Contraseña<input type="password" required autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} /></label>
        <button className="b p" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        {err && <div className="err" role="alert">{err}</div>}
      </form>
    </div>
  )
}

function Main({ email }) {
  const [tab, setTab] = useState('vender')
  const [products, setProducts] = useState([])
  const [sales, setSales] = useState([])
  const [error, setError] = useState('')
  const refresh = async () => {
    const [p, s] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(200),
    ])
    if (p.error || s.error) setError('No se pudieron cargar los datos. Revisa tu conexión y el esquema SQL.')
    else { setError(''); setProducts(p.data); setSales(s.data) }
  }
  useEffect(() => { refresh() }, [])
  const stats = useMemo(() => {
    const today = new Date().toDateString()
    return {
      value: products.reduce((s, p) => s + p.price * p.stock, 0),
      low: products.filter(p => p.stock <= p.min_stock).length,
      today: sales.filter(s => new Date(s.created_at).toDateString() === today).reduce((s, x) => s + Number(x.total), 0),
    }
  }, [products, sales])
  return (
    <div className="wrap">
      <div className="top">
        <h1 className="brand">Must Beauty</h1>
        <span><small style={{ color: 'var(--mute)' }}>{email}</small>{' '}
          <button className="b" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></span>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="stats">
        <div className="stat"><span>Ventas de hoy</span><b>{money(stats.today)}</b></div>
        <div className="stat"><span>Valor del inventario</span><b>{money(stats.value)}</b></div>
        <div className="stat"><span>Productos con poco stock</span><b className={stats.low ? 'low' : ''}>{stats.low}</b></div>
      </div>
      <div className="tabs" role="tablist">
        {[['vender', 'Vender'], ['inventario', 'Inventario'], ['historial', 'Historial']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'vender' && <Sell products={products} refresh={refresh} />}
      {tab === 'inventario' && <Inventory products={products} refresh={refresh} />}
      {tab === 'historial' && <History sales={sales} />}
    </div>
  )
}

function Sell({ products, refresh }) {
  const [cart, setCart] = useState({})
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState({ ok: '', err: '' })
  const [busy, setBusy] = useState(false)
  const list = products.filter(p => (p.name + p.sku).toLowerCase().includes(q.toLowerCase()))
  const items = products.filter(p => cart[p.id])
  const total = items.reduce((s, p) => s + p.price * cart[p.id], 0)
  const add = (p, d) => setCart(c => {
    const n = Math.max(0, Math.min(p.stock, (c[p.id] || 0) + d))
    const x = { ...c }; if (n) x[p.id] = n; else delete x[p.id]; return x
  })
  const confirm = async () => {
    setBusy(true)
    const lines = items.map(p => ({ id: p.id, name: p.name, qty: cart[p.id], price: Number(p.price) }))
    const { error } = await supabase.rpc('register_sale', { p_lines: lines })
    if (error) setMsg({ ok: '', err: 'No se registró la venta: ' + error.message })
    else { setCart({}); setMsg({ ok: 'Venta registrada: ' + money(total), err: '' }) }
    await refresh(); setBusy(false)
  }
  return (
    <div className="cols">
      <div className="card">
        <h2>Productos</h2>
        <input placeholder="Buscar por nombre o código" aria-label="Buscar producto" value={q} onChange={e => setQ(e.target.value)} />
        {list.length === 0 && <div className="empty">No hay productos. Agrégalos en Inventario.</div>}
        {list.map(p => (
          <div className="row" key={p.id}>
            <div><div>{p.name}</div><small style={{ color: 'var(--mute)' }}>{money(p.price)} · Stock: <span className={p.stock <= p.min_stock ? 'low' : ''}>{p.stock}</span></small></div>
            <button className="b" disabled={p.stock < 1 || (cart[p.id] || 0) >= p.stock} onClick={() => add(p, 1)}>Agregar</button>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Venta actual</h2>
        {items.length === 0 && <div className="empty">Agrega productos para empezar una venta.</div>}
        {items.map(p => (
          <div className="row" key={p.id}>
            <span>{p.name}</span>
            <span className="qty">
              <button className="b" onClick={() => add(p, -1)} aria-label="Quitar uno">−</button>{cart[p.id]}
              <button className="b" disabled={cart[p.id] >= p.stock} onClick={() => add(p, 1)} aria-label="Agregar uno">+</button>
            </span>
          </div>
        ))}
        <div className="total"><span>Total</span><span>{money(total)}</span></div>
        <button className="b p" style={{ width: '100%' }} disabled={!items.length || busy} onClick={confirm}>Registrar venta</button>
        {msg.ok && <div className="msg" role="status">{msg.ok}</div>}
        {msg.err && <div className="err" role="alert">{msg.err}</div>}
      </div>
    </div>
  )
}

const blank = { name: '', sku: '', price: '', stock: '', min_stock: '' }
function Inventory({ products, refresh }) {
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const valid = f.name.trim() && f.price !== '' && f.stock !== ''
  const save = async () => {
    const row = { name: f.name.trim(), sku: f.sku.trim(), price: +f.price, stock: +f.stock, min_stock: +(f.min_stock || 0) }
    const { error } = editing
      ? await supabase.from('products').update(row).eq('id', editing)
      : await supabase.from('products').insert(row)
    if (error) return setErr('No se pudo guardar: ' + error.message)
    setErr(''); setF(blank); setEditing(null); refresh()
  }
  const del = async id => {
    if (!window.confirm('¿Eliminar este producto?')) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) setErr('No se pudo eliminar: ' + error.message); else refresh()
  }
  const edit = p => { setEditing(p.id); setF({ name: p.name, sku: p.sku, price: p.price, stock: p.stock, min_stock: p.min_stock }) }
  return (
    <div className="card">
      <h2>{editing ? 'Editar producto' : 'Nuevo producto'}</h2>
      <div className="form">
        <label>Nombre<input value={f.name} onChange={set('name')} /></label>
        <label>Código<input value={f.sku} onChange={set('sku')} /></label>
        <label>Precio<input type="number" min="0" value={f.price} onChange={set('price')} /></label>
        <label>Stock<input type="number" min="0" value={f.stock} onChange={set('stock')} /></label>
        <label>Stock mínimo<input type="number" min="0" value={f.min_stock} onChange={set('min_stock')} /></label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="b p" disabled={!valid} onClick={save}>{editing ? 'Guardar cambios' : 'Agregar producto'}</button>
          {editing && <button className="b" onClick={() => { setEditing(null); setF(blank) }}>Cancelar</button>}
        </div>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {products.length === 0 ? <div className="empty">Aún no hay productos. Completa el formulario para agregar el primero.</div> :
        <div className="scroll"><table>
          <thead><tr><th>Producto</th><th>Código</th><th className="n">Precio</th><th className="n">Stock</th><th></th></tr></thead>
          <tbody>{products.map(p => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.sku}</td><td className="n">{money(p.price)}</td>
              <td className="n">{p.stock <= p.min_stock ? <span className="tag">{p.stock} · reponer</span> : p.stock}</td>
              <td className="n"><button className="b" onClick={() => edit(p)}>Editar</button> <button className="b" onClick={() => del(p.id)}>Eliminar</button></td>
            </tr>))}
          </tbody></table></div>}
    </div>
  )
}

function History({ sales }) {
  return (
    <div className="card">
      <h2>Ventas registradas</h2>
      {sales.length === 0 ? <div className="empty">Todavía no hay ventas. Registra la primera en Vender.</div> :
        <div className="scroll"><table>
          <thead><tr><th>Fecha</th><th>Detalle</th><th className="n">Total</th></tr></thead>
          <tbody>{sales.map(s => (
            <tr key={s.id}>
              <td>{new Date(s.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>{s.lines.map(l => l.qty + ' × ' + l.name).join(', ')}</td>
              <td className="n">{money(s.total)}</td>
            </tr>))}
          </tbody></table></div>}
    </div>
  )
}
