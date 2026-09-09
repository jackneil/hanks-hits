"use client";
import { useFourWheeler3dStore } from "../lib/store";
import "./ui/adventure.css";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

export function StartScreen() {
  const start = useFourWheeler3dStore((s) => s.setHasStarted),
    p = useFourWheeler3dStore((s) => s.progress);
  return (
    <div
      className="fw-start"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Hank County"
    >
      <div className="fw-start-content">
        <div className="fw-start-eyebrow">
          <span /> A WORLD OF YOUR OWN
        </div>
        <h1>
          HANK
          <br />
          <span>COUNTY</span>
        </h1>
        <p className="fw-start-lead">The trail is only the beginning.</p>
        <p className="fw-start-description">
          A four-wheeler, your best friend, and a whole county waiting outside.
          Ride, hunt, fish, race, build, and see where the day takes you.
        </p>
        <ReadAloudButton
          className="fw-start-narration"
          text="Welcome to Hank County. Tap Start your adventure. On a phone, hold Gas to drive and use the left and right arrows to steer. Tap Use beside a ride or building. On a keyboard, use the arrow keys to drive, E to use something, M for your map, and P for your phone. Follow the map to shops, hunting, fishing, races, and home. Feed yourself and your dog before the fullness bars run out."
        />
        <button
          autoFocus
          aria-label="▶ Play!"
          className="fw-start-play"
          onClick={() => start(true)}
        >
          Start your adventure <span aria-hidden="true">↗</span>
        </button>
        <div className="fw-start-save">
          <span />{" "}
          {p.lastModified
            ? "Your saved world is ready"
            : "Your first ride starts at the garage"}
        </div>
        <div className="fw-start-controls">
          <span>
            <kbd>W A S D</kbd> Drive
          </span>
          <span>
            <kbd>E</kbd> Use / hop off
          </span>
          <span>
            <kbd>M</kbd> Map
          </span>
          <span>
            <kbd>P</kbd> Phone
          </span>
        </div>
        <p className="fw-start-touch">
          On a phone or tablet, use the controls on screen. Landscape gives you
          more room to explore.
        </p>
      </div>
      <div className="fw-start-edition">
        <strong>FOUR-WHEELER ADVENTURE</strong>
        <span>Hank’s world. Bigger than ever.</span>
      </div>
    </div>
  );
}
