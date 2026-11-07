import { useEffect, useRef } from "react";
import { buildTicks } from "../lib/ticks";
import type { Viewport } from "../lib/viewport";
import { jdnToX, xToJdn } from "../lib/viewport";

interface Props {
  vp: Viewport;
  height?: number;
  /** 时间轴左边缘的像素偏移，与 CanvasArea 的 GUTTER 对齐（否则刻度会比卡片偏一段） */
  offsetX?: number;
}

/** Canvas 画刻度尺：高 DPI 适配，避免 125%/150% 缩放发虚。 */
export default function Ruler({ vp, height = 44, offsetX = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = vp.width;
    const cssH = height;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const from = xToJdn(vp, -offsetX - 100);
    const to = xToJdn(vp, cssW - offsetX + 100);
    const ticks = buildTicks(from, to, vp.pxPerDay, (j) => jdnToX(vp, j) + offsetX);

    ctx.strokeStyle = "#d0d4dc";
    ctx.fillStyle = "#8891a0";
    ctx.font = "12px system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
    ctx.textBaseline = "top";
    ctx.lineWidth = 1;

    for (const t of ticks) {
      const x = Math.round(t.x) + 0.5;
      if (x < -80 || x > cssW + 80) continue;
      const tickH = t.major ? 14 : 7;
      ctx.beginPath();
      ctx.moveTo(x, cssH);
      ctx.lineTo(x, cssH - tickH);
      ctx.stroke();
      if (t.major) {
        ctx.fillText(t.label, x + 4, 6);
      }
    }
  }, [vp, height]);

  return <canvas ref={canvasRef} className="ruler-canvas" />;
}
