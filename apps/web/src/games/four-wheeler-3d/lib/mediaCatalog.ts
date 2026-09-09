export type MediaTheme =
  | "forest"
  | "race"
  | "snow"
  | "ocean"
  | "city"
  | "toys"
  | "magic"
  | "space"
  | "lab"
  | "sport"
  | "blocks";
export type PretendVideo = {
  id: string;
  title: string;
  channelId: string;
  theme: MediaTheme;
  scene: readonly string[];
  duration: number;
};
export type PretendChannel = {
  id: string;
  label: string;
  icon: string;
  theme: MediaTheme;
  videos: readonly PretendVideo[];
};

const disneyRows: [string, string, MediaTheme, string[]][] = [
  ["lion-king", "The Lion King", "forest", ["🦁", "🌅", "🌳", "👑"]],
  ["cars", "Cars", "race", ["🏎️", "🏁", "🔧", "🏆"]],
  ["frozen", "Frozen", "snow", ["❄️", "⛄", "🏔️", "✨"]],
  ["moana", "Moana", "ocean", ["🌊", "⛵", "🌴", "⭐"]],
  ["spider-man", "Spider-Man", "city", ["🕷️", "🏙️", "🕸️", "🌟"]],
  ["toy-story", "Toy Story", "toys", ["🧸", "🚀", "🪁", "🤠"]],
  ["avengers", "The Avengers", "city", ["🦸", "🛡️", "⚡", "🌍"]],
  ["finding-nemo", "Finding Nemo", "ocean", ["🐠", "🪸", "🐢", "🌊"]],
  ["encanto", "Encanto", "magic", ["✨", "🏠", "🌸", "🦋"]],
  ["star-wars", "Star Wars", "space", ["⭐", "🚀", "🪐", "🤖"]],
];
export const DISNEY_VIDEOS: readonly PretendVideo[] = disneyRows.map(
  ([id, title, theme, scene]) => ({
    id: `disney-${id}`,
    title,
    theme,
    scene,
    channelId: "disney",
    duration: 48,
  }),
);
const beast: [string, string[]][] = [
  ["Last to Leave the Giant Circle Wins $100,000!", ["⭕", "🤑", "😱", "🏆"]],
  ["I Built the World's Biggest LEGO Tower!", ["🧱", "🏗️", "😮", "🎉"]],
  ["Surviving 50 Hours Inside a Giant Maze!", ["🌀", "😰", "🔦", "🏁"]],
  ["$1,000,000 Hide & Seek Challenge!", ["🙈", "💵", "🔍", "🏆"]],
  ["I Gave a Stranger a Brand-New Car!", ["🚗", "🎁", "😄", "💖"]],
  ["Last to Stop Running Wins $50,000!", ["🏃", "💨", "😅", "💰"]],
  ["I Filled My Friend's House with Slime!", ["🟢", "🏠", "😂", "🪣"]],
  ["Giving Away 100 Bikes to Kids!", ["🚲", "🎁", "😍", "🎉"]],
  ["World's Largest Pizza Challenge!", ["🍕", "😋", "📏", "🏆"]],
  ["1,000 People vs the Coolest Treehouse!", ["🌳", "🏠", "😮", "👑"]],
];
const channelRows: [string, string, string, MediaTheme, string, string[]][] = [
  [
    "crunchlabs",
    "CrunchLabs",
    "🔬",
    "lab",
    "Build Box: Coolest Gadget Yet! 🔧",
    ["🔧", "⚙️", "🧪", "💡", "🚀"],
  ],
  ["mrbeast", "MrBeast", "🐻", "sport", "", []],
  [
    "mark-rober",
    "Mark Rober",
    "🚀",
    "lab",
    "Giant Backyard Experiment! 🚀",
    ["🚀", "🔬", "🐿️", "💥", "🎯"],
  ],
  [
    "dude-perfect",
    "Dude Perfect",
    "🏀",
    "sport",
    "Trick Shot Battle! 🏀",
    ["🏀", "🎯", "🏈", "😱", "🏆"],
  ],
  [
    "minecraft",
    "Minecraft",
    "⛏️",
    "blocks",
    "Building a Mega Base! ⛏️",
    ["⛏️", "🟩", "🧱", "💎", "🐷"],
  ],
  [
    "gaming",
    "Gaming Videos",
    "🎮",
    "blocks",
    "Awesome Video!",
    ["🎬", "📺", "😂", "🔥", "⭐"],
  ],
  [
    "animals",
    "Funny Animals",
    "🐕",
    "forest",
    "Awesome Video!",
    ["🎬", "📺", "😂", "🔥", "⭐"],
  ],
  [
    "stunts",
    "Car Stunts",
    "🚗",
    "race",
    "Awesome Video!",
    ["🎬", "📺", "😂", "🔥", "⭐"],
  ],
  [
    "dinosaurs",
    "Dinosaurs",
    "🦖",
    "forest",
    "Awesome Video!",
    ["🎬", "📺", "😂", "🔥", "⭐"],
  ],
  [
    "laugh",
    "Try Not to Laugh",
    "😂",
    "toys",
    "Awesome Video!",
    ["🎬", "📺", "😂", "🔥", "⭐"],
  ],
];
export const YOUTUBE_CHANNELS: readonly PretendChannel[] = channelRows.map(
  ([id, label, icon, theme, title, scene]) => ({
    id,
    label,
    icon,
    theme,
    videos:
      id === "mrbeast"
        ? beast.map(([title, scene], index) => ({
            id: `mrbeast-${index + 1}`,
            channelId: id,
            title,
            scene,
            theme: (
              [
                "sport",
                "blocks",
                "blocks",
                "forest",
                "race",
                "sport",
                "toys",
                "race",
                "toys",
                "forest",
              ] as const
            )[index],
            duration: 60,
          }))
        : [{ id: `${id}-1`, channelId: id, title, scene, theme, duration: 48 }],
  }),
);
export const MEDIA_VIDEOS = [
  ...DISNEY_VIDEOS,
  ...YOUTUBE_CHANNELS.flatMap((c) => c.videos),
];
export function findMedia(id: string | null): PretendVideo | undefined {
  return MEDIA_VIDEOS.find((v) => v.id === id);
}

export type MediaLibrary = {
  activeId: string | null;
  playing: boolean;
  progress: Record<string, number>;
  liked: string[];
  subscribed: string[];
};
export const createMediaLibrary = (): MediaLibrary => ({
  activeId: null,
  playing: false,
  progress: {},
  liked: [],
  subscribed: [],
});
export type MediaAction =
  | { type: "select"; id: string }
  | { type: "play" | "pause" | "like" | "subscribe" }
  | { type: "tick" | "seek"; seconds: number };
export function reduceMedia(
  s: MediaLibrary,
  action: MediaAction,
): MediaLibrary {
  if (action.type === "select") {
    const video = findMedia(action.id);
    if (!video) return s;
    const previous = s.progress[video.id] ?? 0;
    return {
      ...s,
      activeId: video.id,
      playing: true,
      progress: {
        ...s.progress,
        [video.id]: previous >= video.duration ? 0 : previous,
      },
    };
  }
  const video = findMedia(s.activeId);
  if (!video) return s;
  if (action.type === "pause") return { ...s, playing: false };
  if (action.type === "play")
    return {
      ...s,
      playing: true,
      progress: {
        ...s.progress,
        [video.id]:
          (s.progress[video.id] ?? 0) >= video.duration
            ? 0
            : (s.progress[video.id] ?? 0),
      },
    };
  if (action.type === "tick" || action.type === "seek") {
    if (
      !Number.isFinite(action.seconds) ||
      (action.type === "tick" && (!s.playing || action.seconds <= 0))
    )
      return s;
    const seconds =
      action.type === "seek"
        ? action.seconds
        : (s.progress[video.id] ?? 0) + Math.min(1, action.seconds);
    const progress = Math.max(0, Math.min(video.duration, seconds));
    return {
      ...s,
      playing: s.playing && progress < video.duration,
      progress: { ...s.progress, [video.id]: progress },
    };
  }
  const field = action.type === "like" ? "liked" : "subscribed",
    id = action.type === "like" ? video.id : video.channelId;
  return {
    ...s,
    [field]: s[field].includes(id)
      ? s[field].filter((v) => v !== id)
      : [...s[field], id],
  };
}
export const mediaTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
