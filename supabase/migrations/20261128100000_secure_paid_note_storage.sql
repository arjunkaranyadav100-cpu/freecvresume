-- Track private object paths for paid study-note PDFs.
alter table public.study_notes
  add column if not exists storage_path text;

comment on column public.study_notes.storage_path is
  'Private Supabase Storage object path for paid-note PDFs; never expose a public URL.';

-- Restrict this dedicated private bucket to PDF files up to 50 MiB.
update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['application/pdf']
where id = 'paid-notes-private';
