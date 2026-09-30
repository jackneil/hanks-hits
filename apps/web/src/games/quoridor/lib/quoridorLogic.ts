// quoridorLogic.ts - Quoridor game rules and BFS pathfinding

import {
  type Player,
  type Position,
  type Wall,
  type GameStatus,
  BOARD_SIZE,
  getGoalRow,
  getOpponent,
  isValidPosition,
  positionsEqual,
  wallsEqual,
} from "./constants";

// Game state for logic functions
export type GameLogicState = {
  positions: Record<Player, Position>;
  walls: Wall[];
  wallsRemaining: Record<Player, number>;
};

/**
 * Check if movement between two adjacent squares is blocked by a wall
 */
export function isBlockedByWall(
  from: Position,
  to: Position,
  walls: Wall[]
): boolean {
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;

  // Horizontal movement (left/right)
  if (dRow === 0 && Math.abs(dCol) === 1) {
    const minCol = Math.min(from.col, to.col);
    // Check for vertical walls that would block this horizontal movement
    for (const wall of walls) {
      if (wall.orientation === "vertical") {
        // Vertical wall at column minCol+1 blocks movement between minCol and minCol+1
        if (wall.col === minCol + 1) {
          // Wall spans two rows: wall.row and wall.row+1
          if (wall.row === from.row || wall.row === from.row - 1) {
            return true;
          }
        }
      }
    }
  }

  // Vertical movement (up/down)
  if (Math.abs(dRow) === 1 && dCol === 0) {
    const minRow = Math.min(from.row, to.row);
    // Check for horizontal walls that would block this vertical movement
    for (const wall of walls) {
      if (wall.orientation === "horizontal") {
        // Horizontal wall at row minRow+1 blocks movement between minRow and minRow+1
        if (wall.row === minRow + 1) {
          // Wall spans two columns: wall.col and wall.col+1
          if (wall.col === from.col || wall.col === from.col - 1) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Get valid neighboring squares from a position (respecting walls)
 */
export function getNeighbors(pos: Position, walls: Wall[]): Position[] {
  const neighbors: Position[] = [];
  const directions = [
    { dRow: -1, dCol: 0 }, // Down
    { dRow: 1, dCol: 0 }, // Up
    { dRow: 0, dCol: -1 }, // Left
    { dRow: 0, dCol: 1 }, // Right
  ];

  for (const { dRow, dCol } of directions) {
    const newRow = pos.row + dRow;
    const newCol = pos.col + dCol;

    if (isValidPosition(newRow, newCol)) {
      const newPos = { row: newRow, col: newCol };
      if (!isBlockedByWall(pos, newPos, walls)) {
        neighbors.push(newPos);
      }
    }
  }

  return neighbors;
}

/**
 * BFS to check if a player can reach their goal row
 * This is CRITICAL for wall validation
 */
export function canReachGoal(
  startPos: Position,
  goalRow: number,
  walls: Wall[]
): boolean {
  const visited = new Set<string>();
  const queue: Position[] = [startPos];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.row},${current.col}`;

    if (visited.has(key)) continue;
    visited.add(key);

    // Reached goal row
    if (current.row === goalRow) return true;

    // Add valid neighbors to queue
    for (const neighbor of getNeighbors(current, walls)) {
      if (!visited.has(`${neighbor.row},${neighbor.col}`)) {
        queue.push(neighbor);
      }
    }
  }

  return false;
}

/**
 * Get shortest path length to goal using BFS (for AI heuristic)
 */
export function getShortestPathLength(
  startPos: Position,
  goalRow: number,
  walls: Wall[]
): number {
  const visited = new Set<string>();
  const queue: { pos: Position; dist: number }[] = [{ pos: startPos, dist: 0 }];

  while (queue.length > 0) {
    const { pos: current, dist } = queue.shift()!;
    const key = `${current.row},${current.col}`;

    if (visited.has(key)) continue;
    visited.add(key);

    // Reached goal row
    if (current.row === goalRow) return dist;

    // Add valid neighbors to queue
    for (const neighbor of getNeighbors(current, walls)) {
      if (!visited.has(`${neighbor.row},${neighbor.col}`)) {
        queue.push({ pos: neighbor, dist: dist + 1 });
      }
    }
  }

  return Infinity; // No path found
}

/**
 * Check if a pawn move is valid (basic orthogonal movement)
 */
export function isValidPawnMove(
  state: GameLogicState,
  player: Player,
  to: Position
): boolean {
  const from = state.positions[player];
  const opponent = getOpponent(player);
  const opponentPos = state.positions[opponent];

  // Can't move off board
  if (!isValidPosition(to.row, to.col)) return false;

  // Can't land on opponent
  if (positionsEqual(to, opponentPos)) return false;

  // Calculate movement
  const dRow = to.row - from.row;
  const dCol = to.col - from.col;
  const absRow = Math.abs(dRow);
  const absCol = Math.abs(dCol);

  // Basic orthogonal move (one square)
  if ((absRow === 1 && absCol === 0) || (absRow === 0 && absCol === 1)) {
    return !isBlockedByWall(from, to, state.walls);
  }

  // Jump over opponent
  if (absRow === 2 && absCol === 0) {
    // Vertical jump
    const midRow = from.row + dRow / 2;
    const midPos = { row: midRow, col: from.col };

    // Opponent must be adjacent
    if (!positionsEqual(midPos, opponentPos)) return false;

    // Can't jump if wall between us and opponent
    if (isBlockedByWall(from, midPos, state.walls)) return false;

    // Can't jump if wall between opponent and landing
    if (isBlockedByWall(midPos, to, state.walls)) return false;

    return true;
  }

  if (absRow === 0 && absCol === 2) {
    // Horizontal jump
    const midCol = from.col + dCol / 2;
    const midPos = { row: from.row, col: midCol };

    // Opponent must be adjacent
    if (!positionsEqual(midPos, opponentPos)) return false;

    // Can't jump if wall between us and opponent
    if (isBlockedByWall(from, midPos, state.walls)) return false;

    // Can't jump if wall between opponent and landing
    if (isBlockedByWall(midPos, to, state.walls)) return false;

    return true;
  }

  // Diagonal jump (when straight jump is blocked)
  if (absRow === 1 && absCol === 1) {
    // Opponent must be adjacent to us
    const verticalAdj = { row: from.row + dRow, col: from.col };
    const horizontalAdj = { row: from.row, col: from.col + dCol };

    // Check vertical adjacency case
    if (positionsEqual(verticalAdj, opponentPos)) {
      // Can we reach opponent?
      if (isBlockedByWall(from, opponentPos, state.walls)) return false;

      // Is straight jump blocked?
      const straightJump = { row: from.row + dRow * 2, col: from.col };
      const straightBlocked =
        !isValidPosition(straightJump.row, straightJump.col) ||
        isBlockedByWall(opponentPos, straightJump, state.walls);

      if (!straightBlocked) return false; // Can do straight jump instead

      // Can we do diagonal from opponent?
      return !isBlockedByWall(opponentPos, to, state.walls);
    }

    // Check horizontal adjacency case
    if (positionsEqual(horizontalAdj, opponentPos)) {
      // Can we reach opponent?
      if (isBlockedByWall(from, opponentPos, state.walls)) return false;

      // Is straight jump blocked?
      const straightJump = { row: from.row, col: from.col + dCol * 2 };
      const straightBlocked =
        !isValidPosition(straightJump.row, straightJump.col) ||
        isBlockedByWall(opponentPos, straightJump, state.walls);

      if (!straightBlocked) return false; // Can do straight jump instead

      // Can we do diagonal from opponent?
      return !isBlockedByWall(opponentPos, to, state.walls);
    }

    return false;
  }

  return false;
}

/**
 * Get all valid pawn moves for a player
 */
export function getValidMoves(state: GameLogicState, player: Player): Position[] {
  const validMoves: Position[] = [];

  // Check all possible destinations
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const to = { row, col };
      if (isValidPawnMove(state, player, to)) {
        validMoves.push(to);
      }
    }
  }

  return validMoves;
}

/**
 * Check if two walls overlap or cross
 */
export function wallsOverlap(wall1: Wall, wall2: Wall): boolean {
  // Same position and orientation = same wall
  if (wallsEqual(wall1, wall2)) return true;

  // Check if walls cross (one horizontal, one vertical at same center point)
  if (wall1.orientation !== wall2.orientation) {
    // They cross if they share a center point
    // Horizontal wall center: (row, col + 0.5)
    // Vertical wall center: (row + 0.5, col)
    if (wall1.orientation === "horizontal") {
      // wall1 is horizontal, wall2 is vertical
      // They cross if wall2.col = wall1.col + 1 and wall2.row = wall1.row - 1
      if (wall2.col === wall1.col + 1 && wall2.row === wall1.row - 1) {
        return true;
      }
    } else {
      // wall1 is vertical, wall2 is horizontal
      if (wall1.col === wall2.col + 1 && wall1.row === wall2.row - 1) {
        return true;
      }
    }
  } else {
    // Same orientation - check if they overlap
    if (wall1.orientation === "horizontal") {
      if (wall1.row === wall2.row) {
        // Horizontal walls at same row - check column overlap
        // Each wall spans 2 columns
        if (Math.abs(wall1.col - wall2.col) <= 1) {
          return true;
        }
      }
    } else {
      if (wall1.col === wall2.col) {
        // Vertical walls at same column - check row overlap
        if (Math.abs(wall1.row - wall2.row) <= 1) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if a wall placement is valid
 */
export function isValidWallPlacement(
  state: GameLogicState,
  wall: Wall,
  player: Player
): boolean {
  // Check player has walls remaining
  if (state.wallsRemaining[player] <= 0) return false;

  // Check wall is within bounds
  if (wall.orientation === "horizontal") {
    // Horizontal wall at row R blocks between rows R-1 and R
    // Valid rows: 1-8 (can't place at row 0 or 9)
    if (wall.row < 1 || wall.row > 8) return false;
    // Spans columns col and col+1
    if (wall.col < 0 || wall.col > 7) return false;
  } else {
    // Vertical wall at col C blocks between cols C-1 and C
    // Valid cols: 1-8
    if (wall.col < 1 || wall.col > 8) return false;
    // Spans rows row and row+1
    if (wall.row < 0 || wall.row > 7) return false;
  }

  // Check wall doesn't overlap with existing walls
  for (const existingWall of state.walls) {
    if (wallsOverlap(wall, existingWall)) {
      return false;
    }
  }

  // Critical: Check both players can still reach their goals
  const newWalls = [...state.walls, wall];

  const player1CanReach = canReachGoal(
    state.positions[1],
    getGoalRow(1),
    newWalls
  );
  const player2CanReach = canReachGoal(
    state.positions[2],
    getGoalRow(2),
    newWalls
  );

  return player1CanReach && player2CanReach;
}

/**
 * Get all valid wall placements for a player
 */
export function getValidWalls(state: GameLogicState, player: Player): Wall[] {
  if (state.wallsRemaining[player] <= 0) return [];

  const validWalls: Wall[] = [];

  // Check all possible horizontal walls
  for (let row = 1; row <= 8; row++) {
    for (let col = 0; col <= 7; col++) {
      const wall: Wall = { row, col, orientation: "horizontal" };
      if (isValidWallPlacement(state, wall, player)) {
        validWalls.push(wall);
      }
    }
  }

  // Check all possible vertical walls
  for (let row = 0; row <= 7; row++) {
    for (let col = 1; col <= 8; col++) {
      const wall: Wall = { row, col, orientation: "vertical" };
      if (isValidWallPlacement(state, wall, player)) {
        validWalls.push(wall);
      }
    }
  }

  return validWalls;
}

/**
 * Apply a pawn move and return new positions
 */
export function applyPawnMove(
  positions: Record<Player, Position>,
  player: Player,
  to: Position
): Record<Player, Position> {
  return {
    ...positions,
    [player]: { ...to },
  };
}

/**
 * Check if a player has won
 */
export function checkWinner(positions: Record<Player, Position>): Player | null {
  if (positions[1].row === getGoalRow(1)) return 1;
  if (positions[2].row === getGoalRow(2)) return 2;
  return null;
}

/**
 * Get game status
 */
export function getGameStatus(positions: Record<Player, Position>): GameStatus {
  const winner = checkWinner(positions);
  if (winner === 1) return "player1-wins";
  if (winner === 2) return "player2-wins";
  return "playing";
}
