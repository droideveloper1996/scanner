'use client';
import { useEffect, useState } from 'react';

type Feed = {
  telegram: boolean; cronSecret: boolean; coins: string[]; storage: string | null; checked: string | null; error?: string;
  recent: { at: string; sym: string; kind: string; text: string; delivered: boolean }[];
};

/** Alerts are stored as Telegram HTML: show them as one plain line. */
const plain = (t: string) => t.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').split('\n\n')[0].split('\n').join(' · ');

export function AlertsPanel() {
  const [f, setF] = useState<Feed | null>(null);
  useEffect(() => {
    let off = false;
    const go = () => fetch('/api/alerts').then(r => r.json()).then(j => { if (!off) setF(j); }).catch(() => {});
    go(); const id = setInterval(go, 60000);
    return () => { off = true; clearInterval(id); };
  }, []);
  const t = (iso: string) => iso.slice(5, 10) + ' ' + iso.slice(11, 16) + ' UTC';
  return (
    <section className="panel al" aria-label="Alerts">
      <h2>Alerts</h2>
      {!f ? <div className="fresh">Loading…</div> : (
        <>
          <div className="st">
            <span className={f.telegram ? 'ok' : 'no'}>Telegram {f.telegram ? 'connected' : 'not set up'}</span>
            <span className={f.cronSecret ? 'ok' : 'no'}>Scheduler key {f.cronSecret ? 'set' : 'missing'}</span>
            <span className={f.storage ? 'ok' : 'no'}>Storage {f.storage ?? 'unavailable'}</span>
            <span>Watching {f.coins.length} coins · last check {f.checked ? t(f.checked) : 'never'}</span>
          </div>
          {f.error && <div className="msg err">{f.error}</div>}
          {f.recent.length === 0
            ? <p className="why">No alerts yet. An alert fires when a coin enters Strong Buy or Strong Sell on a closed 1h candle, or breaks its 8h high or low on volume.</p>
            : <ul>{f.recent.map((a, i) => <li key={i}><time>{t(a.at)}</time><span>{plain(a.text)}</span></li>)}</ul>}
        </>
      )}
    </section>
  );
}
