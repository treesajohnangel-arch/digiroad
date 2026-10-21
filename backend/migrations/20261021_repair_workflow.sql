ALTER TABLE public.user_complaints
    ADD COLUMN IF NOT EXISTS citizen_name text,
    ADD COLUMN IF NOT EXISTS contact text,
    ADD COLUMN IF NOT EXISTS severity text,
    ADD COLUMN IF NOT EXISTS repair_type text;

ALTER TABLE public.dynamic_road_evaluations
    ADD COLUMN IF NOT EXISTS rut_depth_mm double precision;

ALTER TABLE public.historic_road_evaluations
    ADD COLUMN IF NOT EXISTS rut_depth_mm double precision;

CREATE OR REPLACE FUNCTION public.apply_road_repair(
    p_complaint_id text,
    p_segment_id text,
    p_repair_type text,
    p_repaired_at timestamptz,
    p_pci_score double precision,
    p_iri_m_km double precision,
    p_cracking_pct double precision,
    p_rut_depth_mm double precision,
    p_raveling_pct double precision,
    p_patching_pct double precision,
    p_road_health text,
    p_cumulative_esal_msa double precision DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    affected_rows integer;
BEGIN
    UPDATE public.user_complaints
       SET status = 'repaired',
           repaired_at = p_repaired_at,
           repair_type = p_repair_type
     WHERE complaint_id::text = p_complaint_id
       AND segment_id = p_segment_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows = 0 THEN
        RAISE EXCEPTION 'Complaint % was not found for segment %', p_complaint_id, p_segment_id
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.dynamic_road_evaluations
       SET pci_score = p_pci_score,
           iri_m_km = p_iri_m_km,
           cracking_pct = p_cracking_pct,
           rut_depth_mm = p_rut_depth_mm,
           raveling_pct = p_raveling_pct,
           patching_pct = p_patching_pct,
           pothole_pct = 0,
           road_health = p_road_health,
           cumulative_esal_msa = p_cumulative_esal_msa,
           execution_timestamp = p_repaired_at
     WHERE segment_id = p_segment_id;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows = 0 THEN
        INSERT INTO public.dynamic_road_evaluations (
            segment_id, pci_score, iri_m_km, cracking_pct, rut_depth_mm,
            raveling_pct, patching_pct, pothole_pct, road_health,
            cumulative_esal_msa, execution_timestamp
        ) VALUES (
            p_segment_id, p_pci_score, p_iri_m_km, p_cracking_pct, p_rut_depth_mm,
            p_raveling_pct, p_patching_pct, 0, p_road_health,
            p_cumulative_esal_msa, p_repaired_at
        );
    END IF;

    INSERT INTO public.historic_road_evaluations (
        segment_id, evaluation_timestamp, pci_score, iri_m_km, cracking_pct,
        rut_depth_mm, raveling_pct, patching_pct, road_health, cumulative_esal_msa
    ) VALUES (
        p_segment_id, p_repaired_at, p_pci_score, p_iri_m_km, p_cracking_pct,
        p_rut_depth_mm, p_raveling_pct, p_patching_pct, p_road_health, p_cumulative_esal_msa
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_road_repair(
    text, text, text, timestamptz, double precision, double precision,
    double precision, double precision, double precision, double precision,
    text, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_road_repair(
    text, text, text, timestamptz, double precision, double precision,
    double precision, double precision, double precision, double precision,
    text, double precision
) TO service_role;
