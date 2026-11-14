import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

const NOME = { entrada: 'Entrada', saida_intervalo: 'Saída intervalo', retorno: 'Retorno', saida: 'Saída' }
const dh = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' })
const soNum = (s) => (s || '').replace(/\D/g, '')
const masc = (s) => soNum(s).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
function cpfOk(s) {
  const c = soNum(s); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false
  for (const n of [9, 10]) { let t = 0; for (let i = 0; i < n; i++) t += c[i] * (n + 1 - i); if (((t * 10) % 11) % 10 !== +c[n]) return false }
  return true
}
const VAZIO = { nome: '', cpf: '', data_nascimento: '', carga_horaria_diaria: '8', email: '', senha: '', cargo: '', telefone: '', matricula: '', data_admissao: '', endereco: '', observacoes: '' }
const CAMPOS = ['nome', 'cpf', 'data_nascimento', 'carga_horaria_diaria', 'cargo', 'telefone', 'matricula', 'data_admissao', 'endereco', 'observacoes']

function Funcionarios({ eu }) {
  const [lista, setLista] = useState([]), [f, setF] = useState(VAZIO), [edit, setEdit] = useState(null), [busca, setBusca] = useState(''), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false)
  const carregar = useCallback(async () => { const { data } = await supabase.from('profiles').select('*').order('nome'); setLista(data || []) }, [])
  useEffect(() => { carregar() }, [carregar])
  const set = (k) => (e) => setF({ ...f, [k]: k === 'cpf' ? masc(e.target.value) : e.target.value })
  const limpar = () => { setF(VAZIO); setEdit(null) }

  async function salvar(e) {
    e.preventDefault(); setMsg(null)
    if (!cpfOk(f.cpf)) return setMsg({ ok: false, t: 'CPF inválido. Confira os números.' })
    setBusy(true)
    const dados = Object.fromEntries(CAMPOS.map((k) => [k, f[k] === '' ? null : f[k]])); dados.cpf = soNum(f.cpf)
    const { data: dup } = await supabase.from('profiles').select('id').eq('cpf', dados.cpf).neq('id', edit || '00000000-0000-0000-0000-000000000000')
    if (dup?.length) { setBusy(false); return setMsg({ ok: false, t: 'Já existe um funcionário com este CPF.' }) }
    if (edit) {
      const { error } = await supabase.from('profiles').update(dados).eq('id', edit)
      setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'Alterações salvas.' }); if (!error) limpar()
    } else {
      const tmp = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await tmp.auth.signUp({ email: f.email, password: f.senha, options: { data: { ...Object.fromEntries(CAMPOS.map((k) => [k, f[k]])), cpf: dados.cpf } } })
      setMsg(error ? { ok: false, t: error.message } : { ok: true, t: `${f.nome} cadastrado. Já pode entrar com o e-mail e a senha informados.` }); if (!error) limpar()
    }
    setBusy(false); carregar()
  }
  const alternar = async (p) => { await supabase.from('profiles').update({ ativo: !p.ativo }).eq('id', p.id); carregar() }
  const editar = (p) => { setEdit(p.id); setMsg(null); setF({ ...VAZIO, ...Object.fromEntries(CAMPOS.map((k) => [k, k === 'cpf' ? masc(p[k]) : p[k] ?? ''])), email: p.email }); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return (
    <>
      <form className="card cad" onSubmit={salvar}>
        <h2>{edit ? 'Editar funcionário' : 'Novo funcionário'}</h2>
        <p className="mut">Campos com * são obrigatórios. Os demais são opcionais.</p>
        <div className="grid2">
          <label>Nome completo *<input value={f.nome} onChange={set('nome')} required /></label>
          <label>CPF *<input value={f.cpf} onChange={set('cpf')} inputMode="numeric" placeholder="000.000.000-00" required /></label>
          <label>Data de nascimento *<input type="date" value={f.data_nascimento} onChange={set('data_nascimento')} required /></label>
          <label>Carga horária diária (horas) *<input type="number" min="1" max="12" step="0.5" value={f.carga_horaria_diaria} onChange={set('carga_horaria_diaria')} required /></label>
          <label>Cargo<input value={f.cargo} onChange={set('cargo')} /></label>
          <label>Telefone<input value={f.telefone} onChange={set('telefone')} inputMode="tel" /></label>
          <label>Matrícula<input value={f.matricula} onChange={set('matricula')} /></label>
          <label>Data de admissão<input type="date" value={f.data_admissao} onChange={set('data_admissao')} /></label>
          <label className="full">Endereço<input value={f.endereco} onChange={set('endereco')} /></label>
          <label className="full">Observações<textarea rows="2" value={f.observacoes} onChange={set('observacoes')} /></label>
        </div>
        <h3>Acesso ao sistema</h3>
        <div className="grid2">
          <label>E-mail de login *<input type="email" value={f.email} onChange={set('email')} required disabled={!!edit} /></label>
          {!edit && <label>Senha (mínimo 6 caracteres) *<input type="text" minLength={6} value={f.senha} onChange={set('senha')} required /></label>}
        </div>
        <div className="linha">
          <button className="btn sol" disabled={busy}>{busy ? 'Salvando…' : edit ? 'Salvar alterações' : 'Cadastrar funcionário'}</button>
          {edit && <button type="button" className="btn sec" onClick={limpar}>Cancelar</button>}
        </div>
        {msg && <p className={`aviso ${msg.ok ? 'ok' : 'erro'}`} role="status">{msg.t}</p>}
      </form>

      <h2 className="sec-t">Equipe ({lista.length})</h2>
      <input className="busca" placeholder="Buscar por nome, CPF ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="equipe">
        {lista.filter((p) => `${p.nome} ${p.cpf || ''} ${p.email || ''}`.toLowerCase().includes(busca.toLowerCase())).map((p) => (
          <article className={`pessoa ${p.ativo ? '' : 'off'}`} key={p.id}>
            <div className="av">{p.nome?.[0]?.toUpperCase()}</div>
            <div className="info">
              <strong>{p.nome}</strong>{p.role === 'admin' && <span className="tag">admin</span>}{!p.ativo && <span className="tag cinza">desativado</span>}
              <div className="mut">{p.cargo || 'Sem cargo'} · {p.carga_horaria_diaria}h/dia</div>
              <div className="mut">{p.cpf ? masc(p.cpf) : 'CPF não informado'} · {p.email}</div>
            </div>
            <div className="acoes"><button className="link" onClick={() => editar(p)}>Editar</button>{p.id !== eu && <button className="link" onClick={() => alternar(p)}>{p.ativo ? 'Desativar' : 'Reativar'}</button>}</div>
          </article>
        ))}
      </div>
    </>
  )
}

function Registros() {
  const [regs, setRegs] = useState(null), [dias, setDias] = useState(7), [sel, setSel] = useState(null), [modo, setModo] = useState(null)
  const [f, setF] = useState({ em: '', tipo: 'entrada', just: '' }), [erro, setErro] = useState(''), [busy, setBusy] = useState(false)
  const carregar = useCallback(async () => {
    const { data } = await supabase.from('time_records').select('*, profiles(nome)').gte('registrado_em', new Date(Date.now() - dias * 864e5).toISOString()).order('registrado_em', { ascending: false }).limit(300)
    setRegs(data || [])
  }, [dias])
  useEffect(() => { carregar() }, [carregar])
  const abrir = (r, m) => { setSel(r); setModo(m); setErro(''); setF({ em: new Date(r.registrado_em).toLocaleString('sv-SE', { timeZone: 'America/Fortaleza' }).replace(' ', 'T').slice(0, 16), tipo: r.tipo, just: '' }) }
  const fechar = () => { setSel(null); setModo(null) }
  async function confirmar(e) {
    e.preventDefault(); setBusy(true); setErro('')
    const { error } = modo === 'editar'
      ? await supabase.rpc('corrigir_ponto', { p_id: sel.id, p_em: f.em + ':00-03:00', p_tipo: f.tipo, p_just: f.just })
      : await supabase.rpc('excluir_ponto', { p_id: sel.id, p_just: f.just })
    setBusy(false)
    if (error) return setErro(error.message)
    fechar(); carregar()
  }
  return (
    <>
      <div className="linha filtro"><label>Período<select value={dias} onChange={(e) => setDias(+e.target.value)}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option></select></label></div>
      {!regs ? <p className="mut">Carregando…</p> : !regs.length ? <p className="mut">Nenhuma marcação neste período.</p> : (
        <div className="card rolar"><table>
          <thead><tr><th>Funcionário</th><th>Tipo</th><th>Data e hora</th><th>Local</th><th>Ações</th></tr></thead>
          <tbody>{regs.map((r) => (
            <tr key={r.id}><td>{r.profiles?.nome}</td><td>{NOME[r.tipo]}{r.editado && <span className="tag cinza">editado</span>}</td><td>{dh(r.registrado_em)}</td>
              <td>{r.lat != null ? <a target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=18/${r.lat}/${r.lng}`}>Ver no mapa ({Math.round(r.precisao)} m)</a> : '—'}</td>
              <td className="acoes"><button className="link" onClick={() => abrir(r, 'editar')}>Editar</button><button className="link" onClick={() => abrir(r, 'excluir')}>Excluir</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {sel && <div className="fundo" onClick={fechar}><form className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={confirmar}>
        <h3>{modo === 'editar' ? 'Editar ponto' : 'Excluir ponto'}</h3>
        <p className="mut">{sel.profiles?.nome} · {NOME[sel.tipo]} · {dh(sel.registrado_em)}</p>
        {modo === 'editar' && <div className="grid2">
          <label>Data e hora<input type="datetime-local" value={f.em} onChange={(e) => setF({ ...f, em: e.target.value })} required /></label>
          <label>Tipo<select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(NOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>}
        <label className="just">Justificativa * (obrigatória)<textarea rows="3" minLength={5} required value={f.just} onChange={(e) => setF({ ...f, just: e.target.value })} placeholder="Ex.: funcionário esqueceu de bater o ponto, horário confirmado pelo gerente" /></label>
        {modo === 'excluir' && <p className="erro">Esta marcação será removida. A exclusão e a justificativa ficam gravadas no histórico.</p>}
        {erro && <p className="erro" role="alert">{erro}</p>}
        <div className="linha"><button className="btn sol" disabled={busy}>{busy ? 'Salvando…' : modo === 'editar' ? 'Salvar correção' : 'Excluir ponto'}</button><button type="button" className="btn sec" onClick={fechar}>Cancelar</button></div>
      </form></div>}
    </>
  )
}

const ST = { entrada: ['Trabalhando', 'ok'], retorno: ['Trabalhando', 'ok'], saida_intervalo: ['No intervalo', 'amb'], saida: ['Saiu', 'cinza'] }
function Hoje() {
  const [d, setD] = useState(null)
  const carregar = useCallback(async () => {
    const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' })
    const [p, r] = await Promise.all([
      supabase.from('profiles').select('id,nome,cargo,role').eq('ativo', true).order('nome'),
      supabase.from('time_records').select('user_id,tipo,registrado_em').gte('registrado_em', dia + 'T00:00:00-03:00').order('registrado_em')])
    setD({ p: p.data || [], r: r.data || [], em: new Date() })
  }, [])
  useEffect(() => {
    carregar()
    const i = setInterval(carregar, 10000)
    const volta = () => { if (!document.hidden) carregar() }
    document.addEventListener('visibilitychange', volta)
    const canal = supabase.channel('ponto-hoje').on('postgres_changes', { event: '*', schema: 'public', table: 'time_records' }, carregar).subscribe()
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', volta); supabase.removeChannel(canal) }
  }, [carregar])
  if (!d) return <p className="mut">Carregando…</p>
  const linhas = d.p.filter((p) => p.role === 'funcionario' || d.r.some((x) => x.user_id === p.id)).map((p) => { const u = d.r.filter((x) => x.user_id === p.id).at(-1); return { p, u, st: u ? ST[u.tipo] : ['Não bateu', 'err'] } })
  const cont = (n) => linhas.filter((l) => l.st[0] === n).length
  return (
    <>
      <div className="kpis4">
        {[['Trabalhando', 'ok'], ['No intervalo', 'amb'], ['Saiu', 'cinza'], ['Não bateu', 'err']].map(([n, c]) => <div className="kpi" key={n}><span className={`st ${c}`}>{n}</span><b className="num">{cont(n)}</b></div>)}
      </div>
      <p className="mut"><span className="vivo" /> Ao vivo · atualizado às {d.em.toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' })}</p>
      {linhas.length === 0 && <p className="mut">Nenhum funcionário ativo cadastrado.</p>}
      <div className="equipe">{linhas.map(({ p, u, st }) => (
        <article className="pessoa" key={p.id}><div className="av">{p.nome?.[0]?.toUpperCase()}</div>
          <div className="info"><strong>{p.nome}</strong><div className="mut">{p.cargo || 'Sem cargo'}{u ? ` · última marcação ${dh(u.registrado_em)}` : ''}</div></div>
          <span className={`st ${st[1]}`}>{st[0]}</span></article>
      ))}</div>
    </>
  )
}

export default function Admin({ eu }) {
  const [aba, setAba] = useState('hoje')
  return (
    <main className="painel larga">
      <nav className="tabs"><button className={aba === 'hoje' ? 'on' : ''} onClick={() => setAba('hoje')}>Hoje</button><button className={aba === 'func' ? 'on' : ''} onClick={() => setAba('func')}>Funcionários</button><button className={aba === 'reg' ? 'on' : ''} onClick={() => setAba('reg')}>Registros</button></nav>
      {aba === 'hoje' ? <Hoje /> : aba === 'func' ? <Funcionarios eu={eu} /> : <Registros />}
    </main>
  )
}