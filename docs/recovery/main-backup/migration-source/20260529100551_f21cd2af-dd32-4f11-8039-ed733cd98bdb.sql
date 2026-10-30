-- Add partial indexes for message_reads to optimize read-count lookups
-- These support the fetchReadCounts queries which filter by specific message ID columns

CREATE INDEX IF NOT EXISTS idx_message_reads_group_message
ON public.message_reads (group_message_id)
WHERE group_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reads_direct_message
ON public.message_reads (direct_message_id)
WHERE direct_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reads_broadcast_message
ON public.message_reads (broadcast_message_id)
WHERE broadcast_message_id IS NOT NULL;