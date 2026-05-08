-- Add sticker support to internal message types.
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'STICKER';
