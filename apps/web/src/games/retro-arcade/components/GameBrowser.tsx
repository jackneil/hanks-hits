"use client";

import { useState, useMemo } from "react";

// Generic catalog game interface - works with both SNES and Atari catalogs
export interface CatalogGame {
  id: string;
  displayName: string;
  filename: string;
  genre: string;
  favorite: boolean;
}

interface GameBrowserProps {
  catalog: CatalogGame[];
  getRomUrl: (game: CatalogGame) => string;
  systemName: string;
  onGameSelect: (game: CatalogGame, romUrl: string) => void;
  onUploadClick: () => void;
  favoriteIds: string[];
  onToggleFavorite: (gameId: string) => void;
}

// Genre colors for visual variety - covers both SNES and Atari genres
const GENRE_COLORS: Record<string, string> = {
  rpg: "from-purple-600 to-purple-800",
  platformer: "from-blue-600 to-blue-800",
  action: "from-red-600 to-red-800",
  fighting: "from-orange-600 to-orange-800",
  adventure: "from-green-600 to-green-800",
  racing: "from-yellow-500 to-yellow-700",
  puzzle: "from-pink-600 to-pink-800",
  sports: "from-emerald-600 to-emerald-800",
  shooter: "from-cyan-600 to-cyan-800",
  strategy: "from-indigo-600 to-indigo-800",
};

const GENRE_LABELS: Record<string, string> = {
  rpg: "RPG",
  platformer: "Platformer",
  action: "Action",
  fighting: "Fighting",
  adventure: "Adventure",
  racing: "Racing",
  puzzle: "Puzzle",
  sports: "Sports",
  shooter: "Shooter",
  strategy: "Strategy",
};

// Get color for a genre, with fallback for unknown genres
function getGenreColor(genre: string): string {
  return GENRE_COLORS[genre] || "from-gray-600 to-gray-800";
}

// Get label for a genre, with fallback
function getGenreLabel(genre: string): string {
  return GENRE_LABELS[genre] || genre.charAt(0).toUpperCase() + genre.slice(1);
}

// Individual game card - big and clickable for kids
function GameCard({
  game,
  onClick,
  isFavorite,
  onToggleFavorite,
  isLoading,
}: {
  game: CatalogGame;
  onClick: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isLoading: boolean;
}) {
  return (
    <div
      className={`
        relative bg-gradient-to-br ${getGenreColor(game.genre)}
        rounded-xl shadow-lg
        hover:scale-105 active:scale-95
        transition-all duration-150 cursor-pointer
        border-2 border-white/20 hover:border-white/40
        min-h-[120px] sm:min-h-[130px]
        touch-manipulation
      `}
    >
      <button
        type="button"
        onClick={onToggleFavorite}
        className={`absolute right-2 top-2 z-10 h-8 w-8 rounded-full text-lg font-bold transition-colors ${
          isFavorite
            ? "bg-yellow-300 text-gray-900"
            : "bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
        }`}
        aria-label={
          isFavorite
            ? `Remove ${game.displayName} from favorites`
            : `Add ${game.displayName} to favorites`
        }
      >
        {isFavorite ? "★" : "☆"}
      </button>

      <button
        onClick={onClick}
        disabled={isLoading}
        className="
          h-full min-h-[120px] w-full rounded-xl p-4
          flex flex-col items-center text-center
          disabled:opacity-50 disabled:cursor-wait
        "
      >
        {/* Loading spinner */}
        {isLoading ? (
          <div className="text-3xl mb-2 animate-spin">⏳</div>
        ) : (
          <div className="text-3xl mb-2">🎮</div>
        )}

        {/* Game name */}
        <h3 className="text-xs sm:text-sm font-bold text-white leading-tight line-clamp-2">
          {game.displayName}
        </h3>

        {/* Genre badge */}
        <span className="mt-auto pt-1 text-[10px] sm:text-xs text-white/60 capitalize">
          {getGenreLabel(game.genre)}
        </span>
      </button>
    </div>
  );
}

export function GameBrowser({
  catalog,
  getRomUrl,
  systemName,
  onGameSelect,
  onUploadClick,
  favoriteIds,
  onToggleFavorite,
}: GameBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string>("all");
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // Get all unique genres from catalog
  const genres = useMemo(() => {
    const genreSet = new Set(catalog.map((g) => g.genre));
    return Array.from(genreSet).sort();
  }, [catalog]);

  // Filter games
  const filteredGames = useMemo(() => {
    let result = [...catalog];

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((g) => g.displayName.toLowerCase().includes(q));
    }

    // Genre filter
    if (selectedGenre === "favorites") {
      result = result.filter((g) => favoriteIdSet.has(g.id));
    }

    if (selectedGenre !== "all" && selectedGenre !== "favorites") {
      result = result.filter((g) => g.genre === selectedGenre);
    }

    // Sort: user favorites first, then catalog featured games, then alphabetical
    return result.sort((a, b) => {
      const aIsFavorite = favoriteIdSet.has(a.id);
      const bIsFavorite = favoriteIdSet.has(b.id);
      if (aIsFavorite && !bIsFavorite) return -1;
      if (!aIsFavorite && bIsFavorite) return 1;
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [catalog, favoriteIdSet, searchQuery, selectedGenre]);

  const handleGameClick = (game: CatalogGame) => {
    setLoadingGameId(game.id);
    const romUrl = getRomUrl(game);
    // Small delay to show loading state
    setTimeout(() => {
      onGameSelect(game, romUrl);
    }, 100);
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-2 sm:px-4">
      {/* Search bar - BIG for kids */}
      <div className="mb-4 sm:mb-6">
        <input
          type="text"
          placeholder={`Search ${systemName} games...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="
            w-full px-4 py-3 text-lg rounded-xl
            bg-white/10 border-2 border-white/20
            text-white placeholder-white/50
            focus:border-white/40 focus:outline-none
            transition-colors
          "
        />
      </div>

      {/* Genre filter - scrollable on mobile */}
      <div className="mb-4 sm:mb-6 overflow-x-auto pb-2 -mx-2 px-2">
        <div className="flex gap-2 min-w-max">
          <button
            onClick={() => setSelectedGenre("all")}
            className={`
              px-3 sm:px-4 py-2 rounded-lg font-bold text-sm sm:text-base
              transition-colors whitespace-nowrap
              ${
                selectedGenre === "all"
                  ? "bg-blue-600 text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }
            `}
          >
            All ({catalog.length})
          </button>
          <button
            onClick={() => setSelectedGenre("favorites")}
            className={`
              px-3 sm:px-4 py-2 rounded-lg font-bold text-sm sm:text-base
              transition-colors whitespace-nowrap
              ${
                selectedGenre === "favorites"
                  ? "bg-yellow-500 text-gray-950"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              }
            `}
          >
            Favorites ({favoriteIds.length})
          </button>
          {genres.map((genre) => {
            const count = catalog.filter((g) => g.genre === genre).length;
            return (
              <button
                key={genre}
                onClick={() => setSelectedGenre(genre)}
                className={`
                  px-3 sm:px-4 py-2 rounded-lg font-bold text-sm sm:text-base
                  transition-colors whitespace-nowrap
                  ${
                    selectedGenre === genre
                      ? "bg-blue-600 text-white"
                      : "bg-white/10 text-white/70 hover:bg-white/20"
                  }
                `}
              >
                {getGenreLabel(genre)} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Upload your own button */}
      <button
        onClick={onUploadClick}
        className="
          mb-4 sm:mb-6 w-full p-3 sm:p-4
          border-2 border-dashed border-white/30
          rounded-xl text-white/70
          hover:border-white/50 hover:text-white
          transition-colors flex items-center justify-center gap-2
        "
      >
        <span className="text-xl sm:text-2xl">+</span>
        <span className="text-sm sm:text-base">Upload Your Own ROM</span>
      </button>

      {/* Games grid - responsive columns (2 on tiny screens for bigger touch targets) */}
      <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
        {filteredGames.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            onClick={() => handleGameClick(game)}
            isFavorite={favoriteIdSet.has(game.id)}
            onToggleFavorite={() => onToggleFavorite(game.id)}
            isLoading={loadingGameId === game.id}
          />
        ))}
      </div>

      {/* No results */}
      {filteredGames.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔍</div>
          <p className="text-white/60 text-xl">No games found</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setSelectedGenre("all");
            }}
            className="mt-4 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Game count */}
      <div className="mt-6 text-center text-white/40 text-sm">
        {filteredGames.length} of {catalog.length} games
      </div>
    </div>
  );
}

export default GameBrowser;
