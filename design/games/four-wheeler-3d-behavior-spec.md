# Four Wheeler Adventure: 2D to 3D behavior spec

This workbook lists every feature found in the 2D source file `apps/web/public/games/four-wheeler-adventure/index.html` (6,617 lines, one file, 2D canvas). Each row names the function and line number that owns the behavior, states what the player does and what visibly happens with the real numbers from the code, and assigns the work to a 3D port milestone. Read a row as the acceptance test for that feature in the 3D build. Status is `planned` on every row until the 3D version passes that test.

| id | 2D source (function + line) | expected behavior | 3D milestone | status |
|---|---|---|---|---|
| veh-foot | `SPEEDS.foot` line 697, `update` line 1747 | On foot the player walks at max 2.8 units (39 mph on the HUD), accel 0.14, brake 0.20, friction 0.80, reverse -1.6, turn 0.075. Walking stops fast because friction is 0.80. | 4 | planned |
| veh-atv | `SPEEDS.atv` line 698, `update` line 1747 | The starting quad drives at max 57.6 (806 mph), accel 0.90, brake 0.46, friction 0.985, reverse -5.0, turn 0.062. It starts parked in front of the garage at `GARAGE.x, GARAGE.y+250` (line 920). | 4 | planned |
| veh-utv | `SPEEDS.utv` line 699, `FOR_SALE` line 785 | The side-by-side drives at max 64.8 (907 mph), accel 1.00, brake 0.50, friction 0.985, reverse -5.2, turn 0.068. Costs $20,000 at the dealership. | 6 | planned |
| veh-truck | `SPEEDS.truck` line 700, `drawTruck` line 4191 | The F250 truck drives at max 51.6 (722 mph), accel 0.70, brake 0.52, friction 0.986, reverse -4.4, turn 0.046. Costs $20,000. | 6 | planned |
| veh-firetruck | `SPEEDS.firetruck` line 701, `drawFireTruck` line 4039 | The fire truck drives at max 46.0 (644 mph), accel 0.50, brake 0.50, friction 0.987, reverse -3.6, turn 0.036. Costs $150,000 (`buyPrice` line 6577). | 6 | planned |
| veh-monster | `SPEEDS.monster` line 702, `drawMonster` line 4061 | The monster truck drives at max 56.0 (784 mph), accel 0.64, brake 0.50, friction 0.986, reverse -4.0, turn 0.044. Costs $40,000. | 6 | planned |
| veh-racecar | `SPEEDS.racecar` line 703, `drawRaceCar` line 4126 | The race car drives at max 112.0 (1,568 mph), accel 1.70, brake 0.66, friction 0.987, reverse -4.0, turn 0.078. Costs $80,000. | 6 | planned |
| veh-muscle | `SPEEDS.muscle` line 704, `drawMuscle` line 4138 | The muscle car drives at max 90.0 (1,260 mph), accel 1.35, brake 0.60, friction 0.986, reverse -5.0, turn 0.068. Costs $45,000. | 6 | planned |
| veh-tractor | `SPEEDS.tractor` line 705, `drawTractor` line 4079 | The tractor drives at max 7.142857 (exactly 100 mph), accel 0.16, brake 0.22, friction 0.96, reverse -2.5, turn 0.050. Costs $25,000. It is the natural tow vehicle for the mower. | 6 | planned |
| veh-rv | `SPEEDS.rv` line 706, `drawRV` line 4097 | The driveable camper drives at max 50.0 (700 mph), accel 0.42, brake 0.46, friction 0.987, reverse -3.4, turn 0.034. Costs $45,000 and tows trailers. | 6 | planned |
| veh-jet | `SPEEDS.jet` line 707, `drawJet` line 3622 | The fighter jet flies at max 714.285714 (10,000 mph), accel 14, brake 8, friction 0.99, no reverse, turn 0.030. Costs $200,000 at the flying store. | 10 | planned |
| veh-biplane | `SPEEDS.biplane` line 708, `drawBiplane` line 3633 | The biplane flies at max 18 (252 mph), accel 0.45, brake 0.42, friction 0.990, no reverse, turn 0.040. Costs $40,000. | 10 | planned |
| veh-chopper | `SPEEDS.chopper` line 709, `drawChopper` line 3646 | The chopper flies at max 24 (336 mph), accel 0.55, brake 0.42, friction 0.990, reverse -4, turn 0.052. Costs $120,000. | 10 | planned |
| veh-plane | `SPEEDS.plane` line 724, `drawPlane` line 3420 | The starter plane flies at max 26 (364 mph), accel 0.6, brake 0.40, friction 0.992, no reverse, turn 0.030. Costs $60,000 at the flying store, or comes with the $200,000 aircraft package. | 10 | planned |
| veh-heli | `SPEEDS.heli` line 725, `drawHeli` line 3658 | The helicopter flies at max 20 (280 mph), accel 0.5, brake 0.42, friction 0.990, reverse -4, turn 0.050, and does not barrel roll. Costs $80,000. | 10 | planned |
| veh-canoe | `SPEEDS.canoe` line 710, `drawCanoe` line 4152 | The canoe moves at max 16.0 (224 mph), accel 0.40, brake 0.34, friction 0.974, reverse -3.0, turn 0.072. Costs $3,000 at the boat dealer (`FOR_SALE_BOATS` line 823). | 9 | planned |
| veh-sailboat | `SPEEDS.sailboat` line 711, `drawSailboat` line 4164 | The sailboat moves at max 22.0 (308 mph), accel 0.42, brake 0.36, friction 0.982, reverse -3.0, turn 0.046. Costs $12,000. | 9 | planned |
| veh-tugboat | `SPEEDS.tugboat` line 712, `drawTugboat` line 4178 | The tugboat moves at max 18.0 (252 mph), accel 0.30, brake 0.34, friction 0.985, reverse -2.6, turn 0.034. Costs $30,000. | 9 | planned |
| veh-moto | `SPEEDS.moto` line 713, `drawMoto` line 4235 | The motorcycle drives at max 75.0 (1,050 mph), accel 1.20, brake 0.48, friction 0.984, reverse -4.4, turn 0.084. Costs $20,000. | 6 | planned |
| veh-lambo | `SPEEDS.lambo` line 714, `drawLambo` line 4253 | The Ferrari/Lamborghini drives at max 93.0 (1,302 mph), accel 1.50, brake 0.62, friction 0.986, reverse -5.0, turn 0.072. Costs $50,000. | 6 | planned |
| veh-semi | `SPEEDS.semi` line 715, `drawSemi` line 4214 | The 18-wheeler drives at max 45.0 (630 mph), accel 0.55, brake 0.40, friction 0.986, reverse -3.4, turn 0.034. Costs $20,000. | 6 | planned |
| veh-boat | `SPEEDS.boat` line 716, `drawBoat` line 3086 | The speedboat moves at max 30.0 (420 mph), accel 0.60, brake 0.42, friction 0.980, reverse -4.8, turn 0.056. Costs $5,000 and starts parked at `DOCK_WATER` (line 769). | 9 | planned |
| veh-pontoon | `SPEEDS.pontoon` line 717, `drawPontoon` line 3568 | The pontoon moves at max 18.0 (252 mph), accel 0.38, brake 0.36, friction 0.978, reverse -3.4, turn 0.050. Costs $5,000. | 9 | planned |
| veh-fishingboat | `SPEEDS.fishingboat` line 718, `drawFishingBoat` line 3548 | The big fishing boat moves at max 20.0 (280 mph), accel 0.32, brake 0.34, friction 0.982, reverse -3.0, turn 0.038. Costs $50,000 and has a walkable deck of radius 92. | 9 | planned |
| veh-minifishingboat | `SPEEDS.minifishingboat` line 719, `deckRadius` line 6126 | The mini fishing boat moves at max 24.0 (336 mph), accel 0.46, brake 0.40, friction 0.980, reverse -3.6, turn 0.060. Costs $15,000 and has a small deck of radius 46. | 9 | planned |
| veh-yacht | `SPEEDS.yacht` line 720, `drawYacht` line 3474 | The mega yacht moves at max 20.0 (280 mph), accel 0.30, brake 0.32, friction 0.985, reverse -2.6, turn 0.030. Costs $10,000,000 and carries a jet ski, a tender, a side-by-side, a helicopter, nets and a cabin. | 9 | planned |
| veh-jetski | `SPEEDS.jetski` line 721, `drawJetski` line 3443 | The jet ski moves at max 28.0 (392 mph), accel 0.62, brake 0.44, friction 0.976, reverse -4.0, turn 0.088. Costs $5,000. | 9 | planned |
| veh-mount | `SPEEDS.mount` line 722, `rideHorse` line 6216 | A ridden animal or horse moves at max 9.0 (126 mph), accel 0.32, brake 0.40, friction 0.920, reverse -2.5, turn 0.062. | 11 | planned |
| veh-train | `SPEEDS.train` line 723, `update` line 1943 | The train runs at max 4000 (about 56,000 mph). Holding gas adds 95 per tick, braking subtracts 60, coasting multiplies speed by 0.985. | 10 | planned |
| veh-bikes | `BIKES` line 903, `buyBike` line 6256 | Eight bikes are sold at the bike shop, each running at 8x its real mph: Kids' 18 mph $480, BMX 30 mph $1,400, Cruiser 28 mph $1,200, Mountain 44 mph $3,400, Road 60 mph $6,000, Electric City 40 mph $7,200, Electric Mtn 56 mph $14,000, Super E-Bike 90 mph $18,000. A bought bike parks in front of the shop. | 6 | planned |
| veh-boarding | `boardOrExit` line 1534 | Press E or tap Switch within 150 units of a parked vehicle to get in. The old ride parks where you stand, mud carries over, and aiming, tree stand and hitch all clear. | 5 | planned |
| veh-garage-gate | `boardOrExit` line 1560 | A vehicle parked behind the garage doors (within 430 of `GARAGE` and north of `GARAGE.y+30`) cannot be boarded until `garageDoor` animates past 0.6. The hint says to open the garage door first. | 6 | planned |
| veh-aircraft-gate | `boardOrExit` line 1561, `buyAircraft` line 1512 | Boarding a plane or helicopter is refused until the $200,000 aircraft package is bought. The Buy Aircraft button only shows within 290 of the runway or 270 of the helipad. | 10 | planned |
| veh-switch | `switchVehicle` line 5616 | The Switch button swaps you into another parked vehicle of the same class (land to land, water to water, air to air) without moving you. Your old ride goes to where the new one was parked. | 6 | planned |
| veh-park-here | `parkHere` line 1497 | Getting out records the vehicle position, angle and current mud level, so a muddy truck is still muddy when you get back in. | 6 | planned |
| veh-reset | `resetVehicles` line 5068 | On death every bought vehicle is deleted and the starter fleet respawns: boat at the dock, plane at the runway, heli at the helipad, and utv, truck, moto, lambo plus three spare cars in the garage bays. | 13 | planned |
| veh-paint | `swatches` line 6528 | At the customizing garage, tapping one of 12 colour swatches repaints the land vehicle you are sitting in. On foot or in a boat it refuses with a hint. | 6 | planned |
| veh-tune | `setSpeedLabel` line 6534, `spUp` handler line 6535 | At the customizing garage, +10 mph costs $10 (one dollar per mph) and -10 mph refunds $10. The floor is 5/14 units. The panel shows the current top speed in mph. | 6 | planned |
| veh-nos | `nos` line 1499 | Tapping NOS in any vehicle doubles your current speed instantly and doubles your top speed for 3 seconds. In the train it doubles train speed or adds 30, whichever is more. | 4 | planned |
| veh-mph-readout | `update` line 2298, `drawSpeedo` line 5382 | The HUD speed is always `abs(speed) * 14` rounded. The dial fills to the vehicle max and turns red past 80 percent. | 4 | planned |
| cam-presets | `CAMERAS` line 1014, `cycleCamera` line 5539 | Ten camera presets cycle on the Camera button: Top-Down 1.0/1.0, Close 1.5/1.0, Far 0.7/1.0, Bird's Eye 0.5/1.0, Oblique 1.1/0.7, Low Angle 1.4/0.55, Cinematic 0.9/0.8, Action 1.7/0.5, Wide 0.6/0.85, Super Zoom 2.0/0.9 (zoom/tilt). The button label shows the preset name. | 4 | planned |
| cam-follow | `draw` line 2324 | The camera centres on the player and clamps to the world edges, so you never see past the 72,000 unit boundary. Tilt squashes the vertical scale for the angled look. | 4 | planned |
| cam-aim-override | `draw` line 2325, `AIM_ZOOM` line 1010 | Raising the gun scope overrides the camera preset to a flat 2.4x zoom with no tilt, so aiming maths stay simple. | 8 | planned |
| cam-key | `keydown` line 5434 | Pressing C cycles the camera the same way as the Camera button. | 4 | planned |
| foot-walk | `update` line 1836, `SPEEDS.foot` line 697 | On foot the player walks with arrows or WASD at 2.8 max and cannot enter the lake: walking into it slides you back to `pond.r + 16` and halves your speed. | 5 | planned |
| foot-chute | `bailOut` line 1587 | Press F in the quad to bail out at height 140, or in a plane at height 300. The vehicle stays where you jumped, and `chute` falls 1.7 per tick until you land. | 5 | planned |
| foot-chute-ride | `update` line 2043 | Parachuting between height 0 and 60 over any non-wolf animal within 34 units puts you on its back in mount mode. | 8 | planned |
| foot-jump | `update` line 1966 | Space gives a 6.4 launch on any land vehicle when the wheels are down. Gravity is -0.5 per tick and you land back at 0. | 4 | planned |
| foot-interact-click | `nearestInteractable` line 1426, `canvas mousedown` line 6598 | Clicking the glowing bubble over a nearby vehicle, stand, train, build slot, house, land sign or upgrade marker performs that action without walking up and pressing a button. | 5 | planned |
| foot-glow | `drawInteractGlow` line 1449, `GLOW_RANGE` line 1377 | A pulsing ring appears at vehicle 170, stand 110, train 260, build 150, my house 150, buy land 220, upgrade 150 units, and turns gold once inside the ready range (150/80/240/120/120/180/120). | 5 | planned |
| dog-follow | `updateDog` line 5094 | Your retriever trails 64 units behind you on foot and 80 behind a vehicle, easing at 0.12 or 0.3 per tick. If it falls more than 1,600 units behind it teleports back to you. | 5 | planned |
| dog-feed | `feedDog` line 5562 | Tapping Feed Dog costs $10 and sends the dog to the bowl at `DOGHOUSE.x+78, DOGHOUSE.y+40`. When it arrives, `dogFood` resets to 0 and the dog is full again. | 5 | planned |
| dog-starve | `update` line 1815 | Your dog gets hungry at the same rate you do. At 24 game hours with no food it dies and `loseEverything` wipes your progress and money back to $20,000. | 13 | planned |
| dog-retrieve | `retrieveDog` line 5129, `updateDog` line 5111 | Tapping Retrieve sends the dog to the nearest carcass at up to 4,400 units per tick, then back to you. The kill lands in `heldKills` for you to sell. | 8 | planned |
| dog-house | `drawDogHouse` line 3048, `DOGHOUSE` line 830 | A dog house with a food bowl sits at `HOUSE.x+80, HOUSE.y-380`, behind your house. It is the destination for the Feed Dog run. | 5 | planned |
| hud-money | `addMoney` line 5084 | Every earn or spend updates the money badge to a comma formatted dollar amount, and money can never go below $0. You start with $20,000. | 5 | planned |
| hud-clock | `fmtTime` line 2766, `update` line 1751 | The clock shows the icon plus 12 hour time. One real second is one game minute, so a full day takes 24 real minutes. The icon is the weather icon if it is not sunny, otherwise a sun from 8am to 8pm and a moon at night. | 3 | planned |
| hud-hunger | `update` line 1819 | The hunger badge shows `(1 - hunger/24) * 100` percent, counting down over a full game day. The dog badge does the same for the dog. | 5 | planned |
| hud-bones | `update` line 2005, `buildWorld` line 1112 | 56 bones are scattered on land. Driving or boating within 34 units collects one with a gold sparkle, and the counter reads `bones N / 56`, changing to a celebration line when all are found. | 3 | planned |
| hud-skulls | `update` line 2158 | The skull badge counts buck skulls you have walked over (within 46 units on foot). The world record badge shows `max(312, mountedSkulls)`, so beating 312 takes the record. | 8 | planned |
| hud-minimap | `drawMinimap` line 2813 | Pressing M or tapping Map opens a square overview up to 300px showing the lake, the race loop, the garage, the runway, tree stands, feeders, uncollected bones, every living animal colour coded by type, the rival during a race, your heading arrow and the GPS route line. | 5 | planned |
| hud-gps-banner | `drawGPS` line 2799 | When a waypoint is set, a banner shows the destination name, the distance in feet and an arrow rotating toward it. | 5 | planned |
| hud-waypoint-arrive | `update` line 1756 | Coming within 260 units of the waypoint fires an arrival hint and clears the waypoint. | 5 | planned |
| hud-hint | `hint` line 1478 | Every hint takes over the Switch button label for 1.4 seconds, then the label reverts to the context text. | 5 | planned |
| hud-switch-label | `updateSwitchLabel` line 1484 | The Switch button reads "Get in the <vehicle>" within 150 units of a parked vehicle, "Climb the stand" within 80 of a stand, "Climb down" while in a stand, "On foot (find a ride)" otherwise, and "Get Out & Walk" while driving. | 5 | planned |
| hud-shop-stop | `update` line 2185 | Store panels only open when your speed is under 0.8 and you are on foot. Ranges are dealership 330, boat dealer 330, stand store 300, anything store 260, hunting store 240, flying store 200, saddle shop 170, bike shop 160, bucket shop 150. | 6 | planned |
| hud-world-buttons | `WORLD_HUD` line 3862, `hideWorldHud` line 3863 | 59 context buttons are hidden as a group when you leave the world (space or a planet) and restored on return. | 5 | planned |
| hud-touch | `bindTouch` line 1676 | On a touch device an on-screen pad appears with gas, brake, left, right and jump, bound to the same key flags as the keyboard. | 4 | planned |
| hud-keys | `keyMap` line 1667, `keydown` line 5416 | Arrows or WASD drive, Space jumps, Q climbs, Z dives, X or Shift is the handbrake, E in/out, F parachute, R barrel roll, B bomb or corn, G scope, O place stand, M map, T hitch, C camera, N grunt call, P place or pick up a feeder. | 4 | planned |
| phone-open | `phoneBtn` handler line 5652 | The Phone button opens a phone panel with a live clock and a grid of 12 apps. It is hidden while you are inside a house. | 5 | planned |
| phone-gps | `openGPS` line 5794, `GPS_DESTS` line 5782 | The GPS app lists 9 destinations: Home, The Lake, Car Dealer, Anything Store, Hunting Store, Airfield, Trophy Room, The Train and Tree Stand. Picking one sets the waypoint and closes the phone. A Clear waypoint button appears once one is set. | 5 | planned |
| phone-maps | `PHONE_APPS` line 5938 | The Maps app opens the same overview map as the M key and closes the phone. | 5 | planned |
| phone-disney | `openMediaApp` line 5805, `DISNEY` line 5803 | Disney+ lists 10 titles (The Lion King, Cars, Frozen, Moana, Spider-Man, Toy Story, The Avengers, Finding Nemo, Encanto, Star Wars). Tapping one shows a pretend now-playing screen. | 5 | planned |
| phone-youtube | `openYouTube` line 5837, `YOUTUBE` line 5804 | YouTube lists 10 channels. Channels with a video list open a channel page; the rest play a single pretend video. | 5 | planned |
| phone-channel | `openChannel` line 5845, `YT_SHOWS` line 5819 | The MrBeast channel shows 24.1M subscribers and 10 named videos. Picking one opens the player. | 5 | planned |
| phone-player | `playYouTube` line 5853 | The video player shows an emoji scene strip, a progress bar, the title, 12,402,118 views, and Like and Subscribe buttons that fire hints. | 5 | planned |
| phone-games | `openGames` line 5868 | The Games app lists Dice Roll, Coin Flip and Lucky Spin. Each result screen offers Play again or Back. | 5 | planned |
| phone-dice | `playDice` line 5881 | Dice Roll rolls 1 to 6. Rolling a 6 pays $5,000, anything else pays nothing. | 5 | planned |
| phone-coin | `playCoin` line 5883 | Coin Flip asks you to pick Heads or Tails. A correct call pays $2,000. | 5 | planned |
| phone-spin | `playSpin` line 5882 | Lucky Spin picks one of five equally likely results: $25,000, $10,000, $1,000, $500 or nothing. | 5 | planned |
| phone-calc | `openCalc` line 5906, `calcKey` line 5897 | The Calculator has C, backspace, percent, divide, times, minus, plus, sign flip, decimal point and equals, with a 12 digit input cap and an Error result on divide by zero. | 5 | planned |
| phone-huntsim | `openHuntSim` line 5916 | The Hunting Simulator shows a mini map with a dot per feeder and your own marker, plus a corn bar per feeder as a percent of `CORN_MAX` (yellow above 30 percent, red at or below). Feeder names are editable up to 14 characters. | 8 | planned |
| phone-weather | `PHONE_APPS` line 5944 | The Weather app names today's weather (Sunny and clear, Rainy and wet, Thick fog, Snowing) and shows the current time. | 3 | planned |
| phone-firetruck | `PHONE_APPS` line 5945 | The Fire Truck app shows the water tank percent and tells you to refill at the hydrant when it is empty. | 6 | planned |
| phone-music-photos | `PHONE_APPS` lines 5943, 5946 | The Music app shows "Highway Cruisin'" now playing. The Photos app shows a pretend library of 1,204 photos. | 5 | planned |
| phone-amazon | `openAmazonStores` line 5693, `AMAZON_STORES` line 5683 | The Amazon app lists 8 stores to order from: Anything Store, Car Dealership, Boat & Trailer, Hunting Store, Saddle Shop, Flying Stuff, Buckets and Bike Shop. | 6 | planned |
| phone-amazon-store | `openAmazonStore` line 5704 | Picking a store lists its items with prices and a Back to All Stores button. Tapping an item orders it. | 6 | planned |
| phone-order | `orderDelivery` line 5654, `update` line 1802 | Ordering charges the price up front, closes the panels, and launches the Amazon plane from the Anything Store. It flies 62 units per tick toward you and always delivers within 38 seconds. Only one order can be in flight at a time. | 6 | planned |
| phone-deliver-vehicle | `deliverVehicle` line 5669, `deliverWaterSpawn` line 5663 | A delivered land vehicle appears at your position plus (95, 55). A delivered boat splashes into the lake near you if you are within `pond.r + 700`, otherwise it waits at the dock. Either way the GPS points at it. | 6 | planned |
| phone-deliver-boatitem | `deliverBoatItem` line 5674 | Ordering from the Boat & Trailer store drops the right trailer beside you: long trailer length 132 cap 4, mega trailer length 380 cap 12, boat trailer length 50 cap 1, mower length 44, camper length 64. Actual boats splash into the water instead. | 6 | planned |
| econ-start-money | `money` declaration line 1051 | You start every run with $20,000. | 6 | planned |
| econ-dealership | `dlList` loop line 5476, `FOR_SALE` line 784 | The car dealership sells 12 vehicles. The quad, side-by-side, F250, motorcycle and 18-wheeler are $20,000; Ferrari $50,000; fire truck $150,000; monster truck $40,000; race car $80,000; muscle car $45,000; tractor $25,000; camper $45,000. Each card shows top speed and price and has a Details preview. | 6 | planned |
| econ-dealer-spawn | `dlList` click handler line 5484 | A bought car spawns as a brand new keyed vehicle in front of the dealership at `DEALER.x - 200 + (count % 5) * 92, DEALER.y + 205`, so buying never runs out. | 6 | planned |
| econ-feeder-buy | `fbBtn` line 5493 | The dealership also sells a corn feeder for $500. It goes into your carry count and you press P to place it. | 8 | planned |
| econ-boat-dealer | `boatList` loop line 5498, `FOR_SALE_BOATS` line 821 | The boat and trailer dealership sells speedboat $5,000, pontoon $5,000, jet ski $5,000, canoe $3,000, sailboat $12,000, tugboat $30,000, mini fishing boat $5,000, fishing boat $5,000, long trailer $5,000, boat trailer $5,000, mega trailer $5,000, pull-behind mower $8,000, camper $35,000. | 6 | planned |
| econ-boat-on-trailer | `boatList` click handler line 5527 | A bought boat arrives sitting on a fresh boat trailer parked in front of the store, so you must tow it to the water. | 6 | planned |
| econ-anystore | `FOR_SALE_ANY` line 809, `buyAny` line 6022 | The Anything Store sells 29 items including all the cars, boats up to the $10,000,000 mega yacht, the $200,000 aircraft package, the $110,000 train, the $4,000 snow plow, a $200 bag of corn, trailers, feeders and stands, the $100 fishing rod, and all seven baits. | 6 | planned |
| econ-grant | `grantItem` line 6001 | A purchase spawns by kind: cars and aircraft park in front, boats arrive on a boat trailer, trailers spawn empty, feeders and stands add to your place-count, the rod sets `hasRod`, bait becomes the active bait, the plow drops as a hitchable prop, the train unlocks, and corn adds a bag. | 6 | planned |
| econ-huntstore | `huntList` loop line 5983, `FOR_SALE_HUNT` line 804 | The hunting store sells 10 items at $100 each: bow and arrow, decoy, camo suit, deer scent, binoculars, grunt call, extra ammo, targets, hand warmers and a fishing rod. Each lands in your inventory. | 8 | planned |
| econ-flystore | `flyList` loop line 6232, `FOR_SALE_FLY` line 795 | The flying store sells plane $60,000, biplane $40,000, jet $200,000, helicopter $80,000, chopper $120,000 and rocket ship $500,000. A bought aircraft parks out front and sets `aircraftOwned`; the rocket sets `rocketOwned` and waits on the launch pad. | 10 | planned |
| econ-standstore | `standList` loop line 5535 | The stand store sells a tree stand for $1,000 and a ground blind for $400. Both add to your place-count and are set down with the O key. | 8 | planned |
| econ-saddleshop | `saddleList` loop line 6226, `SADDLES` line 839 | The saddle shop sells 6 saddles at $100 each: Western, Racing, Brown, Black, Pink and Show. They go into your inventory for use on a horse. | 11 | planned |
| econ-bucketshop | `buyBucket` line 4774, `BUCKET_COLORS` line 798 | The Buckets shop sells a milk bucket in 8 colours for $200: Red, Blue, Green, Yellow, Pink, White, Orange and Purple. You can hold one bucket at a time. | 11 | planned |
| econ-bikestore | `bikeList` loop line 6263, `BIKESTORE` line 918 | The bike shop beside the flying dealership sells the 8 bikes with their mph and price on the card, plus a Details preview of the frame colour. | 6 | planned |
| econ-sellbox | `openSellPanel` line 6555, `SELLBOX` line 792 | Driving within 140 units of the sell box (or standing there with a part-full milk bucket) shows the Sell button. The panel lists the vehicle you are in, the trailer you tow, each item on that trailer, and a milk bucket. | 6 | planned |
| econ-sell-payout | `sellPart` line 6585, `buyPrice` line 6574 | Selling a vehicle pays back the full buy price. A trailer pays $5,000, or $8,000 if it is the mower. Selling drops you on foot with no hitch. | 6 | planned |
| econ-sell-milk | `sellPart` line 6589 | Selling milk pays `200 * fill`, so a full bucket is $200. The bucket is consumed. | 11 | planned |
| econ-details | `showVehicleDetails` line 5449, `makeCard` line 5465 | Every vehicle store card has a Details button that opens a preview drawing the real in-game vehicle art at 2x, plus its top speed in mph and its price. | 6 | planned |
| econ-clothes | `SHIRT_COLORS` line 5719, `SHIRT_WORDS` line 5720 | The closet inside any house opens a dressing room with 30 shirt colours, 21 preset words or emoji, and a free-text field capped at 10 uppercase characters. | 11 | planned |
| race-start | `startRace` line 1324 | Tapping Start the Race puts you and the rival on the start grid, you on the left and the rival on the right, 44 units back and 34 units to each side. If you are on foot or in a boat you are dropped into the quad. | 7 | planned |
| race-rival-speed | `startRace` line 1326, `RIVAL_MAX` line 755 | The rival drives the same car you chose but at 80 percent of your top speed, so items and cornering decide the race. | 7 | planned |
| race-countdown | `setCountdown` line 1338, `update` line 2079 | A 3.2 second countdown shows 3, 2, 1, then GO! for 0.7 seconds. Nobody can move during the countdown because `lock` freezes input. | 7 | planned |
| race-track | `buildTrack` line 1173, `TRACK_W` line 744 | The dirt loop is a 400 point rounded rectangle between 380 and `WORLD-380` with corner radius 520, drawn 170 units wide. The start line is at the bottom middle. | 7 | planned |
| race-progress | `updateProgress` line 1296 | Lap progress is counted by nearest waypoint index, accepting jumps of 1 to 3 forward or backward, so cutting the course does not falsely advance you. | 7 | planned |
| race-rival-ai | `updateRival` line 1307 | The rival aims 6 waypoints ahead, steers at most 0.05 radians per tick, slows up to 42 percent in corners, loses another 55 percent while item slowed, and is slowed 3 percent per tick in mud. | 7 | planned |
| race-items | `buildCheckpoints` line 1288, `update` line 2094 | Four item boxes sit at 20, 40, 60 and 80 percent around the lap. The first racer within 80 units claims it and slows the other racer for 1.8 seconds to half speed, with a banana flash message. | 7 | planned |
| race-win | `update` line 2110, `LAPS` line 745 | The race is 1 lap. Finishing first pays $10,000 and shows the win banner; the rival finishing first shows a try-again banner. The race button becomes Race Again. | 7 | planned |
| race-freeroam | `update` line 2087 | Driving during a race behaves exactly like free roam: there are no invisible walls and no forced respawn for leaving the dirt. `strikes` and `offCooldown` exist (line 749) but are only reset, never enforced. | 7 | planned |
| race-end | `endRace` line 1351 | Tapping End Race abandons the race with no win and no loss, clears the countdown and status, and resets the button to Start the Race. | 7 | planned |
| hunt-scope | `keydown` line 5420, `drawScope` line 5351 | Pressing G on foot raises the rifle scope: the view zooms to 2.4x, the screen darkens outside a circle of 32 percent of the smaller screen dimension, and a crosshair follows the mouse. | 8 | planned |
| hunt-fire | `fireGun` line 5165 | Clicking while aiming is a hit-scan: the nearest living animal within 42 world units of the crosshair dies. Dust puffs at the impact point. | 8 | planned |
| hunt-bow | `toggleBow` line 6071, `bowTwang` line 5176 | Owning a bow lets you swap between bow and rifle from the inventory. The bow plays a 420Hz to 110Hz twang instead of the rifle crack. | 8 | planned |
| hunt-gunshot | `gunshot` line 5186 | The rifle plays a 0.18 second high-passed noise burst at 700Hz. | 8 | planned |
| hunt-camo | `toggleCamo` line 6067, `updateAnimals` line 5043 | Wearing the camo suit stops prey from fleeing and stops wolves from hunting you, no matter how close you get. | 8 | planned |
| hunt-scent | `sprayScent` line 6047 | Spraying deer scent on a feeder within 280 units consumes one bottle and raises that feeder's attraction radius from 3,500 to 6,000 units. | 8 | planned |
| hunt-grunt | `gruntCall` line 6057, `grunt` line 6038 | The grunt call works 10 times. Each use plays a 125Hz to 68Hz grunt and turns every deer and buck within 1,100 units toward you at speed 2.2, reporting how many are coming. | 8 | planned |
| hunt-carry-corn | `carryCorn` line 6075, `CORN_BAG` line 1001 | Pressing B on foot picks up a corn bag. Pressing B again within 140 units of a feeder adds 6 drops up to `CORN_MAX` 18; within 150 of a trailer it loads the corn onto the trailer instead. | 8 | planned |
| hunt-corn-clock | `update` line 1779, `CORN_MAX` line 1000 | Every 4 game hours (`cornClock`) each feeder with corn loses 1 unit. A full feeder of 18 drops therefore lasts 3 full game days. | 8 | planned |
| hunt-corn-trailer | `update` line 1781 | Towing a loaded corn trailer within 150 units of a feeder tops that feeder up automatically and reports the new fill percent. | 6 | planned |
| hunt-feeders | `buildFeeders` line 4707, `drawFeeder` line 5325 | Four feeders start beside the four tree stands at `stand.x+80, stand.y-20`, each full at 18 and named Feeder 1 to Feeder 4, drawn with 16 scattered corn kernels. | 8 | planned |
| hunt-place-feeder | `keydown` line 5439 | Pressing P on foot picks up a feeder you are standing within 55 units of, or sets down a bought one where you stand, named for the next free number. | 8 | planned |
| hunt-stands | `buildTreestands` line 4701 | Four tree stands sit east and south of the lake at `pond` offsets (+7500,-7500), (+8500,+4000), (+4000,+8500) and (-2000,+9000). | 8 | planned |
| hunt-climb | `boardOrExit` line 1571 | Climbing a stand within 80 units perches you at height 30 for a tree stand or 5 for a ground blind, and animals stop fleeing from you while you are up there. | 8 | planned |
| hunt-place-stand | `keydown` line 5426 | Pressing O on foot sets down a bought stand where you stand, as a tree stand or ground blind depending on which you bought last. | 8 | planned |
| hunt-decoy | `huntList` handler line 5991 | Buying a $100 decoy adds one to your feeder place-count, so it is set down with P and attracts animals like a feeder. | 8 | planned |
| hunt-kill | `killAnimal` line 5086 | A killed animal leaves a carcass on the ground with a dust burst. Only the last 50 carcasses are kept. | 8 | planned |
| hunt-roadkill | `update` line 2039 | Driving a land vehicle faster than 1.5 into an animal within 26 units kills it. An aircraft flying below height 55 does the same. | 8 | planned |
| hunt-sell-kills | `sellKills` line 5121 | Selling the kills your dog fetched pays $10,000 per wolf, $8,000 per bat and $4,000 for everything else, adds each to your trophy counts, and drops a skull on the ground for every buck. | 8 | planned |
| hunt-trophy-room | `drawTrophyRoom` line 4552, `drawTrophyMount` line 4565 | The trophy room behind the garage shows 8 wall mounts (buck, deer, tiger, lion, zebra, wolf, rabbit, bat) each with your kill count. | 8 | planned |
| animal-deer-buck | `buildAnimals` line 4692, `spawnAnimal` line 4657 | 1,240 deer-family animals spawn on open land with a 58 percent buck chance; the rest split 70 percent doe and 30 percent rabbit. | 8 | planned |
| animal-stand-cluster | `buildAnimals` line 4693 | Each of the four tree stands gets 24 extra animals spawned 130 to 620 units away at an 80 percent buck chance, so hunting near a stand pays off. | 8 | planned |
| animal-lion | `buildAnimals` line 4694 | 108 lions roam the open map. Killing one and selling it pays $4,000. | 8 | planned |
| animal-tiger | `buildAnimals` line 4695 | 108 tigers roam the open map. Killing one and selling it pays $4,000. | 8 | planned |
| animal-zebra | `buildAnimals` line 4696 | 120 zebras roam the open map. Killing one and selling it pays $4,000. | 8 | planned |
| animal-bat | `buildAnimals` line 4697, `updateAnimals` line 5052 | 120 bats roam the map. Bats are fast movers (target speed 2.4 wandering, 3.4 fleeing) and are the only animal allowed to fly over the lake. Selling one pays $8,000. | 8 | planned |
| animal-wolf | `buildAnimals` line 4698, `updateAnimals` line 5038 | 84 wolves hunt you. On foot, outside a stand and without camo, a wolf within 720 units charges at speed 3.5, and within 30 units it kills you. Selling a wolf pays $10,000. | 8 | planned |
| animal-flee | `updateAnimals` line 5043 | Any non-wolf animal within 210 units of you turns and runs at 3.4 (rabbit or bat) or 2.3 (everything else), unless you are camoed or up in a stand. | 8 | planned |
| animal-corn-draw | `updateAnimals` line 5046 | An idle animal heads for the nearest feeder that still has corn, from up to 3,500 units away (6,000 if scented), and stops once it is within 30 units. | 8 | planned |
| animal-fence | `updateAnimals` line 5055 | The compound fence pushes any animal that enters back out the nearest side, and the dock corridor opening is blocked the same way, so animals never wander into your base. | 3 | planned |
| animal-nolake | `updateAnimals` line 5053, `buildAnimals` line 4699 | Non-bat animals bounce off the lake edge at `pond.r + 25` and any that spawn in the water are moved to dry land. | 8 | planned |
| animal-ride | `boardOrExit` line 1547 | Riding an animal, press E or Switch to hop off. If the animal dies while you ride it, you drop back to foot automatically. | 8 | planned |
| animal-carcass | `drawCarcass` line 5137 | A dead animal lies on its side with stiff legs and an X eye, coloured for its species, and stays there until the dog fetches it. | 8 | planned |
| animal-death | `playerDies` line 5149 | A wolf catching you wipes all skulls, kills and trophies, rebuilds the animals, stands, feeders and trailers, resets every vehicle, and respawns you on foot at `GARAGE.x, GARAGE.y+190` with 3.5 seconds of spawn protection. Money is not lost. | 13 | planned |
| fish-population | `buildFish` line 4660 | 900 fish swim inside `pond.r - 90`: 55 percent little, 25 percent middle, 13 percent big and 7 percent huge. Plus exactly 2 rainbow fish spawned near the lake centre. | 9 | planned |
| fish-swim | `updateFish` line 4669 | Each fish turns randomly every 1 to 3 seconds, swims at 0.5 to 1.4 units per tick, and reverses if it would pass `pond.r - 45`. | 9 | planned |
| fish-values | `FISH` line 940 | Fish sell for little $1,000, middle $10,000, big $15,000, huge $30,000 and rainbow $1,000,000. Sizes drawn are 7, 11, 16, 23 and 14. | 9 | planned |
| fish-cast | `castFish` line 6090 | Casting from a boat or a deck needs a rod and has a 1 second cooldown. You cast one line per rod you own at the nearest fish within 360 units. With no bait the odds are little 0.55, middle 0.45, big 0.35, huge 0.25, rainbow 0.12. | 9 | planned |
| fish-rainbow-catch | `castFish` line 6110 | Landing a rainbow fish pays $1,000,000 instantly, starts a 6 second rainbow banner, and spawns a replacement rainbow in the middle of the lake so there are always two. | 9 | planned |
| fish-baits | `BAITS` line 948 | Seven baits raise the odds: Cheap $100 (0.90/0.30/0.15/0.08/0.03), Bad $400 (0.85 little only), Good $1,000 (0.72/0.62/0.42/0.22/0.05), Mediocre $4,000 (0.50/0.72/0.64/0.34/0.06), Pro $10,000 (0.72/0.74/0.68/0.54/0.10), Ace $20,000 (0.46 across the board, 0.16 rainbow), Rainbow $100,000 (0.98 on everything). | 9 | planned |
| fish-rainbow-bait | `castFish` line 6108, `grantItem` line 6017 | The Rainbow Bait is set to 2 uses when bought. Each successful catch spends one, and it clears itself when used up. | 9 | planned |
| fish-sell | `sellFish` line 6116 | The Sell Fish button pays the summed value of everything in your fish inventory, reports the count and total, and empties the inventory. | 9 | planned |
| fish-count | `fishCount` line 6123, `update` line 2226 | The Sell Fish button only appears when you are holding at least one fish and are not inside a house. | 9 | planned |
| boat-shore | `update` line 1893 | A watercraft that reaches `pond.r - 16` slides along the shore instead of beaching, and loses 45 percent of its speed. | 9 | planned |
| boat-exit | `boardOrExit` line 1580 | You cannot step out of the speedboat while more than `pond.r - 170` from shore; the hint tells you to sail to the shore first. | 9 | planned |
| boat-waves | `update` line 2124 | A new wave spawns every 1.0 to 2.6 seconds, 45 percent of them big. A big wave hit while moving faster than 2 launches the boat with an upward velocity of `6 + amp * 0.35`. | 9 | planned |
| boat-deck | `walkDeck` line 6127, `deckRadius` line 6126 | Tap Walk the Deck on a fishing boat or the yacht to walk around on it. The deck radius is 150 on the yacht, 92 on the big fishing boat and 46 on the mini. You are always pulled back inside that radius, never to shore. | 9 | planned |
| boat-helm | `backToHelm` line 6494 | Tap Back to Helm to leave the deck and drive again. Leaving the water at all also clears deck mode. | 9 | planned |
| boat-nets | `throwNets` line 6495 | The yacht's nets have a 2 second cooldown and haul in up to 16 fish within 480 units at once. The nets never catch rainbow fish. | 9 | planned |
| boat-yacht-cabin | `enterYachtCabin` line 5555 | Tap Cabin on the yacht to walk into an interior identical to your house, with a bed, kitchen, closet and door. Leaving puts you back at the helm in the same spot. | 9 | planned |
| boat-yacht-ski | `hopOnJetSki` line 6128, `loadYachtSki` line 6136 | Tap Jet Ski on the yacht to drop into a jet ski 110 units to the side. The yacht stays parked where it floated. Drive back within 400 units and tap Load on Yacht to reload it. | 9 | planned |
| boat-yacht-tender | `hopOnTender` line 6450, `loadYachtTender` line 6458 | Tap Tender on the yacht to drop onto a mini fishing boat 230 units astern. Load it back within 400 units. | 9 | planned |
| boat-yacht-utv | `launchYachtUTV` line 6464, `loadYachtUTV` line 6474 | The yacht carries a side-by-side. You must be within `pond.r - 360` of the shore to drop it, and it lands 95 units onto dry ground. Drive back within 380 units of the yacht to load it. `yachtHasUTV` tracks whether it is aboard. | 9 | planned |
| boat-yacht-heli | `launchYachtHeli` line 6480, `landYachtHeli` line 6488 | The yacht carries a helicopter that lifts off at altitude 130 and lands back within 420 units of the yacht. `yachtHasHeli` tracks whether it is aboard. | 9 | planned |
| boat-dock | `drawDock` line 3203, `DOCK_WATER` line 769 | A dock reaches east from your lawn into the lake. The starter speedboat is parked in the water at `pond.x - pond.r + 90`. | 9 | planned |
| air-altitude | `update` line 1998 | Q climbs and Z dives 3.4 units per tick, clamped between altitude 45 and 320. `planeAlt` becomes the drawn air height. | 10 | planned |
| air-roll | `planeStunt` line 1596, `update` line 2000 | Pressing R in the plane starts a 0.7 second barrel roll that leaves a gold smoke trail. Helicopters refuse the stunt. | 10 | planned |
| air-bomb | `dropBomb` line 1602, `update` line 2028 | Pressing B in a plane or helicopter drops a bomb that carries half your forward speed and falls 6 units per tick from `planeAlt + 20`. | 10 | planned |
| air-explode | `explode` line 1608, `boom` line 1622 | A bomb impact removes every tree and flower within 95 units, kills every animal within 130 units, leaves a scorch mark of radius 46 to 62 (max 70 kept), throws 28 fire and smoke particles, and plays a 0.55 second low-passed noise boom. | 10 | planned |
| air-runway-helipad | `drawRunway` line 3694, `drawHelipad` line 3684 | The runway sits at `pond.x - 7330, pond.y - 1090` and the helipad at `pond.x - 6920, pond.y - 1070`, both west of the giant lake behind the trophy room. | 10 | planned |
| rail-buy | `buyTrain` line 1507 | The Ride Train button reads Buy Train ($110k) until you pay $110,000. Boarding before then is refused. | 10 | planned |
| rail-board | `boardTrain` line 1524 | Walk within 260 units of the train and tap Ride Train to board. Driving is gas and brake, or you pick a station. | 10 | planned |
| rail-loop | `buildTrainTrack` line 1202 | The main loop is a 1,200 point rounded rectangle between 150 and `WORLD-150` with radius 360, with four stations: North, East, South and West at the midpoints of each side. | 10 | planned |
| rail-gaps | `inTrainGap` line 1249, `trainGapHeight` line 1250 | Four jump gaps sit at 12, 37, 63 and 88 percent around the loop, each 26 points wide. The train arcs up to 80 units high over each gap. | 10 | planned |
| rail-spur | `buildSpur` line 1222 | A 320 point spur runs from the West Station to your west fence at `COMPOUND.x1 - 10, pond.y`, humping up to 40 units high as a bridge where it crosses the race track at x 380. The train starts parked at this Fence Station. | 10 | planned |
| rail-sky | `buildSkyTrack` line 1238, `toggleInAir` line 1517 | Tapping In Air puts the train on a 1,500 point sky track of three linked circles of radius 2,200 at altitude 340, with a dip back to ground height 12 across 140 points at index 0. | 10 | planned |
| rail-route | `routeToLoopStop` line 5636, `routeToFence` line 5637 | Picking a station auto-drives the train there, transferring between spur and loop through the West junction as needed, and stops it exactly at the platform. | 10 | planned |
| rail-return | `update` line 1919, `boardOrExit` line 1550 | Hopping off the train sets `trainReturning`, and the train drives itself home to the Fence Station over the bridge. You step off 80 units to the side. | 10 | planned |
| rail-stations | `drawStations` line 3268 | Each of the four loop stations is drawn as a platform you can see from the ground and is listed in the Stops panel along with the Fence Station. | 10 | planned |
| space-buy | `flyList` handler line 6240 | Buying the $500,000 rocket ship sets `rocketOwned` and parks it on the launch pad at `pond.x - 6850, pond.y - 1090` beside the runway. | 10 | planned |
| space-blastoff | `blastOff` line 3761 | Standing within 130 units of the launch pad on foot shows Blast Off. Tapping it hides the world HUD and starts you in space at (0,-200) with upward velocity 3 and 1.2 seconds of collision grace. | 10 | planned |
| space-fly | `updateSpace` line 3792 | In space, left and right turn 0.045 radians per tick, gas adds 0.45 thrust, drag is 0.992 and speed caps at 24. | 10 | planned |
| space-planets | `buildSpace` line 3705 | Four bodies orbit the starfield: Mars radius 520, Neptune radius 600, Saturn radius 540 with a ring, and the Moon radius 430. A Land button appears within 300 units of one and landing happens automatically within 28 units. | 10 | planned |
| space-meteors | `drawMeteor` line 3720, `crashMeteor` line 3733 | 16 meteorites of radius 26 to 58 drift and wrap at plus or minus 4,600. Touching one outside the grace window crashes your rocket and sends you straight back to the launch pad. | 10 | planned |
| space-surface | `landOnPlanet` line 3773 | Each planet surface is a disc of radius 2,600 holding 14 gems, 22 rocks and 5 wandering aliens, generated once and remembered. You land at the south of the disc. | 10 | planned |
| space-gems | `updatePlanet` line 3814 | Walking within 55 units of a space gem collects it for $5,000. Movement on a planet is 9 units per tick in 8 directions, clamped to the disc edge. | 10 | planned |
| space-leave | `boardRocketFromPlanet` line 3786, `returnToPad` line 3767 | Walking within 120 units of your rocket shows Board Rocket, which relaunches you above the planet. Return to Pad brings you back on foot at the launch pad. | 10 | planned |
| space-hud | `hideWorldHud` line 3863, `showWorldHud` line 3864 | Space and planet mode hide every world button and only show Return to Pad, Land on Planet and Board Rocket, restoring the world HUD when you return. | 10 | planned |
| home-enter | `enterHouse` line 5547 | Walking within 140 units of `HOUSE.x, HOUSE.y+240` shows Enter House. Inside, you walk at 5.5 units per tick in a 2D room. | 11 | planned |
| home-objects | `houseObjects` line 5560 | The house interior has a bed at 74 percent width and 60 percent height, a kitchen at 24/54, a closet at 50/30 and a door at (95, height-110). Standing within 100 units of a station enables its button. | 11 | planned |
| home-eat | `eat` line 5561 | Eating at the kitchen costs $100 and resets hunger to 0. With less than $100 it refuses with a broke message. | 11 | planned |
| home-sleep | `doSleep` line 5598, `padPress` line 5608 | At the bed, a number pad takes an hour from 0 to 23. Sleeping sets the clock to that hour and rolls fresh weather for the new day. | 11 | planned |
| home-starve | `starve` line 5588, `update` line 1817 | Hunger climbs one unit per game hour. Reaching 24 (a full game day with no food) calls `loseEverything`. | 13 | planned |
| home-lose-everything | `loseEverything` line 5568 | Starving, or letting your dog starve, resets trophies, animals, feeders, stands, trailers, vehicles, paint, tuning, inventory, fish, bait, plow, camo, bow, corn, train and aircraft ownership, and puts your money back to $20,000. | 13 | planned |
| home-exit | `exitHouse` line 5589 | Walking within 56 units of the door leaves the building and puts you back where you came from: the yacht helm, a cabin door, a camper, an RV driver seat, your own built house, or `HOUSE.x, HOUSE.y+290`. | 11 | planned |
| home-closet | `closetBtn` handler line 5726 | The closet opens the dressing room with shirt colours, preset words and free text, applied to the drawn character. | 11 | planned |
| home-cabins | `buildCabins` line 4714, `enterCabin` line 4856 | Eight cabins are dotted around the map at fixed coordinates. Walking within 130 units on foot shows Enter Cabin, and the interior is the same as your house. | 11 | planned |
| home-camper | `enterCamper` line 4862, `nearestCamper` line 4860 | A towable camper trailer can be entered on foot within 130 units, giving the same sleep, eat and dress interior. | 11 | planned |
| home-rv-interior | `enterCamperRV` line 4867 | While driving the RV, tap Inside Camper to step into the back, and you return to the driver seat when you leave. | 11 | planned |
| farm-horses | `buildHorses` line 4872 | Five horses live in the corral behind the Winter Wonderland, in brown, black, cream, palomino and chestnut, laid out three across. | 11 | planned |
| farm-horse-ai | `updateHorses` line 4880 | An unridden horse turns randomly every 2 to 5 seconds and picks target speed 0 or 0.7, and bounces off the corral walls 28 units in from the fence. | 11 | planned |
| farm-saddle | `putOnHorse` line 6208, `hasSaddle` line 6205 | Standing within 150 units of an unsaddled horse with a saddle in your inventory, tap Put on Horse. The saddle is consumed and the horse is marked saddled. | 11 | planned |
| farm-ride | `rideHorse` line 6216 | Tap Ride near a saddled horse to mount it at `SPEEDS.mount` (9 max, 126 mph). Tap again to hop off, and the horse stops where you left it. | 11 | planned |
| farm-cows | `buildCows` line 4734, `drawCowPen` line 4753 | Five cows wander a pen at `FLYSTORE.x, FLYSTORE.y - 560` with half-extents 150 by 110, bobbing as they idle. | 11 | planned |
| farm-milk | `startMilking` line 4848, `update` line 2266 | With a bucket, stand within 120 units of a cow and tap Milk Cow. Holding still for 10 seconds adds 20 percent milk and one use. Moving more than 150 units away cancels it. Five milkings fill the bucket. | 11 | planned |
| farm-bucket-hud | `update` line 2277 | The milk HUD shows the bucket colour, the fill percent and the milkings used out of 5, and reads FULL at 5. | 11 | planned |
| fun-slide | `slide` line 6142 | Within 170 units of the slide, tap Slide for a 14 unit whoosh southward that decays at 0.82 per tick and pushes your speed to at least 4. | 11 | planned |
| fun-swing | `startSwing` line 6147 | Within 160 units of the swings on foot, tap Swing to be locked onto the seat for 6 seconds, then released with a hint. | 11 | planned |
| fun-balls | `update` line 2287, `buildFunStuff` line 4805 | A soccer ball sits at the goal and a basketball at the hoop. Walking into one within `radius + 24` kicks it at `8 + speed * 1.5`. Scoring pays $100 and returns the ball home. A ball more than 800 units from home also resets. | 11 | planned |
| fun-trampoline | `update` line 2295 | Standing within 40 units of the trampoline on foot bounces you up to 36 units high with a BOING hint the first time. | 11 | planned |
| fun-props | `buildFunStuff` line 4783, `FUN_DRAW` line 4824 | 22 yard props are auto-placed inside the compound without overlapping buildings: trampoline, hoop, soccer goal, slide, seesaw, bouncy castle, sandbox, campfire, bbq, picnic table, umbrella, lemonade stand, fountain, statue, windmill, garden, pumpkins, hay, scarecrow, chicken coop, swings and treehouse. | 11 | planned |
| fun-wonderland | `drawWonderland` line 6174, `WONDER` line 832 | A 210 radius Winter Wonderland behind the dog house holds a snowman, the blue slide and the swing set. Everything inside it moves 1.7 times faster (`update` line 1857). | 11 | planned |
| fun-carwash | `update` line 1877, `drawCarWash` line 4920 | Driving a land vehicle within 90 units of the car wash removes 0.035 mud per tick from the car and any hitched trailer, with a spray of blue droplets. | 6 | planned |
| fun-nozzle | `nozzleBtn` handler line 6396, `update` line 1883 | Pick up the wall nozzle within 110 units and hold Spray to clean any parked vehicle within 110 units at 0.02 mud per tick. Walking more than 260 units away snaps the hose back. | 6 | planned |
| fun-firetruck-fill | `fillTruck` line 6356 | In the fire truck within 175 units of the hydrant by the dock, tap Fill to set the water tank to 100 percent. | 6 | planned |
| fun-firetruck-spray | `sprayWater` line 6361 | Each Spray press costs 3 percent water and throws 16 droplets forward. Hitting a parked vehicle within 55 units of the nozzle tip washes 0.05 mud off it, anywhere on the map. | 6 | planned |
| fun-ladder | `toggleLadder` line 6370 | The fire truck's Ladder button raises and lowers the ladder, which is only cosmetic. | 6 | planned |
| helper-follow | `update` line 1806 | A helper buddy trails 80 units behind you, closing 18 percent of the gap per tick with a minimum step of 3. | 5 | planned |
| helper-ask | `helperFetch` line 5750, `parseAsk` line 5730 | Typing a request into Ask matches keywords to a vehicle (pontoon, jet ski, speedboat, mini fishing, fishing boat, yacht, quad, side-by-side, truck, motorcycle, ferrari, semi), charges the Anything Store price, and delivers it in about 4 seconds. Any unmatched text containing "boat" defaults to a pontoon. | 5 | planned |
| helper-corn | `helperFillFeeders` line 5740 | Asking for corn, feeders or a fill charges $200 per feeder and, after 4 seconds, tops every feeder to `CORN_MAX`. It refuses if there are no feeders or they are all already full. | 8 | planned |
| helper-deliver | `deliverHelperItem` line 5762 | The fetched vehicle appears 85 units to your right, or in the water beside you when you are within `pond.r + 700` of the lake, or at the dock when you are far from water. The GPS points at it either way. | 5 | planned |
| land-plots | `LAND_PLOTS` line 848, `LAND_RADIUS` line 846 | Six buildable plots sit on a 16,000 unit ring around the lake, spaced 60 degrees apart starting at 15 degrees. The base plot size is 1,600. | 12 | planned |
| land-buy | `buyLand` line 6331, `LAND_COST` line 847 | Walking to a plot's For Sale sign within 180 units and tapping Buy Land charges $6,000 and marks the plot owned. The purchase is saved. | 12 | planned |
| land-upgrade | `upgradeLand` line 6318, `LAND_UPGRADE_COST` line 857 | The upgrade marker at `plot.x - size * 0.55` sells four size levels: $8,000, $15,000, $25,000 and $40,000, multiplying the plot to 1.35x, 1.8x, 2.3x and 2.8x. At the top level the menu says the land is already the biggest size. | 12 | planned |
| land-build | `constructBuilding` line 6340, `BUILD_COST` line 853 | On owned land you build a garage $3,000, a trophy room $3,000, a small house $4,000, a medium house $10,000 or a huge house $25,000. Each build is saved to the plot slot. | 12 | planned |
| land-slots | `nearestBuildSlot` line 1400 | Each plot has two build slots, but the second shack only appears once the first slot is built. | 12 | planned |
| land-house-scale | `HOUSE_SCALE` line 4478, `drawGenericHouse` line 4479 | Built houses draw at 0.55 scale for small, 0.82 for medium and 1.15 for huge, so a bigger tier really looks bigger. | 12 | planned |
| land-enter-house | `enterMyHouse` line 5549 | Walking within 120 units of a house you built takes you inside the same interior as the community house, and leaving puts you back where you stood. | 12 | planned |
| land-garage | `nearestMyGarage` line 3871, `openGarageDoor` line 3888 | Within 220 units of a garage you built, on foot, an Open Garage button appears. Opening the door is saved to the plot. | 12 | planned |
| land-park | `parkInGarage` line 3895 | With the door open and a land vehicle, Park in the Garage stores it at the slot position plus 30 with its mud, and drops you on foot 90 units in front. | 12 | planned |
| land-roads | `drawLandRoads` line 4422 | Dirt roads are drawn from the home compound out to every land plot so you can always find your land. | 12 | planned |
| land-menu-close | `update` line 2312 | Walking out of range of the build shack, For Sale sign or upgrade marker, or getting into a vehicle, closes the open build menu automatically. | 12 | planned |
| tow-hitch | `toggleHitch` line 4991 | Press T or tap Tow from a land vehicle to grab the nearest trailer within 240 units, checked at both ends so a long trailer still catches. It snaps in line behind you. Pressing again drops it. | 6 | planned |
| tow-plow-hitch | `toggleHitch` line 4996 | If a snow plow prop is within 240 units and no plow is attached, hitching picks up the plow onto the front of the car instead of a trailer. | 6 | planned |
| tow-update | `updateTow` line 5016 | The hitched trailer always points back at the hitch ball, which sits `RIG[type][0] + 8` units behind the vehicle centre. | 6 | planned |
| tow-load | `toggleOnTrailer` line 4960 | Get on Trailer loads the car you are driving onto the nearest flat trailer within 150 units, or the boat you are driving onto the nearest boat trailer within 160 units, if it has a free slot. You step off beside it. | 6 | planned |
| tow-unload | `toggleOnTrailer` line 4977 | With nothing to load, the button unloads the last vehicle from the nearest loaded trailer within 140 units, parking it 92 units to the side. | 6 | planned |
| tow-trailer-caps | `buildTrailers` line 4951, `boatList` handler line 5507 | Two trailers start by the garage: a flat trailer length 44 cap 1 and a boat trailer length 50 cap 1. Bought trailers are longer: long length 132 cap 4, mega length 380 cap 12, boat length 50 cap 1. | 6 | planned |
| tow-mud | `update` line 1873 | A towed trailer picks up its own mud at 0.025 per tick when it drives through a puddle, tracked separately from the car. | 6 | planned |
| tow-mower | `update` line 1763, `mowBtn` handler line 6392 | With the mower hitched and MOW on, driving faster than 0.3 cuts a swath of grass cells 1.5 cells either side, throwing green clippings. Cut cells are remembered. | 11 | planned |
| tow-grass-regrow | `update` line 1775, `grassClock` line 1035 | Grass grows back every 4 game days (96 game hours), clearing every cut cell at once with a hint. | 11 | planned |
| tow-plow-scrape | `update` line 1799, `togglePlow` line 6406 | With the plow down on snow deeper than 0.12 and moving faster than 1.5, snow piles build in front (max 150 piles, max size 50) and `plowLoad` climbs to 5, capping your top speed. Raising the plow dumps the pile. | 11 | planned |
| tow-plow-stuck | `update` line 1806 | Past a plow load of 4.6 you get a warning that the plow is buried and you must dump the pile to drive again. At a full load of 5 the drag factor is 0, so you stop entirely. | 11 | planned |
| weather-roll | `rollWeather` line 2720, `WEATHERS` line 980 | Each new day rolls weather: 62 percent sunny, 15 percent rainy, 11 percent foggy and 12 percent snowy, with a hint naming it. Sleeping also rolls a new day's weather. | 3 | planned |
| weather-render | `drawWeather` line 2726 | Rain draws 170 falling streaks over a blue tint, snow draws 170 flakes of varying size and drift, and fog is a flat 44 percent grey wash. | 3 | planned |
| weather-snow-level | `update` line 1786 | While snowing, `snowLevel` climbs 0.03 per second to 1. Otherwise it melts at 0.012 per second and existing snow piles shrink 1 unit per second until they vanish under size 4. | 3 | planned |
| weather-ice-handling | `update` line 1848 | On snow deeper than 0.25 in a land vehicle, acceleration is 1.3x, braking is halved, the handbrake barely grips at 0.95, the top speed is 1.5x, and your velocity only turns 6 percent per tick toward your heading, so you slide like ice. | 4 | planned |
| weather-snow-tracks | `update` line 1790 | Driving faster than 1 on snow deeper than 0.3 lays packed tyre tracks every 16 units, up to 600 of them, which vanish once the snow melts below 0.1. | 3 | planned |
| weather-night | `nightFactor` line 2713, `drawNightAndLights` line 2774 | Daytime is 8am to 8pm. Dusk fades in from 8pm to 9pm, dawn fades out from 7am to 8am, and full night darkens the world by 62 percent. | 3 | planned |
| weather-headlights | `drawNightAndLights` line 2778 | The Lights button on a land vehicle draws two additive headlight cones reaching 220 units, brighter at night, plus two bulbs on the nose. | 3 | planned |
| save-myland | `saveMyLand` line 868, `loadMyLand` line 869 | Land ownership, size level and every building are saved to `localStorage` under `fwa_myland_v1` and restored at load. Older saves without an `owned` flag are treated as owned when they already hold buildings. Nothing else in the game is persisted. | 13 | planned |

## Numbers to carry over

These are the raw constants read out of the 2D source. Use them directly in the 3D port so the feel and the economy match.

### SPEEDS (line 696). Columns are max, accel, brake, fric, rev, turn. HUD mph is `max * 14`.

| key | max | accel | brake | fric | rev | turn | mph |
|---|---|---|---|---|---|---|---|
| foot | 2.8 | 0.14 | 0.20 | 0.80 | -1.6 | 0.075 | 39 |
| atv | 57.6 | 0.90 | 0.46 | 0.985 | -5.0 | 0.062 | 806 |
| utv | 64.8 | 1.00 | 0.50 | 0.985 | -5.2 | 0.068 | 907 |
| truck | 51.6 | 0.70 | 0.52 | 0.986 | -4.4 | 0.046 | 722 |
| firetruck | 46.0 | 0.50 | 0.50 | 0.987 | -3.6 | 0.036 | 644 |
| monster | 56.0 | 0.64 | 0.50 | 0.986 | -4.0 | 0.044 | 784 |
| racecar | 112.0 | 1.70 | 0.66 | 0.987 | -4.0 | 0.078 | 1568 |
| muscle | 90.0 | 1.35 | 0.60 | 0.986 | -5.0 | 0.068 | 1260 |
| tractor | 7.142857 | 0.16 | 0.22 | 0.96 | -2.5 | 0.050 | 100 |
| rv | 50.0 | 0.42 | 0.46 | 0.987 | -3.4 | 0.034 | 700 |
| jet | 714.285714 | 14 | 8 | 0.99 | 0 | 0.030 | 10000 |
| biplane | 18 | 0.45 | 0.42 | 0.990 | 0 | 0.040 | 252 |
| chopper | 24 | 0.55 | 0.42 | 0.990 | -4 | 0.052 | 336 |
| canoe | 16.0 | 0.40 | 0.34 | 0.974 | -3.0 | 0.072 | 224 |
| sailboat | 22.0 | 0.42 | 0.36 | 0.982 | -3.0 | 0.046 | 308 |
| tugboat | 18.0 | 0.30 | 0.34 | 0.985 | -2.6 | 0.034 | 252 |
| moto | 75.0 | 1.20 | 0.48 | 0.984 | -4.4 | 0.084 | 1050 |
| lambo | 93.0 | 1.50 | 0.62 | 0.986 | -5.0 | 0.072 | 1302 |
| semi | 45.0 | 0.55 | 0.40 | 0.986 | -3.4 | 0.034 | 630 |
| boat | 30.0 | 0.60 | 0.42 | 0.980 | -4.8 | 0.056 | 420 |
| pontoon | 18.0 | 0.38 | 0.36 | 0.978 | -3.4 | 0.050 | 252 |
| fishingboat | 20.0 | 0.32 | 0.34 | 0.982 | -3.0 | 0.038 | 280 |
| minifishingboat | 24.0 | 0.46 | 0.40 | 0.980 | -3.6 | 0.060 | 336 |
| yacht | 20.0 | 0.30 | 0.32 | 0.985 | -2.6 | 0.030 | 280 |
| jetski | 28.0 | 0.62 | 0.44 | 0.976 | -4.0 | 0.088 | 392 |
| mount | 9.0 | 0.32 | 0.40 | 0.920 | -2.5 | 0.062 | 126 |
| train | 4000 | 0 | 0 | 1 | 0 | 0 | 56000 |
| plane | 26 | 0.6 | 0.40 | 0.992 | 0 | 0.030 | 364 |
| heli | 20 | 0.5 | 0.42 | 0.990 | -4 | 0.050 | 280 |

Bikes are generated at line 913 as `max = mph / 14 * 8`: kids 18, bmx 30, cruiser 28, mtb 44, road 60, ebike 40, emtb 56, supere 90 mph.

### World and layout

- World 72,000 x 72,000, fence margin 60 (line 674).
- Lake radius 6,480, centred at the world middle (line 766).
- Race track: 400 points, corner radius 520, inset 380, width 170, 1 lap (lines 744, 745, 1173).
- Train loop: 1,200 points, radius 360, inset 150, 4 stations, 4 jump gaps (line 1202). Spur 320 points with a 40 unit bridge. Sky track 1,500 points, three circles of radius 2,200 at altitude 340.
- Compound fence encloses the garage, trophy room, dealership, house and cow pen (line 840).
- Land plots: 6 on a 16,000 ring, base size 1,600 (lines 846, 848).
- Scenery: 520 trees, 460 rocks, 110 mud puddles plus one 440 radius puddle, 84 ramps, 56 bones, 1,500 patches, 7,000 tufts, 800 flowers (line 1063).
- Grass grid cell 110 (line 1032). Camera presets: 10 (line 1014). Vehicle rig offsets: `RIG` line 1028.

### Prices

- Start money $20,000. Race win $10,000. Goal or basket $100. Space gem $5,000.
- Cars: atv, utv, truck, moto, semi $20,000; muscle $45,000; rv $45,000; lambo $50,000; monster $40,000; tractor $25,000; racecar $80,000; firetruck $150,000.
- Boats: canoe $3,000; speedboat, pontoon, jet ski, mini fishing boat (dealer) $5,000; sailboat $12,000; tugboat $30,000; camper $35,000; mower $8,000; big fishing boat $50,000 at the Anything Store; mega yacht $10,000,000.
- Trailers: long $5,000 cap 4 length 132; mega $10,000 cap 12 length 380; boat $5,000 cap 1 length 50.
- Aircraft: biplane $40,000; plane $60,000; helicopter $80,000; chopper $120,000; jet $200,000; rocket $500,000. Aircraft package $200,000. Train $110,000.
- Gear: every hunting store item $100; saddles $100; bucket $200; corn bag $200; feeder $500; ground blind $400; tree stand $1,000; snow plow $4,000; fishing rod $100.
- Land: buy $6,000; upgrades $8,000, $15,000, $25,000, $40,000; garage $3,000; trophy room $3,000; small house $4,000; medium house $10,000; huge house $25,000.
- Living costs: eat $100; feed dog $10; speed tuning $10 per 10 mph.
- Helper: vehicle at the Anything Store price; filling all feeders $200 per feeder.

### Payouts

- Fish: little $1,000, middle $10,000, big $15,000, huge $30,000, rainbow $1,000,000.
- Kills: wolf $10,000, bat $8,000, everything else $4,000.
- Milk: $200 for a full bucket, prorated by fill.
- Phone games: dice six $5,000, coin flip $2,000, spin $25,000 / $10,000 / $1,000 / $500 / nothing.
- Selling a vehicle returns its full buy price. A trailer returns $5,000, a mower $8,000.

### Counts and timers

- Animals: 1,240 deer family (58 percent buck), 96 extra per stand cluster (24 each at 80 percent buck), 108 lions, 108 tigers, 120 zebras, 120 bats, 84 wolves.
- Fish: 900 in the lake (55 percent little, 25 percent middle, 13 percent big, 7 percent huge) plus 2 rainbow.
- Horses 5, cows 5, cabins 8, tree stands 4, feeders 4, fun props 22, meteors 16, planets 4, space stars 260, gems per planet 14.
- Time: 1 real second is 1 game minute; a full day is 24 real minutes; day starts at 8am.
- Corn: `CORN_MAX` 18, `CORN_BAG` 6, one drop every 4 game hours, so a full feeder lasts 3 game days.
- Hunger and dog food: 24 game hours to death.
- Grass regrows every 96 game hours. Snow builds at 0.03 per second and melts at 0.012.
- NOS lasts 3 seconds and doubles speed. Item slow lasts 1.8 seconds at half speed. Race countdown 3.2 seconds.
- Milking takes 10 seconds per 20 percent, 5 milkings to fill. Grunt call 10 uses. Rainbow bait 2 uses.
- Amazon delivery arrives in under 38 seconds and flies 62 units per tick. Helper errands take 4 seconds.
- Fishing cast cooldown 1 second, cast range 360 units. Yacht nets cooldown 2 seconds, range 480 units, up to 16 fish.
- Spawn protection after death 3.5 seconds. Rainbow celebration 6 seconds. Swing 6 seconds. Barrel roll 0.7 seconds.
- Smash-through threshold 200 mph (`200 / 14` units). Fire boost above 4,000 mph adds 100 mph.

### Persistence

Only `fwa_myland_v1` in `localStorage` is saved (line 868): plot ownership, size level and buildings. Money, vehicles, trophies, fish, inventory and world state all reset on reload.
