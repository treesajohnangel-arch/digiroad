-- Complaint photos: link column plus a public Storage bucket (file names are random UUIDs).
ALTER TABLE public.user_complaints
    ADD COLUMN IF NOT EXISTS photo_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('complaint-photos', 'complaint-photos', true, 1000000, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;
