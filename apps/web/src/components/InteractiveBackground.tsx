import { useEffect, useRef } from 'react';

type NodePoint = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
};

function createNodes(count: number, width: number, height: number): NodePoint[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random(),
    vx: (Math.random() - 0.5) * 0.16,
    vy: (Math.random() - 0.5) * 0.12,
  }));
}

export default function InteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0, y: 0, active: false };
    const state = {
      width: 0,
      height: 0,
      dpr: Math.min(window.devicePixelRatio || 1, 1.5),
      nodes: [] as NodePoint[],
      animationFrame: 0,
    };

    const resize = () => {
      state.width = window.innerWidth;
      state.height = window.innerHeight;
      state.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(state.width * state.dpr);
      canvas.height = Math.floor(state.height * state.dpr);
      canvas.style.width = `${state.width}px`;
      canvas.style.height = `${state.height}px`;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      const count = state.width < 768 ? 22 : 42;
      state.nodes = createNodes(count, state.width, state.height);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    };

    const onPointerLeave = () => {
      pointer.active = false;
    };

    const drawGrid = () => {
      const horizon = state.height * 0.58;
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.07)';
      ctx.lineWidth = 1;

      for (let i = 0; i < 9; i += 1) {
        const y = horizon + i * i * 8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(state.width, y);
        ctx.stroke();
      }

      for (let i = -7; i <= 7; i += 1) {
        const centerX = state.width / 2;
        const baseX = centerX + i * 140;
        ctx.beginPath();
        ctx.moveTo(centerX + i * 18, horizon);
        ctx.lineTo(baseX, state.height);
        ctx.stroke();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, state.width, state.height);

      const gradient = ctx.createLinearGradient(0, 0, state.width, state.height);
      gradient.addColorStop(0, 'rgba(239, 246, 255, 0.92)');
      gradient.addColorStop(0.48, 'rgba(248, 250, 252, 0.88)');
      gradient.addColorStop(1, 'rgba(224, 242, 254, 0.72)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, state.width, state.height);

      drawGrid();

      for (const node of state.nodes) {
        if (!prefersReducedMotion) {
          node.x += node.vx * (0.45 + node.z);
          node.y += node.vy * (0.45 + node.z);
          if (node.x < -30) node.x = state.width + 30;
          if (node.x > state.width + 30) node.x = -30;
          if (node.y < -30) node.y = state.height + 30;
          if (node.y > state.height + 30) node.y = -30;
        }

        if (pointer.active) {
          const dx = node.x - pointer.x;
          const dy = node.y - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 190 && distance > 0) {
            const force = (190 - distance) / 190;
            node.x += (dx / distance) * force * (0.55 + node.z * 0.5);
            node.y += (dy / distance) * force * (0.45 + node.z * 0.35);
          }
        }
      }

      for (let i = 0; i < state.nodes.length; i += 1) {
        for (let j = i + 1; j < state.nodes.length; j += 1) {
          const a = state.nodes[i];
          const b = state.nodes[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > 175) continue;

          const depth = (a.z + b.z) / 2;
          const alpha = (1 - distance / 175) * (0.09 + depth * 0.11);
          ctx.strokeStyle = `rgba(29, 78, 216, ${alpha})`;
          ctx.lineWidth = 0.65 + depth * 0.65;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const node of state.nodes) {
        const radius = 1.7 + node.z * 2.4;
        ctx.fillStyle = `rgba(14, 116, 144, ${0.18 + node.z * 0.28})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!prefersReducedMotion) {
        state.animationFrame = requestAnimationFrame(draw);
      }
    };

    resize();
    draw();

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);

    return () => {
      cancelAnimationFrame(state.animationFrame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(37,99,235,0.10),rgba(255,255,255,0.20)_42%,rgba(14,116,144,0.10)),linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.68))]" />
      <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(15,23,42,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.55)_1px,transparent_1px)] [background-size:28px_28px]" />
    </div>
  );
}
