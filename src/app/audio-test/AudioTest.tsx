"use client";

import { useRef, useState } from "react";

/**
 * 聲音測試頁：戴著耳機逐一播放，找出底噪是從哪裡來的。
 * 每次只播放一種，按「停止」結束。這一頁只給製作者測試，不會出現在遊戲選單。
 */

const MP3 = "/assets/music/jrpg-junkala/peaceful_home_town.mp3?v=3";
const OGG = "/assets/music/test/original_home_town.ogg";

type Stop = () => void;

export default function AudioTest() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const stopRef = useRef<Stop | null>(null);

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(null);
  };

  const playElement = (key: string, src: string) => {
    stop();
    const a = new Audio(src);
    a.loop = true;
    a.volume = 0.5;
    a.play().catch((e: Error) => setNote(`無法播放：${e.message}（這台裝置可能不支援這種格式）`));
    stopRef.current = () => a.pause();
    setPlaying(key);
  };

  /** Web Audio：old＝遊戲原本的播放方式；new＝調整後；silent＝開著音訊輸出但不播任何聲音 */
  const playWebAudio = async (key: string, mode: "old" | "new" | "silent") => {
    stop();
    const ctx = mode === "old" ? new AudioContext() : new AudioContext({ latencyHint: "playback" });
    const master = ctx.createGain();
    if (mode === "old") {
      master.gain.value = 0.85;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      master.connect(limiter).connect(ctx.destination);
    } else {
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    let source: AudioScheduledSourceNode;
    if (mode === "silent") {
      // 播一段完全無聲的訊號，讓耳機與手機的音訊輸出保持開啟
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(master);
      source = osc;
    } else {
      const data = await fetch(MP3).then((r) => r.arrayBuffer());
      const buffer = await ctx.decodeAudioData(data);
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      const g = ctx.createGain();
      g.gain.value = mode === "old" ? 0.3 : 0.5;
      s.connect(g).connect(master);
      source = s;
    }
    source.start();
    setNote(`取樣率 ${ctx.sampleRate} Hz・輸出延遲約 ${Math.round(((ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0)) * 1000)} ms`);
    stopRef.current = () => {
      source.stop();
      void ctx.close();
    };
    setPlaying(key);
  };

  const tests: Array<{ key: string; title: string; desc: string; run: () => void }> = [
    { key: "silent", title: "1. 無聲測試", desc: "打開音訊輸出，但不播任何聲音。這時聽到沙沙聲，是耳機或手機本身的底噪（藍牙耳機常見），不是音樂的問題。", run: () => void playWebAudio("silent", "silent") },
    { key: "element", title: "2. 一般播放器播 MP3", desc: "用手機內建的播放器直接播音樂檔。這裡就有雜音，代表是音樂檔本身的問題。", run: () => playElement("element", MP3) },
    { key: "old", title: "3. 遊戲原本的播放方式", desc: "低延遲模式＋限幅器、音量 0.3（上一版遊戲的做法）。", run: () => void playWebAudio("old", "old") },
    { key: "new", title: "4. 調整後的播放方式", desc: "播放模式（較大的緩衝）、不經過限幅器、音量 0.5（這一版遊戲的做法）。3 有雜音、4 沒有，代表原因是播放方式。", run: () => void playWebAudio("new", "new") },
    { key: "ogg", title: "5. 轉檔前的原始檔（OGG）", desc: "和 2 比較，判斷轉檔有沒有加入雜音。部分 iPhone 不支援 OGG，播不出來是正常的。", run: () => playElement("ogg", OGG) },
  ];

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px", color: "#e6e8f5", background: "#0d1020", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22 }}>聲音測試</h1>
      <p style={{ opacity: 0.75, fontSize: 14, lineHeight: 1.6 }}>戴上耳機，手機音量調到平常玩遊戲的大小，一次只按一個按鈕，比較哪幾個有底噪。每一個都是同一首「Home Town」。</p>
      {tests.map((t) => (
        <section key={t.key} style={{ border: "1px solid #363b55", borderRadius: 10, padding: 12, margin: "12px 0", background: playing === t.key ? "#20284a" : "#151826" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <b>{t.title}</b>
            <button onClick={() => (playing === t.key ? stop() : t.run())} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #6c8cff", background: playing === t.key ? "#6c8cff" : "transparent", color: "#fff", fontSize: 15 }}>
              {playing === t.key ? "■ 停止" : "▶ 播放"}
            </button>
          </div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6, lineHeight: 1.5 }}>{t.desc}</div>
        </section>
      ))}
      {note && <p style={{ fontSize: 12, opacity: 0.6 }}>{note}</p>}
    </main>
  );
}
