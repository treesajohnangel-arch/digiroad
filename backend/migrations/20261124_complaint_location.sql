-- Exact damage location (map pin, device GPS or photo geotag), shown as a marker on the 3D map.
ALTER TABLE public.user_complaints
    ADD COLUMN IF NOT EXISTS latitude double precision CHECK (latitude BETWEEN -90 AND 90),
    ADD COLUMN IF NOT EXISTS longitude double precision CHECK (longitude BETWEEN -180 AND 180);
