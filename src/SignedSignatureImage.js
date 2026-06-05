import React, { useEffect, useState } from 'react';
import { createSignedSignatureUrl } from './signatureStorage';

export default function SignedSignatureImage({ signatureValue, alt, className }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      if (!signatureValue) {
        setSignedUrl(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const url = await createSignedSignatureUrl(signatureValue);
      if (!cancelled) {
        setSignedUrl(url || null);
        setLoading(false);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [signatureValue]);

  if (!signatureValue) return null;
  if (loading) {
    return <div className="text-xs text-gray-400">Loading signature...</div>;
  }
  if (!signedUrl) {
    return <div className="text-xs text-gray-400">Signature unavailable</div>;
  }
  return <img src={signedUrl} alt={alt} className={className} />;
}
