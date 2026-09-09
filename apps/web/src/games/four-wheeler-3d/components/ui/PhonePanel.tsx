"use client";
import { startRadio } from "../../lib/radioAudio";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { PHONE_APPS } from "../../lib/catalog";
import { useAdventureSession } from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import { calculatorKey, emptyCalculator } from "../../lib/calculator";
import { requestHelper } from "../../lib/economy";
import { transact } from "../../lib/transactions";
import { WorldMap } from "./WorldMap";
import { ShopPanel, dollars } from "./ShopPanel";
import {
  DISNEY_VIDEOS,
  YOUTUBE_CHANNELS,
  createMediaLibrary,
  findMedia,
  mediaTime,
  reduceMedia,
  type MediaAction,
  type PretendVideo,
} from "../../lib/mediaCatalog";
import { LANDMARKS, RUNWAY } from "../../lib/landmarks";
import "./phone-media.css";

export function PhonePanel() {
  const app = useAdventureSession((s) => s.phoneApp),
    setApp = useAdventureSession((s) => s.setPhoneApp);
  const clock = useFourWheeler3dStore((s) => s.clock);
  const title = PHONE_APPS.find((a) => a.id === app)?.label;
  return (
    <div className="fw-phone">
      <div className="fw-phone-status">
        <span>HANK MOBILE</span>
        <time>
          {Math.floor(clock).toString().padStart(2, "0")}:
          {Math.floor((clock % 1) * 60)
            .toString()
            .padStart(2, "0")}
        </time>
        <span aria-label="Full phone signal">▰ ▰ ▰ ▰</span>
      </div>
      {app ? (
        <>
          <button className="fw-back" onClick={() => setApp(null)}>
            ‹ All apps
          </button>
          <h3>{title}</h3>
          <PhoneApp app={app} />
        </>
      ) : (
        <>
          <div className="fw-phone-greeting">
            <small>YOUR WORLD, IN YOUR POCKET</small>
            <h3>Let’s go somewhere.</h3>
          </div>
          <div className="fw-app-grid">
            {PHONE_APPS.map((a, i) => (
              <button key={a.id} onClick={() => setApp(a.id)}>
                <span
                  style={{ background: `hsl(${35 + i * 29} 26% 38%)` }}
                  aria-hidden="true"
                >
                  {a.icon}
                </span>
                {a.label}
              </button>
            ))}
          </div>
          <Helper />
        </>
      )}
    </div>
  );
}
function PhoneApp({ app }: { app: string }) {
  if (app === "amazon") return <ShopPanel delivery />;
  if (app === "gps") return <GPSApp />;
  if (app === "maps") return <OpenMap />;
  if (app === "calculator") return <Calculator />;
  if (app === "hunting") return <FeederMap />;
  if (app === "games") return <PhoneGames />;
  if (app === "weather") return <WeatherApp />;
  if (app === "music") return <MusicApp />;
  if (app === "photos") return <PhotosApp />;
  if (app === "firetruck") return <FireTruckApp />;
  return <PretendTV key={app} channel={app} />;
}
function OpenMap() {
  useEffect(() => useAdventureSession.getState().openPanel("map"), []);
  return <p>Opening your county map...</p>;
}
function GPSApp() {
  const train = useAdventureSession((s) => s.rail),
    stand = useFourWheeler3dStore((s) => s.progress.adventure.stands[0]),
    waypoint = useAdventureSession((s) => s.waypoint),
    player = useAdventureSession((s) => s.playerSnapshot);
  const places = [
    { id: "house", label: "Home", ...LANDMARKS.house },
    { id: "lake", label: "The Lake", ...LANDMARKS.lake },
    { id: "dealership", label: "Car Dealer", ...LANDMARKS.dealership },
    { id: "anyStore", label: "Anything Store", ...LANDMARKS.anyStore },
    { id: "huntStore", label: "Hunting Store", ...LANDMARKS.huntStore },
    { id: "airfield", label: "Airfield", x: RUNWAY.x, z: RUNWAY.z },
    { id: "trophyRoom", label: "Trophy Room", ...LANDMARKS.trophyRoom },
    {
      id: "train",
      label: "The Train",
      x: train?.position.x ?? -503,
      z: train?.position.z ?? 0,
    },
    {
      id: "tree-stand",
      label: "Tree Stand",
      x: stand?.position.x ?? 417,
      z: stand?.position.z ?? -417,
    },
  ];
  return (
    <>
      <p>Where to? Choose a stop and follow your GPS route.</p>
      <div className="fw-destination-list">
        {places.map((p) => (
          <button
            key={p.id}
            onClick={() => useAdventureSession.getState().setWaypoint(p)}
          >
            <span>{p.label}</span>
            <small>
              {Math.round(Math.hypot(player.x - p.x, player.z - p.z))} m
            </small>
          </button>
        ))}
      </div>
      {waypoint && (
        <button
          className="fw-track"
          onClick={() => useAdventureSession.getState().setWaypoint(null)}
        >
          Clear waypoint
        </button>
      )}
    </>
  );
}
function Helper() {
  const [text, setText] = useState("");
  const task = useFourWheeler3dStore((s) => s.progress.adventure.helperTask);
  return (
    <form
      className="fw-helper"
      onSubmit={(e) => {
        e.preventDefault();
        if (transact((p) => requestHelper(p, text))) setText("");
      }}
    >
      <h4>Your helper</h4>
      <label>
        Send an errand
        <input
          value={text}
          maxLength={140}
          onChange={(e) => setText(e.target.value)}
          placeholder="Bring a truck, or fill my feeders"
        />
      </label>
      <button disabled={!!task || !text.trim()} className="fw-primary">
        {task
          ? `On the way · ${Math.ceil(task.remainingSeconds)}s`
          : "Ask helper"}
      </button>
    </form>
  );
}
function Calculator() {
  const [state, setState] = useState(emptyCalculator);
  return (
    <div className="fw-calculator">
      <output aria-live="polite">{state.display}</output>
      <div>
        {[
          "C",
          "±",
          "%",
          "÷",
          "7",
          "8",
          "9",
          "×",
          "4",
          "5",
          "6",
          "−",
          "1",
          "2",
          "3",
          "+",
          "⌫",
          "0",
          ".",
          "=",
        ].map((k) => (
          <button key={k} onClick={() => setState((s) => calculatorKey(s, k))}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
function FeederMap() {
  const feeders = useFourWheeler3dStore((s) => s.progress.adventure.feeders);
  return (
    <>
      <WorldMap />
      {feeders.map((f) => {
        const percent = Math.max(0, Math.min(100, (f.corn / 18) * 100));
        return (
          <div className="fw-feeder-row" key={f.id}>
            <div className="fw-feeder-details">
              <label>
                Feeder name
                <input
                  value={f.label}
                  maxLength={14}
                  onChange={(e) =>
                    useFourWheeler3dStore.getState().updateProgress((p) => ({
                      ...p,
                      adventure: {
                        ...p.adventure,
                        feeders: p.adventure.feeders.map((v) =>
                          v.id === f.id
                            ? { ...v, label: e.target.value.slice(0, 14) }
                            : v,
                        ),
                      },
                    }))
                  }
                />
              </label>
              <div
                className="fw-feeder-meter"
                role="meter"
                aria-label={`${f.label} corn level`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
              >
                <span
                  style={{
                    width: `${percent}%`,
                    background: percent > 30 ? "#ddc275" : "#e5816c",
                  }}
                />
              </div>
              <small className="fw-feeder-percent">
                {Math.round(percent)}% corn · {f.corn.toFixed(1)}/18{" "}
                {percent <= 30 ? "· Refill soon" : ""}
              </small>
            </div>
            <button
              onClick={() =>
                useAdventureSession
                  .getState()
                  .setWaypoint({ id: f.id, label: f.label, ...f.position })
              }
            >
              GPS
            </button>
          </div>
        );
      })}
    </>
  );
}
function PhoneGames() {
  const [result, setResult] = useState(
    "Choose a game. These use pretend game money.",
  );
  const play = (kind: string, guess?: number) => {
    let prize = 0,
      message = "";
    if (kind === "dice") {
      const die = 1 + Math.floor(Math.random() * 6);
      prize = die === 6 ? 5000 : 0;
      message = `You rolled ${die}.`;
    } else if (kind === "coin") {
      const coin = Math.random() < 0.5 ? 0 : 1;
      prize = coin === guess ? 2000 : 0;
      message = `It’s ${coin === 0 ? "heads" : "tails"}!`;
    } else {
      const prizes = [25000, 10000, 1000, 500, 0];
      prize = prizes[Math.floor(Math.random() * prizes.length)];
      message = "The wheel stopped.";
    }
    if (prize) useFourWheeler3dStore.getState().addMoney(prize);
    setResult(
      `${message} ${prize ? `You won ${dollars(prize)}!` : "Try again!"}`,
    );
  };
  return (
    <div className="fw-phone-games">
      <p role="status">{result}</p>
      <article>
        <h4>Lucky six</h4>
        <p>Roll a six to win $5,000.</p>
        <button onClick={() => play("dice")}>Roll the die</button>
      </article>
      <article>
        <h4>Heads or tails</h4>
        <p>Guess correctly to win $2,000.</p>
        <button onClick={() => play("coin", 0)}>Heads</button>
        <button onClick={() => play("coin", 1)}>Tails</button>
      </article>
      <article>
        <h4>Prize wheel</h4>
        <p>Spin for up to $25,000.</p>
        <button onClick={() => play("wheel")}>Spin again</button>
      </article>
    </div>
  );
}
function WeatherApp() {
  const weather = useFourWheeler3dStore((s) => s.progress.weather),
    clock = useFourWheeler3dStore((s) => s.clock),
    day = useFourWheeler3dStore((s) => s.progress.day);
  const info =
    weather === "snowy"
      ? {
          icon: "❄",
          name: "Snowing",
          advice: "Snow makes roads slippery. Try your plow.",
        }
      : weather === "rainy"
        ? {
            icon: "☂",
            name: "Rainy and wet",
            advice: "Wet trails make more mud. Wash your ride after exploring.",
          }
        : weather === "foggy"
          ? {
              icon: "☁",
              name: "Thick fog",
              advice:
                "Visibility is low. Slow down and use the map to find your way.",
            }
          : {
              icon: "☀",
              name: "Sunny and clear",
              advice: "A good day to head outside.",
            };
  return (
    <div className="fw-weather-app">
      <span aria-hidden="true">{info.icon}</span>
      <h3>{info.name}</h3>
      <p>Hank County · Day {day}</p>
      <p>
        {Math.floor(clock).toString().padStart(2, "0")}:
        {Math.floor((clock % 1) * 60)
          .toString()
          .padStart(2, "0")}
      </p>
      <p>{info.advice}</p>
    </div>
  );
}
const TRACKS = [
  {
    name: "Highway Cruisin'",
    notes: [196, 246.94, 293.66, 246.94],
    wave: "triangle" as OscillatorType,
  },
  {
    name: "Lake After Dark",
    notes: [146.83, 174.61, 220, 261.63],
    wave: "sine" as OscillatorType,
  },
  {
    name: "Race Day",
    notes: [220, 329.63, 293.66, 440],
    wave: "triangle" as OscillatorType,
  },
];
function MusicApp() {
  const [track, setTrack] = useState<number | null>(null);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const enabled = useFourWheeler3dStore(
    (s) => s.progress.settings.soundEnabled,
  );
  useEffect(() => {
    if (track === null || !enabled) return;
    return startRadio(TRACKS[track].notes, TRACKS[track].wave, () =>
      setAudioUnavailable(true),
    );
  }, [track, enabled]);
  return (
    <>
      <p className="fw-muted">Original instrumentals for the ride.</p>
      {TRACKS.map((t, i) => (
        <button
          className="fw-track"
          key={t.name}
          onClick={() => {
            setAudioUnavailable(false);
            setTrack(track === i ? null : i);
          }}
        >
          {track === i ? "Ⅱ" : "▶"} {t.name}
        </button>
      ))}
      <p role="status">
        {audioUnavailable
          ? "Radio is unavailable. Try another track or turn sound off and on."
          : !enabled
            ? "Turn sound on in settings to listen."
            : track === null
              ? "Radio off"
              : `Playing ${TRACKS[track].name}`}
      </p>
    </>
  );
}
const useMediaLibrary = create(() => createMediaLibrary());
const mediaAction = (action: MediaAction) =>
  useMediaLibrary.setState((s) => reduceMedia(s, action));

function PretendTV({ channel }: { channel: string }) {
  const [channelId, setChannelId] = useState<string | null>(null),
    [screen, setScreen] = useState<"library" | "player">("library");
  const library = useMediaLibrary(),
    selected = findMedia(library.activeId),
    disney = channel === "disney";
  const currentChannel = YOUTUBE_CHANNELS.find((c) => c.id === channelId);
  const play = (video: PretendVideo) => {
    mediaAction({ type: "select", id: video.id });
    setScreen("player");
  };
  if (screen === "player" && selected)
    return (
      <MediaPlayer
        video={selected}
        onBack={() => {
          mediaAction({ type: "pause" });
          setScreen("library");
        }}
      />
    );
  const videos = disney ? DISNEY_VIDEOS : currentChannel?.videos;
  return (
    <section className="fw-media-library">
      <p className="fw-media-note">
        Hank&apos;s pretend TV. Original animated scenes made for this game.
      </p>
      {currentChannel && (
        <>
          <button className="fw-back" onClick={() => setChannelId(null)}>
            ‹ All channels
          </button>
          <h4>
            {currentChannel.icon} {currentChannel.label}
          </h4>
          <p className="fw-media-meta">Pretend channel · 24.1M subscribers</p>
        </>
      )}
      {videos ? (
        <div className="fw-media-grid">
          {videos.map((video) => (
            <button
              className={`fw-media-card fw-media-${video.theme}`}
              key={video.id}
              onClick={() => play(video)}
            >
              <span className="fw-media-art" aria-hidden="true">
                <span>{video.scene[0]}</span>
                <small>{mediaTime(video.duration)}</small>
              </span>
              <strong>{video.title}</strong>
              <span className="fw-media-card-meta">
                {library.progress[video.id] > 0 &&
                library.progress[video.id] < video.duration
                  ? `Resume at ${mediaTime(library.progress[video.id])}`
                  : "Play pretend episode"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="fw-channel-grid">
          {YOUTUBE_CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                if (c.videos.length > 1) setChannelId(c.id);
                else play(c.videos[0]);
              }}
            >
              <span
                className={`fw-channel-icon fw-media-${c.theme}`}
                aria-hidden="true"
              >
                {c.icon}
              </span>
              <span>
                <strong>{c.label}</strong>
                <small>
                  {c.videos.length > 1
                    ? `${c.videos.length} videos`
                    : "Watch episode"}
                  {library.subscribed.includes(c.id) ? " · Subscribed" : ""}
                </small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MediaPlayer({
  video,
  onBack,
}: {
  video: PretendVideo;
  onBack: () => void;
}) {
  const library = useMediaLibrary(),
    canvas = useRef<HTMLCanvasElement>(null),
    paused = useFourWheeler3dStore((s) => s.isPaused);
  const position = library.progress[video.id] ?? 0,
    channel = YOUTUBE_CHANNELS.find((c) => c.id === video.channelId),
    playing = library.playing && !paused;
  useEffect(() => {
    const element = canvas.current,
      context = element?.getContext("2d");
    if (!element || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      last = performance.now(),
      pending = 0;
    const render = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const current = useMediaLibrary.getState();
      if (
        current.playing &&
        !useFourWheeler3dStore.getState().isPaused &&
        !document.hidden
      ) {
        pending += dt;
        if (pending >= 0.1) {
          mediaAction({ type: "tick", seconds: pending });
          pending = 0;
        }
      } else pending = 0;
      const progress = useMediaLibrary.getState().progress[video.id] ?? 0;
      drawPretendScene(
        context,
        video,
        progress + (current.playing ? pending : 0),
        reduced.matches,
      );
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const visibility = () => {
      if (document.hidden) mediaAction({ type: "pause" });
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [video]);
  return (
    <section className="fw-media-player">
      <button className="fw-back" onClick={onBack}>
        ‹ {channel?.videos.length === 10 ? "More videos" : "Pick another"}
      </button>
      <div className="fw-media-screen">
        <canvas
          ref={canvas}
          width={720}
          height={405}
          role="img"
          aria-label={`Animated pretend scene for ${video.title}`}
        />
        <span className="fw-media-badge">HANK TV</span>
        {!playing && (
          <button
            className="fw-media-big-play"
            aria-label={
              position >= video.duration ? "Replay episode" : "Play episode"
            }
            onClick={() => mediaAction({ type: "play" })}
          >
            ▶
          </button>
        )}
      </div>
      <div className="fw-media-controls">
        <button
          aria-label={playing ? "Pause episode" : "Play episode"}
          onClick={() => mediaAction({ type: playing ? "pause" : "play" })}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <label className="fw-media-seek">
          <span className="sr-only">Episode progress</span>
          <input
            type="range"
            min="0"
            max={video.duration}
            step="0.1"
            value={position}
            aria-valuetext={`${mediaTime(position)} of ${mediaTime(video.duration)}`}
            onChange={(e) =>
              mediaAction({ type: "seek", seconds: Number(e.target.value) })
            }
          />
        </label>
        <time>
          {mediaTime(position)} / {mediaTime(video.duration)}
        </time>
        <button
          aria-label="Restart episode"
          onClick={() => {
            mediaAction({ type: "seek", seconds: 0 });
            mediaAction({ type: "play" });
          }}
        >
          ↺
        </button>
      </div>
      <h4>{video.title}</h4>
      <p className="fw-media-meta">
        {channel
          ? `${channel.label} · 12,402,118 pretend views`
          : "Disney+ · Pretend now playing"}
      </p>
      {channel && (
        <div className="fw-media-social">
          <button
            aria-pressed={library.liked.includes(video.id)}
            onClick={() => {
              mediaAction({ type: "like" });
              useFourWheeler3dStore
                .getState()
                .setHint(
                  useMediaLibrary.getState().liked.includes(video.id)
                    ? "You liked the video!"
                    : "Like removed.",
                );
            }}
          >
            👍 {library.liked.includes(video.id) ? "Liked" : "Like"}
          </button>
          <button
            aria-pressed={library.subscribed.includes(video.channelId)}
            onClick={() => {
              mediaAction({ type: "subscribe" });
              useFourWheeler3dStore
                .getState()
                .setHint(
                  useMediaLibrary
                    .getState()
                    .subscribed.includes(video.channelId)
                    ? `Subscribed to ${channel.label}!`
                    : "Subscription removed.",
                );
            }}
          >
            🔔{" "}
            {library.subscribed.includes(video.channelId)
              ? "Subscribed"
              : "Subscribe"}
          </button>
        </div>
      )}
      <p className="fw-media-note">
        A local pretend episode, with no outside videos or accounts.
      </p>
    </section>
  );
}

/** A locally drawn short: distinct settings, chapter cues and continuous travel, without a network player. */
function drawPretendScene(
  ctx: CanvasRenderingContext2D,
  video: PretendVideo,
  seconds: number,
  reduced: boolean,
) {
  const palettes: Record<string, [string, string, string]> = {
    forest: ["#98c6be", "#417151", "#ead18b"],
    race: ["#d2bca0", "#69785d", "#e1a54e"],
    snow: ["#789eae", "#d8e5dc", "#f1e9bb"],
    ocean: ["#83bfd0", "#326f91", "#d9cbb1"],
    city: ["#a9b2bd", "#4b5f72", "#c4be8d"],
    toys: ["#d8bfa4", "#9587a9", "#dbad65"],
    magic: ["#a699ba", "#5b7770", "#e8c68d"],
    space: ["#141e37", "#29365b", "#ccab68"],
    lab: ["#a7c7be", "#566a6e", "#e7c777"],
    sport: ["#97beb4", "#5c8660", "#e0bd77"],
    blocks: ["#98bac5", "#658858", "#d7b76a"],
  };
  const [sky, ground, accent] = palettes[video.theme],
    time = reduced ? 0 : seconds,
    chapter = Math.min(
      video.scene.length - 1,
      Math.floor((seconds / video.duration) * video.scene.length),
    );
  const gradient = ctx.createLinearGradient(0, 0, 0, 405);
  gradient.addColorStop(0, sky);
  gradient.addColorStop(1, ground);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 720, 405);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(580, 82, 34, 0, Math.PI * 2);
  ctx.fill();
  if (video.theme === "space") {
    ctx.fillStyle = "#e5e9d5";
    for (let i = 0; i < 44; i++) {
      const x = (i * 137.3) % 720,
        y = (i * 71.9) % 340;
      ctx.fillRect(x, y, i % 3 ? 2 : 3, 2);
    }
    ctx.fillStyle = "#847296";
    ctx.beginPath();
    ctx.arc(130, 145, 55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.ellipse(130, 145, 81, 21, -0.2, 0, Math.PI * 2);
    ctx.stroke();
  } else if (
    video.theme === "city" ||
    video.theme === "blocks" ||
    video.theme === "lab"
  ) {
    for (let i = 0; i < 11; i++) {
      const x = i * 78 - ((time * 8) % 78),
        h = 70 + (i % 4) * 28;
      ctx.fillStyle = i % 2 ? "#526574" : "#687b83";
      ctx.fillRect(x, 290 - h, 58, h);
      ctx.fillStyle = "#e4d49d";
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++)
          ctx.fillRect(x + 9 + j * 15, 300 - h + k * 25, 6, 10);
    }
  } else {
    for (let layer = 0; layer < 2; layer++) {
      ctx.fillStyle = layer ? ground : "#688f84";
      ctx.beginPath();
      ctx.moveTo(0, 405);
      for (let x = 0; x <= 720; x += 12)
        ctx.lineTo(
          x,
          205 + layer * 57 + Math.sin(x / 100 + layer + time * 0.05) * 30,
        );
      ctx.lineTo(720, 405);
      ctx.fill();
    }
    if (video.theme === "forest" || video.theme === "magic")
      for (let i = 0; i < 9; i++) {
        const x = i * 100 - ((time * 11) % 100);
        ctx.fillStyle = "#495c43";
        ctx.fillRect(x + 14, 218, 8, 79);
        ctx.fillStyle = i % 2 ? "#47734d" : "#365c46";
        ctx.beginPath();
        ctx.arc(x + 18, 216, 31, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  if (video.theme === "race") {
    ctx.fillStyle = "#595e5c";
    ctx.fillRect(0, 298, 720, 74);
    ctx.strokeStyle = "#e0d6b3";
    ctx.lineWidth = 4;
    ctx.setLineDash([42, 28]);
    ctx.lineDashOffset = -time * 80;
    ctx.beginPath();
    ctx.moveTo(0, 335);
    ctx.lineTo(720, 335);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (video.theme === "ocean") {
    ctx.strokeStyle = "#a9d7d4";
    ctx.lineWidth = 3;
    for (let row = 0; row < 5; row++) {
      ctx.beginPath();
      for (let x = 0; x <= 720; x += 8)
        ctx.lineTo(x, 270 + row * 22 + Math.sin(x / 35 + time + row) * 5);
      ctx.stroke();
    }
  }
  if (video.theme === "snow") {
    ctx.fillStyle = "#e9f0e8";
    for (let i = 0; i < 30; i++) {
      const x = (i * 83 + Math.sin(time + i) * 8) % 720,
        y = (i * 59 + time * 12) % 355;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.textAlign = "center";
  ctx.font = "92px system-ui";
  ctx.shadowColor = "#13272055";
  ctx.shadowBlur = 12;
  ctx.fillText(
    video.scene[chapter],
    360 + Math.sin(time * 0.65) * 80,
    255 + Math.sin(time * 1.3) * 8,
  );
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#14232bd9";
  ctx.fillRect(0, 365, 720, 40);
  ctx.font = "16px system-ui";
  ctx.fillStyle = "#f1ebd9";
  ctx.fillText(
    `SCENE ${chapter + 1} OF ${video.scene.length}   ${video.scene.join("   ")}`,
    360,
    391,
  );
}
function PhotosApp() {
  const [photo, setPhoto] = useState<string | null>(null),
    [error, setError] = useState("");
  const anchor = useRef<HTMLAnchorElement>(null);
  return (
    <>
      <p>Save a photo of the view behind your phone.</p>
      <button
        onClick={() => {
          const capture = useAdventureSession.getState().captureView;
          if (!capture) {
            setError("The view is still loading.");
            return;
          }
          try {
            setPhoto(capture());
            setError("");
          } catch {
            setError(
              "The photo could not be saved. Try again after the view finishes loading.",
            );
          }
        }}
      >
        Take photo
      </button>
      {error && <p role="alert">{error}</p>}
      {photo && (
        <>
          <PhotoPreview photo={photo} />
          <a ref={anchor} href={photo} download="hank-county.png">
            Save photo
          </a>
        </>
      )}
    </>
  );
}
function FireTruckApp() {
  const p = useFourWheeler3dStore((s) => s.progress);
  const truck = Object.values(p.adventure.fleet).find(
    (v) => v.type === "firetruck",
  );
  return (
    <>
      <p>Water tank: {Math.round(p.adventure.fireWater)}%</p>
      {p.adventure.fireWater < 3 && (
        <p role="status">
          Your tank is empty. Bring the fire truck to the hydrant by the dock to
          refill.
        </p>
      )}
      <button
        onClick={() =>
          useAdventureSession.getState().setWaypoint({
            id: "hydrant",
            label: "Dock hydrant",
            ...LANDMARKS.hydrant,
          })
        }
      >
        Find the hydrant
      </button>
      <button
        onClick={() =>
          useAdventureSession.getState().requestAction("activity:fill")
        }
      >
        Refill at hydrant
      </button>
      <button
        onClick={() =>
          useAdventureSession.getState().requestAction("activity:ladder")
        }
      >
        {p.adventure.ladderRaised ? "Lower ladder" : "Raise ladder"}
      </button>
      <button
        onClick={() =>
          useAdventureSession.getState().requestAction("activity:fire-spray")
        }
      >
        Spray water
      </button>
      {truck ? (
        <button
          onClick={() =>
            useAdventureSession.getState().setWaypoint({
              id: truck.id,
              label: "Fire Truck",
              ...truck.position,
            })
          }
        >
          Find your fire truck
        </button>
      ) : (
        <button
          onClick={() => useAdventureSession.getState().setPhoneApp("amazon")}
        >
          Shop for a fire truck
        </button>
      )}
    </>
  );
}

function PhotoPreview({ photo }: { photo: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!photo.startsWith("data:image/png;base64,")) return;
    const image = new Image();
    let active = true;
    image.onload = () => {
      if (!active || !canvas.current) return;
      canvas.current.width = image.width;
      canvas.current.height = image.height;
      canvas.current.getContext("2d")?.drawImage(image, 0, 0);
    };
    image.src = photo;
    return () => {
      active = false;
      image.onload = null;
    };
  }, [photo]);
  return (
    <canvas
      className="fw-photo"
      ref={canvas}
      role="img"
      aria-label="Your latest view of Hank County"
    />
  );
}
