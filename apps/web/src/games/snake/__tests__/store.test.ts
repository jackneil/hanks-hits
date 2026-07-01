import { beforeEach, describe, expect, it } from "vitest";
import { useSnakeStore } from "../lib/store";

describe("Snake store", () => {
  beforeEach(() => {
    useSnakeStore.getState().reset();
  });

  it("allows moving into the current tail on a non-eating move", () => {
    useSnakeStore.setState({
      status: "playing",
      direction: "left",
      nextDirection: "left",
      snake: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 1 },
      ],
      food: { x: 10, y: 10 },
    });

    useSnakeStore.getState().tick();

    const state = useSnakeStore.getState();
    expect(state.status).toBe("playing");
    expect(state.snake).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);
  });

  it("still ends the game when moving into a non-tail body segment", () => {
    useSnakeStore.setState({
      status: "playing",
      direction: "down",
      nextDirection: "down",
      snake: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 1 },
      ],
      food: { x: 10, y: 10 },
    });

    useSnakeStore.getState().tick();

    expect(useSnakeStore.getState().status).toBe("game-over");
  });

  it("does not ignore the tail when the snake grows", () => {
    useSnakeStore.setState({
      status: "playing",
      direction: "left",
      nextDirection: "left",
      snake: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 1 },
      ],
      food: { x: 1, y: 1 },
    });

    useSnakeStore.getState().tick();

    expect(useSnakeStore.getState().status).toBe("game-over");
  });
});
