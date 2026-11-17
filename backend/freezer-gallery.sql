-- =====================================================================
--  GALERÍA MUNDIAL · FREEZER.CRAFT
--  Pegar TODO este texto una sola vez en Supabase → SQL Editor → Run.
--  Usa el mismo proyecto que los récords. Se puede volver a correr sin romper nada.
--
--  Cualquiera puede VER, SUBIR y VOTAR. Nadie puede borrar ni editar desde el juego:
--  para sacar una foto, entrá a Supabase → Table Editor → freezer_photos (y a
--  Storage → freezer para borrar el archivo).
-- =====================================================================

-- 1) Tabla de fotos
create table if not exists public.freezer_photos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null default '' check (char_length(name) <= 40),
  img_path   text not null unique check (img_path ~ '^heladera-[0-9]+-[a-z0-9]{6}\.jpg$'),
  votes      integer not null default 0 check (votes >= 0)
);
create index if not exists freezer_photos_top_idx on public.freezer_photos (votes desc, created_at desc);

alter table public.freezer_photos enable row level security;
revoke all on public.freezer_photos from anon, authenticated;
grant select on public.freezer_photos to anon, authenticated;
grant insert (name, img_path) on public.freezer_photos to anon, authenticated;

drop policy if exists "freezer: todos ven"   on public.freezer_photos;
drop policy if exists "freezer: todos suben" on public.freezer_photos;
create policy "freezer: todos ven"   on public.freezer_photos for select to anon, authenticated using (true);
create policy "freezer: todos suben" on public.freezer_photos for insert to anon, authenticated with check (votes = 0);

-- 2) Votar: solo se puede sumar o restar 1 con esta función
create or replace function public.freezer_vote(p_id uuid, p_delta integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.freezer_photos
     set votes = greatest(0, votes + case when p_delta > 0 then 1 else -1 end)
   where id = p_id
  returning votes;
$$;
revoke all on function public.freezer_vote(uuid, integer) from public;
grant execute on function public.freezer_vote(uuid, integer) to anon, authenticated;

-- 3) Carpeta de imágenes: pública para verlas, máximo 1,5 MB, solo JPG
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('freezer', 'freezer', true, 1572864, array['image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = 1572864, allowed_mime_types = array['image/jpeg'];

drop policy if exists "freezer: suben imagenes" on storage.objects;
create policy "freezer: suben imagenes" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'freezer' and name ~ '^heladera-[0-9]+-[a-z0-9]{6}\.jpg$');
