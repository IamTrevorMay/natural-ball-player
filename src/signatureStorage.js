import { supabase } from './supabaseClient';

const SIGNATURE_BUCKET = 'signatures';
const PUBLIC_MARKER = `/storage/v1/object/public/${SIGNATURE_BUCKET}/`;
const SIGNED_MARKER = `/storage/v1/object/sign/${SIGNATURE_BUCKET}/`;

export function normalizeSignaturePath(storedValue) {
  if (typeof storedValue !== 'string') return null;
  const value = storedValue.trim();
  if (!value) return null;

  if (value.startsWith(`${SIGNATURE_BUCKET}/`)) {
    return value.slice(`${SIGNATURE_BUCKET}/`.length);
  }

  if (!/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const pathname = url.pathname || '';

    if (pathname.includes(PUBLIC_MARKER)) {
      const idx = pathname.indexOf(PUBLIC_MARKER);
      return decodeURIComponent(pathname.slice(idx + PUBLIC_MARKER.length));
    }
    if (pathname.includes(SIGNED_MARKER)) {
      const idx = pathname.indexOf(SIGNED_MARKER);
      return decodeURIComponent(pathname.slice(idx + SIGNED_MARKER.length));
    }

    const bucketMarker = `/${SIGNATURE_BUCKET}/`;
    if (pathname.includes(bucketMarker)) {
      const idx = pathname.indexOf(bucketMarker);
      return decodeURIComponent(pathname.slice(idx + bucketMarker.length));
    }
  } catch {
    return null;
  }

  return null;
}

export async function createSignedSignatureUrl(storedValue, expiresInSeconds = 60 * 60) {
  const path = normalizeSignaturePath(storedValue);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
