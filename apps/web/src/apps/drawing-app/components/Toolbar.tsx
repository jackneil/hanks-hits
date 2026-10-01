"use client";

import { useDrawingStore } from "../lib/store";
import { TOOLS, type DrawingTool } from "../lib/constants";

/**
 * Toolbar Component - Tool selection
 * Big touch-friendly buttons for kids
 */
export function Toolbar({ compact = false }: { compact?: boolean }) {
  const { tool, setTool } = useDrawingStore();

  const tools: DrawingTool[] = ["pencil", "brush", "eraser"];

  // Compact: 44 px round icons that flow into the side rail's grid.
  if (compact) {
    return (
      <div className="contents">
        {tools.map((t) => {
          const toolInfo = TOOLS[t];
          const isActive = tool === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTool(t)}
              aria-pressed={isActive}
              className={`flex h-11 w-11 items-center justify-center rounded-xl text-2xl shadow-lg transition-all touch-manipulation ${
                isActive ? "bg-blue-500 text-white" : "bg-white/90 text-gray-700"
              }`}
              aria-label={toolInfo.name}
              title={toolInfo.description}
            >
              <span aria-hidden="true">{toolInfo.icon}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex gap-2 p-2 bg-white/90 rounded-2xl shadow-lg">
      {tools.map((t) => {
        const toolInfo = TOOLS[t];
        const isActive = tool === t;

        return (
          <button
            key={t}
            type="button"
            onClick={() => setTool(t)}
            aria-pressed={isActive}
            className={`
              w-16 h-16 rounded-xl flex flex-col items-center justify-center
              transition-all touch-manipulation
              ${
                isActive
                  ? "bg-blue-500 text-white shadow-lg scale-105"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }
            `}
            aria-label={toolInfo.name}
            title={toolInfo.description}
          >
            <span className="text-2xl" aria-hidden="true">{toolInfo.icon}</span>
            <span className="text-sm font-medium mt-0.5">
              {toolInfo.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
