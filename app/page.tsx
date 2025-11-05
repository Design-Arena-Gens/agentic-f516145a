"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import cx from "classnames";

// Types for presets
type PresetId = "clean" | "deep" | "chipmunk" | "robot" | "radio" | "alien" | "echo";

type EffectSettings = {
  pitchSemitones: number;
  reverbWet: number; // 0..1
  distortion: number; // 0..1
  delayTime: number; // seconds
  delayFeedback: number; // 0..1
  eqLow: number; // dB
  eqMid: number; // dB
  eqHigh: number; // dB
  ringModHz: number; // 0 disables ring modulation
};

const PRESETS: Record<PresetId, EffectSettings> = {
  clean: {
    pitchSemitones: 0,
    reverbWet: 0.05,
    distortion: 0.0,
    delayTime: 0.0,
    delayFeedback: 0.0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    ringModHz: 0,
  },
  deep: {
    pitchSemitones: -6,
    reverbWet: 0.1,
    distortion: 0.05,
    delayTime: 0.0,
    delayFeedback: 0.0,
    eqLow: 3,
    eqMid: -2,
    eqHigh: -1,
    ringModHz: 0,
  },
  chipmunk: {
    pitchSemitones: 7,
    reverbWet: 0.12,
    distortion: 0.0,
    delayTime: 0.12,
    delayFeedback: 0.25,
    eqLow: -2,
    eqMid: 0,
    eqHigh: 2,
    ringModHz: 0,
  },
  robot: {
    pitchSemitones: 0,
    reverbWet: 0.08,
    distortion: 0.35,
    delayTime: 0,
    delayFeedback: 0,
    eqLow: 0,
    eqMid: 3,
    eqHigh: -2,
    ringModHz: 90,
  },
  radio: {
    pitchSemitones: -1,
    reverbWet: 0.03,
    distortion: 0.15,
    delayTime: 0,
    delayFeedback: 0,
    eqLow: -6,
    eqMid: 4,
    eqHigh: -4,
    ringModHz: 0,
  },
  alien: {
    pitchSemitones: -12,
    reverbWet: 0.18,
    distortion: 0.22,
    delayTime: 0.18,
    delayFeedback: 0.3,
    eqLow: 2,
    eqMid: -4,
    eqHigh: 3,
    ringModHz: 30,
  },
  echo: {
    pitchSemitones: 0,
    reverbWet: 0.2,
    distortion: 0.0,
    delayTime: 0.28,
    delayFeedback: 0.45,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 1,
    ringModHz: 0,
  },
};

export default function HomePage() {
  // UI state
  const [isMicLive, setIsMicLive] = useState(false);
  const [isPlayingFile, setIsPlayingFile] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [preset, setPreset] = useState<PresetId>("clean");
  const [settings, setSettings] = useState<EffectSettings>(PRESETS.clean);

  // Audio graph refs
  const inputNodeRef = useRef<Tone.UserMedia | null>(null);
  const filePlayerRef = useRef<Tone.Player | null>(null);
  const pitchShiftRef = useRef<Tone.PitchShift | null>(null);
  const ringModRef = useRef<Tone.AMOscillator | null>(null);
  const ringGainRef = useRef<Tone.Gain | null>(null);
  const distortionRef = useRef<Tone.Distortion | null>(null);
  const delayRef = useRef<Tone.FeedbackDelay | null>(null);
  const reverbRef = useRef<Tone.Reverb | null>(null);
  const eqRef = useRef<Tone.EQ3 | null>(null);
  const analyserRef = useRef<Tone.Analyser | null>(null);
  const finalGainRef = useRef<Tone.Gain | null>(null);

  // Recording
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const startTone = async () => {
    await Tone.start();
  };

  // Build audio graph once
  useEffect(() => {
    const buildGraph = async () => {
      await startTone();

      const pitch = new Tone.PitchShift({ pitch: settings.pitchSemitones }).toDestination();
      const distortion = new Tone.Distortion({ distortion: settings.distortion, oversample: "4x" });
      const delay = new Tone.FeedbackDelay({ delayTime: settings.delayTime, feedback: settings.delayFeedback });
      const reverb = new Tone.Reverb({ decay: 2.4, wet: settings.reverbWet });
      const eq = new Tone.EQ3({ low: settings.eqLow, mid: settings.eqMid, high: settings.eqHigh });
      const finalGain = new Tone.Gain(0.9);
      const analyser = new Tone.Analyser("fft", 64);

      // Optional ring mod via AM oscillator into gain
      const ringOsc = new Tone.AMOscillator({ frequency: settings.ringModHz || 1, type: "sine", harmonicity: 1.0 });
      const ringGain = new Tone.Gain(settings.ringModHz > 0 ? 0.5 : 0);
      ringOsc.connect(ringGain);

      // final chain: source -> pitch -> ring mix -> distortion -> delay -> reverb -> eq -> finalGain -> destination
      pitch.connect(distortion);
      ringGain.connect(distortion);
      distortion.connect(delay);
      delay.connect(reverb);
      reverb.connect(eq);
      eq.connect(finalGain);
      finalGain.connect(analyser);
      finalGain.connect(Tone.Destination);

      pitchShiftRef.current = pitch;
      ringModRef.current = ringOsc;
      ringGainRef.current = ringGain;
      distortionRef.current = distortion;
      delayRef.current = delay;
      reverbRef.current = reverb;
      eqRef.current = eq;
      analyserRef.current = analyser;
      finalGainRef.current = finalGain;

      // Prepare recording tap via native AudioContext
      const ctx = Tone.getContext().rawContext as AudioContext;
      const dest = ctx.createMediaStreamDestination();
      mediaDestRef.current = dest;
      // Connect Tone destination into native node
      // @ts-expect-error - _destination is internal but stable
      const destinationNode: AudioNode = Tone.Destination._destination;
      destinationNode.connect(dest);
    };

    buildGraph();

    return () => {
      try {
        filePlayerRef.current?.dispose();
        inputNodeRef.current?.dispose();
        pitchShiftRef.current?.dispose();
        ringModRef.current?.dispose();
        ringGainRef.current?.dispose();
        distortionRef.current?.dispose();
        delayRef.current?.dispose();
        reverbRef.current?.dispose();
        eqRef.current?.dispose();
        analyserRef.current?.dispose();
        finalGainRef.current?.dispose();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update effect params when settings change
  useEffect(() => {
    pitchShiftRef.current?.set({ pitch: settings.pitchSemitones });
    distortionRef.current?.set({ distortion: settings.distortion });
    delayRef.current?.set({ delayTime: settings.delayTime, feedback: settings.delayFeedback });
    reverbRef.current?.set({ wet: settings.reverbWet });
    eqRef.current?.set({ low: settings.eqLow, mid: settings.eqMid, high: settings.eqHigh });
    if (ringModRef.current && ringGainRef.current) {
      ringModRef.current.frequency.value = Math.max(0.0001, settings.ringModHz);
      if (settings.ringModHz > 0) {
        if (!ringModRef.current.state || ringModRef.current.state === "stopped") {
          ringModRef.current.start();
        }
        ringGainRef.current.gain.value = 0.5;
      } else {
        ringGainRef.current.gain.value = 0.0;
        if (ringModRef.current.state === "started") ringModRef.current.stop();
      }
    }
  }, [settings]);

  // Visualizer draw loop
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const data = analyser.getValue() as Float32Array;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#6ee7b7");
      grad.addColorStop(1, "#93c5fd");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        // Data is in dB; map to 0..1
        const v = (data[i] + 140) / 140;
        const y = h - v * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    setSettings(PRESETS[id]);
  };

  const handleMicToggle = async () => {
    await startTone();
    if (!isMicLive) {
      const mic = new Tone.UserMedia({ constraints: { audio: { echoCancellation: false, noiseSuppression: false } } });
      await mic.open();
      mic.connect(pitchShiftRef.current!);
      inputNodeRef.current = mic;
      setIsMicLive(true);
    } else {
      inputNodeRef.current?.disconnect();
      inputNodeRef.current?.close();
      inputNodeRef.current = null;
      setIsMicLive(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    await startTone();
    const url = URL.createObjectURL(file);
    if (filePlayerRef.current) {
      filePlayerRef.current.stop();
      filePlayerRef.current.disconnect();
      filePlayerRef.current.dispose();
    }
    const player = new Tone.Player({ url, autostart: false, loop: false });
    player.connect(pitchShiftRef.current!);
    filePlayerRef.current = player;
  };

  const handlePlayPause = async () => {
    if (!filePlayerRef.current) return;
    await startTone();
    if (isPlayingFile) {
      filePlayerRef.current.stop();
      setIsPlayingFile(false);
    } else {
      filePlayerRef.current.start();
      setIsPlayingFile(true);
      filePlayerRef.current.onstop = () => setIsPlayingFile(false);
    }
  };

  const startRecording = () => {
    if (!mediaDestRef.current) return;
    recordedChunksRef.current = [];
    const rec = new MediaRecorder(mediaDestRef.current.stream);
    mediaRecorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `ultra-voice-${ts}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
    rec.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const setSetting = (key: keyof EffectSettings, v: number) => {
    setSettings((s) => ({ ...s, [key]: v }));
  };

  return (
    <main className="container py-8 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Ultra Pro Voice Changer
        </h1>
        <div className="flex gap-2">
          <button
            className={cx("btn-primary", { "opacity-50": isMicLive })}
            onClick={handleMicToggle}
          >
            {isMicLive ? "Stop Mic" : "Start Mic"}
          </button>
          <label className="btn-secondary cursor-pointer">
            Upload Audio
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileSelect(f);
              }}
            />
          </label>
          <button className="btn" onClick={handlePlayPause} disabled={!filePlayerRef.current}>
            {isPlayingFile ? "Stop" : "Play"}
          </button>
          {!isRecording ? (
            <button className="btn-primary" onClick={startRecording}>
              Record
            </button>
          ) : (
            <button className="btn-secondary" onClick={stopRecording}>
              Stop & Save
            </button>
          )}
        </div>
      </header>

      <section className="grid md:grid-cols-3 gap-6">
        <div className="panel p-4 md:col-span-2">
          <canvas ref={canvasRef} width={1200} height={300} className="w-full h-[200px] sm:h-[300px]" />
        </div>
        <div className="panel p-4 space-y-4">
          <div>
            <div className="label mb-2">Presets</div>
            <div className="grid grid-cols-3 gap-2">
              {Object.keys(PRESETS).map((id) => (
                <button
                  key={id}
                  className={cx("btn", preset === id ? "bg-accent/30 text-accent" : "bg-white/5 hover:bg-white/10")}
                  onClick={() => applyPreset(id as PresetId)}
                >
                  {(id as string).toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="Pitch (semitones)"
            min={-12}
            max={12}
            step={1}
            value={settings.pitchSemitones}
            onChange={(v) => setSetting("pitchSemitones", v)}
          />
          <Slider label="Reverb" min={0} max={1} step={0.01} value={settings.reverbWet} onChange={(v) => setSetting("reverbWet", v)} />
          <Slider label="Distortion" min={0} max={1} step={0.01} value={settings.distortion} onChange={(v) => setSetting("distortion", v)} />
          <Slider label="Delay Time (s)" min={0} max={0.5} step={0.01} value={settings.delayTime} onChange={(v) => setSetting("delayTime", v)} />
          <Slider label="Delay Feedback" min={0} max={0.9} step={0.01} value={settings.delayFeedback} onChange={(v) => setSetting("delayFeedback", v)} />
          <Slider label="Ring Mod (Hz)" min={0} max={200} step={1} value={settings.ringModHz} onChange={(v) => setSetting("ringModHz", v)} />
          <div className="grid grid-cols-3 gap-2">
            <Slider label="EQ Low (dB)" min={-12} max={12} step={1} value={settings.eqLow} onChange={(v) => setSetting("eqLow", v)} />
            <Slider label="EQ Mid (dB)" min={-12} max={12} step={1} value={settings.eqMid} onChange={(v) => setSetting("eqMid", v)} />
            <Slider label="EQ High (dB)" min={-12} max={12} step={1} value={settings.eqHigh} onChange={(v) => setSetting("eqHigh", v)} />
          </div>
        </div>
      </section>

      <footer className="text-center text-white/50 text-sm">
        Tip: On first use, your browser will ask to allow microphone.
      </footer>
    </main>
  );
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  const { label, min, max, step, value, onChange } = props;
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="label">{label}</span>
        <span className="text-xs text-white/60">{typeof v === "number" ? v.toFixed(2) : v}</span>
      </div>
      <input
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => {
          const nv = parseFloat(e.target.value);
          setV(nv);
          onChange(nv);
        }}
      />
    </div>
  );
}
