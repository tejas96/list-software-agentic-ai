'use client';

import { useEffect, useRef } from 'react';

/**
 * The "agent core": radial spokes of dots, one bright spoke per agent,
 * with a pulse travelling outward. Pure canvas, honours reduced motion.
 */
export function Orb({ size = 300, agents = 11 }: { size?: number; agents?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const N = 56;
    const agentSpokes = new Set(Array.from({ length: agents }, (_, i) => Math.round((i * N) / agents)));
    let frame = 0;
    const draw = (t: number) => {
      const w = c.width;
      const h = c.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.46;
      const r0 = R * 0.2;
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
      g.addColorStop(0, 'rgba(161,149,255,.20)');
      g.addColorStop(1, 'rgba(161,149,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const rot = t * 0.00004;
      for (let i = 0; i < N; i++) {
        const ang = (i / N) * Math.PI * 2 + rot;
        const ag = agentSpokes.has(i);
        for (let j = 0; j < 11; j++) {
          const f = j / 10;
          const rr = r0 + (R - r0) * f;
          const wave = Math.pow(Math.max(0, Math.cos(f * 5.5 - t * 0.0022 + (ag ? 0 : i * 0.35))), 10);
          const a = Math.min(1, (ag ? 0.55 : 0.16) * (1 - f * 0.55) + wave * (ag ? 0.6 : 0.35));
          const s = (ag ? 1.9 : 1.3) * dpr * (1 + wave * 0.8) * (1 - f * 0.25);
          ctx.fillStyle = ag ? `rgba(193,185,255,${a})` : `rgba(210,215,235,${a})`;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, s, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(233,235,243,.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      if (!reduce) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size, agents]);

  return <canvas ref={ref} aria-hidden="true" style={{ width: size, height: size, maxWidth: '100%' }} />;
}
