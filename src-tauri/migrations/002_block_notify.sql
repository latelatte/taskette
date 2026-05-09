-- Slice: notification feature
-- Add notify_offset_min to blocks: minutes before start to fire a notification.
-- NULL = no notification; 0 = at start time; N>0 = N minutes before.

ALTER TABLE blocks ADD COLUMN notify_offset_min INTEGER;
