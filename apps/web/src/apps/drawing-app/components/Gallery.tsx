"use client";

import { useState } from "react";
import { useCoarsePointer } from "@/shared/hooks";
import { useDrawingStore, type SavedArtwork } from "../lib/store";

interface GalleryProps {
  onLoadArtwork: (artwork: SavedArtwork) => void;
  onClose: () => void;
}

/**
 * Gallery Component - View and manage saved artworks
 * Grid of thumbnails with load/delete options
 */
export function Gallery({ onLoadArtwork, onClose }: GalleryProps) {
  const isCoarsePointer = useCoarsePointer();
  const { savedArtworks, deleteArtwork } = useDrawingStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const selectedArtwork = savedArtworks.find((art) => art.id === selectedId);

  const handleLoad = () => {
    if (selectedArtwork) {
      onLoadArtwork(selectedArtwork);
      onClose();
    }
  };

  const handleDelete = (id: string) => {
    deleteArtwork(id);
    setShowDeleteConfirm(null);
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-4 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            {"\uD83D\uDDBC\uFE0F"} My Gallery
          </h2>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-xl transition-all"
            aria-label="Close gallery"
          >
            {"\u2715"}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {savedArtworks.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">{"\uD83C\uDFA8"}</div>
              <h3 className="text-xl font-bold text-gray-700 mb-2">
                No Artwork Yet!
              </h3>
              <p className="text-gray-500">
                Draw something awesome and save it to see it here!
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {savedArtworks.map((artwork) => (
                <div
                  key={artwork.id}
                  className={`
                    relative group rounded-xl overflow-hidden border-4 transition-all cursor-pointer
                    ${
                      selectedId === artwork.id
                        ? "border-blue-500 ring-4 ring-blue-200"
                        : "border-gray-200 hover:border-gray-300"
                    }
                  `}
                  onClick={() => setSelectedId(artwork.id)}
                >
                  {/* Thumbnail */}
                  <div className="aspect-square bg-gray-100">
                    <img
                      src={artwork.thumbnail}
                      alt={artwork.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Info overlay */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                    <p className="text-white font-medium text-sm truncate">
                      {artwork.name}
                    </p>
                    <p className="text-white/70 text-xs">
                      {formatDate(artwork.editedAt)}
                    </p>
                  </div>

                  {/* Delete button — hover-revealed on desktop, but fingers
                      can't hover: on coarse pointers it stays visible */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(artwork.id);
                    }}
                    className={`absolute top-2 right-2 w-11 h-11 rounded-full bg-red-500 text-white transition-opacity flex items-center justify-center text-sm hover:bg-red-600 ${
                      isCoarsePointer
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                    aria-label="Delete artwork"
                  >
                    {"\uD83D\uDDD1\uFE0F"}
                  </button>

                  {/* Selection checkmark */}
                  {selectedId === artwork.id && (
                    <div className="absolute top-2 left-2 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center">
                      {"\u2713"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {savedArtworks.length > 0 && (
          <div className="p-4 bg-gray-50 border-t border-gray-200 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-700 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleLoad}
              disabled={!selectedArtwork}
              className={`
                flex-1 py-3 px-4 rounded-xl font-bold transition-all
                ${
                  selectedArtwork
                    ? "bg-blue-500 hover:bg-blue-600 text-white"
                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }
              `}
            >
              {"\uD83D\uDCE5"} Load Selected
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">{"\u26A0\uFE0F"}</div>
              <h3 className="text-xl font-bold text-gray-800">Delete Artwork?</h3>
              <p className="text-gray-600 mt-2">
                Are you sure you want to delete this artwork? This cannot be undone!
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 py-3 rounded-xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-700 transition-all"
              >
                Keep It
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 font-bold text-white transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
