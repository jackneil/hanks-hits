/** Fixed capture geometry keeps recordings readable on both phone orientations. */
export const BOARD = { x: 32, y: 96, size: 576 };
export function text(c: CanvasRenderingContext2D, value: string, x: number, y: number, size = 24, color = "#fff"): void {
  c.fillStyle = color;
  c.font = `bold ${size}px system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(value, x, y);
}
export function rect(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(x, y, width, height);
}
export function disc(c: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, radius, 0, Math.PI * 2);
  c.fill();
}
export function frame(c: CanvasRenderingContext2D, title: string, status: string, background = "#172554"): void {
  rect(c, 0, 0, 640, 720, background);
  text(c, title, 320, 30, 30);
  text(c, status, 320, 69, 20);
}
