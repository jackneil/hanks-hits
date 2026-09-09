"use client";
import { useId, useMemo, useRef, useState } from "react";
import { DESTINATIONS, distanceTo, routeTo } from "../../lib/destinations";
import { useAdventureSession, type Waypoint } from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import {
  ANIMAL_MAP_COLORS,
  BONE_POINTS,
  wildlifeMapPaths,
  wildlifeMapRuntime,
} from "../../lib/mapData";
import { LAND_PLOTS, RUNWAY, raceLoopPoints } from "../../lib/landmarks";
import { RAIL_TRACKS } from "../../lib/rail";
import { racePoint } from "../../lib/race";
import {
  propertySize,
  propertySlot,
  BUILDING_LABELS,
} from "../../lib/property";
import { isAirVehicle } from "../../lib/catalog";
import "./phone-media.css";

type Layer = "places" | "rides" | "hunting" | "bones" | "wildlife" | "rival";
type Pin = Waypoint & { layer: Layer; icon: string; color: string };
const LAYERS: { id: Layer; label: string; color: string }[] = [
  { id: "places", label: "Places", color: "#e6c17b" },
  { id: "rides", label: "Your rides", color: "#92bbde" },
  { id: "hunting", label: "Stands & feeders", color: "#c3c883" },
  { id: "bones", label: "Bones", color: "#fff0a0" },
  { id: "wildlife", label: "Wildlife", color: "#ca9c69" },
  { id: "rival", label: "Race rival", color: "#648eff" },
];
const RACE_LINE = raceLoopPoints(128)
  .map((p) => `${p.x},${p.z}`)
  .join(" ");
const RAIL_LINES = (["loop", "spur", "sky"] as const).map((id) => ({
  id,
  points: RAIL_TRACKS[id].points
    .filter((_, i) => i % 3 === 0)
    .map((p) => `${p.x},${p.z}`)
    .join(" "),
}));
const clamp = (v: number) => Math.max(-2000, Math.min(2000, v));

export function WorldMap({ mini = false }: { mini?: boolean }) {
  const clip = useId().replaceAll(":", "");
  const player = useAdventureSession((s) => s.playerSnapshot),
    waypoint = useAdventureSession((s) => s.waypoint),
    rail = useAdventureSession((s) => s.rail),
    race = useAdventureSession((s) => s.race);
  const adventure = useFourWheeler3dStore((s) => s.progress.adventure),
    mode = useFourWheeler3dStore((s) => s.mode);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState<{ x: number; z: number } | null>(null),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState(40),
    [picked, setPicked] = useState<Waypoint | null>(null);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    places: true,
    rides: true,
    hunting: true,
    bones: true,
    wildlife: !mini,
    rival: true,
  });
  const drag = useRef<{
    x: number;
    y: number;
    centerX: number;
    centerZ: number;
    span: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const span = mini ? 600 : 4200 / zoom,
    center = mini ? player : (pan ?? (zoom > 1 ? player : { x: 0, z: 0 }));
  const viewBox = `${center.x - span / 2} ${center.z - span / 2} ${span} ${span}`;
  const route = waypoint
    ? ["boat", "aircraft"].includes(mode)
      ? [player, waypoint]
      : routeTo(player, waypoint)
    : [];
  const pins = useMemo<Pin[]>(() => {
    const places: Pin[] = DESTINATIONS.filter((d) => d.kind !== "stand").map(
      (d) => ({
        id: d.id,
        label:
          d.kind === "land"
            ? `${adventure.plots[d.id]?.owned ? "Your land" : "Land for sale"} · ${d.id.split("-")[1]}`
            : d.label,
        x: d.id === "train" && rail ? rail.position.x : d.x,
        z: d.id === "train" && rail ? rail.position.z : d.z,
        layer: "places",
        icon: d.icon,
        color: d.kind === "shop" ? "#e6c17b" : "#d9ddd5",
      }),
    );
    places.push({
      id: "airfield",
      label: "Airfield",
      x: RUNWAY.x,
      z: RUNWAY.z,
      layer: "places",
      icon: "✈",
      color: "#bfcbd0",
    });
    for (const plot of Object.values(adventure.plots))
      for (const b of plot.buildings) {
        const p = propertySlot(adventure, plot.id, b.slot);
        if (p)
          places.push({
            id: `${plot.id}:${b.slot}`,
            label: `${BUILDING_LABELS[b.type]} · Plot ${plot.id.split("-")[1]}`,
            ...p,
            layer: "places",
            icon: "⌂",
            color: "#c8d6ba",
          });
      }
    const counts: Record<string, number> = {},
      carried = new Set(Object.values(adventure.fleet).flatMap((v) => v.cargo));
    for (const v of Object.values(adventure.fleet)) {
      if (
        carried.has(v.id) ||
        (isAirVehicle(v.type) && !adventure.aircraftOwned)
      )
        continue;
      counts[v.type] = (counts[v.type] ?? 0) + 1;
      const p =
        v.id === adventure.activeVehicleId &&
        ["vehicle", "boat", "aircraft"].includes(mode)
          ? player
          : v.position;
      places.push({
        id: v.id,
        label: `${v.type.toUpperCase()} ${counts[v.type]}`,
        x: p.x,
        z: p.z,
        layer: "rides",
        icon: "↗",
        color: v.paint,
      });
    }
    adventure.stands.forEach((s, i) =>
      places.push({
        id: s.id,
        label: `${s.type === "tree" ? "Tree stand" : "Ground blind"} ${i + 1}`,
        ...s.position,
        layer: "hunting",
        icon: "⌖",
        color: "#a8bc8e",
      }),
    );
    adventure.feeders.forEach((f) =>
      places.push({
        id: f.id,
        label: `${f.label} · ${Math.round((f.corn / 18) * 100)}% corn`,
        ...f.position,
        layer: "hunting",
        icon: "▪",
        color: f.corn > 5.4 ? "#e0c779" : "#ee8970",
      }),
    );
    return places;
  }, [adventure, rail, mode, player]);
  const visible = (p: { x: number; z: number }) =>
    Math.abs(p.x - center.x) < span / 2 + span / 30 &&
    Math.abs(p.z - center.z) < span / 2 + span / 30;
  const animalPaths = layers.wildlife
    ? wildlifeMapPaths(
        wildlifeMapRuntime.animals,
        { ...center, span },
        span / (mini ? 140 : 300),
      )
    : {};
  const bones = useMemo(
    () => BONE_POINTS.filter((b) => !adventure.collectedBones.includes(b.id)),
    [adventure.collectedBones],
  );
  const rival = { x: 0, z: 0, heading: 0 };
  if (race) racePoint(race.rivalProgress, rival);
  const directory: Pin[] = [
    ...pins,
    ...bones.map((b) => ({
      ...b,
      label: `Bone ${Number(b.id.split("-")[1]) + 1}`,
      layer: "bones" as const,
      icon: "🦴",
      color: "#fff0a0",
    })),
  ];
  const results = directory
    .filter(
      (p) =>
        layers[p.layer] && p.label.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => distanceTo(player, a) - distanceTo(player, b));
  const setDestination = (p: Waypoint) => {
    useAdventureSession.getState().setWaypoint(p);
    useFourWheeler3dStore
      .getState()
      .setHint(`GPS set to ${p.label}. Follow the gold route.`);
  };
  return (
    <div className={mini ? "fw-map-mini" : "fw-map-full fw-map-upgraded"}>
      {!mini && (
        <div className="fw-map-toolbar">
          <label>
            <span className="sr-only">Search destinations</span>
            <input
              value={search}
              placeholder="Search places, rides or feeders"
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(40);
              }}
            />
          </label>
          <button
            onClick={() => {
              setPan(null);
              setZoom(8);
            }}
            aria-label="Center map on your location"
          >
            ◎ You
          </button>
          <button
            onClick={() => {
              setPan(null);
              setZoom(1);
            }}
          >
            Whole county
          </button>
        </div>
      )}
      <div className="fw-map-viewport">
        <svg
          viewBox={viewBox}
          preserveAspectRatio="none"
          role={mini ? "img" : "group"}
          tabIndex={mini ? undefined : 0}
          aria-label={
            mini
              ? "Nearby map with your location and GPS route"
              : "Interactive county map. Drag or use arrow keys to pan. Select markers for GPS."
          }
          onKeyDown={
            mini
              ? undefined
              : (e) => {
                  const step = span * 0.15;
                  if (
                    [
                      "ArrowUp",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowRight",
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                    setPan({
                      x: clamp(
                        center.x +
                          (e.key === "ArrowRight"
                            ? step
                            : e.key === "ArrowLeft"
                              ? -step
                              : 0),
                      ),
                      z: clamp(
                        center.z +
                          (e.key === "ArrowDown"
                            ? step
                            : e.key === "ArrowUp"
                              ? -step
                              : 0),
                      ),
                    });
                  }
                }
          }
          onPointerDown={
            mini
              ? undefined
              : (e) => {
                  if (e.button !== 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    centerX: center.x,
                    centerZ: center.z,
                    span,
                    width: rect.width,
                    height: rect.height,
                    moved: false,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }
          }
          onPointerMove={
            mini
              ? undefined
              : (e) => {
                  const d = drag.current;
                  if (!d) return;
                  const dx = e.clientX - d.x,
                    dy = e.clientY - d.y;
                  if (Math.hypot(dx, dy) > 5) d.moved = true;
                  if (d.moved)
                    setPan({
                      x: clamp(d.centerX - (dx / d.width) * d.span),
                      z: clamp(d.centerZ - (dy / d.height) * d.span),
                    });
                }
          }
          onPointerUp={
            mini
              ? undefined
              : (e) => {
                  const d = drag.current;
                  if (!d) return;
                  if (!d.moved) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPicked({
                      id: "custom-waypoint",
                      label: "Map pin",
                      x: clamp(
                        d.centerX +
                          ((e.clientX - rect.left) / rect.width - 0.5) * d.span,
                      ),
                      z: clamp(
                        d.centerZ +
                          ((e.clientY - rect.top) / rect.height - 0.5) * d.span,
                      ),
                    });
                  }
                  drag.current = null;
                }
          }
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <pattern
              id={`grid-${clip}`}
              width="100"
              height="100"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M100 0 L0 0 0 100"
                fill="none"
                stroke="#fff"
                strokeOpacity=".045"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          <rect
            x="-10000"
            y="-10000"
            width="20000"
            height="20000"
            fill="#263a34"
          />
          <rect
            x="-2000"
            y="-2000"
            width="4000"
            height="4000"
            rx="30"
            fill="#36463a"
            stroke="#8b8167"
            strokeWidth="12"
          />
          <rect
            x="-2000"
            y="-2000"
            width="4000"
            height="4000"
            fill={`url(#grid-${clip})`}
          />
          <polyline
            points={RACE_LINE}
            fill="none"
            stroke="#a78c64"
            strokeWidth="10"
          />
          {RAIL_LINES.map((line) => (
            <polyline
              key={line.id}
              points={line.points}
              fill="none"
              stroke={line.id === "sky" ? "#a9b9cf" : "#cad0bb"}
              strokeOpacity=".6"
              strokeWidth="4"
              strokeDasharray={line.id === "sky" ? "15 10" : "8 7"}
            />
          ))}
          <circle r="360" fill="#41717c" stroke="#82968a" strokeWidth="12" />
          {DESTINATIONS.filter(
            (d) => d.kind === "stand" || d.kind === "land" || d.kind === "home",
          ).map((d) => (
            <path
              key={d.id}
              d={`M-400 0 L${d.x} ${d.z}`}
              stroke="#9f9379"
              strokeOpacity=".3"
              strokeWidth={mini ? 3 : 6}
            />
          ))}
          <rect
            x="-520"
            y="-150"
            width="165"
            height="164"
            fill="#b9ab91"
            opacity=".8"
          />
          <rect
            x={RUNWAY.x - RUNWAY.length / 2}
            y={RUNWAY.z - RUNWAY.width / 2}
            width={RUNWAY.length}
            height={RUNWAY.width}
            fill="#dedecb"
          />
          {LAND_PLOTS.filter((p) => adventure.plots[p.id]?.owned).map((p) => {
            const size = propertySize(adventure, p.id);
            return (
              <rect
                key={p.id}
                x={p.x - size / 2}
                y={p.z - size / 2}
                width={size}
                height={size}
                fill="#b0be8822"
                stroke="#d6cb9a"
                strokeWidth={span / 900}
              />
            );
          })}
          {Object.entries(animalPaths).map(([type, d]) => (
            <path
              key={type}
              d={d}
              fill={ANIMAL_MAP_COLORS[type]}
              opacity={mini ? 0.8 : 0.7}
            />
          ))}
          {layers.bones &&
            bones.filter(visible).map((b) => (
              <g key={b.id} transform={`translate(${b.x},${b.z})`}>
                <rect
                  x={-span / 450}
                  y={-span / 600}
                  width={span / 225}
                  height={span / 300}
                  rx={span / 1500}
                  fill="#fff0a0"
                />
              </g>
            ))}
          {pins
            .filter((p) => layers[p.layer] && visible(p))
            .map((p) => (
              <g
                key={`${p.layer}:${p.id}`}
                transform={`translate(${p.x},${p.z})`}
                className={!mini ? "fw-map-pin" : undefined}
                role={!mini ? "button" : undefined}
                tabIndex={!mini ? 0 : undefined}
                aria-label={!mini ? `Select ${p.label} for GPS` : undefined}
                onPointerDown={mini ? undefined : (e) => e.stopPropagation()}
                onClick={mini ? undefined : () => setPicked(p)}
                onKeyDown={
                  mini
                    ? undefined
                    : (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPicked(p);
                        }
                      }
                }
              >
                <circle r={span / 90} fill="transparent" />
                {p.layer === "rides" ? (
                  <rect
                    x={-span / 230}
                    y={-span / 200}
                    width={span / 115}
                    height={span / 100}
                    rx={span / 550}
                    fill={p.color}
                    stroke="#f0eee0"
                    strokeWidth={span / 650}
                  />
                ) : (
                  <circle
                    r={span / (mini ? 100 : 170)}
                    fill={p.color}
                    stroke="#24332c"
                    strokeWidth={span / 600}
                  />
                )}
                <title>{p.label}</title>
                {!mini && zoom >= 4 && (
                  <text
                    y={-span / 65}
                    fill="#f7f4e9"
                    stroke="#20332b"
                    strokeWidth={span / 1500}
                    paintOrder="stroke"
                    fontSize={span / 65}
                    textAnchor="middle"
                  >
                    {p.label}
                  </text>
                )}
              </g>
            ))}
          {layers.rival &&
            race &&
            ["racing", "countdown"].includes(race.phase) && (
              <g transform={`translate(${rival.x},${rival.z})`}>
                <circle
                  r={span / 70}
                  fill="#648eff"
                  stroke="#dce6ff"
                  strokeWidth={span / 500}
                />
                <title>Race rival</title>
              </g>
            )}
          {waypoint && (
            <polyline
              points={route.map((p) => `${p.x},${p.z}`).join(" ")}
              fill="none"
              stroke="#f7cb72"
              strokeWidth={span / 140}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {waypoint && (
            <g transform={`translate(${waypoint.x},${waypoint.z})`}>
              <circle
                r={span / 40}
                fill="none"
                stroke="#ffd180"
                strokeWidth={span / 160}
              />
              <circle r={span / 100} fill="#ffd180" />
            </g>
          )}
          {picked && !mini && (
            <g transform={`translate(${picked.x},${picked.z})`}>
              <circle
                r={span / 45}
                fill="none"
                stroke="#fff"
                strokeWidth={span / 400}
              />
              <path
                d={`M${-span / 35} 0 H${span / 35} M0 ${-span / 35} V${span / 35}`}
                stroke="#fff"
                strokeWidth={span / 500}
              />
            </g>
          )}
          <g
            transform={`translate(${player.x},${player.z}) rotate(${(-player.heading * 180) / Math.PI + 180}) scale(${span / 750})`}
          >
            <path
              d="M0 -15 L10 12 L0 7 L-10 12 Z"
              fill="#fff"
              stroke="#152622"
              strokeWidth="2"
            />
          </g>
        </svg>
        <span className="fw-map-north" aria-hidden="true">
          N ↑
        </span>
        {!mini && (
          <div className="fw-map-zoom">
            <button
              onClick={() => setZoom((z) => Math.min(16, z * 2))}
              disabled={zoom === 16}
              aria-label="Zoom map in"
            >
              +
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(1, z / 2))}
              disabled={zoom === 1}
              aria-label="Zoom map out"
            >
              −
            </button>
          </div>
        )}
      </div>
      {mini ? (
        <button
          className="fw-map-open"
          onClick={() => useAdventureSession.getState().openPanel("map")}
          aria-label="Open full map"
        />
      ) : (
        <>
          {picked && (
            <div className="fw-map-selection">
              <span>
                <strong>{picked.label}</strong>
                <small>{Math.round(distanceTo(player, picked))} m away</small>
              </span>
              <button
                className="fw-primary"
                onClick={() => setDestination(picked)}
              >
                Set GPS
              </button>
              <button
                aria-label="Dismiss selected map pin"
                onClick={() => setPicked(null)}
              >
                ×
              </button>
            </div>
          )}
          <fieldset className="fw-map-layers">
            <legend>Map layers</legend>
            {LAYERS.map((layer) => (
              <label key={layer.id}>
                <input
                  type="checkbox"
                  checked={layers[layer.id]}
                  onChange={(e) =>
                    setLayers((s) => ({ ...s, [layer.id]: e.target.checked }))
                  }
                />
                <i style={{ background: layer.color }} />
                {layer.label}
                {layer.id === "bones" ? ` (${bones.length})` : ""}
              </label>
            ))}
          </fieldset>
          {layers.wildlife && (
            <div
              className="fw-map-animal-key"
              aria-label="Wildlife color legend"
            >
              {Object.entries(ANIMAL_MAP_COLORS).map(([type, color]) => (
                <span key={type}>
                  <i style={{ background: color }} />
                  {type}
                </span>
              ))}
            </div>
          )}
          <div className="fw-map-directory-title">
            <strong>Destinations · {results.length}</strong>
            {waypoint && (
              <button
                onClick={() => useAdventureSession.getState().setWaypoint(null)}
              >
                Clear GPS
              </button>
            )}
          </div>
          <div className="fw-destination-list">
            {results.slice(0, limit).map((p) => (
              <button
                key={`${p.layer}:${p.id}`}
                onClick={() => setDestination(p)}
              >
                <span aria-hidden="true">{p.icon}</span>
                <span>{p.label}</span>
                <small>{Math.round(distanceTo(player, p))} m</small>
              </button>
            ))}
          </div>
          {!results.length && (
            <p>
              No destinations match. Try another name or turn on more layers.
            </p>
          )}
          {results.length > limit && (
            <button
              className="fw-track"
              onClick={() => setLimit((n) => n + 40)}
            >
              Show more destinations
            </button>
          )}
          <p className="fw-media-note">
            Drag or use arrow keys to explore. Tap a marker or any spot, then
            set your GPS. Pale lines are rails; the dashed sky route is above
            the ground.
          </p>
        </>
      )}
    </div>
  );
}
