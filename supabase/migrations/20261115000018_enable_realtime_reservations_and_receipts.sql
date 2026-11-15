-- =============================================================================
-- Migration 18: Enable Realtime on reservations and payment_receipts
-- Ensures landlords receive live payment and reservation change events and
-- triggers immediate reminder tones across active sessions.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'reservations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'payment_receipts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_receipts;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not alter supabase_realtime publication automatically: %', SQLERRM;
END $$;
