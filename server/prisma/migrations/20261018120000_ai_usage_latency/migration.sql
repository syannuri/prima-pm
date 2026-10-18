-- Phase 5: per-call latency on AI usage rows (nullable; existing rows stay null).
ALTER TABLE "AiUsage" ADD COLUMN "latencyMs" INTEGER;
