-- ETAPA 2: rode este arquivo inteiro no Supabase > SQL Editor
create table work_schedules(
  id uuid primary key default gen_random_uuid(),
  nome text not null, entrada time not null default '08:00', saida time not null default '17:00',
  intervalo_min int not null default 60, tolerancia_min int not null default 10,
  dias int[] not null default '{1,2,3,4,5}');
insert into work_schedules(nome) values ('Padrão 8h');

create table profiles(
  id uuid primary key references auth.users on delete cascade,
  nome text not null, email text, cargo text,
  role text not null default 'funcionario' check (role in ('admin','funcionario')),
  ativo boolean not null default true,
  schedule_id uuid references work_schedules(id));

create table time_records(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  tipo text not null check (tipo in ('entrada','saida_intervalo','retorno','saida')),
  registrado_em timestamptz not null default now(),
  lat double precision, lng double precision, precisao real);
create index on time_records(user_id, registrado_em);

create table audit_log(
  id bigserial primary key, tabela text, registro_id text, acao text,
  usuario uuid default auth.uid(), antes jsonb, depois jsonb, em timestamptz default now());

create function is_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='admin' and ativo) $$;

-- cria o perfil automaticamente quando um usuário é criado
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as
$$ begin
  insert into profiles(id,nome,email,schedule_id)
  values(new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), new.email,
         (select id from work_schedules limit 1));
  return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- auditoria automática
create function audit() returns trigger language plpgsql security definer set search_path=public as
$$ begin
  insert into audit_log(tabela,registro_id,acao,antes,depois)
  values(tg_table_name, coalesce((to_jsonb(new)->>'id'),(to_jsonb(old)->>'id')), tg_op,
         case when tg_op<>'INSERT' then to_jsonb(old) end, case when tg_op<>'DELETE' then to_jsonb(new) end);
  return coalesce(new,old); end $$;
create trigger a1 after insert or update or delete on profiles for each row execute function audit();
create trigger a2 after insert or update or delete on work_schedules for each row execute function audit();
create trigger a3 after insert or update or delete on time_records for each row execute function audit();

-- registro de ponto: hora e tipo definidos pelo SERVIDOR
create function registrar_ponto(p_lat double precision, p_lng double precision, p_precisao real)
returns time_records language plpgsql security definer set search_path=public as $$
declare ult text; prox text; r time_records; hoje timestamptz;
begin
  if not exists(select 1 from profiles where id=auth.uid() and ativo) then raise exception 'Usuário inativo'; end if;
  hoje := date_trunc('day', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza';
  select tipo into ult from time_records where user_id=auth.uid() and registrado_em>=hoje order by registrado_em desc limit 1;
  prox := case ult when null then 'entrada' when 'entrada' then 'saida_intervalo'
          when 'saida_intervalo' then 'retorno' when 'retorno' then 'saida' else null end;
  if prox is null then raise exception 'Todas as marcações de hoje já foram feitas'; end if;
  insert into time_records(user_id,tipo,lat,lng,precisao) values(auth.uid(),prox,p_lat,p_lng,p_precisao) returning * into r;
  return r; end $$;

-- segurança por linha (RLS)
alter table profiles enable row level security;
alter table work_schedules enable row level security;
alter table time_records enable row level security;
alter table audit_log enable row level security;
create policy p_sel on profiles for select using (id=auth.uid() or is_admin());
create policy p_adm on profiles for all using (is_admin()) with check (is_admin());
create policy w_sel on work_schedules for select using (auth.uid() is not null);
create policy w_adm on work_schedules for all using (is_admin()) with check (is_admin());
create policy t_sel on time_records for select using (user_id=auth.uid() or is_admin());
create policy a_sel on audit_log for select using (is_admin());
-- funcionário NÃO tem policy de insert/update/delete em time_records: só marca via registrar_ponto()

-- DEPOIS de criar seu usuário em Authentication > Users, torne-se admin:
-- update profiles set role='admin' where email='SEU@EMAIL.COM';
