import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from './supabase'
import Admin from './Admin.jsx'

const TZ = 'America/Fortaleza'
const TIPOS = ['entrada', 'saida_intervalo', 'retorno', 'saida']
const ROTULO = { entrada: 'Registrar entrada', saida_intervalo: 'Sair para intervalo', retorno: 'Voltar do intervalo', saida: 'Encerrar expediente' }
const CURTO = { entrada: 'Entrada', saida_intervalo: 'Intervalo', retorno: 'Retorno', saida: 'Saída' }
const hhmm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const chave = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ })
const fmt = (ms) => `${ms < 0 ? '-' : ''}${Math.floor(Math.abs(ms) / 36e5)}h${String(Math.floor((Math.abs(ms) % 36e5) / 6e4)).padStart(2, '0')}`
const dt = (k) => new Date(k + 'T12:00:00Z')
const somaDia = (k, n) => { const d = dt(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const util = (k) => { const w = dt(k).getUTCDay(); return w > 0 && w < 6 }

// Soma os períodos trabalhados. Só conta período aberto quando "agora" é informado (dia de hoje).
export function horasTrabalhadas(regs, agora = null) {
  let total = 0, inicio = null
  for (const r of regs) {
    const t = new Date(r.registrado_em).getTime()
    if (r.tipo === 'entrada' || r.tipo === 'retorno') inicio = t
    else if (inicio !== null) { total += t - inicio; inicio = null }
  }
  return inicio !== null && agora ? total + (agora - inicio) : total
}

function pegarLocalizacao() {
  return new Promise((ok, erro) => {
    if (!navigator.geolocation) return erro(new Error('Este aparelho não suporta localização.'))
    navigator.geolocation.getCurrentPosition(ok, (e) => erro(new Error(
      e.code === 1 ? 'Permissão de localização negada. Ative o GPS para este site nas configurações do navegador.'
        : 'Não foi possível obter a localização. Vá para um local aberto e tente novamente.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  })
}

document.documentElement.dataset.tema = (() => { try { return localStorage.getItem('tema') } catch { return null } })() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro')
function TemaBtn() {
  const [t, setT] = useState(document.documentElement.dataset.tema)
  const troca = () => { const n = t === 'claro' ? 'escuro' : 'claro'; document.documentElement.dataset.tema = n; try { localStorage.setItem('tema', n) } catch { } setT(n) }
  return <button className="tema" onClick={troca} aria-label="Alternar tema claro ou escuro">{t === 'claro' ? '☾' : '☀'}</button>
}
export const Paw = ({ size = 28 }) => (
  <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true"><g fill="currentColor">
    <ellipse cx="14" cy="28" rx="6" ry="8" /><ellipse cx="27" cy="16" rx="6" ry="9" /><ellipse cx="41" cy="16" rx="6" ry="9" /><ellipse cx="54" cy="28" rx="6" ry="8" />
    <path d="M32 30c-10 0-18 9-18 17 0 6 5 9 11 8 3-.6 5-1.5 7-1.5s4 .9 7 1.5c6 1 11-2 11-8 0-8-8-17-18-17z" /></g></svg>
)

function Topo({ children }) {
  return (
    <header className="topo"><div className="topo-in">
      <div className="brand"><span className="logo"><Paw size={22} /></span><span>Casa da Ração <b>Pet Center</b></span></div>
      <div className="acoes">{children}<TemaBtn /><button className="link" onClick={() => supabase.auth.signOut()}>Sair</button></div>
    </div></header>
  )
}

function Login() {
  const [email, setEmail] = useState(''), [senha, setSenha] = useState(''), [msg, setMsg] = useState(''), [load, setLoad] = useState(false)
  async function entrar(e) {
    e.preventDefault(); setLoad(true); setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) setMsg('E-mail ou senha incorretos.')
    setLoad(false)
  }
  return (
    <main className="login"><div className="canto"><TemaBtn /></div>
      <aside className="login-brand">
        <span className="logo grande"><Paw size={44} /></span>
        <h1>Casa da Ração<br />Pet Center</h1>
        <p>Controle de ponto da equipe.</p>
      </aside>
      <form onSubmit={entrar} className="login-form">
        <h2>Bem-vindo de volta</h2>
        <p className="mut">Entre com o e-mail e a senha fornecidos pela empresa.</p>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></label>
        <label>Senha<input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" /></label>
        {msg && <p className="erro" role="alert">{msg}</p>}
        <button className="btn sol" disabled={load}>{load ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  )
}

const Chips = ({ regs }) => regs.length
  ? <div className="chips">{regs.map((r) => <span className="chip" key={r.id}><i>{CURTO[r.tipo]}</i>{hhmm(r.registrado_em)}</span>)}</div>
  : <span className="mut">Sem marcações</span>

function Funcionario({ perfil }) {
  const meta = (Number(perfil.carga_horaria_diaria) || 8) * 36e5
  const [regs, setRegs] = useState([]), [agora, setAgora] = useState(Date.now()), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false), [aba, setAba] = useState('hoje'), [conf, setConf] = useState(false)
  const hoje = chave(agora), mesIni = hoje.slice(0, 8) + '01'
  const semIni = somaDia(hoje, -((dt(hoje).getUTCDay() + 6) % 7))
  const ini = semIni < mesIni ? semIni : mesIni

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('time_records').select('*').gte('registrado_em', ini + 'T00:00:00-03:00').order('registrado_em')
    setRegs(data || [])
  }, [ini])
  useEffect(() => { carregar(); const i = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(i) }, [carregar])
  useEffect(() => { if (msg?.ok) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) } }, [msg])

  const porDia = useMemo(() => { const m = {}; regs.forEach((r) => (m[chave(r.registrado_em)] ||= []).push(r)); return m }, [regs])
  const trab = (k) => horasTrabalhadas(porDia[k] || [], k === hoje ? agora : null)
  const hojeRegs = porDia[hoje] || [], prox = TIPOS[hojeRegs.length]
  const feitoHoje = trab(hoje), pct = Math.min(feitoHoje / meta, 1)
  const ult = hojeRegs.at(-1)?.tipo
  const st = !ult ? ['Não iniciou', 'cinza'] : ult === 'saida' ? ['Expediente concluído', 'ok'] : ult === 'saida_intervalo' ? ['No intervalo', 'amb'] : ['Trabalhando', 'ok']
  const resta = Math.max(meta - feitoHoje, 0)
  const falta = (ult === 'entrada' || ult === 'retorno') && resta > 0 ? `Faltam ${fmt(resta)} para a meta${ult === 'retorno' ? ` · saída prevista às ${hhmm(agora + resta)}` : ''}` : null
  const hora = Number(new Date(agora).toLocaleTimeString('pt-BR', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }))
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'


  async function marcar() {
    setBusy(true); setMsg(null)
    try {
      const p = await pegarLocalizacao()
      const { error } = await supabase.rpc('registrar_ponto', { p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_precisao: p.coords.accuracy })
      if (error) throw new Error(error.message)
      setMsg({ ok: true, t: 'Ponto registrado com sucesso!' }); await carregar()
    } catch (e) { setMsg({ ok: false, t: e.message }) }
    setBusy(false)
  }

  const semana = Array.from({ length: 7 }, (_, i) => somaDia(semIni, i))
  const semFeito = semana.reduce((s, k) => s + trab(k), 0), semMeta = semana.filter(util).length * meta
  const diasMes = Object.keys(porDia).filter((k) => k >= mesIni).sort().reverse()
  let esperado = 0, fechado = 0
  for (let k = mesIni; k < hoje; k = somaDia(k, 1)) { if (util(k)) esperado += meta; fechado += trab(k) }
  const saldo = fechado - esperado
  const lbl = (k, o) => dt(k).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...o })
  const Barra = ({ v }) => <div className="barra"><div style={{ width: `${Math.min(v / meta, 1) * 100}%` }} /></div>

  return (
    <main className="painel">
      <section className="hero">
        <div className="hero-txt">
          <p>{saud}, {perfil.nome.split(' ')[0]}</p><span className={`st ${st[1]}`}>{st[0]}</span>
          <div className="relogio">{new Date(agora).toLocaleTimeString('pt-BR', { timeZone: TZ })}</div>
          <p className="data">{lbl(hoje, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="anel" aria-label={`Hoje: ${fmt(feitoHoje)} de ${fmt(meta)}`}>
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" className="trilho" /><circle cx="60" cy="60" r="54" className="prog" strokeDasharray="339.3" strokeDashoffset={339.3 * (1 - pct)} /></svg>
          <div><strong className="num">{fmt(feitoHoje)}</strong><span>de {fmt(meta)}</span></div>
        </div>
      </section>

      {prox ? <button className="btn sol marcar" onClick={() => setConf(true)} disabled={busy}>{busy ? 'Obtendo localização…' : ROTULO[prox]}</button>
        : <p className="fim">Expediente de hoje concluído. Bom descanso!</p>}
      {falta && <p className="falta">{falta}</p>}
      {msg && <div className={`toast ${msg.ok ? 'ok' : 'erro'}`} role="status" onClick={() => setMsg(null)}>{msg.t}</div>}
      {conf && <div className="fundo" onClick={() => setConf(false)}><div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{ROTULO[prox]}?</h3><p className="mut">Serão registrados o horário do servidor (agora {hhmm(agora)}) e a sua localização.</p>
        <div className="linha"><button className="btn sol" onClick={() => { setConf(false); marcar() }}>Confirmar</button><button className="btn sec" onClick={() => setConf(false)}>Cancelar</button></div></div></div>}

      <nav className="tabs" role="tablist">
        {[['hoje', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês']].map(([k, n]) => <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? 'on' : ''} onClick={() => setAba(k)}>{n}</button>)}
      </nav>

      {aba === 'hoje' && <div className="card">
        {TIPOS.map((t, i) => <div className={`slot ${hojeRegs[i] ? 'feito' : ''}`} key={t}><span>{CURTO[t]}</span><b>{hojeRegs[i] ? hhmm(hojeRegs[i].registrado_em) : '—'}</b></div>)}
      </div>}

      {aba === 'semana' && <div className="card">
        <div className="resumo"><span>Trabalhado na semana</span><b className="num">{fmt(semFeito)} <small>de {fmt(semMeta)}</small></b></div>
        {semana.map((k) => (
          <div className={`dia ${k === hoje ? 'hoje' : ''} ${k > hoje ? 'futuro' : ''}`} key={k}>
            <div className="dia-topo"><span>{lbl(k, { weekday: 'short', day: '2-digit', month: '2-digit' })}</span><b>{k > hoje ? '' : fmt(trab(k))}</b></div>
            {util(k) && k <= hoje && <Barra v={trab(k)} />}
            {k <= hoje && <Chips regs={porDia[k] || []} />}
          </div>
        ))}
      </div>}

      {aba === 'mes' && <div className="card">
        <div className="kpis">
          <div><span>Dias com ponto</span><b className="num">{diasMes.length}</b></div>
          <div><span>Trabalhado no mês</span><b className="num">{fmt(fechado + trab(hoje))}</b></div>
          <div><span>Saldo até ontem</span><b className={`num ${saldo < 0 ? 'neg' : 'pos'}`}>{saldo > 0 ? '+' : ''}{fmt(saldo)}</b></div>
        </div>
        {diasMes.length === 0 && <p className="mut">Nenhuma marcação neste mês ainda.</p>}
        {diasMes.map((k) => (
          <div className="dia" key={k}>
            <div className="dia-topo"><span>{lbl(k, { weekday: 'short', day: '2-digit', month: '2-digit' })}</span><b>{fmt(trab(k))}</b></div>
            <Chips regs={porDia[k]} />
          </div>
        ))}
      </div>}
    </main>
  )
}

function Escolha({ perfil, escolher }) {
  return (
    <main className="login escolha"><div className="canto"><TemaBtn /></div>
      <aside className="login-brand"><span className="logo grande"><Paw size={44} /></span><h1>Casa da Ração<br />Pet Center</h1></aside>
      <div className="login-form">
        <h2>Olá, {perfil.nome.split(' ')[0]}</h2>
        <p className="mut">Como você quer entrar agora?</p>
        <button className="opc" onClick={() => escolher('admin')}><b>Painel do administrador</b><span>Equipe, registros e acompanhamento do dia</span></button>
        <button className="opc" onClick={() => escolher('ponto')}><b>Registrar meu ponto</b><span>Bater ponto e ver minhas horas</span></button>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    </main>
  )
}

export default function App() {
  const [sessao, setSessao] = useState(undefined), [perfil, setPerfil] = useState(null), [modo, setModo] = useState(null)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!sessao) { setPerfil(null); setModo(null); return }
    supabase.from('profiles').select('*').eq('id', sessao.user.id).single().then(({ data }) => setPerfil(data))
  }, [sessao])

  if (sessao === undefined) return null
  if (!sessao) return <Login />
  if (!perfil) return <p className="mut centro">Carregando…</p>
  if (!perfil.ativo) return <p className="erro centro">Seu acesso está desativado. Fale com o administrador.</p>
  const admin = perfil.role === 'admin'
  if (admin && !modo) return <Escolha perfil={perfil} escolher={setModo} />
  return (
    <>
      <Topo>{admin && <button className="link" onClick={() => setModo(modo === 'admin' ? 'ponto' : 'admin')}>{modo === 'admin' ? 'Meu ponto' : 'Painel'}</button>}</Topo>
      {admin && modo === 'admin' ? <Admin eu={perfil.id} /> : <Funcionario perfil={perfil} />}
    </>
  )
}