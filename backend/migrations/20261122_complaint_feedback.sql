-- Citizen answer to "Is the road fixed?" on the Track complaint page.
ALTER TABLE public.user_complaints
    ADD COLUMN IF NOT EXISTS citizen_feedback text,
    ADD COLUMN IF NOT EXISTS feedback_at timestamptz;
