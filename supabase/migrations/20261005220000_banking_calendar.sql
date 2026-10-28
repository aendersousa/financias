begin;
create table finance.holidays (
  id uuid primary key default gen_random_uuid(),
  financial_space_id uuid references finance.financial_spaces(id) on delete cascade,
  holiday_on date not null,
  name text not null,
  kind text not null check (kind in ('national','bank','local')),
  check ((kind = 'local') = (financial_space_id is not null))
);
create unique index global_holiday_date on finance.holidays(holiday_on) where financial_space_id is null;
create unique index local_holiday_date on finance.holidays(financial_space_id,holiday_on) where financial_space_id is not null;
alter table finance.holidays enable row level security;
create policy holiday_read on finance.holidays for select to authenticated using (financial_space_id is null or private.is_member(financial_space_id));
revoke all on finance.holidays from public,anon,authenticated;
grant select on finance.holidays to authenticated;

create function private.space_today(p_space uuid) returns date language sql stable set search_path = '' as $$
  select (now() at time zone timezone)::date from finance.financial_spaces where id = p_space;
$$;
create function private.easter(p_year integer) returns date language plpgsql immutable set search_path = '' as $$
declare a integer; b integer; c integer; d integer; e integer; f integer; g integer; h integer; i integer; k integer; l integer; m integer; begin
  if p_year < 1900 or p_year > 9999 then raise exception 'Invalid holiday year' using errcode = '23514'; end if;
  a := p_year % 19; b := p_year / 100; c := p_year % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19*a+b-d-g+15) % 30; i := c/4; k := c % 4; l := (32+2*e+2*i-h-k) % 7; m := (a+11*h+22*l)/451;
  return make_date(p_year,(h+l-7*m+114)/31,(h+l-7*m+114)%31+1);
end;
$$;
create function private.ensure_holiday_year(p_year integer) returns void language plpgsql security definer set search_path = '' as $$
declare easter_on date := private.easter(p_year); begin
  insert into finance.holidays(holiday_on,name,kind)
  select make_date(p_year,month,day),name,'national' from (values
    (1,1,'Confraternização Universal'),(4,21,'Tiradentes'),(5,1,'Dia do Trabalho'),(9,7,'Independência'),(10,12,'Nossa Senhora Aparecida'),
    (11,2,'Finados'),(11,15,'Proclamação da República'),(11,20,'Consciência Negra'),(12,25,'Natal')) dates(month,day,name)
  on conflict (holiday_on) where financial_space_id is null do nothing;
  insert into finance.holidays(holiday_on,name,kind) values
    (easter_on-2,'Sexta-feira da Paixão','national'),(easter_on-48,'Segunda-feira de Carnaval','bank'),(easter_on-47,'Terça-feira de Carnaval','bank')
  on conflict (holiday_on) where financial_space_id is null do nothing;
end;
$$;
create function private.is_banking_day(p_space uuid,p_on date) returns boolean language sql stable set search_path = '' as $$
  select extract(isodow from p_on) not in (6,7) and not exists(select 1 from finance.holidays where holiday_on = p_on and (financial_space_id is null or financial_space_id = p_space));
$$;
create function private.effective_due_date(p_space uuid,p_on date,p_adjustment text default 'next') returns date language plpgsql set search_path = '' as $$
declare result date := p_on; steps integer := 0; begin
  if p_on is null or p_adjustment not in ('next','previous') then raise exception 'Invalid due date' using errcode = '23514'; end if;
  loop
    perform private.ensure_holiday_year(extract(year from result)::integer);
    if private.is_banking_day(p_space,result) then return result; end if;
    result := result + case when p_adjustment = 'next' then 1 else -1 end;
    steps := steps + 1;
    if steps > 366 then raise exception 'No banking day found' using errcode = '23514'; end if;
  end loop;
end;
$$;
create function private.add_banking_days(p_space uuid,p_on date,p_days integer) returns date language plpgsql set search_path = '' as $$
declare result date := p_on; idx integer; begin
  if p_days is null or p_days < 0 or p_days > 365 then raise exception 'Invalid banking day interval' using errcode = '23514'; end if;
  if p_days > 0 then for idx in 1..p_days loop result := private.effective_due_date(p_space,result+1); end loop; end if;
  return result;
end;
$$;
create function private.clamped_day(p_month date,p_day integer) returns date language sql immutable set search_path = '' as $$
  select date_trunc('month',p_month)::date + (least(p_day,extract(day from date_trunc('month',p_month) + interval '1 month - 1 day')::integer)-1);
$$;
revoke all on function private.space_today(uuid),private.easter(integer),private.ensure_holiday_year(integer),private.is_banking_day(uuid,date),private.effective_due_date(uuid,date,text),private.add_banking_days(uuid,date,integer),private.clamped_day(date,integer) from public,anon,authenticated;
do $$ declare year integer; begin for year in extract(year from now())::integer..extract(year from now())::integer+5 loop perform private.ensure_holiday_year(year); end loop; end $$;
commit;
