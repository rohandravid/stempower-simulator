// Drives a radar module's speedMph from webcam motion instead of the slider:
// wave slowly for a low reading, wave fast to spike it past the speed limit.

import { useEffect, useRef, useState } from 'react';

interface Props {
  onSpeed: (mph: number) => void;
  onClose: () => void;
}

const SAMPLE_W = 32;
const SAMPLE_H = 24;
/** Per-pixel luminance delta (0-255) counted as "this pixel moved". */
const DIFF_THRESHOLD = 20;
/** How quickly the reported speed follows the raw motion signal (0-1, higher = snappier). */
const SMOOTHING = 0.4;
/** Fraction of pixels changing that maps to a 100 mph reading. */
const FULL_SCALE_FRACTION = 0.4;

export function CameraSpeedSensor({ onSpeed, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSpeedRef = useRef(onSpeed);
  onSpeedRef.current = onSpeed;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let prevFrame: Uint8ClampedArray | null = null;
    let smoothed = 0;

    function loop() {
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
      const frame = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

      let changed = 0;
      if (prevFrame) {
        for (let i = 0; i < frame.length; i += 4) {
          const lum = frame[i] * 0.3 + frame[i + 1] * 0.59 + frame[i + 2] * 0.11;
          const prevLum = prevFrame[i] * 0.3 + prevFrame[i + 1] * 0.59 + prevFrame[i + 2] * 0.11;
          if (Math.abs(lum - prevLum) > DIFF_THRESHOLD) changed++;
        }
      }
      prevFrame = frame;

      const rawFrac = changed / (SAMPLE_W * SAMPLE_H);
      smoothed += (rawFrac - smoothed) * SMOOTHING;
      onSpeedRef.current(Math.min(100, (smoothed / FULL_SCALE_FRACTION) * 100));
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        loop();
      } catch {
        if (!cancelled) setError('Camera unavailable — check your browser permissions.');
      }
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      onSpeedRef.current(0);
    };
  }, []);

  return (
    <div className="camera-speed-panel">
      <div className="camera-speed-header">
        <span>📷 Motion speed input</span>
        <button type="button" className="camera-speed-close" onClick={onClose} aria-label="Turn off camera input">
          ✕
        </button>
      </div>
      {error ? (
        <p className="camera-speed-error">{error}</p>
      ) : (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} muted playsInline className="camera-speed-video" />
          <p className="camera-speed-hint">Wave slowly for a low reading, fast to trigger the lights.</p>
        </>
      )}
      <canvas ref={canvasRef} width={SAMPLE_W} height={SAMPLE_H} style={{ display: 'none' }} />
    </div>
  );
}
