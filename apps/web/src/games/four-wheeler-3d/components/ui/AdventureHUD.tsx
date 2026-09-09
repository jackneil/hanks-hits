"use client";
import { useEffect, useRef, type ReactNode } from "react";
import {
  useAdventureSession,
  type WorldPanel,
} from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import { STORE_LABELS, type StoreId } from "../../lib/catalog";
import { distanceTo } from "../../lib/destinations";
import { WorldMap } from "./WorldMap";
import { PhonePanel } from "./PhonePanel";
import { GaragePanel, ShopPanel, dollars } from "./ShopPanel";
import { PropertyPanel, HomePanel } from "./PropertyPanel";
import { DeliveryStatus } from "../DeliveryVisuals";
import { CameraControls, CameraSettings } from "./CameraControls";
import { RidePanel } from "./RidePanel";
import { SellPanel } from "./SellPanel";
import "./adventure.css";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

const PANEL_NAMES: Record<Exclude<WorldPanel, null>, string> = {
  ride: "Make the most of your ride",
  sell: "County sell box",
  activities: "Outside is the best place",
  phone: "Your phone",
  map: "Hank County",
  shop: "Store",
  garage: "Your rides",
  inventory: "Your gear",
  land: "Make it yours",
  home: "Home sweet home",
  race: "County Raceway",
  fishing: "Lakeside fishing",
  train: "County Railway",
  space: "Beyond the county",
  help: "Find your adventure",
  settings: "Make yourself comfortable",
  trophies: "Your trophy room",
};
export function AdventureHUD({
  mobile,
  children,
}: {
  mobile: boolean;
  children?: ReactNode;
}) {
  const session = useAdventureSession(),
    p = useFourWheeler3dStore((s) => s.progress),
    clock = useFourWheeler3dStore((s) => s.clock),
    mode = useFourWheeler3dStore((s) => s.mode);
  const open = session.openPanel,
    action = session.requestAction;
  const waypoint = session.waypoint,
    position = session.playerSnapshot;
  const hours = Math.floor(clock),
    time = `${((hours + 11) % 12) + 1}:${Math.floor((clock % 1) * 60)
      .toString()
      .padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const key = e.code;
      if (key === "KeyP" || key === "KeyM" || key === "KeyI") {
        e.preventDefault();
        const panel =
          key === "KeyP" ? "phone" : key === "KeyM" ? "map" : "inventory";
        open(session.panel === panel ? null : panel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, session.panel]);
  return (
    <div className={`fw-ui ${mobile ? "fw-mobile" : ""}`}>
      <div className="fw-topline">
        <div className="fw-location">
          <strong>HANK COUNTY</strong>
          <span>
            {time} · Day {p.day} · {p.weather}
          </span>
        </div>
        <div className="fw-balance">
          <small>YOUR CASH</small>
          <strong>{dollars(p.money)}</strong>
        </div>
      </div>
      <nav className="fw-toolbelt" aria-label="Adventure tools">
        <button onClick={() => open("phone")}>
          <span aria-hidden="true">▯</span>Phone<kbd>P</kbd>
        </button>
        <button onClick={() => open("map")}>
          <span aria-hidden="true">⌖</span>Map<kbd>M</kbd>
        </button>
        <button onClick={() => open("inventory")}>
          <span aria-hidden="true">▣</span>Gear<kbd>I</kbd>
        </button>
        <CameraControls />
        <button onClick={() => open("ride")}>Ride</button>
        <button onClick={() => open("activities")}>Activities</button>
        <button onClick={() => open("help")} aria-label="Adventure guide">
          ?
        </button>
        <button onClick={() => open("settings")} aria-label="Game settings">
          ⚙
        </button>
      </nav>
      <DeliveryStatus />
      {(p.hunger >= 18 || p.adventure.dog.hungerHours >= 18) && (
        <div className="fw-food-warning" role="status">
          <strong>Time for food</strong>
          <span>Eat and feed your dog before empty to keep your rides.</span>
          {p.hunger >= 18 && (
            <button
              onClick={() =>
                session.setWaypoint({
                  id: "house",
                  label: "Home kitchen",
                  x: -485,
                  z: 6,
                })
              }
            >
              🍽 Find home
            </button>
          )}
          {p.adventure.dog.hungerHours >= 18 && (
            <button onClick={() => action("dog:feed")}>
              🐕 Feed dog · $10
            </button>
          )}
        </div>
      )}
      <div className="fw-navigation">
        {mode !== "interior" && <WorldMap mini />}
        <div className="fw-fullness-labels">
          <span>
            🧑 {Math.max(0, Math.round(100 - (p.hunger / 24) * 100))}%
          </span>
          <span>
            🐕{" "}
            {Math.max(
              0,
              Math.round(100 - (p.adventure.dog.hungerHours / 24) * 100),
            )}
            %
          </span>
        </div>
        <div className="fw-status-bars">
          <span
            role="meter"
            aria-label="Your fullness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.max(0, Math.round(100 - (p.hunger / 24) * 100))}
          >
            <i style={{ width: `${100 - (p.hunger / 24) * 100}%` }} />
          </span>
          <span
            role="meter"
            aria-label="Dog fullness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.max(
              0,
              Math.round(100 - (p.adventure.dog.hungerHours / 24) * 100),
            )}
          >
            <i
              style={{
                width: `${100 - (p.adventure.dog.hungerHours / 24) * 100}%`,
              }}
            />
          </span>
        </div>
        <div className="fw-route-label">
          {mode === "interior" ? (
            <>
              <strong>
                {session.interior?.kind === "garage" ? "Your garage" : "Inside"}
              </strong>
              <span>Walk around. Press E to use nearby things.</span>
              <button
                onClick={() => action("home:exit")}
                className="fw-primary"
              >
                Go outside
              </button>
              {session.interior?.kind === "garage" && (
                <button
                  onClick={() =>
                    action("property:manage", session.interior!.id)
                  }
                >
                  Manage parked rides
                </button>
              )}
            </>
          ) : waypoint ? (
            <>
              <strong>{waypoint.label}</strong>
              <span>
                {Math.round(distanceTo(position, waypoint))} m · Follow the gold
                route
              </span>
            </>
          ) : (
            <>
              <strong>Free roam</strong>
              <span>Find a trail. Make a story.</span>
            </>
          )}
        </div>
      </div>
      <div className="fw-context" hidden={mode === "train"}>
        {(!["vehicle", "boat"].includes(mode) || session.interaction) && (
          <button onClick={() => action("world:interact")}>
            <kbd>E</kbd>
            {session.interaction?.label ??
              (["vehicle", "boat"].includes(mode)
                ? "Hop off"
                : "Use nearby thing")}
          </button>
        )}
        {["vehicle", "boat"].includes(mode) && (
          <button onClick={() => action("world:exit")}>Hop off</button>
        )}
        {["vehicle", "boat", "aircraft"].includes(mode) && (
          <button onClick={() => useFourWheeler3dStore.getState().startNos()}>
            NOS
          </button>
        )}
        {["boat", "deck"].includes(mode) && (
          <button onClick={() => open("fishing")}>Fishing</button>
        )}
        {mode === "aircraft" && (
          <>
            <button onClick={() => action("air:climb")}>Climb</button>
            <button onClick={() => action("air:descend")}>Descend</button>
            <button onClick={() => action("air:parachute")}>Parachute</button>
          </>
        )}
      </div>
      {session.panel && (
        <Panel
          title={
            session.panel === "shop"
              ? (STORE_LABELS[session.panelId as StoreId] ?? "Store")
              : PANEL_NAMES[session.panel]
          }
          onClose={() => open(null)}
        >
          {session.panel === "ride" ? (
            <RidePanel />
          ) : session.panel === "sell" ? (
            <SellPanel />
          ) : session.panel === "phone" ? (
            <PhonePanel />
          ) : session.panel === "map" ? (
            <WorldMap />
          ) : session.panel === "shop" ? (
            <ShopPanel storeId={session.panelId} />
          ) : session.panel === "garage" ? (
            <GaragePanel custom={session.panelId === "customGarage"} />
          ) : session.panel === "land" ? (
            <PropertyPanel id={session.panelId} />
          ) : session.panel === "home" ? (
            <HomePanel />
          ) : session.panel === "settings" ? (
            <Settings />
          ) : session.panel === "help" ? (
            <Guide />
          ) : session.panel === "trophies" ? (
            <Trophies />
          ) : (
            children
          )}
        </Panel>
      )}
    </div>
  );
}
export function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    panel?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      );
      const first = items[0],
        last = items.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    panel?.addEventListener("keydown", trap);
    return () => {
      panel?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, []);
  return (
    <div className="fw-panel-backdrop">
      <div
        className="fw-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <div>
            <small>HANK COUNTY</small>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </header>
        <div className="fw-panel-body">
          <ReadAloudButton
            variant="icon"
            text={() =>
              `${title}. ${ref.current?.querySelector("[data-panel-copy]")?.textContent ?? ""}`
            }
          />
          <div data-panel-copy>{children}</div>
        </div>
      </div>
    </div>
  );
}
function Settings() {
  const s = useFourWheeler3dStore((s) => s.progress.settings),
    update = useFourWheeler3dStore((s) => s.updateSettings);
  return (
    <div className="fw-settings">
      <CameraSettings />
      <label>
        <span>
          Sound<small>Engine, wildlife and music</small>
        </span>
        <input
          type="checkbox"
          checked={s.soundEnabled}
          onChange={(e) => update({ soundEnabled: e.target.checked })}
        />
      </label>
      <label>
        <span>
          Rider camera<small>See through the rider’s eyes</small>
        </span>
        <input
          type="checkbox"
          checked={s.helmetCam}
          onChange={(e) => update({ helmetCam: e.target.checked })}
        />
      </label>
      <p>
        Your rides, cash and progress save automatically on this device. Sign in
        from the game bar to sync between devices.
      </p>
    </div>
  );
}
function Guide() {
  return (
    <div className="fw-guide">
      <h3>A whole county to call your own.</h3>
      <p>
        Ride the trails, buy a truck, follow your dog into the woods, catch a
        fish worth a fortune, or build a place of your own.
      </p>
      <dl>
        <dt>Drive / walk</dt>
        <dd>WASD or arrow keys. Shift to handbrake or run. Space to jump.</dd>
        <dt>Use something nearby</dt>
        <dd>
          Press E beside a store, ride, house or activity. Slow down first.
        </dd>
        <dt>Find your way</dt>
        <dd>
          M opens the map. Choose a destination to put a gold route on your GPS.
        </dd>
        <dt>Phone and shopping</dt>
        <dd>
          P opens your phone. Shop in town or order a delivery from anywhere.
        </dd>
        <dt>Hunting and fishing</dt>
        <dd>
          I opens your gear. Buy equipment in town, then walk to the woods or
          the lake.
        </dd>
        <dt>Camera / recovery</dt>
        <dd>C switches camera. R puts your ride back on its wheels.</dd>
        <dt>Pause</dt>
        <dd>Escape closes a panel or pauses the game.</dd>
      </dl>
    </div>
  );
}
function Trophies() {
  const p = useFourWheeler3dStore((s) => s.progress);
  return (
    <>
      <p className="fw-muted">Every trip has something worth remembering.</p>
      <div className="fw-trophies">
        <article>
          <strong>{p.racesWon}</strong>
          <span>Races won</span>
        </article>
        <article>
          <strong>{p.adventure.collectedSkulls}</strong>
          <span>Buck skulls</span>
        </article>
        <article>
          <strong>
            {Object.values(p.fishCaught).reduce((a, b) => a + b, 0)}
          </strong>
          <span>Fish caught</span>
        </article>
        <article>
          <strong>{p.airPoints}</strong>
          <span>Air points</span>
        </article>
      </div>
      <h3>Hunting collection</h3>
      {Object.entries(p.adventure.trophyCounts).map(([type, n]) => (
        <p key={type}>
          {type}: {n}
        </p>
      ))}
      <h3>Fishing records</h3>
      {Object.entries(p.fishCaught).map(([type, n]) => (
        <p key={type}>
          {type}: {n}
        </p>
      ))}
    </>
  );
}
