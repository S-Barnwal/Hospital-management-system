// Waiting-hall TV screen (/tv/:token). Public, no login: shows token numbers and rooms only — never patient names.
// Polls every 4 s, flashes and announces each new call (chime + voice once sound is enabled), keeps the screen awake.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LuVolume2, LuVolumeX, LuMaximize } from 'react-icons/lu';
import { api } from '../../lib/api.js';
import { cx } from '../../components/ui.jsx';

function chime(ctx) {
  const now = ctx.currentTime;
  [660, 880].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, now + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.35); o.stop(now + i * 0.35 + 0.65);
  });
}

function speak(text, lang) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

export default function TvDisplay() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sound, setSound] = useState(false);
  const [flash, setFlash] = useState(null);
  const [clock, setClock] = useState(new Date());
  const seen = useRef(null);
  const audio = useRef(null);
  const lang = new URLSearchParams(window.location.search).get('lang') === 'hi' ? 'hi-IN' : 'en-IN';

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api.get(`/public/display/${encodeURIComponent(token)}`);
        if (!alive) return;
        setData(r.data); setError(null);
        const latest = r.data.recentCalls[0];
        const key = latest ? `${latest.queueKey}:${latest.number}:${latest.callCount}:${latest.calledAt}` : '';
        if (seen.current !== null && key && key !== seen.current) {
          setFlash(latest);
          setTimeout(() => setFlash(null), 8000);
          if (sound && audio.current) {
            chime(audio.current);
            const where = latest.counter ? (lang === 'hi-IN' ? `कमरा ${latest.counter}` : `room ${latest.counter}`) : latest.label;
            setTimeout(() => speak(lang === 'hi-IN' ? `टोकन नंबर ${latest.number}, कृपया ${where} में आएं` : `Token number ${latest.number}, please go to ${where}`, lang), 900);
          }
        }
        seen.current = key;
      } catch (e) {
        if (alive) setError(e.status === 404 ? 'This screen link is no longer valid. Ask the hospital for a new one.' : 'Reconnecting…');
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [token, sound, lang]);

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let lock = null;
    const req = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or not visible */ } };
    req();
    const onVis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, []);
  useEffect(() => { document.title = data ? `${data.hospital} — queue` : 'Queue display'; }, [data]);

  const enableSound = () => {
    try { audio.current = audio.current || new (window.AudioContext || window.webkitAudioContext)(); audio.current.resume(); chime(audio.current); } catch { /* no audio */ }
    setSound(true);
  };

  if (error && !data) return <div className="grid min-h-screen place-items-center bg-[#04130e] p-8 text-center text-2xl text-forest-100">{error}</div>;
  const queues = data?.queues || [];
  return (
    <div className="min-h-screen bg-[#04130e] text-white">
      <header className="flex items-center justify-between gap-4 border-b border-gold-500/30 px-6 py-4 lg:px-10">
        <div className="min-w-0"><p className="truncate font-display text-2xl font-bold text-gold-400 lg:text-4xl">{data?.hospital ?? '…'}</p><p className="text-sm text-forest-200 lg:text-base">{data?.screen}</p></div>
        <div className="flex items-center gap-3">
          <p className="font-mono text-3xl tabular-nums text-forest-50 lg:text-5xl">{clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
          <button onClick={sound ? () => setSound(false) : enableSound} className="rounded-full border border-white/20 p-3 hover:bg-white/10" aria-label={sound ? 'Mute' : 'Enable sound'}>{sound ? <LuVolume2 /> : <LuVolumeX />}</button>
          <button onClick={() => document.documentElement.requestFullscreen?.()} className="rounded-full border border-white/20 p-3 hover:bg-white/10" aria-label="Full screen"><LuMaximize /></button>
        </div>
      </header>
      {!sound && <button onClick={enableSound} className="w-full bg-gold-500/90 py-2 text-center font-semibold text-forest-950">Tap here once to turn on announcements</button>}
      {error && <p className="bg-red-700/80 py-1 text-center text-sm">{error}</p>}
      {flash && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#04130e]/95" role="alert">
          <div className="animate-pulse text-center">
            <p className="text-3xl text-forest-200 lg:text-5xl">Token</p>
            <p className="font-display text-[10rem] font-bold leading-none text-gold-400 lg:text-[16rem]">{flash.number}</p>
            <p className="text-4xl font-semibold lg:text-6xl">{flash.counter ? `Room / counter ${flash.counter}` : flash.label}</p>
            {flash.counter && <p className="mt-2 text-2xl text-forest-200">{flash.label}</p>}
          </div>
        </div>
      )}
      <main className="p-6 lg:p-10">
        {!queues.length ? <p className="mt-20 text-center text-3xl text-forest-200">No tokens yet today.</p> : (
          <div className={cx('grid gap-6', queues.length === 1 ? 'grid-cols-1' : queues.length <= 4 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3')}>
            {queues.map((q) => (
              <section key={q.key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="flex items-baseline justify-between gap-3"><h2 className="truncate text-2xl font-semibold lg:text-3xl">{q.label}</h2>{q.room && <span className="shrink-0 rounded-full bg-gold-500/20 px-3 py-1 text-lg text-gold-200">Room {q.room}</span>}</div>
                <p className="mt-4 text-sm uppercase tracking-[0.3em] text-forest-300">Now serving</p>
                <p className={cx('font-display text-8xl font-bold leading-none lg:text-9xl', q.current ? 'text-gold-400' : 'text-white/20')}>{q.current?.number ?? '—'}</p>
                <p className="mt-4 text-sm uppercase tracking-[0.3em] text-forest-300">Next</p>
                <p className="mt-1 flex flex-wrap gap-3 text-3xl font-semibold text-forest-50">{q.next.length ? q.next.map((n) => <span key={n} className="rounded-lg bg-white/10 px-3 py-1">{n}</span>) : <span className="text-white/30">—</span>}</p>
                <p className="mt-3 text-sm text-forest-200">{q.waiting} waiting{q.estimatedWaitMinutes ? ` · about ${q.estimatedWaitMinutes} min` : ''}</p>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
