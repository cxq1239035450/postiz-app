-- Additive, idempotent change; apply before starting the new backend.
ALTER TYPE "Provider" ADD VALUE IF NOT EXISTS 'WECHAT';
