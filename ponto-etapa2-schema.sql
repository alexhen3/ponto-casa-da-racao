-- =====================================================================
-- CONTROLE DE PONTO (nome provisório) - ETAPA 2
-- Banco de dados + segurança (RLS) + auditoria + imutabilidade
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- ---------- 1. TABELAS ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  start_time time not null default '08:00',
  end_time time not null default '17:00',
  break_minutes int not null default 60,
  daily_minutes int not null default 480,
  tolerance_minutes int not null default 10,
  workdays int[] not null default '{1,2,3,4,5}', -- 1=segunda ... 7=domingo
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  schedule_id uuid references public.work_schedules(id) on delete set null,
  full_name text not null,
  role text not null default 'employee' check (role in ('owner','admin','manager','employee')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('clock_in','break_out','break_in','clock_out')),
  recorded_at timestamptz not null default now(),
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric,
  selfie_path text,
  device_info text,
  source text not null default 'employee' check (source in ('employee','correction')),
  supersedes_id uuid references public.time_entries(id), -- registro que este substitui
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index time_entries_supersedes_uq on public.time_entries(supersedes_id) where supersedes_id is not null;
create index time_entries_user_time_idx on public.time_entries(company_id, user_id, recorded_at desc);

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.profiles(id),
  entry_id uuid references public.time_entries(id), -- null = ponto esquecido
  kind text not null check (kind in ('clock_in','break_out','break_in','clock_out')),
  requested_time timestamptz not null,
  reason text not null check (length(trim(reason)) >= 5),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create table public.hour_bank_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.profiles(id),
  minutes int not null check (minutes <> 0), -- positivo = crédito, negativo = débito
  reason text not null check (length(trim(reason)) >= 5),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigserial primary key,
  company_id uuid,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- Registros "efetivos": ignora os que foram substituídos por uma correção aprovada
create view public.effective_time_entries with (security_invoker = true) as
select e.* from public.time_entries e
where not exists (select 1 from public.time_entries s where s.supersedes_id = e.id);

-- ---------- 2. FUNÇÕES AUXILIARES ----------
create or replace function public.current_company() returns uuid
language sql stable security definer set search_path = public as
$$ select company_id from public.profiles where id = auth.uid() and active $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role in ('owner','admin') from public.profiles where id = auth.uid() and active), false) $$;

-- ---------- 3. PROTEÇÃO CONTRA MANIPULAÇÃO ----------
-- Horário do ponto vem SEMPRE do servidor; o relógio do celular é ignorado.
create or replace function public.time_entries_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'employee' then
    new.recorded_at := now();
    new.user_id := auth.uid();
    new.company_id := public.current_company();
    new.created_by := auth.uid();
  end if;
  return new;
end $$;
create trigger time_entries_bi before insert on public.time_entries
for each row execute function public.time_entries_before_insert();

-- Registros são imutáveis: nada de UPDATE, DELETE ou TRUNCATE
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Registro imutável: % em % não é permitido', tg_op, tg_table_name;
end $$;

create trigger time_entries_immutable before update or delete on public.time_entries
for each row execute function public.forbid_mutation();
create trigger time_entries_no_truncate before truncate on public.time_entries
for each statement execute function public.forbid_mutation();
create trigger bank_immutable before update or delete on public.hour_bank_adjustments
for each row execute function public.forbid_mutation();
create trigger audit_immutable before update or delete on public.audit_log
for each row execute function public.forbid_mutation();
create trigger audit_no_truncate before truncate on public.audit_log
for each statement execute function public.forbid_mutation();

-- ---------- 4. AUDITORIA AUTOMÁTICA ----------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; r jsonb;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  r := coalesce(n, o);
  insert into public.audit_log(company_id, actor_id, action, table_name, record_id, old_data, new_data)
  values ((r->>'company_id')::uuid, auth.uid(), tg_op, tg_table_name, r->>'id', o, n);
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create trigger audit_departments after insert or update or delete on public.departments
for each row execute function public.audit_row();
create trigger audit_schedules after insert or update or delete on public.work_schedules
for each row execute function public.audit_row();
create trigger audit_profiles after insert or update or delete on public.profiles
for each row execute function public.audit_row();
create trigger audit_corrections after insert or update or delete on public.correction_requests
for each row execute function public.audit_row();
create trigger audit_entries after insert on public.time_entries
for each row execute function public.audit_row();
create trigger audit_bank after insert on public.hour_bank_adjustments
for each row execute function public.audit_row();

-- ---------- 5. REGRAS DE ACESSO (RLS) ----------
alter table public.companies enable row level security;
alter table public.departments enable row level security;
alter table public.work_schedules enable row level security;
alter table public.profiles enable row level security;
alter table public.time_entries enable row level security;
alter table public.correction_requests enable row level security;
alter table public.hour_bank_adjustments enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon;
revoke update, delete, truncate on public.time_entries, public.hour_bank_adjustments, public.audit_log from authenticated;
revoke insert on public.audit_log from authenticated;

create policy companies_select on public.companies for select to authenticated
  using (id = public.current_company());

create policy departments_select on public.departments for select to authenticated
  using (company_id = public.current_company());
create policy departments_admin on public.departments for all to authenticated
  using (public.is_admin() and company_id = public.current_company())
  with check (public.is_admin() and company_id = public.current_company());

create policy schedules_select on public.work_schedules for select to authenticated
  using (company_id = public.current_company());
create policy schedules_admin on public.work_schedules for all to authenticated
  using (public.is_admin() and company_id = public.current_company())
  with check (public.is_admin() and company_id = public.current_company());

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (public.is_admin() and company_id = public.current_company()));
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin() and company_id = public.current_company())
  with check (company_id = public.current_company());

create policy entries_select on public.time_entries for select to authenticated
  using (user_id = auth.uid() or (public.is_admin() and company_id = public.current_company()));
create policy entries_insert on public.time_entries for insert to authenticated
  with check (source = 'employee');

create policy corrections_select on public.correction_requests for select to authenticated
  using (user_id = auth.uid() or (public.is_admin() and company_id = public.current_company()));
create policy corrections_insert on public.correction_requests for insert to authenticated
  with check (user_id = auth.uid() and company_id = public.current_company() and status = 'pending');

create policy bank_select on public.hour_bank_adjustments for select to authenticated
  using (user_id = auth.uid() or (public.is_admin() and company_id = public.current_company()));
create policy bank_insert on public.hour_bank_adjustments for insert to authenticated
  with check (public.is_admin() and company_id = public.current_company()
    and exists (select 1 from public.profiles p where p.id = user_id and p.company_id = public.current_company()));

create policy audit_select on public.audit_log for select to authenticated
  using (public.is_admin() and company_id = public.current_company());

-- ---------- 6. FUNÇÕES DE NEGÓCIO ----------
-- Primeiro acesso: o usuário recém-cadastrado cria a empresa e vira "owner"
create or replace function public.create_company(p_company_name text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Este usuário já pertence a uma empresa';
  end if;
  insert into public.companies(name) values (p_company_name) returning id into cid;
  insert into public.profiles(id, company_id, full_name, role) values (auth.uid(), cid, p_full_name, 'owner');
  return cid;
end $$;

-- Admin aprova/rejeita correção (motivo obrigatório). O registro original nunca é alterado.
create or replace function public.review_correction(p_request uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare req public.correction_requests;
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  if p_note is null or length(trim(p_note)) < 3 then raise exception 'Informe o motivo da decisão'; end if;
  select * into req from public.correction_requests
   where id = p_request and company_id = public.current_company() and status = 'pending' for update;
  if not found then raise exception 'Solicitação não encontrada ou já analisada'; end if;
  if p_approve then
    insert into public.time_entries(company_id, user_id, kind, recorded_at, source, supersedes_id, created_by)
    values (req.company_id, req.user_id, req.kind, req.requested_time, 'correction', req.entry_id, auth.uid());
  end if;
  update public.correction_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = req.id;
end $$;

-- ---------- 7. SELFIES (bucket privado) ----------
-- Caminho do arquivo: {company_id}/{user_id}/{arquivo}.jpg
insert into storage.buckets (id, name, public) values ('selfies', 'selfies', false)
on conflict (id) do nothing;

create policy selfies_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'selfies'
    and (storage.foldername(name))[1] = public.current_company()::text
    and (storage.foldername(name))[2] = auth.uid()::text);

create policy selfies_select on storage.objects for select to authenticated
  using (bucket_id = 'selfies'
    and (storage.foldername(name))[1] = public.current_company()::text
    and ((storage.foldername(name))[2] = auth.uid()::text or public.is_admin()));
