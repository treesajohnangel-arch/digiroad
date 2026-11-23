-- Complaint priority: P1 (urgent) to P4 (low). Set automatically on submit, admins can override.
ALTER TABLE public.user_complaints
    ADD COLUMN IF NOT EXISTS priority text CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
    ADD COLUMN IF NOT EXISTS priority_source text NOT NULL DEFAULT 'auto' CHECK (priority_source IN ('auto', 'admin'));

-- Existing complaints: priority from severity alone (road PCI at submit time is not recorded).
UPDATE public.user_complaints
SET priority = CASE lower(coalesce(severity, ''))
        WHEN 'critical' THEN 'P1'
        WHEN 'high' THEN 'P2'
        WHEN 'medium' THEN 'P3'
        ELSE 'P4'
    END
WHERE priority IS NULL;
