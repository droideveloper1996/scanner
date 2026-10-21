'use client';
import { useEffect } from 'react';

export function RegisterSW() {
  useEffect(() => {
    const ok = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost');
    if (ok) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
