# Graph Report - .  (2026-08-02)

## Corpus Check
- Large corpus: 592 files · ~698,613 words. Semantic extraction can be expensive. Full-repository scope was explicitly confirmed for this run.

## Summary
- 3031 nodes · 5662 edges · 244 communities (163 shown, 81 thin omitted)
- Extraction: 96.64% EXTRACTED · 3.32% INFERRED · 0.04% AMBIGUOUS · INFERRED: 188 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Health Warning
- Extraction diagnostics found 470 dangling-endpoint edges, 1 self-loop, 269 directed same-endpoint collapses, and 275 undirected same-endpoint collapses. The final graph has no missing endpoints, but it may omit or collapse source relationships. See `.graphify_health.json` for the complete diagnostic.

## Token Reduction Benchmark
- Corpus baseline: 151,550 words, approximately 202,066 tokens with naive full-corpus loading.
- Average graph query: approximately 7,694 tokens.
- Reduction: 26.3x fewer tokens per query.
- Per-question results:
  - 687.3x: `how does authentication work`
  - 7.1x: `what is the main entry point`
  - 169.5x: `what connects the data layer to the api`
  - 204.9x: `what are the core abstractions`

## Community Hubs (Navigation)
- Breakout Game
- Checkers Game
- Auth Sync and Weather
- Space Invaders Game
- Asteroids Game
- Retro Arcade Emulator
- Drawing App
- Bomberman Game
- Dino Runner Game
- Hextris Game
- Quoridor Game
- 2048 Game
- Cookie Clicker Game
- Snake Game
- Platformer Game
- Game Progress Schemas
- Endless Runner Game
- Wordle Game
- Virtual Pet
- Blitz Bomber Game
- Chess Game
- Monster Truck Game State
- Memory Match Game
- Claude Game-Building Instructions
- Drum Machine
- Web Runtime Dependencies
- Oregon Trail Types
- Web TypeScript Configuration
- Trivia App
- Arkanoid Game
- Workspace Package Configuration
- Web Development Dependencies
- Leaderboard API
- Achievement Evaluation
- API Rate Limiting
- Leaderboards UI
- Achievement Trophy UI
- Game Metadata Definitions
- Toy Finder App
- Hill Climb Physics
- Hill Climb Garage
- Oregon Trail UI
- Database Package Configuration
- Flappy Bird Game
- Math Attack Game
- Oregon Trail Game Logic
- Database Schema
- Player Profile Progress
- Joke Generator App
- Profile Game Details
- Profile Signup Validation
- Database TypeScript Configuration
- Game Design Documents
- Game Routing Metadata
- Game Registry
- Hill Climb Terrain
- Monster Truck Vehicle Physics
- Shared Game Components
- Four-Wheeler Adventure Audit
- Turbo Build Configuration
- Shared Game Shell
- Oregon Trail Hunting
- Shared Game Design
- Atari ROM Catalog Upload
- Progress API Validation
- Authentication UI
- Monster Truck Sound Manager
- Game Shelf Home
- Hill Climb Game UI
- Monster Truck Terrain
- Web Package Scripts
- Monster Truck Game World
- Monster Truck Controls
- Fullscreen Installation
- Next.js App Configuration
- Monster Truck Environment
- Database Schema Migration
- SNES ROM Catalog Upload
- Hank's Hits Architecture
- Game Metadata Generation
- Progress Merge Logic
- Test Environment Setup
- Quoridor Game Interface
- Hill Climb Terrain Generation
- Monster Truck Collectibles
- WebGL Capability Gate
- 2048 Game Interface
- Breakout Game Interface
- Checkers Game Interface
- Cookie Clicker Interface
- Hank's Hopper Gameplay
- Drum Machine Interface
- Toy Finder Interface
- Blitz Bomber Interface
- Cookie Clicker Fixed Interface
- Flappy Bird Interface
- Oregon Trail Events
- Virtual Pet Interface
- Asteroids Game Interface
- Breakout Fixed Interface
- Dino Runner Interface
- Endless Runner Interface
- Hextris Game Interface
- Hill Climb Results
- Memory Match Interface
- Hank's Hopper Orientation
- Snake Game Interface
- Trophy Toast Joke Generator
- Leaderboard Components
- Drawing App Interface
- Joke Generator Interface
- Game Leaderboards Interface
- Arkanoid Game Interface
- Chess Game Interface
- Hill Climb Gameplay
- Hill Climb Garage
- Monster Truck Gameplay
- Populated Game Shelf
- Desktop Game Shelf
- Space Invaders Interface
- Gaming Profile Authentication
- Hill Climb Controls
- Hill Climb Helpers
- Oregon Trail Travel Scene
- Drum Machine Interface
- Trivia Quiz Completion
- Weather Buddy Interface
- Asteroids Game Interface
- Blitz Bomber Gameplay
- Bomberman Game Interface
- Bomberman Fixed Layout
- Four-Wheeler Adventure
- Four-Wheeler Fixed Layout
- Guest Trophy Case
- Hextris Game Interface
- Hextris Game Over
- Hank's Hopper Contrast
- Empty Games Shelf
- Populated Games Shelf
- Profile Achievement Tiers
- Joke Generator Trophy Toast
- Trivia Quiz Trophy Unlock
- Platform Route Surface
- Home Game Registry
- Profile Authentication
- Hill Climb Orientation
- Math Attack Gameplay
- Oregon Trail Gameplay
- Retro Arcade Controls
- Trophy Case Achievements
- Wordle Game Interface
- Bomberman Landscape Board
- Landscape Navigation Header
- Trophy Storage Sync
- Retro Arcade Loading
- Globe Asset
- Window Asset
- Drawing App Page
- Drum Machine Page
- Joke Generator Page
- Toy Finder Page
- Trivia App Page
- Virtual Pet Page
- Arkanoid Game Page
- Asteroids Game Page
- Blitz Bomber Page
- Bomberman Game Page
- Breakout Game Page
- Checkers Game Page
- Chess Game Page
- Cookie Clicker Page
- Dino Runner Page
- Endless Runner Page
- Flappy Bird Page
- Four-Wheeler Adventure Page
- Hextris Game Page
- Hill Climb Game Page
- Math Attack Game Page
- Memory Match Game Page
- Monster Truck Game Page
- Oregon Trail Game Page
- Platformer Game Page
- Quoridor Game Page
- Retro Arcade Game
- Snake Game
- Space Invaders Game
- Wordle Game
- Four Wheeler Adventure
- Shared Game Design
- Pre-Push Hook
- Game Regression Testing
- Progress and Leaderboards
- QA and UX Skills
- ESLint Configuration
- DaisyUI Framework
- React Framework
- Zustand State Management
- JSDOM Testing
- Tailwind CSS
- React Testing Library
- Node.js Type Definitions
- Three.js Type Definitions
- TypeScript Compiler
- Vitest Testing
- PostCSS Configuration
- Next.js Logo Asset
- Toy Finder Metadata
- Asteroids Metadata
- Chess Metadata
- Endless Runner Metadata
- Hextris Metadata
- Math Attack Metadata
- Quoridor Metadata
- Retro Arcade Metadata
- Snake Metadata
- Space Invaders Metadata
- Wordle Metadata
- Chess and Checkers Design
- Off-Road Driving Games
- Pre-Commit Hook
- Authentication Rate Limiting
- Release Skill
- What's Next Skill
- Web pnpm Workspace
- File Document Icon
- Delivery Truck App Icon
- Vercel Logo Asset
- NextAuth API Route
- Checkers Difficulty Selection
- Jeep Vehicle Asset
- Monster Truck Vehicle Asset
- Motorbike Vehicle Asset
- Quad Bike Vehicle Asset
- Drum Machine Design
- Oregon Trail Design
- Hank's Hopper Platformer
- Quoridor Design
- pnpm Workspace Configuration

## God Nodes (most connected - your core abstractions)
1. `useAuthSync()` - 73 edges
2. `GameShell()` - 38 edges
3. `GameMetadata` - 33 edges
4. `IOSInstallPrompt()` - 32 edges
5. `useOregonTrailStore` - 28 edges
6. `useCoarsePointer()` - 24 edges
7. `HillClimbGame()` - 23 edges
8. `getTerrainHeight()` - 20 edges
9. `useHillClimbStore` - 17 edges
10. `useGameStore` - 17 edges

## Surprising Connections (you probably didn't know these)
- `GET()` --references--> `VALID_APP_IDS`  [EXTRACTED]
  apps/web/src/app/api/leaderboards/[appId]/route.ts → packages/db/src/schema/app-progress.ts
- `Docs Sync Command` --references--> `Claude Instructions for Hank's Hits`  [EXTRACTED]
  .claude/commands/docs-sync.md → CLAUDE.md
- `Roadmap Advisor Command` --references--> `Claude Instructions for Hank's Hits`  [EXTRACTED]
  .claude/commands/whats-next.md → CLAUDE.md
- `Session Lessons` --references--> `Browser Render Verification`  [EXTRACTED]
  lessons.md → .claude/skills/play-my-game/SKILL.md
- `Make a Game Skill` --references--> `Compartmentalized Feature Islands`  [EXTRACTED]
  .claude/skills/make-a-game/SKILL.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Build Verify and Show Flow** — claude_skills_make_a_game_skill, claude_skills_play_my_game_skill, claude_skills_mobile_playability_skill, claude_browser_verification [INFERRED 0.85]
- **Game Lifecycle Skills** — claude_skills_make_a_game_skill, claude_skills_change_a_game_skill, claude_skills_oops_go_back_skill, claude_skills_play_my_game_skill, claude_skills_put_it_online_skill [EXTRACTED 1.00]
- **Kid-Friendly Games and Apps** — design_apps_drawing_app_document, design_apps_joke_generator_document, design_apps_toy_finder_document, design_apps_weather_document, design_games_2048_document, design_games_arkanoid_document [INFERRED 0.85]
- **Shared Platform Persistence Surfaces** — design_architecture_document, design_achievements_document, design_my_games_shelf_document, design_apps_toy_finder_document, design_games_2048_document [INFERRED 0.85]
- **Web Game Design Portfolio** — design_games_asteroids, design_games_blitz_bomber, design_games_bomberman, design_games_breakout, design_games_dino_runner, design_games_flappy_bird, design_games_snake [EXTRACTED 1.00]
- **Persistent Kid-Focused Apps** — design_games_cookie_clicker, design_games_endless_runner, design_games_memory_match, design_games_retro_arcade, design_games_space_invaders, design_games_virtual_pet [INFERRED 0.85]
- **Behavior Specification Quality Loop** — graphify_out_converted_behavior_spec_ed8c3838_progress_sync, graphify_out_converted_behavior_spec_ed8c3838_leaderboards, graphify_out_converted_behavior_spec_ed8c3838_game_regressions, graphify_out_converted_behavior_spec_ed8c3838_test_infrastructure [INFERRED 0.75]
- **2048 Gameplay Controls and State** — design_audits_screenshots_2048_score_display, design_audits_screenshots_2048_best_score_display, design_audits_screenshots_2048_tile_grid, design_audits_screenshots_2048_undo_button, design_audits_screenshots_2048_new_game_button [EXTRACTED 1.00]
- **Drawing Workflow Controls** — design_audits_screenshots_apps_drawing_app_touch_drawing_canvas, design_audits_screenshots_apps_drawing_app_touch_brush_tool, design_audits_screenshots_apps_drawing_app_touch_pencil_tool, design_audits_screenshots_apps_drawing_app_touch_eraser_tool [EXTRACTED 1.00]
- **Step Pattern Composition** — design_audits_screenshots_apps_drum_machine_fixed_sixteen_step_grid, design_audits_screenshots_apps_drum_machine_fixed_drum_instrument_tracks, design_audits_screenshots_apps_drum_machine_fixed_hip_hop_pattern [INFERRED 0.85]
- **Interactive Beat Creation** — design_audits_screenshots_apps_drum_machine_touch_sequencer_grid, design_audits_screenshots_apps_drum_machine_touch_drum_pads, design_audits_screenshots_apps_drum_machine_touch_transport_controls, design_audits_screenshots_apps_drum_machine_touch_record_workflow [INFERRED 0.85]
- **Joke Discovery Flow** — design_audits_screenshots_apps_joke_generator_touch_joke_categories, design_audits_screenshots_apps_joke_generator_touch_joke_prompt_card, design_audits_screenshots_apps_joke_generator_touch_punchline_reveal, design_audits_screenshots_apps_joke_generator_touch_tell_me_a_joke_action [INFERRED 0.85]
- **Cookie Clicker Leaderboard Interaction Flow** — design_audits_screenshots_apps_leaderboards_touch_cookie_clicker, design_audits_screenshots_apps_leaderboards_touch_time_filter, design_audits_screenshots_apps_leaderboards_touch_retry_action, design_audits_screenshots_apps_leaderboards_touch_play_cta [INFERRED 0.75]
- **Sign In Options** — design_audits_screenshots_apps_profile_touch_google_sign_in, design_audits_screenshots_apps_profile_touch_email_password_sign_in, design_audits_screenshots_apps_profile_touch_authentication_screen [EXTRACTED 1.00]
- **Toy Finder Product Card Pattern** — design_audits_screenshots_apps_toy_finder_touch_super_smash_bros_ultimate, design_audits_screenshots_apps_toy_finder_touch_roblox_gift_card_2000_robux, design_audits_screenshots_apps_toy_finder_touch_nerf_elite_20_commander, design_audits_screenshots_apps_toy_finder_touch_nerf_mega_mastodon [EXTRACTED 1.00]
- **Quiz Completion Summary Flow** — design_audits_screenshots_apps_trivia_touch_quiz_completion, design_audits_screenshots_apps_trivia_touch_score_summary, design_audits_screenshots_apps_trivia_touch_play_again [INFERRED 0.85]
- **Virtual Pet Care System** — design_audits_screenshots_apps_virtual_pet_touch_virtual_pet, design_audits_screenshots_apps_virtual_pet_touch_care_metrics, design_audits_screenshots_apps_virtual_pet_touch_streak_tracking, design_audits_screenshots_apps_virtual_pet_touch_pet_interactions [INFERRED 0.75]
- **Weather Dashboard** — design_audits_screenshots_apps_weather_touch_london_weather, design_audits_screenshots_apps_weather_touch_current_conditions, design_audits_screenshots_apps_weather_touch_clothing_recommendations [EXTRACTED 1.00]
- **Arkanoid Game Over Summary** — design_audits_screenshots_arkanoid_arkanoid_game, design_audits_screenshots_arkanoid_game_over_state, design_audits_screenshots_arkanoid_score, design_audits_screenshots_arkanoid_high_score, design_audits_screenshots_arkanoid_play_again_control [EXTRACTED 1.00]
- **Asteroids Game Screen UI** — design_audits_screenshots_asteroids_fixed_game_over_state, design_audits_screenshots_asteroids_fixed_score_wave_hud, design_audits_screenshots_asteroids_fixed_replay_prompt, design_audits_screenshots_asteroids_fixed_home_navigation, design_audits_screenshots_asteroids_fixed_best_wave_indicator, design_audits_screenshots_asteroids_fixed_leaderboard_navigation, design_audits_screenshots_asteroids_fixed_ship_control [INFERRED 0.85]
- **Asteroids Play Session** — design_audits_screenshots_asteroids_game_hud, design_audits_screenshots_asteroids_spaceship, design_audits_screenshots_asteroids_asteroid_field, design_audits_screenshots_asteroids_game_controls [INFERRED 0.85]
- **Gameplay HUD and Controls** — design_audits_screenshots_blitz_bomber_fixed_score_display, design_audits_screenshots_blitz_bomber_fixed_level_display, design_audits_screenshots_blitz_bomber_fixed_pause_control, design_audits_screenshots_blitz_bomber_fixed_home_control, design_audits_screenshots_blitz_bomber_fixed_trophy_control [INFERRED 0.95]
- **Bombing and Landing Gameplay Loop** — design_audits_screenshots_blitz_bomber_bomb_drop, design_audits_screenshots_blitz_bomber_building_destruction, design_audits_screenshots_blitz_bomber_safe_landing [EXTRACTED 1.00]
- **Mobile Bomberman Game Interface** — design_audits_screenshots_bomberman_fixed_game_hud, design_audits_screenshots_bomberman_fixed_maze_board, design_audits_screenshots_bomberman_fixed_directional_controls, design_audits_screenshots_bomberman_fixed_bomb_action [EXTRACTED 1.00]
- **Navigation Controls** — design_audits_screenshots_bomberman_landscape_menu_prefix_landscape_navigation_header, design_audits_screenshots_bomberman_landscape_menu_prefix_home_control, design_audits_screenshots_bomberman_landscape_menu_prefix_trophy_control, design_audits_screenshots_bomberman_landscape_menu_prefix_leaderboard_control [EXTRACTED 1.00]
- **Bomberman Gameplay Interface** — design_audits_screenshots_bomberman_grid_based_game_board, design_audits_screenshots_bomberman_bomb_mechanic, design_audits_screenshots_bomberman_directional_movement_controls, design_audits_screenshots_bomberman_game_statistics [EXTRACTED 1.00]
- **Breakout Gameplay Surface** — design_audits_screenshots_breakout_fixed_game_board, design_audits_screenshots_breakout_fixed_brick_layout, design_audits_screenshots_breakout_fixed_paddle_and_ball, design_audits_screenshots_breakout_fixed_score_level_lives [INFERRED 0.95]
- **Breakout Game Interface** — design_audits_screenshots_breakout_score_display, design_audits_screenshots_breakout_level_display, design_audits_screenshots_breakout_lives_display, design_audits_screenshots_breakout_brick_grid, design_audits_screenshots_breakout_paddle_and_ball [EXTRACTED 1.00]
- **Game Configuration Controls** — design_audits_screenshots_checkers_game_mode, design_audits_screenshots_checkers_rule_variant, design_audits_screenshots_checkers_difficulty [EXTRACTED 1.00]
- **Chess Game Interface** — design_audits_screenshots_chess_chessboard, design_audits_screenshots_chess_ai_thinking_state, design_audits_screenshots_chess_game_mode_controls, design_audits_screenshots_chess_difficulty_controls, design_audits_screenshots_chess_player_color_controls, design_audits_screenshots_chess_game_action_controls [EXTRACTED 1.00]
- **Cookie Clicker Game Systems** — design_audits_screenshots_cookie_clicker_fixed_cookie_click_interaction, design_audits_screenshots_cookie_clicker_fixed_upgrades_panel, design_audits_screenshots_cookie_clicker_fixed_buildings_panel [EXTRACTED 1.00]
- **Cookie Production System** — design_audits_screenshots_cookie_clicker_click_power, design_audits_screenshots_cookie_clicker_cps_bonus, design_audits_screenshots_cookie_clicker_cursor [INFERRED 0.85]
- **Dino Runner Game Interface** — design_audits_screenshots_dino_runner_dino_runner_game, design_audits_screenshots_dino_runner_play_button, design_audits_screenshots_dino_runner_jump_control, design_audits_screenshots_dino_runner_duck_control, design_audits_screenshots_dino_runner_high_score, design_audits_screenshots_dino_runner_game_stats [INFERRED 0.95]
- **Endless Runner Gameplay Interface** — design_audits_screenshots_endless_runner_player_character, design_audits_screenshots_endless_runner_distance_score, design_audits_screenshots_endless_runner_collectible_coins, design_audits_screenshots_endless_runner_gameplay_obstacle [EXTRACTED 1.00]
- **Flappy Bird Gameplay Elements** — design_audits_screenshots_flappy_bird_player_bird, design_audits_screenshots_flappy_bird_pipe_obstacles, design_audits_screenshots_flappy_bird_score_display, design_audits_screenshots_flappy_bird_game_statistics [EXTRACTED 1.00]
- **Four-Wheeler Adventure Controls** — design_audits_screenshots_four_wheeler_adventure_get_on_trailer, design_audits_screenshots_four_wheeler_adventure_camera, design_audits_screenshots_four_wheeler_adventure_map, design_audits_screenshots_four_wheeler_adventure_get_out_and_walk, design_audits_screenshots_four_wheeler_adventure_start_the_race, design_audits_screenshots_four_wheeler_adventure_bail_out, design_audits_screenshots_four_wheeler_adventure_nos, design_audits_screenshots_four_wheeler_adventure_garage_door, design_audits_screenshots_four_wheeler_adventure_hitch, design_audits_screenshots_four_wheeler_adventure_switch, design_audits_screenshots_four_wheeler_adventure_lights, design_audits_screenshots_four_wheeler_adventure_phone, design_audits_screenshots_four_wheeler_adventure_feed_dog, design_audits_screenshots_four_wheeler_adventure_hunting_inventory, design_audits_screenshots_four_wheeler_adventure_ask_helper, design_audits_screenshots_four_wheeler_adventure_jump, design_audits_screenshots_four_wheeler_adventure_speedometer [EXTRACTED 1.00]
- **Interactive Four-Wheeler Adventure Interface** — design_audits_screenshots_four_wheeler_driving_racing_gameplay, design_audits_screenshots_four_wheeler_driving_vehicle_controls, design_audits_screenshots_four_wheeler_driving_race_actions [INFERRED 0.95]
- **Four-Wheeler Gameplay Interface** — design_audits_screenshots_four_wheeler_fixed_vehicle_controls, design_audits_screenshots_four_wheeler_fixed_race_controls, design_audits_screenshots_four_wheeler_fixed_navigation_controls, design_audits_screenshots_four_wheeler_fixed_game_world, design_audits_screenshots_four_wheeler_fixed_context_actions [EXTRACTED 1.00]
- **Trophy Progress Flow** — design_audits_screenshots_header_390_guest_trophies_guest_user, design_audits_screenshots_header_390_guest_trophies_empty_state, design_audits_screenshots_header_390_guest_trophies_game_play_progress [INFERRED 0.75]
- **Gameplay Interface** — design_audits_screenshots_hextris_game_status, design_audits_screenshots_hextris_score_tracking, design_audits_screenshots_hextris_hexagonal_playfield, design_audits_screenshots_hextris_rotation_controls, design_audits_screenshots_hextris_pause_control, design_audits_screenshots_hextris_audio_control [INFERRED 0.85]
- **Hextris Interface Components** — design_audits_screenshots_hextris_post_hexagonal_puzzle_board, design_audits_screenshots_hextris_post_rotation_controls, design_audits_screenshots_hextris_post_game_status_hud, design_audits_screenshots_hextris_post_pause_control [EXTRACTED 1.00]
- **Hextris Game-Over State Summary** — design_audits_screenshots_hextris_pre_hextris_game, design_audits_screenshots_hextris_pre_game_over_state, design_audits_screenshots_hextris_pre_score_24, design_audits_screenshots_hextris_pre_replay_action [EXTRACTED 1.00]
- **Crash Result Summary and Recovery Options** — design_audits_screenshots_hill_climb_desktop_crash_result_screen, design_audits_screenshots_hill_climb_desktop_distance_metric, design_audits_screenshots_hill_climb_desktop_coin_reward_summary, design_audits_screenshots_hill_climb_desktop_retry_action, design_audits_screenshots_hill_climb_desktop_garage_navigation, design_audits_screenshots_hill_climb_desktop_home_navigation [EXTRACTED 1.00]
- **Orientation Guidance Flow** — design_audits_screenshots_hill_climb_fixed_screenshot, design_audits_screenshots_hill_climb_fixed_rotate_phone_instruction, design_audits_screenshots_hill_climb_fixed_landscape_mode, design_audits_screenshots_hill_climb_fixed_continue_in_portrait [EXTRACTED 1.00]
- **Vehicle Options in Garage** — design_audits_screenshots_hill_climb_garage_via_touch_pause_vehicle_selection, design_audits_screenshots_hill_climb_garage_via_touch_pause_jeep, design_audits_screenshots_hill_climb_garage_via_touch_pause_motorbike, design_audits_screenshots_hill_climb_garage_via_touch_pause_monster_truck, design_audits_screenshots_hill_climb_garage_via_touch_pause_quad_bike [EXTRACTED 1.00]
- **Hill Climb Gameplay Controls and HUD** — design_audits_screenshots_hill_climb_brake_control, design_audits_screenshots_hill_climb_gas_control, design_audits_screenshots_hill_climb_speed_indicator, design_audits_screenshots_hill_climb_distance_record, design_audits_screenshots_hill_climb_currency_counter [EXTRACTED 1.00]
- **Math Attack Gameplay Interface** — design_audits_screenshots_math_attack_arithmetic_expressions, design_audits_screenshots_math_attack_score, design_audits_screenshots_math_attack_lives, design_audits_screenshots_math_attack_answer_input [EXTRACTED 1.00]
- **Memory Match Interface** — design_audits_screenshots_memory_match_medium_difficulty, design_audits_screenshots_memory_match_animals_theme, design_audits_screenshots_memory_match_card_grid, design_audits_screenshots_memory_match_game_stats, design_audits_screenshots_memory_match_new_game_control [EXTRACTED 1.00]
- **Gameplay Controls and Status UI** — design_audits_screenshots_monster_truck_score_display, design_audits_screenshots_monster_truck_nitrous_boost, design_audits_screenshots_monster_truck_brake_control, design_audits_screenshots_monster_truck_gas_control [INFERRED 0.95]
- **Gameplay Dashboard** — design_audits_screenshots_oregon_trail_travel_progress, design_audits_screenshots_oregon_trail_resource_tracking, design_audits_screenshots_oregon_trail_river_crossing [EXTRACTED 1.00]
- **Platformer Gameplay UI Elements** — design_audits_screenshots_platformer_contrast_fix_score_display, design_audits_screenshots_platformer_contrast_fix_gameplay_controls, design_audits_screenshots_platformer_contrast_fix_collectibles [INFERRED 0.95]
- **Orientation Prompt and Game Controls** — design_audits_screenshots_platformer_fixed_rotate_phone_prompt, design_audits_screenshots_platformer_fixed_continue_portrait_anyway, design_audits_screenshots_platformer_fixed_pause_control, design_audits_screenshots_platformer_fixed_jump_control [EXTRACTED 1.00]
- **Gameplay HUD and Controls** — design_audits_screenshots_platformer_score_hud, design_audits_screenshots_platformer_level_label, design_audits_screenshots_platformer_timer, design_audits_screenshots_platformer_pause_control, design_audits_screenshots_platformer_fullscreen_control [INFERRED 0.95]
- **Quoridor Gameplay Controls** — design_audits_screenshots_quoridor_move_pawn_action, design_audits_screenshots_quoridor_place_wall_action, design_audits_screenshots_quoridor_new_game_control [INFERRED 0.85]
- **Quoridor Game State Summary** — design_audits_screenshots_quoridor_turn_indicator, design_audits_screenshots_quoridor_player_scores, design_audits_screenshots_quoridor_pawns [INFERRED 0.95]
- **On-Screen Controller Layout** — design_audits_screenshots_retro_arcade_fixed_virtual_game_controls, design_audits_screenshots_retro_arcade_fixed_navigation_controls, design_audits_screenshots_retro_arcade_fixed_action_buttons [EXTRACTED 1.00]
- **Retro Arcade Loading Screen Elements** — design_audits_screenshots_retro_arcade_retro_arcade_screen, design_audits_screenshots_retro_arcade_emulator_loading_state, design_audits_screenshots_retro_arcade_arcade_navigation_header, design_audits_screenshots_retro_arcade_game_controller_visual [EXTRACTED 1.00]
- **Empty State to Game Creation Flow** — design_audits_screenshots_shelf_390_empty_invite_hanks_hits_home_screen, design_audits_screenshots_shelf_390_empty_invite_empty_my_games_shelf, design_audits_screenshots_shelf_390_empty_invite_build_invitation [INFERRED 0.85]
- **Visible game collection** — design_audits_screenshots_shelf_390_populated_my_games, design_audits_screenshots_shelf_390_populated_four_wheeler_adventure, design_audits_screenshots_shelf_390_populated_snake [EXTRACTED 1.00]
- **Desktop game shelf context** — design_audits_screenshots_shelf_desktop_myland_stat_my_games, design_audits_screenshots_shelf_desktop_myland_stat_four_wheeler_adventure, design_audits_screenshots_shelf_desktop_myland_stat_my_land_two_plots [EXTRACTED 1.00]
- **Populated My Games Shelf** — design_audits_screenshots_shelf_desktop_populated_my_games_shelf, design_audits_screenshots_shelf_desktop_populated_four_wheeler_adventure, design_audits_screenshots_shelf_desktop_populated_snake [EXTRACTED 1.00]
- **Snake Gameplay Interface** — design_audits_screenshots_snake_game_board, design_audits_screenshots_snake_score_hud, design_audits_screenshots_snake_directional_controls, design_audits_screenshots_snake_pause_control [EXTRACTED 1.00]
- **Gameplay Screen Components** — design_audits_screenshots_space_invaders_game_hud, design_audits_screenshots_space_invaders_alien_invaders, design_audits_screenshots_space_invaders_player_cannon, design_audits_screenshots_space_invaders_defensive_shields [INFERRED 0.95]
- **Progressive Achievement Sections** — design_audits_screenshots_trophy_case_fixed_jokes_achievements, design_audits_screenshots_trophy_case_fixed_all_games_achievements, design_audits_screenshots_trophy_case_fixed_achievement_progression [INFERRED 0.85]
- **Profile Achievement System** — design_audits_screenshots_trophy_case_profile_trivia_quiz_achievements, design_audits_screenshots_trophy_case_profile_all_games_achievements, design_audits_screenshots_trophy_case_profile_progressive_achievement_tiers [EXTRACTED 1.00]
- **Joke Generator UI Flow** — design_audits_screenshots_trophy_toast_fixed_joke_generator, design_audits_screenshots_trophy_toast_fixed_joke_category_navigation, design_audits_screenshots_trophy_toast_fixed_punchline_reveal [INFERRED 0.75]
- **Joke Generator Interface** — design_audits_screenshots_trophy_toast_live_joke_generator, design_audits_screenshots_trophy_toast_live_joke_categories, design_audits_screenshots_trophy_toast_live_bicycle_joke_card, design_audits_screenshots_trophy_toast_live_show_punchline_action [EXTRACTED 1.00]
- **Quiz Screen Elements** — design_audits_screenshots_trophy_toast_unlock_trivia_quiz_interface, design_audits_screenshots_trophy_toast_unlock_quiz_progress, design_audits_screenshots_trophy_toast_unlock_achievement_trophy [EXTRACTED 1.00]
- **Wordle Gameplay Interface** — design_audits_screenshots_wordle_wordle_game, design_audits_screenshots_wordle_guess_grid, design_audits_screenshots_wordle_keyboard [EXTRACTED 1.00]

## Communities (244 total, 81 thin omitted)

### Community 0 - "Breakout Game"
Cohesion: 0.06
Nodes (69): BreakoutGameShell(), BreakoutGame(), GameCanvas(), SettingsPanel(), StatsDisplay(), touchXToCanvasX(), useCanvasRenderer(), Ball (+61 more)

### Community 1 - "Checkers Game"
Cohesion: 0.10
Nodes (58): Board(), GameUI(), Piece(), PieceProps, Square(), SquareProps, CheckersGame(), evaluateBoard() (+50 more)

### Community 2 - "Auth Sync and Weather"
Cohesion: 0.07
Nodes (49): DEFAULT_LOCATIONS, getKidFriendlyDescription(), getOutfitRecommendations(), getRandomFact(), mapWeatherCode(), WEATHER_API, WEATHER_FACTS, WEATHER_ICONS (+41 more)

### Community 3 - "Space Invaders Game"
Cohesion: 0.07
Nodes (42): drawAlien(), SoundManager, SpaceInvadersGame(), Alien, ALIEN_TYPES, AlienType, Bullet, CANVAS_HEIGHT (+34 more)

### Community 4 - "Asteroids Game"
Cohesion: 0.07
Nodes (52): AsteroidsGameShell(), AsteroidsGame(), useCanvasRenderer(), Asteroid, ASTEROID_SIZES, ASTEROIDS_PER_WAVE, AsteroidSize, Bullet (+44 more)

### Community 5 - "Retro Arcade Emulator"
Cohesion: 0.06
Nodes (41): CatalogGame, GameBrowser(), GameBrowserProps, GameCard(), GENRE_COLORS, GENRE_LABELS, getGenreColor(), getGenreLabel() (+33 more)

### Community 6 - "Drawing App"
Cohesion: 0.09
Nodes (37): BrushSettings(), Canvas(), CanvasProps, ColorPicker(), Gallery(), GalleryProps, Toolbar(), DrawingApp() (+29 more)

### Community 7 - "Bomberman Game"
Cohesion: 0.07
Nodes (46): BombermanGameShell(), BombermanGame(), BLOCK_DENSITY, BOMB_TIMER, COLORS, DEFAULT_BLAST_RANGE, DEFAULT_BOMB_COUNT, DEFAULT_SPEED (+38 more)

### Community 8 - "Dino Runner Game"
Cohesion: 0.08
Nodes (47): DinoRunnerGame(), drawCactus(), drawClouds(), drawDino(), drawGameOver(), drawGround(), drawPterodactyl(), drawScore() (+39 more)

### Community 9 - "Hextris Game"
Cohesion: 0.08
Nodes (43): HextrisGame(), useCanvasRenderer(), HextrisGameShell(), Block, BLOCK_COLORS, BLOCK_HEIGHT, BLOCK_WIDTH, BlockColor (+35 more)

### Community 10 - "Quoridor Game"
Cohesion: 0.10
Nodes (45): QuoridorGame(), AI_CONFIG, BOARD_SIZE, COLORS, createInitialPositions(), Difficulty, GameMode, GameStatus (+37 more)

### Community 11 - "2048 Game"
Cohesion: 0.09
Nodes (40): Controls(), Game2048(), GameOverOverlay(), Grid(), ScoreBoard(), Tile(), useKeyboardControls(), useSwipeControls() (+32 more)

### Community 12 - "Cookie Clicker Game"
Cohesion: 0.12
Nodes (38): AchievementPopups(), BuildingItem(), BuildingPanel(), CookieButton(), CookieClickerGame(), FloatingText(), GoldenCookie(), UpgradeItem() (+30 more)

### Community 13 - "Snake Game"
Cohesion: 0.10
Nodes (39): GameBoard(), GameUI(), MobileControls(), SettingsPanel(), SnakeGame(), StatsDisplay(), calculateNewHead(), CELL_SIZE (+31 more)

### Community 14 - "Platformer Game"
Cohesion: 0.10
Nodes (31): PlatformerGame(), CAMERA, CANVAS_HEIGHT, CANVAS_WIDTH, Cloud, COIN, CoinDef, Collectible (+23 more)

### Community 15 - "Game Progress Schemas"
Cohesion: 0.05
Nodes (41): achievementsSchema, arkanoidSchema, asteroidsSchema, blitzBomberSchema, bombermanSchema, boundedString, breakoutSchema, checkersSchema (+33 more)

### Community 16 - "Endless Runner Game"
Cohesion: 0.12
Nodes (25): EndlessRunnerGame(), CANVAS_HEIGHT, CANVAS_WIDTH, CharacterId, CHARACTERS, Cloud, COIN, CoinType (+17 more)

### Community 17 - "Wordle Game"
Cohesion: 0.13
Nodes (27): TutorialModal(), WordleGame(), Difficulty, DIFFICULTY_SETTINGS, DifficultySettings, getDifficultySettings(), KEYBOARD_ROWS, LETTER_COLORS (+19 more)

### Community 18 - "Virtual Pet"
Cohesion: 0.11
Nodes (26): calculateMood(), clamp(), COLORS, DECAY_RATES, EVOLUTION_DAYS, getMoodEmoji(), getStage(), MINIGAME_REWARD (+18 more)

### Community 19 - "Blitz Bomber Game"
Cohesion: 0.15
Nodes (24): BlitzBomberGameShell(), BlitzBomberGame(), DIFFICULTY_CHOICES, Bomb, Building, CANVAS_HEIGHT, CANVAS_WIDTH, COLORS (+16 more)

### Community 20 - "Chess Game"
Cohesion: 0.12
Nodes (24): ChessGame(), createGame(), evaluateBoard(), getAIMove(), getCapturedPieces(), getKingInCheckSquare(), getLastMove(), minimax() (+16 more)

### Community 21 - "Monster Truck Game State"
Cohesion: 0.10
Nodes (23): ChallengesPanel(), GameUI(), GameUIProps, PauseMenu(), Garage(), GarageProps, defaultChallenges, MonsterTruckGame() (+15 more)

### Community 22 - "Memory Match Game"
Cohesion: 0.13
Nodes (23): StatsBar(), WinModal(), calculateOptimalMoves(), calculateStars(), Card, COLORS, createCards(), DIFFICULTIES (+15 more)

### Community 23 - "Claude Game-Building Instructions"
Cohesion: 0.08
Nodes (31): Browser Render Verification, DCR Command, Docs Sync Command, Browser QA Command, Release Manager Command, UX Checks Command, Roadmap Advisor Command, Compartmentalized Feature Islands (+23 more)

### Community 24 - "Drum Machine"
Cohesion: 0.14
Nodes (23): DrumMachine(), SequencerGrid(), COLORS, createEmptyPattern(), DEFAULT_BPM, DRUM_KITS, DrumKit, DrumSound (+15 more)

### Community 25 - "Web Runtime Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, @auth/drizzle-adapter, bcryptjs, chess.js, @hank-neil/db, matter-js, next, next-auth (+21 more)

### Community 26 - "Oregon Trail Types"
Cohesion: 0.09
Nodes (26): TitleScreen(), ANIMALS, BULLETS_PER_BOX, FOOD_CONSUMPTION_PER_PERSON, HEALTH_DISPLAY, MONTH_NAMES, PACES, PARTY_SIZE (+18 more)

### Community 27 - "Web TypeScript Configuration"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 28 - "Trivia App"
Cohesion: 0.19
Nodes (19): getQuestions(), PreparedQuestion, prepareQuestion(), shuffleArray(), Difficulty, DIFFICULTY_SETTINGS, DifficultySettings, getDifficultySettings() (+11 more)

### Community 29 - "Arkanoid Game"
Cohesion: 0.16
Nodes (18): ArkanoidGameShell(), ArkanoidGame(), BALL_CONFIG, GAME, getSpawnedBallType(), GRID, PADDLE, PHYSICS (+10 more)

### Community 30 - "Workspace Package Configuration"
Cohesion: 0.07
Nodes (27): devDependencies, prettier, tsx, turbo, typescript, engines, node, turbo (+19 more)

### Community 31 - "Web Development Dependencies"
Cohesion: 0.07
Nodes (27): devDependencies, eslint, eslint-config-next, @tailwindcss/postcss, @testing-library/dom, @testing-library/jest-dom, @types/bcryptjs, @types/matter-js (+19 more)

### Community 32 - "Leaderboard API"
Cohesion: 0.13
Nodes (22): GET(), RouteContext, extractLeaderboardScore(), extractorKeys, getGameScoreType(), hasLeaderboardSupport(), LEADERBOARD_ENABLED_GAMES, LEADERBOARD_EXTRACTORS (+14 more)

### Community 33 - "Achievement Evaluation"
Cohesion: 0.11
Nodes (21): BEST_ALIASES, Copy, EXPLORER_COPY, EXPLORER_TIERS, PLAYS_ALIASES, PLAYS_COPY, PLAYS_TIERS, RECORD_COPY (+13 more)

### Community 34 - "API Rate Limiting"
Cohesion: 0.13
Nodes (14): GET(), GET(), checkLoginRateLimit(), checkProgressRateLimit(), checkRateLimit(), checkRomProxyRateLimit(), cleanupOldEntries(), getClientIP() (+6 more)

### Community 35 - "Leaderboards UI"
Cohesion: 0.13
Nodes (17): metadata, FLOATING_ICONS, getRankBadge(), LEADERBOARD_GAMES, LeaderboardsPage(), MyRank, MyRanksData, formatScore() (+9 more)

### Community 36 - "Achievement Trophy UI"
Cohesion: 0.18
Nodes (14): metadata, AchievementCelebrations(), CONFETTI, sessionMock, snakeCaps, TrophiesPage(), TrophyCase(), TrophyGroup (+6 more)

### Community 37 - "Game Metadata Definitions"
Cohesion: 0.08
Nodes (13): metadata, metadata, metadata, metadata, metadata, metadata, metadata, metadata (+5 more)

### Community 38 - "Toy Finder App"
Cohesion: 0.24
Nodes (20): AGE_RANGES, AgeRange, CURATED_TOYS, getToyById(), getToysByAge(), getToysByCategory(), PRIORITIES, Priority (+12 more)

### Community 39 - "Hill Climb Physics"
Cohesion: 0.17
Nodes (20): CollectibleBody, HillClimbGame(), Particle, useIsMobile(), usePauseKeyboard(), applyLeanTorque(), applyWheelTorque(), createCoinBody() (+12 more)

### Community 40 - "Hill Climb Garage"
Cohesion: 0.13
Nodes (16): FUEL, NITRO, STAGES, UPGRADES, UpgradeType, VEHICLES, GameActions, GameState (+8 more)

### Community 41 - "Oregon Trail UI"
Cohesion: 0.17
Nodes (14): Event(), GameUI(), ProgressMap(), River(), StatusBar(), Store(), HEALTH_EMOJI, Travel() (+6 more)

### Community 42 - "Database Package Configuration"
Cohesion: 0.08
Nodes (24): drizzle-kit, drizzle-orm, dependencies, drizzle-orm, pg, devDependencies, drizzle-kit, @types/pg (+16 more)

### Community 43 - "Flappy Bird Game"
Cohesion: 0.19
Nodes (19): FlappyBirdGame(), Bird, CANVAS_HEIGHT, CANVAS_WIDTH, COLORS, GameState, getMedal(), GROUND (+11 more)

### Community 44 - "Math Attack Game"
Cohesion: 0.26
Nodes (17): MathAttackGame(), Difficulty, DIFFICULTY_SETTINGS, DifficultySettings, GAME, getDifficultySettings(), Operation, POINTS (+9 more)

### Community 45 - "Oregon Trail Game Logic"
Cohesion: 0.17
Nodes (21): OCCUPATIONS, applyEventEffect(), attemptRiverCrossing(), calculateDailyTravel(), calculateFoodConsumption(), checkGameOver(), checkLandmarkReached(), createInitialState() (+13 more)

### Community 46 - "Database Schema"
Cohesion: 0.10
Nodes (18): Database, db, pool, appProgress, AppProgressData, appTransactions, TransactionType, ValidAppId (+10 more)

### Community 47 - "Player Profile Progress"
Cohesion: 0.17
Nodes (16): metadata, GameDetailViewProps, GameProgressCard(), GameProgressCardProps, MyRank, MyRanksData, ProfileData, ProfilePage() (+8 more)

### Community 48 - "Joke Generator App"
Cohesion: 0.26
Nodes (16): JokeGenerator(), CURATED_JOKES, fetchDadJoke(), getRandomJoke(), Joke, JOKE_CATEGORIES, JokeCategory, Rating (+8 more)

### Community 49 - "Profile Game Details"
Cohesion: 0.11
Nodes (16): BuildingCounts, CookieClickerDetails(), CookieClickerDetailsProps, HillClimbDetails(), HillClimbDetailsProps, VehicleUpgrades, GameDetailView(), Challenge (+8 more)

### Community 50 - "Profile Signup Validation"
Cohesion: 0.16
Nodes (13): POST(), findFirst, returning, valuesSpy, checkNameChangeRateLimit(), nameChangeAttempts, PATCH(), checkSignupRateLimit() (+5 more)

### Community 51 - "Database TypeScript Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, declaration, declarationMap, esModuleInterop, lib, module, moduleResolution, outDir (+10 more)

### Community 52 - "Game Design Documents"
Cohesion: 0.12
Nodes (18): Retro Arcade Emulator Page, Four-Wheeler Adventure Game, Child Safety and Security Hardening, Drawing App Design, Joke Generator Design, Weather Buddy Design, Mobile Playability Audit 2026-07-11, Game and App Ideas (+10 more)

### Community 53 - "Game Routing Metadata"
Cohesion: 0.22
Nodes (12): GET(), GamesIMade(), GamesIMadeProps, catalog, gameName(), getPlayableHref(), hrefForCategory(), CategoryId (+4 more)

### Community 54 - "Game Registry"
Cohesion: 0.12
Nodes (10): metadata, metadata, metadata, metadata, metadata, metadata, CATEGORY_CONFIG, CATEGORY_ORDER (+2 more)

### Community 55 - "Hill Climb Terrain"
Cohesion: 0.14
Nodes (15): AUDIO, CAMERA, NitroUpgradeLevel, PHYSICS, SCORING, StageConfig, StageRenderConfig, TERRAIN (+7 more)

### Community 56 - "Monster Truck Vehicle Physics"
Cohesion: 0.14
Nodes (12): FollowCamera(), FollowCameraProps, Vehicle, VehicleProps, ControlValues, BONUSES, CAMERA, COLLECTIBLES (+4 more)

### Community 57 - "Shared Game Components"
Cohesion: 0.16
Nodes (11): AuthProvider(), AuthProviderProps, GameStartOverlay(), GameStartOverlayButton(), GameStartOverlayButtonProps, GameStartOverlayProps, GuestWarning(), GuestWarningProps (+3 more)

### Community 58 - "Four-Wheeler Adventure Audit"
Cohesion: 0.11
Nodes (18): Ask Helper, Bail Out, Camera, Feed Dog ($10), Garage Door, Get on Trailer, Get Out & Walk, Hitch (+10 more)

### Community 59 - "Turbo Build Configuration"
Cohesion: 0.11
Nodes (17): ^build, ^lint, !.next/cache/**, dependsOn, outputs, cache, cache, persistent (+9 more)

### Community 60 - "Shared Game Shell"
Cohesion: 0.15
Nodes (8): Weather, Game2048, GameShell(), GameShellProps, PauseMenu(), PauseMenuProps, useGameShell(), UseGameShellOptions

### Community 61 - "Oregon Trail Hunting"
Cohesion: 0.17
Nodes (13): Animal, ANIMAL_CONFIG, AnimalType, HitEffect, Hunting(), MissEffect, OregonTrailGame(), HUNTING_TIME (+5 more)

### Community 62 - "Shared Game Design"
Cohesion: 0.15
Nodes (17): Asteroids Game Design, Blitz Bomber Game Design, Bomberman Game Design, Breakout Game Design, Cookie Clicker Game Design, Dino Runner Game Design, Endless Runner Game Design, Flappy Bird Game Design (+9 more)

### Community 63 - "Atari ROM Catalog Upload"
Cohesion: 0.20
Nodes (16): categorize_game(), check_s3_credentials(), generate_catalog_only(), generate_typescript_catalog(), get_display_name(), is_favorite(), Mark popular/classic games as favorites., Upload all Atari 2600 ROMs to S3 and generate catalog. (+8 more)

### Community 64 - "Progress API Validation"
Cohesion: 0.18
Nodes (12): DELETE(), GET(), POST(), RouteContext, ADJECTIVES, generateHandle(), generateUniqueHandle(), NOUNS (+4 more)

### Community 65 - "Authentication UI"
Cohesion: 0.27
Nodes (8): LoginPage(), SignUpPage(), signInWithCredentials(), signInWithGoogle(), signOutAndClear(), Header(), HeaderProps, LoginButton()

### Community 67 - "Game Shelf Home"
Cohesion: 0.20
Nodes (13): FLOATING_EMOJIS, HomeClient(), HomeClientProps, loadMyGameStat(), loadRecentItems(), normalizeSearch(), RecentItem, saveRecentItem() (+5 more)

### Community 68 - "Hill Climb Game UI"
Cohesion: 0.22
Nodes (9): useHillClimbStore, GameOverScreen(), GameOverScreenProps, GameUI(), GameUIProps, PauseMenu(), PauseMenuProps, SettingsMenu() (+1 more)

### Community 69 - "Monster Truck Terrain"
Cohesion: 0.29
Nodes (12): isInLake(), Ramps(), StuntPlatform(), Terrain(), LAKES, generateHeightfield(), generateScatteredPositions(), getNoise2D() (+4 more)

### Community 70 - "Web Package Scripts"
Cohesion: 0.14
Nodes (13): name, private, scripts, build, dev, generate:metadata, lint, start (+5 more)

### Community 71 - "Monster Truck Game World"
Cohesion: 0.21
Nodes (6): Destructibles(), generateDestructiblePositions(), Boundaries(), GameScene(), WORLD, sounds

### Community 72 - "Monster Truck Controls"
Cohesion: 0.20
Nodes (12): MobileControls(), MobileControlsProps, ControlState, initialState, initialTouchControlState, OrientationState, TouchControlState, useCombinedControls() (+4 more)

### Community 73 - "Fullscreen Installation"
Cohesion: 0.23
Nodes (9): FullscreenButton(), FullscreenButtonProps, IOSInstallPrompt(), IOSInstallPromptProps, detectPlatform(), emptySubscribe(), isFullscreenSupported(), useFullscreen() (+1 more)

### Community 74 - "Next.js App Configuration"
Cohesion: 0.19
Nodes (7): nextConfig, IMPORTANT: Order matters! When multiple rules match, LAST one wins for each…, metadata, nunito, viewport, SITE, .next/**

### Community 75 - "Monster Truck Environment"
Cohesion: 0.23
Nodes (10): Clouds(), Environment(), EnvironmentColliders(), isInLake(), Lakes(), positionSeed(), Rocks(), seededRandom() (+2 more)

### Community 76 - "Database Schema Migration"
Cohesion: 0.21
Nodes (12): "accounts", "app_progress", "app_transactions", "authenticators", "gaming_profiles", "leaderboard_entries", "sessions", "users" (+4 more)

### Community 77 - "SNES ROM Catalog Upload"
Cohesion: 0.22
Nodes (12): categorize_game(), generate_typescript_catalog(), get_display_name(), is_favorite(), Mark popular/classic games as favorites., Upload all SNES ROMs to S3 and generate catalog., Generate TypeScript catalog file., Convert filename to URL-safe format. (+4 more)

### Community 78 - "Hank's Hits Architecture"
Cohesion: 0.20
Nodes (12): Remix a Game Skill, Web App README, Cross-Game Achievements Engine, Curated Toy Catalog with Affiliate Links, Cross-Game Achievements Design, Toy Finder Design, Hank's Hits Architecture, Framework Roadmap (+4 more)

### Community 79 - "Game Metadata Generation"
Cohesion: 0.18
Nodes (10): allItems, apps, CATEGORY_COLORS, games, output, OUTPUT_FILE, ParsedMetadata, parseMetadataFile() (+2 more)

### Community 80 - "Progress Merge Logic"
Cohesion: 0.33
Nodes (10): clampOrderingTimestamp(), extractTimestamp(), isMonotonicKey(), isPrimitiveArray(), isTimestampRecord(), mergeForSave(), mergeProgress(), MergeResult (+2 more)

### Community 81 - "Test Environment Setup"
Cohesion: 0.17
Nodes (3): CanvasGetContext, MemoryStorage, originalGetContext

### Community 82 - "Quoridor Game Interface"
Cohesion: 0.18
Nodes (11): AI Opponent Mode, Quoridor Game Board, Move Pawn Action, New Game Control, Player Pawns, Place Wall Action, Player Scores, Quoridor Game Interface (+3 more)

### Community 84 - "Monster Truck Collectibles"
Cohesion: 0.44
Nodes (9): Coin(), Collectibles(), CollectParticles(), generatePositions(), isInLake(), MysteryBox(), positionSeed(), seededRandom() (+1 more)

### Community 85 - "WebGL Capability Gate"
Cohesion: 0.36
Nodes (7): detectWebGL(), getServerSnapshot(), getWebGLSnapshot(), resetWebGLSupportCache(), subscribeNoop(), WebGLFallback(), WebGLGate()

### Community 86 - "2048 Game Interface"
Cohesion: 0.20
Nodes (10): Best Score Display, 2048 Game Interface, Mobile Swipe Instruction, New Game Button, Numbered Tiles, Pause Control, Score Display, 2048 Game Screenshot (+2 more)

### Community 87 - "Breakout Game Interface"
Cohesion: 0.20
Nodes (10): Breakout Game, Breakout Game Screen, Brick Grid, Launch Instruction, Level Display, Lives Display, Paddle and Ball, Score Display (+2 more)

### Community 88 - "Checkers Game Interface"
Cohesion: 0.20
Nodes (10): Checkers Board, Checkers Game Interface, Dark Pieces, Forced Jumps Rule, Game Mode Selection, New Game Action, Red Pieces, Rule Variant Selection (+2 more)

### Community 89 - "Cookie Clicker Interface"
Cohesion: 0.22
Nodes (10): Achievement Unlocked, Buildings, Click Power, Cookie Clicker Interface, CPS Bonus, Cursor Building, First Cookie Achievement, Grandma Building (+2 more)

### Community 90 - "Hank's Hopper Gameplay"
Cohesion: 0.20
Nodes (10): Stars and Coins Collectibles, Fullscreen Control, Hank's Hopper, Sky Platformer Game World, Hank's Hopper Gameplay Screenshot, Grassland Start Level Label, Pause Control, Platformer Player Character (+2 more)

### Community 91 - "Drum Machine Interface"
Cohesion: 0.22
Nodes (9): Beat Counter, BPM Tempo Control, Drum Instrument Tracks, Drum Machine Interface, Hip Hop Pattern, Drum Machine App Screenshot, Sequencer Mode, 16-Step Sequencer Grid (+1 more)

### Community 92 - "Toy Finder Interface"
Cohesion: 0.22
Nodes (9): Hot Product Badge, Nerf Elite 2.0 Commander, Nerf MEGA Mastodon, Product Price and Rating, Roblox Gift Card - 2000 Robux, Save Idea Action, Super Smash Bros. Ultimate, Toy Finder Touch Interface (+1 more)

### Community 93 - "Blitz Bomber Interface"
Cohesion: 0.25
Nodes (9): Airplane, Blitz Bomber Game Screen, City Skyline Playfield, Play Fullscreen Prompt, Home Control, Level Display, Pause Control, Score Display (+1 more)

### Community 94 - "Cookie Clicker Fixed Interface"
Cohesion: 0.22
Nodes (9): Buildings Panel, Cookie Click Interaction, Cookie Clicker Game Interface, CPS Bonus, Cursor Building, First Cookie Achievement, Grandma Building, Cookie Clicker Fixed Screenshot (+1 more)

### Community 95 - "Flappy Bird Interface"
Cohesion: 0.28
Nodes (9): Flappy Bird Game Screen, Fullscreen Control, Game Statistics, Side-Scrolling Gameplay Scene, Home Navigation, Pipe Obstacles, Player Bird, Score Display (+1 more)

### Community 96 - "Oregon Trail Events"
Cohesion: 0.25
Nodes (7): ALL_EVENTS, getRandomEvent(), NEGATIVE_EVENTS, NEUTRAL_EVENTS, POSITIVE_EVENTS, SEVERE_EVENTS, GameEvent

### Community 97 - "Virtual Pet Interface"
Cohesion: 0.25
Nodes (8): Pet Care Metrics, Pet Interaction Actions, Virtual Pet App Screenshot, Shop Currency, Stats Modal, Streak Tracking, Unlocked Pets, Virtual Pet

### Community 98 - "Asteroids Game Interface"
Cohesion: 0.25
Nodes (8): Asteroids Game Screen, Best Wave Indicator, Game Over State, Home Navigation, Leaderboard Navigation, Replay Prompt, Score and Wave HUD, Ship Control Button

### Community 99 - "Breakout Fixed Interface"
Cohesion: 0.25
Nodes (8): Breakout Game Interface, Colored Brick Layout, Game Board, Launch Instruction, Paddle and Ball, Score, Level, and Lives HUD, Settings Panel, Stats Panel

### Community 100 - "Dino Runner Interface"
Cohesion: 0.25
Nodes (8): Dino Runner Game, Duck Control, Game Statistics, High Score, Dino Runner Game Interface Screenshot, Jump Control, Navigation and Display Controls, Play Button

### Community 101 - "Endless Runner Interface"
Cohesion: 0.25
Nodes (8): Collectible Coins, Distance Score, Endless Runner Screenshot, Fullscreen Control, Gameplay Obstacle, Home Control, Player Character, Trophy Control

### Community 102 - "Hextris Game Interface"
Cohesion: 0.29
Nodes (8): Audio Control, Game Navigation, Game Status, Hexagonal Playfield, Hextris Game, Pause Control, Rotation Controls, Score Tracking

### Community 103 - "Hill Climb Results"
Cohesion: 0.25
Nodes (8): Coin Reward Summary, Crash Result Screen, Distance Metric, Garage Navigation, Home Navigation, Hill Climb Desktop Screenshot, New Record State, Try Again Action

### Community 104 - "Memory Match Interface"
Cohesion: 0.25
Nodes (8): Animals Theme, 4 by 4 Card Grid, Game Statistics, Locked Themes, Medium Difficulty, Memory Match Game, Memory Match Game Screen, New Game Control

### Community 105 - "Hank's Hopper Orientation"
Cohesion: 0.29
Nodes (8): Continue in Portrait Anyway, Hank's Hopper, Jump Control, Landscape Orientation, Pause Control, Hank's Hopper Platformer Game Screen, Rotate Your Phone Prompt, Score Display

### Community 106 - "Snake Game Interface"
Cohesion: 0.25
Nodes (8): Directional Controls, Banana Food, Grid Game Board, Snake Game Interface, Pause Control, Score and Length HUD, Snake Body, Snake Game

### Community 107 - "Trophy Toast Joke Generator"
Cohesion: 0.25
Nodes (8): Bicycle Joke Card, First Play Trophy Toast, Fullscreen Install Prompt, Add to Home Screen Instruction, Joke Category Filters, Joke Generator, Show Punchline Action, Trophy Toast Live Screenshot

### Community 108 - "Leaderboard Components"
Cohesion: 0.38
Nodes (4): LeaderboardButton(), LeaderboardButtonProps, LeaderboardModal(), LeaderboardModalProps

### Community 109 - "Drawing App Interface"
Cohesion: 0.43
Nodes (7): Artwork Export Actions, Brush Tool, Drawing App Interface, Drawing Canvas, Eraser Tool, Pencil Tool, Undo and Redo Controls

### Community 110 - "Joke Generator Interface"
Cohesion: 0.29
Nodes (7): Favorites Action, Joke Categories, Joke Generator App, Joke Prompt Card, Punchline Reveal, Joke Generator Mobile App Screenshot, Tell Me a Joke Action

### Community 111 - "Game Leaderboards Interface"
Cohesion: 0.29
Nodes (7): Cookie Clicker Game, Leaderboard Fetch Error, Game Leaderboard, Play Cookie Clicker Call to Action, Try Again Action, Apps Leaderboards Touch Screenshot, Leaderboard Time Filter

### Community 112 - "Arkanoid Game Interface"
Cohesion: 0.29
Nodes (7): Arkanoid Game, Arkanoid Game Screenshot, Game Over State, High Score, Score Multiplier, Play Again Control, Score

### Community 113 - "Chess Game Interface"
Cohesion: 0.29
Nodes (7): AI Thinking State, Chessboard, Difficulty Controls, Game Action Controls, Game Mode Controls, Player Color Controls, Chess Game Screen

### Community 114 - "Hill Climb Gameplay"
Cohesion: 0.29
Nodes (7): Brake Control, Currency Counter, Best Distance Record, Gas Control, Hill Climb Game, Hill Climb Game Screen, Speed Indicator

### Community 115 - "Hill Climb Garage"
Cohesion: 0.29
Nodes (7): Best Distance, Coin Balance, Hill Climb Racing Garage UI, Hill Climb Garage via Touch Pause Screenshot, Racing Stages, Vehicle Upgrades, Vehicle Selection

### Community 116 - "Monster Truck Gameplay"
Cohesion: 0.29
Nodes (7): Achievement Trophy, Brake Control, Challenges Control, Gas Control, Monster Truck Gameplay Screen, Nitrous Boost Control, Score Display

### Community 117 - "Populated Game Shelf"
Cohesion: 0.29
Nodes (7): Four-Wheeler Adventure, Populated game shelf, Hank's Hits, My Games, Hank's Hits populated shelf screenshot, Search games and apps, Snake

### Community 118 - "Desktop Game Shelf"
Cohesion: 0.29
Nodes (7): Four-Wheeler Adventure, Games, apps, and awesome stuff, Hank's Hits, My Games, My Land: 2 plots, Hank's Hits shelf desktop screenshot, Search games and apps

### Community 119 - "Space Invaders Interface"
Cohesion: 0.29
Nodes (7): Alien Invaders, Defensive Shields, Game Controls, Game HUD, Player Cannon, Settings Panel, Space Invaders Screenshot

### Community 121 - "Hill Climb Controls"
Cohesion: 0.47
Nodes (5): ControlState, TouchZone, useCombinedControls(), useKeyboardControls(), useTouchControls()

### Community 122 - "Hill Climb Helpers"
Cohesion: 0.53
Nodes (4): clampDeltaTime(), getControlsCopy(), MAX_DELTA_TIME, NOTE: vehicle physics is NOT the consumer - Matter.Runner steps the physics

### Community 123 - "Oregon Trail Travel Scene"
Cohesion: 0.33
Nodes (5): DustParticle, Particle, TIME_PALETTES, WEATHER_EFFECTS, WEATHER_CONDITIONS

### Community 124 - "Drum Machine Interface"
Cohesion: 0.33
Nodes (6): Drum Machine, Drum Pads, Keyboard Shortcuts, Record Workflow, Step Sequencer Grid, Transport Controls

### Community 125 - "Trivia Quiz Completion"
Cohesion: 0.33
Nodes (6): New High Score, Play Again Action, Quiz Completion State, Score Summary, Trivia Quiz Completion Screenshot, Best Streak Statistic

### Community 126 - "Weather Buddy Interface"
Cohesion: 0.47
Nodes (6): City Search, Clothing Recommendations, Current Weather Conditions, Favorite Location Control, London Weather, Weather Buddy

### Community 127 - "Asteroids Game Interface"
Cohesion: 0.33
Nodes (6): Asteroid Field, Asteroids Game Interface, Game Controls, Game HUD, Asteroids Game Screenshot, Player Spaceship

### Community 128 - "Blitz Bomber Gameplay"
Cohesion: 0.33
Nodes (6): Blitz Bomber Game Screen, Bomb Dropping Gameplay, Building Destruction Objective, Difficulty Selection, Game Statistics, Safe Landing Objective

### Community 129 - "Bomberman Game Interface"
Cohesion: 0.33
Nodes (6): Bomb Mechanic, Bomberman Game Interface Screenshot, Directional Movement Controls, Game Statistics, Gameplay Pause Control, Grid-Based Game Board

### Community 130 - "Bomberman Fixed Layout"
Cohesion: 0.33
Nodes (6): Bomb Action Control, Directional Controls, Add to Home Screen Prompt, Game HUD, Maze Game Board, Bomberman Game Screenshot

### Community 131 - "Four-Wheeler Adventure"
Cohesion: 0.33
Nodes (6): Four-Wheeler Adventure Screen, Navigation and Environment, Race Actions, Racing Gameplay, Support and Inventory, Vehicle Controls

### Community 132 - "Four-Wheeler Fixed Layout"
Cohesion: 0.33
Nodes (6): Contextual Game Actions, Outdoor Game World, Navigation Controls, Race Controls, Four-Wheeler Adventure Game Interface Screenshot, Four-Wheeler Vehicle Controls

### Community 133 - "Guest Trophy Case"
Cohesion: 0.33
Nodes (6): Empty Trophy State, Game Play Progress, Guest User, Guest Trophy Case Screenshot, Mobile Navigation Header, Trophy Case

### Community 134 - "Hextris Game Interface"
Cohesion: 0.33
Nodes (6): Game Status HUD, Hexagonal Puzzle Board, Hextris Game Interface, Hextris Game Screenshot, Pause Control, Left and Right Rotation Controls

### Community 135 - "Hextris Game Over"
Cohesion: 0.33
Nodes (6): Game Over State, Hextris Game, Tap to Play Again, Tap Left or Right to Rotate, Score 24, Hextris game-over screenshot

### Community 136 - "Hank's Hopper Contrast"
Cohesion: 0.33
Nodes (6): Gameplay Collectibles, UI Contrast Improvement, Gameplay Controls, Hank's Hopper Game Interface, Platformer Contrast Fix Screenshot, Score Display

### Community 137 - "Empty Games Shelf"
Cohesion: 0.33
Nodes (6): Build Invitation, Claude Builder, Empty My Games Shelf, Hank's Hits Home Screen, Shelf 390 Empty Invite Screenshot, Search Games and Apps

### Community 138 - "Populated Games Shelf"
Cohesion: 0.33
Nodes (6): Four-Wheeler Adventure, Game and App Search, Hank's Hits Game and App Interface, My Games Shelf, Populated Desktop Shelf Screenshot, Snake

### Community 139 - "Profile Achievement Tiers"
Cohesion: 0.40
Nodes (6): All Games Achievements, Trophy Case Profile Screenshot, My Profile, Progressive Achievement Tiers, Streak Achievements, Trivia Quiz Achievements

### Community 140 - "Joke Generator Trophy Toast"
Cohesion: 0.33
Nodes (6): First Play Trophy Toast, Add to Home Screen Prompt, Joke Category Navigation, Joke Generator, Punchline Reveal Interaction, Joke Generator Mobile UI Screenshot

### Community 141 - "Trivia Quiz Trophy Unlock"
Cohesion: 0.33
Nodes (6): Achievement Trophy, Fullscreen Installation Prompt, Issue Badge, Quiz Progress and Timer, Trivia Quiz Mobile Screenshot, Trivia Quiz Interface

### Community 142 - "Platform Route Surface"
Cohesion: 0.33
Nodes (6): Behavior Specification, iPhone Install Prompt, Monorepo Stack, Playable Href Routing, Game and App Registry Discovery, Platform Route Surface

### Community 143 - "Home Game Registry"
Cohesion: 0.70
Nodes (3): Home(), discoverGamesAndApps(), renderHome()

### Community 144 - "Profile Authentication"
Cohesion: 0.50
Nodes (5): Account Registration, Authentication Screen, Email and Password Sign In, Game Progress Persistence, Continue with Google

### Community 145 - "Hill Climb Orientation"
Cohesion: 0.50
Nodes (5): Continue in Portrait Anyway Action, Hill Climb Game, Landscape Mode, Rotate Your Phone Instruction, Hill Climb Orientation Prompt Screenshot

### Community 146 - "Math Attack Gameplay"
Cohesion: 0.40
Nodes (5): Answer Input, Falling Arithmetic Expressions, Lives Counter, Math Attack Game Screen, Score Display

### Community 147 - "Oregon Trail Gameplay"
Cohesion: 0.40
Nodes (5): Oregon Trail Game Screen, Resource Tracking, River Crossing, Travel Controls, Travel Progress

### Community 148 - "Retro Arcade Controls"
Cohesion: 0.40
Nodes (5): Action Buttons, Navigation Controls, Pixel Art Fantasy Scene, Retro Arcade Game Interface, Virtual Game Controls

### Community 149 - "Trophy Case Achievements"
Cohesion: 0.50
Nodes (5): Achievement Progression, All Games Achievements, Jokes Achievements, My Games, Profile Trophy Case Screen

### Community 150 - "Wordle Game Interface"
Cohesion: 0.40
Nodes (5): Guess Grid, One Hint Per Game, Wordle Game Interface Screenshot, On-Screen Keyboard, Wordle Game

### Community 151 - "Bomberman Landscape Board"
Cohesion: 0.50
Nodes (4): Bomb Modal, Bomberman Game, Game Board, Bomberman Landscape Menu Screenshot

### Community 152 - "Landscape Navigation Header"
Cohesion: 0.50
Nodes (4): Home Control, Landscape Navigation Header, Leaderboard Control, Trophy Control

### Community 153 - "Trophy Storage Sync"
Cohesion: 0.50
Nodes (4): Local Trophy Storage, Trophy Case Mobile Screenshot, Sign-In Synchronization, Trophy Case

### Community 154 - "Retro Arcade Loading"
Cohesion: 0.50
Nodes (4): Arcade Navigation Header, Emulator Loading State, Game Controller Visual, Retro Arcade Screen

### Community 155 - "Globe Asset"
Cohesion: 0.67
Nodes (3): Globe Icon, Vector Graphics, World Geography

### Community 156 - "Window Asset"
Cohesion: 0.67
Nodes (3): Browser Window, Vector Graphic, Window Icon

### Community 188 - "Shared Game Design"
Cohesion: 0.67
Nodes (3): Memory Match Game Design, Kid-Friendly Game Design, Mobile and Desktop Control Parity

### Community 190 - "Game Regression Testing"
Cohesion: 0.67
Nodes (3): Game Regression Fixes, Test Infrastructure Gates, Weather Code Mapping

### Community 191 - "Progress and Leaderboards"
Cohesion: 0.67
Nodes (3): Leaderboards, Authenticated Progress Synchronization, Progress Schema Validation

## Ambiguous Edges - Review These
- `Blitz Bomber Game Screen` → `Difficulty Selection`  [AMBIGUOUS]
  design/audits/screenshots/blitz-bomber.png · relation: conceptually_related_to
- `Score Display` → `UI Contrast Improvement`  [AMBIGUOUS]
  design/audits/screenshots/platformer-contrast-fix.jpeg · relation: rationale_for

## Knowledge Gaps
- **962 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+957 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **81 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Blitz Bomber Game Screen` and `Difficulty Selection`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Score Display` and `UI Contrast Improvement`?**
  _Edge tagged AMBIGUOUS (relation: rationale_for) - confidence is low._
- **Why does `useAuthSync()` connect `Auth Sync and Weather` to `Breakout Game`, `Checkers Game`, `Space Invaders Game`, `Asteroids Game`, `Retro Arcade Emulator`, `Drawing App`, `Bomberman Game`, `Dino Runner Game`, `Hextris Game`, `Quoridor Game`, `2048 Game`, `Cookie Clicker Game`, `Snake Game`, `Platformer Game`, `Endless Runner Game`, `Wordle Game`, `Virtual Pet`, `Blitz Bomber Game`, `Chess Game`, `Monster Truck Game State`, `Memory Match Game`, `Drum Machine`, `Trivia App`, `Arkanoid Game`, `Achievement Trophy UI`, `Toy Finder App`, `Hill Climb Physics`, `Oregon Trail UI`, `Flappy Bird Game`, `Math Attack Game`, `Joke Generator App`, `Oregon Trail Hunting`, `Monster Truck Game World`, `Progress Merge Logic`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Why does `IOSInstallPrompt()` connect `Fullscreen Installation` to `Breakout Game`, `Checkers Game`, `Auth Sync and Weather`, `Space Invaders Game`, `Asteroids Game`, `Retro Arcade Emulator`, `Drawing App`, `Bomberman Game`, `Dino Runner Game`, `Hextris Game`, `Quoridor Game`, `2048 Game`, `Cookie Clicker Game`, `Snake Game`, `Platformer Game`, `Endless Runner Game`, `Wordle Game`, `Virtual Pet`, `Blitz Bomber Game`, `Chess Game`, `Memory Match Game`, `Drum Machine`, `Trivia App`, `Toy Finder App`, `Oregon Trail UI`, `Flappy Bird Game`, `Math Attack Game`, `Joke Generator App`, `Shared Game Components`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `SoundManager` connect `Monster Truck Sound Manager` to `Monster Truck Game World`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _962 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Breakout Game` be split into smaller, more focused modules?**
  _Cohesion score 0.05980861244019139 - nodes in this community are weakly interconnected._
