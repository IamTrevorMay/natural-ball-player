-- Audit IM1: most storage buckets had no file_size_limit and no
-- allowed_mime_types. Lets a user upload arbitrarily large files or
-- arbitrary content types (HTML/EXE) into buckets where a clamp is
-- appropriate. Tighten per bucket.
--
-- Sizes are conservative — set so genuine documents fit but a clearly
-- abusive upload bounces server-side.

-- avatars: small images only (already 5 MB; tighten MIME)
UPDATE storage.buckets
  SET file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/gif']
  WHERE id = 'avatars';

-- signatures: PNG-only signature captures, small
UPDATE storage.buckets
  SET file_size_limit = 2097152,
      allowed_mime_types = ARRAY['image/png','image/jpeg']
  WHERE id = 'signatures';

-- bloodwork: PDFs + images, larger ceiling
UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = ARRAY['application/pdf','image/png','image/jpeg','image/heic']
  WHERE id = 'bloodwork';

-- coach-invoices: PDFs/images
UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = ARRAY['application/pdf','image/png','image/jpeg']
  WHERE id = 'coach-invoices';

-- staff-documents: PDFs + Office docs
UPDATE storage.buckets
  SET file_size_limit = 52428800,
      allowed_mime_types = ARRAY[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/png','image/jpeg'
      ]
  WHERE id = 'staff-documents';

-- staff-pay-docs: paystubs / W-2 / 1099, mostly PDF
UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = ARRAY['application/pdf','image/png','image/jpeg']
  WHERE id = 'staff-pay-docs';

-- message-attachments + work-attachments: chat uploads — broader, but capped
UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = ARRAY[
        'application/pdf',
        'image/png','image/jpeg','image/gif','image/webp','image/heic',
        'video/mp4','video/quicktime',
        'text/plain'
      ]
  WHERE id IN ('message-attachments','work-attachments');
