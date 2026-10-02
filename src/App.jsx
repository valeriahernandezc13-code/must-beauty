import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const money = n => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)
const today = () => new Date().toLocaleDateString('en-CA')
const sum = (a, k) => a.reduce((s, x) => s + Number(x[k] || 0), 0)
const field = { font: 'inherit', color: 'var(--ink)', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', width: '100%' }
const margin = p => (Number(p.price) > 0 ? Math.round(((p.price - (p.cost || 0)) / p.price) * 100) : 0)

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
  const [d, setD] = useState({ products: [], sales: [], expenses: [], purchases: [] })
  const [error, setError] = useState('')
  const refresh = async () => {
    const [p, s, e, c] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('expenses').select('*').order('date', { ascending: false }).limit(500),
      supabase.from('purchases').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    if (p.error || s.error || e.error || c.error) setError('No se pudieron cargar los datos. ¿Ejecutaste el archivo migracion-2.sql en Supabase?')
    else { setError(''); setD({ products: p.data, sales: s.data, expenses: e.data, purchases: c.data }) }
  }
  useEffect(() => { refresh() }, [])
  const stats = useMemo(() => ({
    value: d.products.reduce((a, p) => a + (p.cost || 0) * p.stock, 0),
    low: d.products.filter(p => p.stock <= p.min_stock).length,
    today: d.sales.filter(s => new Date(s.created_at).toLocaleDateString('en-CA') === today()).reduce((a, x) => a + Number(x.total), 0),
  }), [d])
  const tabs = [['vender', 'Vender'], ['inventario', 'Inventario'], ['compras', 'Compras'], ['finanzas', 'Finanzas'], ['historial', 'Historial']]
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
        <div className="stat"><span>Inventario a costo</span><b>{money(stats.value)}</b></div>
        <div className="stat"><span>Productos con poco stock</span><b className={stats.low ? 'low' : ''}>{stats.low}</b></div>
      </div>
      <div className="tabs" role="tablist" style={{ overflowX: 'auto' }}>
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'vender' && <Sell products={d.products} refresh={refresh} />}
      {tab === 'inventario' && <Inventory products={d.products} refresh={refresh} />}
      {tab === 'compras' && <Purchases products={d.products} purchases={d.purchases} refresh={refresh} />}
      {tab === 'finanzas' && <Finance sales={d.sales} expenses={d.expenses} refresh={refresh} />}
      {tab === 'historial' && <History sales={d.sales} refresh={refresh} />}
    </div>
  )
}

function Sell({ products, refresh }) {
  const [cart, setCart] = useState({})
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState({ ok: '', err: '' })
  const [busy, setBusy] = useState(false)
  const list = products.filter(p => (p.name + (p.category || '')).toLowerCase().includes(q.toLowerCase()))
  const items = products.filter(p => cart[p.id])
  const total = items.reduce((s, p) => s + p.price * cart[p.id], 0)
  const add = (p, n) => setCart(c => {
    const v = Math.max(0, Math.min(p.stock, (c[p.id] || 0) + n))
    const x = { ...c }; if (v) x[p.id] = v; else delete x[p.id]; return x
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
        <input placeholder="Buscar por nombre o categoría" aria-label="Buscar producto" value={q} onChange={e => setQ(e.target.value)} />
        {list.length === 0 && <div className="empty">No hay productos. Agrégalos en Inventario o en Compras.</div>}
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

const blank = { name: '', category: '', cost: '', price: '', stock: '', min_stock: '' }
function Inventory({ products, refresh }) {
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const valid = f.name.trim() && f.price !== '' && f.cost !== '' && f.stock !== ''
  const save = async () => {
    const row = { name: f.name.trim(), category: f.category.trim(), cost: +f.cost, price: +f.price, stock: +f.stock, min_stock: +(f.min_stock || 0) }
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
  const edit = p => { setEditing(p.id); setF({ name: p.name, category: p.category || '', cost: p.cost || 0, price: p.price, stock: p.stock, min_stock: p.min_stock }) }
  const m = f.price !== '' && f.cost !== '' ? margin({ price: +f.price, cost: +f.cost }) : null
  return (
    <div className="card">
      <h2>{editing ? 'Editar producto' : 'Nuevo producto'}</h2>
      <div className="form">
        <label>Nombre<input value={f.name} onChange={set('name')} /></label>
        <label>Categoría<input value={f.category} onChange={set('category')} /></label>
        <label>Precio de compra<input type="number" min="0" value={f.cost} onChange={set('cost')} /></label>
        <label>Precio de venta<input type="number" min="0" value={f.price} onChange={set('price')} /></label>
        <label>Stock<input type="number" min="0" value={f.stock} onChange={set('stock')} /></label>
        <label>Stock mínimo<input type="number" min="0" value={f.min_stock} onChange={set('min_stock')} /></label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="b p" disabled={!valid} onClick={save}>{editing ? 'Guardar cambios' : 'Agregar producto'}</button>
          {editing && <button className="b" onClick={() => { setEditing(null); setF(blank) }}>Cancelar</button>}
          {m !== null && <small style={{ color: 'var(--mute)' }}>Margen: {m}%</small>}
        </div>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {products.length === 0 ? <div className="empty">Aún no hay productos. Completa el formulario para agregar el primero.</div> :
        <div className="scroll"><table>
          <thead><tr><th>Producto</th><th>Categoría</th><th className="n">Compra</th><th className="n">Venta</th><th className="n">Margen</th><th className="n">Stock</th><th></th></tr></thead>
          <tbody>{products.map(p => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.category}</td>
              <td className="n">{money(p.cost)}</td><td className="n">{money(p.price)}</td>
              <td className="n">{margin(p)}%</td>
              <td className="n">{p.stock <= p.min_stock ? <span className="tag">{p.stock} · reponer</span> : p.stock}</td>
              <td className="n"><button className="b" onClick={() => edit(p)}>Editar</button> <button className="b" onClick={() => del(p.id)}>Eliminar</button></td>
            </tr>))}
          </tbody></table></div>}
    </div>
  )
}

function Purchases({ products, purchases, refresh }) {
  const empty = { pid: '', name: '', category: '', qty: '', cost: '', price: '' }
  const [f, setF] = useState(empty)
  const [msg, setMsg] = useState({ ok: '', err: '' })
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const isNew = f.pid === 'new'
  const valid = f.pid && f.qty !== '' && +f.qty > 0 && f.cost !== '' && (!isNew || (f.name.trim() && f.price !== ''))
  const save = async () => {
    const { error } = await supabase.rpc('register_purchase', {
      p_product_id: isNew ? null : +f.pid,
      p_name: isNew ? f.name.trim() : null,
      p_category: isNew ? f.category.trim() : null,
      p_qty: +f.qty, p_cost: +f.cost, p_price: f.price === '' ? null : +f.price,
    })
    if (error) return setMsg({ ok: '', err: 'No se pudo registrar: ' + error.message })
    setMsg({ ok: isNew ? 'Producto nuevo agregado al inventario.' : 'Stock actualizado.', err: '' })
    setF(empty); refresh()
  }
  return (
    <div className="card">
      <h2>Registrar compra de mercancía</h2>
      <div className="form">
        <label>Producto
          <select style={field} value={f.pid} onChange={set('pid')}>
            <option value="">Elige uno…</option>
            <option value="new">+ Producto nuevo</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {isNew && <label>Nombre<input value={f.name} onChange={set('name')} /></label>}
        {isNew && <label>Categoría<input value={f.category} onChange={set('category')} /></label>}
        <label>Cantidad comprada<input type="number" min="1" value={f.qty} onChange={set('qty')} /></label>
        <label>Costo por unidad<input type="number" min="0" value={f.cost} onChange={set('cost')} /></label>
        <label>{isNew ? 'Precio de venta' : 'Nuevo precio de venta (opcional)'}<input type="number" min="0" value={f.price} onChange={set('price')} /></label>
        <button className="b p" disabled={!valid} onClick={save}>Registrar compra</button>
      </div>
      {msg.ok && <div className="msg" role="status">{msg.ok}</div>}
      {msg.err && <div className="err" role="alert">{msg.err}</div>}
      <h2 style={{ marginTop: 16 }}>Últimas compras</h2>
      {purchases.length === 0 ? <div className="empty">Todavía no hay compras registradas.</div> :
        <div className="scroll"><table>
          <thead><tr><th>Fecha</th><th>Producto</th><th className="n">Cantidad</th><th className="n">Costo unidad</th></tr></thead>
          <tbody>{purchases.map(c => (
            <tr key={c.id}><td>{new Date(c.created_at).toLocaleDateString('es-CO')}</td><td>{c.name}</td><td className="n">{c.qty}</td><td className="n">{money(c.unit_cost)}</td></tr>))}
          </tbody></table></div>}
    </div>
  )
}

const CATS = { flete: 'Fletes', hermana: 'Pagos colaboradoes', otro: 'Otros gastos' }
function Finance({ sales, expenses, refresh }) {
  const [period, setPeriod] = useState('mes')
  const blankE = { category: 'flete', amount: '', note: '', date: today(), paid: true }
  const [f, setF] = useState(blankE)
  const [err, setErr] = useState('')
  const month = today().slice(0, 7)
  const inP = d => period === 'todo' || String(d).slice(0, 7) === month
  const S = sales.filter(s => inP(new Date(s.created_at).toLocaleDateString('en-CA')))
  const E = expenses.filter(x => inP(x.date))
  const ventas = sum(S, 'total'), costo = sum(S, 'cost_total'), bruta = ventas - costo
  const by = c => sum(E.filter(x => x.category === c), 'amount')
  const gastos = sum(E, 'amount'), neta = bruta - gastos
  const porPagar = sum(expenses.filter(x => !x.paid), 'amount')
  const add = async () => {
    const { error } = await supabase.from('expenses').insert({ ...f, amount: +f.amount, note: f.note.trim() })
    if (error) return setErr('No se pudo guardar: ' + error.message)
    setErr(''); setF(blankE); refresh()
  }
  const pay = async id => { await supabase.from('expenses').update({ paid: true }).eq('id', id); refresh() }
  const del = async id => { if (window.confirm('¿Eliminar este gasto?')) { await supabase.from('expenses').delete().eq('id', id); refresh() } }
  const K = ({ l, v, c }) => <div className="stat"><span>{l}</span><b style={c ? { color: c } : null}>{money(v)}</b></div>
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <select style={{ ...field, width: 'auto' }} value={period} onChange={e => setPeriod(e.target.value)} aria-label="Periodo">
          <option value="mes">Este mes</option><option value="todo">Todo el tiempo</option>
        </select>
      </div>
      <div className="stats">
        <K l="Ventas" v={ventas} /><K l="Costo de lo vendido" v={costo} />
        <K l="Ganancia bruta" v={bruta} />
        <K l="Fletes" v={by('flete')} /><K l="Pago a colaboradores" v={by('hermana')} /><K l="Otros gastos" v={by('otro')} />
        <K l="Ganancia neta" v={neta} c={neta < 0 ? 'var(--bad)' : 'var(--acc)'} />
        <K l="Por pagar (pendiente)" v={porPagar} c={porPagar ? 'var(--warn)' : null} />
      </div>
      <div className="card">
        <h2>Registrar gasto</h2>
        <div className="form">
          <label>Tipo<select style={field} value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
            {Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Monto<input type="number" min="0" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
          <label>Fecha<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
          <label>Nota<input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.paid} onChange={e => setF({ ...f, paid: e.target.checked })} />Ya lo pagué</label>
          <button className="b p" disabled={f.amount === ''} onClick={add}>Guardar gasto</button>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        {expenses.length === 0 ? <div className="empty">Aún no hay gastos. Registra un flete o un pago para empezar.</div> :
          <div className="scroll"><table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Nota</th><th className="n">Monto</th><th></th></tr></thead>
            <tbody>{expenses.map(x => (
              <tr key={x.id}>
                <td>{x.date}</td><td>{CATS[x.category] || x.category}</td><td>{x.note}</td>
                <td className="n">{money(x.amount)}</td>
                <td className="n">{x.paid ? <span style={{ color: 'var(--mute)' }}>Pagado</span> : <button className="b" onClick={() => pay(x.id)}>Marcar pagado</button>} <button className="b" onClick={() => del(x.id)}>Eliminar</button></td>
              </tr>))}
            </tbody></table></div>}
      </div>
    </div>
  )
}

function History({ sales, refresh }) {
  const [err, setErr] = useState('')
  const del = async s => {
    if (!window.confirm('¿Eliminar esta venta de ' + money(s.total) + '?')) return
    const restock = window.confirm('¿Devolver las unidades al inventario?\n\nAceptar = sí, suma el stock de nuevo.\nCancelar = no, solo borra la venta.')
    const { error } = await supabase.rpc('delete_sale', { p_id: s.id, p_restock: restock })
    if (error) setErr('No se pudo eliminar: ' + error.message); else { setErr(''); refresh() }
  }
  return (
    <div className="card">
      <h2>Ventas registradas</h2>
      {err && <div className="err" role="alert">{err}</div>}
      {sales.length === 0 ? <div className="empty">Todavía no hay ventas. Registra la primera en Vender.</div> :
        <div className="scroll"><table>
          <thead><tr><th>Fecha</th><th>Detalle</th><th className="n">Total</th><th className="n">Ganancia</th><th></th></tr></thead>
          <tbody>{sales.map(s => (
            <tr key={s.id}>
              <td>{new Date(s.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>{s.lines.map(l => l.qty + ' × ' + l.name).join(', ')}</td>
              <td className="n">{money(s.total)}</td>
              <td className="n">{money(s.total - (s.cost_total || 0))}</td>
              <td className="n"><button className="b" onClick={() => del(s)}>Eliminar</button></td>
            </tr>))}
          </tbody></table></div>}
    </div>
  )
}