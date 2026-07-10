// Bundled, kid-appropriate trivia question bank (ages 6-14).
//
// Ships with the app so Trivia works fully offline and never depends on an
// external service. Organized by the three difficulty tiers the age picker
// maps to (younger = easier):
//   - "easy"   -> 4yo / 8yo / 99yo modes  (roughly 6-year-old level)
//   - "medium" -> 12yo mode              (roughly 8-11-year-old level)
//   - "hard"   -> 24yo mode              (middle-school level)
//
// Every answer has been double-checked for accuracy. Content is timeless
// (no fast-aging pop culture, no brands being endorsed, nothing scary/adult).
// Each question has exactly one correct answer and three distinct wrong ones.

export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface TriviaQuestion {
  category: string;
  difficulty: QuestionDifficulty;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

export const QUESTION_BANK: TriviaQuestion[] = [
  // ---------------------------------------------------------------------------
  // EASY  (~6-year-old level)
  // ---------------------------------------------------------------------------

  // Animals
  { category: "Animals", difficulty: "easy", question: "How many legs does a spider have?", correct_answer: "8", incorrect_answers: ["6", "4", "10"] },
  { category: "Animals", difficulty: "easy", question: "What sound does a cow make?", correct_answer: "Moo", incorrect_answers: ["Woof", "Oink", "Meow"] },
  { category: "Animals", difficulty: "easy", question: "Which animal is often called man's best friend?", correct_answer: "Dog", incorrect_answers: ["Cat", "Fish", "Snake"] },
  { category: "Animals", difficulty: "easy", question: "What do bees make?", correct_answer: "Honey", incorrect_answers: ["Milk", "Bread", "Butter"] },
  { category: "Animals", difficulty: "easy", question: "Which animal has a long trunk?", correct_answer: "Elephant", incorrect_answers: ["Giraffe", "Zebra", "Lion"] },
  { category: "Animals", difficulty: "easy", question: "What do we call a baby dog?", correct_answer: "Puppy", incorrect_answers: ["Kitten", "Calf", "Chick"] },
  { category: "Animals", difficulty: "easy", question: "Which animal is known for its black and white stripes?", correct_answer: "Zebra", incorrect_answers: ["Lion", "Bear", "Fox"] },
  { category: "Animals", difficulty: "easy", question: "Which black and white bird cannot fly and lives where it is cold?", correct_answer: "Penguin", incorrect_answers: ["Eagle", "Parrot", "Robin"] },
  { category: "Animals", difficulty: "easy", question: "Which animal says 'meow'?", correct_answer: "Cat", incorrect_answers: ["Dog", "Cow", "Duck"] },
  { category: "Animals", difficulty: "easy", question: "How many legs does a chicken have?", correct_answer: "2", incorrect_answers: ["4", "6", "3"] },

  // Food
  { category: "Food", difficulty: "easy", question: "What color is a ripe banana?", correct_answer: "Yellow", incorrect_answers: ["Blue", "Purple", "Green"] },
  { category: "Food", difficulty: "easy", question: "Which fruit is red and is said to keep the doctor away?", correct_answer: "Apple", incorrect_answers: ["Banana", "Grape", "Lemon"] },
  { category: "Food", difficulty: "easy", question: "Which of these is a vegetable?", correct_answer: "Carrot", incorrect_answers: ["Apple", "Banana", "Orange"] },
  { category: "Food", difficulty: "easy", question: "Which drink comes from cows?", correct_answer: "Milk", incorrect_answers: ["Juice", "Soda", "Water"] },
  { category: "Food", difficulty: "easy", question: "Which vegetable can make you cry when you cut it?", correct_answer: "Onion", incorrect_answers: ["Carrot", "Potato", "Lettuce"] },
  { category: "Food", difficulty: "easy", question: "What food is made from cocoa beans and is brown and sweet?", correct_answer: "Chocolate", incorrect_answers: ["Cheese", "Bread", "Rice"] },
  { category: "Food", difficulty: "easy", question: "What do we call bread after it has been heated until it is crispy?", correct_answer: "Toast", incorrect_answers: ["Cereal", "Soup", "Salad"] },

  // Space
  { category: "Space", difficulty: "easy", question: "What do we call the star at the center of our solar system?", correct_answer: "The Sun", incorrect_answers: ["The Moon", "Mars", "A comet"] },
  { category: "Space", difficulty: "easy", question: "What do you see in the night sky that is round and glows?", correct_answer: "The Moon", incorrect_answers: ["The Sun", "A cloud", "The grass"] },
  { category: "Space", difficulty: "easy", question: "What planet do we live on?", correct_answer: "Earth", incorrect_answers: ["Mars", "Jupiter", "The Moon"] },
  { category: "Space", difficulty: "easy", question: "How many suns does Earth have in its sky?", correct_answer: "1", incorrect_answers: ["2", "3", "0"] },
  { category: "Space", difficulty: "easy", question: "What shape does the full Moon look like?", correct_answer: "Round", incorrect_answers: ["Square", "Triangle", "Star-shaped"] },

  // Sports
  { category: "Sports", difficulty: "easy", question: "In soccer, which body part are field players not allowed to use?", correct_answer: "Hands", incorrect_answers: ["Feet", "Head", "Chest"] },
  { category: "Sports", difficulty: "easy", question: "What color card does a soccer referee show to send a player off the field?", correct_answer: "Red", incorrect_answers: ["Blue", "Green", "Yellow"] },
  { category: "Sports", difficulty: "easy", question: "In basketball, where do you put the ball to score?", correct_answer: "In the hoop", incorrect_answers: ["In a hole in the ground", "Over a wall", "Under the bench"] },
  { category: "Sports", difficulty: "easy", question: "Which sport is played with a bat, a ball, and bases you run around?", correct_answer: "Baseball", incorrect_answers: ["Swimming", "Golf", "Tennis"] },
  { category: "Sports", difficulty: "easy", question: "What do you kick in a game of soccer?", correct_answer: "A ball", incorrect_answers: ["A bat", "A racket", "A puck"] },

  // Science
  { category: "Science", difficulty: "easy", question: "What do plants need to grow?", correct_answer: "Water and sunlight", incorrect_answers: ["Candy", "Toys", "Music"] },
  { category: "Science", difficulty: "easy", question: "What do we call water when it freezes and becomes hard?", correct_answer: "Ice", incorrect_answers: ["Steam", "Mud", "Sand"] },
  { category: "Science", difficulty: "easy", question: "What color is the sky on a clear, sunny day?", correct_answer: "Blue", incorrect_answers: ["Green", "Purple", "Orange"] },
  { category: "Science", difficulty: "easy", question: "How many colors are in a rainbow?", correct_answer: "7", incorrect_answers: ["3", "5", "10"] },
  { category: "Science", difficulty: "easy", question: "What do we call the water that falls from the clouds?", correct_answer: "Rain", incorrect_answers: ["Sand", "Rocks", "Leaves"] },

  // Geography
  { category: "Geography", difficulty: "easy", question: "What do we call a very large body of salt water?", correct_answer: "An ocean", incorrect_answers: ["A puddle", "A cup", "A bathtub"] },
  { category: "Geography", difficulty: "easy", question: "What do we call the tall, rocky land with a pointed top that you can climb?", correct_answer: "A mountain", incorrect_answers: ["A river", "A lake", "A garden"] },
  { category: "Geography", difficulty: "easy", question: "What do we call the sandy place next to the ocean where you build sandcastles?", correct_answer: "A beach", incorrect_answers: ["A mountain", "A forest", "A city"] },
  { category: "Geography", difficulty: "easy", question: "What do we call the hot, dry, sandy place where camels live and it rarely rains?", correct_answer: "A desert", incorrect_answers: ["A forest", "An ocean", "A snowy mountain"] },

  // Movies & Cartoons
  { category: "Movies & Cartoons", difficulty: "easy", question: "What kind of animal is Mickey Mouse?", correct_answer: "A mouse", incorrect_answers: ["A cat", "A dog", "A duck"] },
  { category: "Movies & Cartoons", difficulty: "easy", question: "In the movie Finding Nemo, what kind of fish is Nemo?", correct_answer: "A clownfish", incorrect_answers: ["A shark", "A whale", "A goldfish"] },
  { category: "Movies & Cartoons", difficulty: "easy", question: "What color is SpongeBob SquarePants?", correct_answer: "Yellow", incorrect_answers: ["Blue", "Green", "Red"] },
  { category: "Movies & Cartoons", difficulty: "easy", question: "What kind of animal is Winnie the Pooh?", correct_answer: "A bear", incorrect_answers: ["A pig", "A rabbit", "A tiger"] },

  // Math
  { category: "Math", difficulty: "easy", question: "What is 2 + 2?", correct_answer: "4", incorrect_answers: ["3", "5", "22"] },
  { category: "Math", difficulty: "easy", question: "What is 5 + 5?", correct_answer: "10", incorrect_answers: ["8", "11", "15"] },
  { category: "Math", difficulty: "easy", question: "How many sides does a triangle have?", correct_answer: "3", incorrect_answers: ["4", "5", "2"] },
  { category: "Math", difficulty: "easy", question: "What is 10 - 4?", correct_answer: "6", incorrect_answers: ["5", "7", "14"] },
  { category: "Math", difficulty: "easy", question: "What number comes right after 9?", correct_answer: "10", incorrect_answers: ["8", "11", "90"] },
  { category: "Math", difficulty: "easy", question: "How many sides does a square have?", correct_answer: "4", incorrect_answers: ["3", "5", "6"] },
  { category: "Math", difficulty: "easy", question: "How many days are in one week?", correct_answer: "7", incorrect_answers: ["5", "10", "12"] },
  { category: "Math", difficulty: "easy", question: "What is 3 + 1?", correct_answer: "4", incorrect_answers: ["2", "5", "6"] },

  // ---------------------------------------------------------------------------
  // MEDIUM  (~8-11-year-old level)
  // ---------------------------------------------------------------------------

  // Animals
  { category: "Animals", difficulty: "medium", question: "What is the largest animal on Earth?", correct_answer: "Blue whale", incorrect_answers: ["Elephant", "Great white shark", "Giraffe"] },
  { category: "Animals", difficulty: "medium", question: "What is a group of lions called?", correct_answer: "A pride", incorrect_answers: ["A pack", "A herd", "A flock"] },
  { category: "Animals", difficulty: "medium", question: "Which is the tallest animal in the world?", correct_answer: "Giraffe", incorrect_answers: ["Elephant", "Horse", "Camel"] },
  { category: "Animals", difficulty: "medium", question: "How many hearts does an octopus have?", correct_answer: "3", incorrect_answers: ["1", "2", "8"] },
  { category: "Animals", difficulty: "medium", question: "What do we call an animal that eats only plants?", correct_answer: "Herbivore", incorrect_answers: ["Carnivore", "Omnivore", "Predator"] },
  { category: "Animals", difficulty: "medium", question: "Which is the fastest land animal in the world?", correct_answer: "Cheetah", incorrect_answers: ["Lion", "Horse", "Kangaroo"] },
  { category: "Animals", difficulty: "medium", question: "A tadpole grows up to become which animal?", correct_answer: "A frog", incorrect_answers: ["A fish", "A turtle", "A snail"] },

  // Space
  { category: "Space", difficulty: "medium", question: "Which planet is known as the Red Planet?", correct_answer: "Mars", incorrect_answers: ["Venus", "Jupiter", "Saturn"] },
  { category: "Space", difficulty: "medium", question: "Which planet is the largest in our solar system?", correct_answer: "Jupiter", incorrect_answers: ["Saturn", "Earth", "Neptune"] },
  { category: "Space", difficulty: "medium", question: "What do we call a space rock that lands on the surface of the Earth?", correct_answer: "A meteorite", incorrect_answers: ["A comet", "An asteroid", "A meteor"] },
  { category: "Space", difficulty: "medium", question: "How many planets are in our solar system?", correct_answer: "8", incorrect_answers: ["7", "9", "10"] },
  { category: "Space", difficulty: "medium", question: "What is the name of the galaxy we live in?", correct_answer: "The Milky Way", incorrect_answers: ["Andromeda", "The Big Dipper", "The Sombrero"] },
  { category: "Space", difficulty: "medium", question: "Which planet is famous for the beautiful rings around it?", correct_answer: "Saturn", incorrect_answers: ["Mars", "Earth", "Mercury"] },

  // Sports
  { category: "Sports", difficulty: "medium", question: "How many players from one team are on the field in soccer?", correct_answer: "11", incorrect_answers: ["9", "10", "12"] },
  { category: "Sports", difficulty: "medium", question: "In which sport would you perform a slam dunk?", correct_answer: "Basketball", incorrect_answers: ["Soccer", "Tennis", "Golf"] },
  { category: "Sports", difficulty: "medium", question: "In American football, how many points is a touchdown worth?", correct_answer: "6", incorrect_answers: ["3", "7", "10"] },
  { category: "Sports", difficulty: "medium", question: "In tennis, what word is used for a score of zero?", correct_answer: "Love", incorrect_answers: ["Nil", "Duck", "Blank"] },
  { category: "Sports", difficulty: "medium", question: "How many holes are on a full-size golf course?", correct_answer: "18", incorrect_answers: ["9", "12", "24"] },

  // Food
  { category: "Food", difficulty: "medium", question: "What is the main ingredient in guacamole?", correct_answer: "Avocado", incorrect_answers: ["Tomato", "Cucumber", "Pea"] },
  { category: "Food", difficulty: "medium", question: "Which long, thin pasta do people famously twirl on a fork?", correct_answer: "Spaghetti", incorrect_answers: ["Rice", "Soup", "Bread"] },
  { category: "Food", difficulty: "medium", question: "What dried fruit is made from a grape?", correct_answer: "A raisin", incorrect_answers: ["A prune", "A date", "A fig"] },
  { category: "Food", difficulty: "medium", question: "What is the main ingredient used to make bread?", correct_answer: "Flour", incorrect_answers: ["Sugar", "Rice", "Eggs"] },

  // Science
  { category: "Science", difficulty: "medium", question: "Which gas do humans need to breathe in to stay alive?", correct_answer: "Oxygen", incorrect_answers: ["Carbon dioxide", "Helium", "Nitrogen"] },
  { category: "Science", difficulty: "medium", question: "What is H2O more commonly known as?", correct_answer: "Water", incorrect_answers: ["Salt", "Air", "Oil"] },
  { category: "Science", difficulty: "medium", question: "Which organ pumps blood around your body?", correct_answer: "The heart", incorrect_answers: ["The brain", "The lungs", "The stomach"] },
  { category: "Science", difficulty: "medium", question: "How many bones are in the body of an adult human?", correct_answer: "206", incorrect_answers: ["106", "300", "150"] },
  { category: "Science", difficulty: "medium", question: "What do we call animals that are awake and active at night?", correct_answer: "Nocturnal", incorrect_answers: ["Diurnal", "Extinct", "Migratory"] },
  { category: "Science", difficulty: "medium", question: "What force pulls objects down toward the Earth?", correct_answer: "Gravity", incorrect_answers: ["Magnetism", "Friction", "Electricity"] },

  // Geography
  { category: "Geography", difficulty: "medium", question: "What is the largest ocean on Earth?", correct_answer: "The Pacific Ocean", incorrect_answers: ["The Atlantic Ocean", "The Indian Ocean", "The Arctic Ocean"] },
  { category: "Geography", difficulty: "medium", question: "Which river is usually said to be the longest in the world?", correct_answer: "The Nile", incorrect_answers: ["The Amazon", "The Mississippi", "The Yangtze"] },
  { category: "Geography", difficulty: "medium", question: "Which is the largest continent on Earth?", correct_answer: "Asia", incorrect_answers: ["Africa", "Europe", "Antarctica"] },
  { category: "Geography", difficulty: "medium", question: "How many continents are there on Earth?", correct_answer: "7", incorrect_answers: ["5", "6", "8"] },
  { category: "Geography", difficulty: "medium", question: "What is the capital city of the United States?", correct_answer: "Washington, D.C.", incorrect_answers: ["New York City", "Los Angeles", "Chicago"] },
  { category: "Geography", difficulty: "medium", question: "Which is the smallest continent on Earth?", correct_answer: "Australia", incorrect_answers: ["Europe", "Antarctica", "South America"] },

  // Movies & Cartoons
  { category: "Movies & Cartoons", difficulty: "medium", question: "In the movie Toy Story, what kind of toy is Woody?", correct_answer: "A cowboy", incorrect_answers: ["An astronaut", "A dinosaur", "A robot"] },
  { category: "Movies & Cartoons", difficulty: "medium", question: "In The Lion King, what is the name of the young lion prince?", correct_answer: "Simba", incorrect_answers: ["Mufasa", "Scar", "Nala"] },
  { category: "Movies & Cartoons", difficulty: "medium", question: "What kind of animal is the Disney character Dumbo?", correct_answer: "An elephant", incorrect_answers: ["A mouse", "A horse", "A dog"] },
  { category: "Movies & Cartoons", difficulty: "medium", question: "In the movie Frozen, what is the name of the friendly snowman?", correct_answer: "Olaf", incorrect_answers: ["Sven", "Kristoff", "Hans"] },

  // Math
  { category: "Math", difficulty: "medium", question: "What is 7 x 8?", correct_answer: "56", incorrect_answers: ["54", "63", "48"] },
  { category: "Math", difficulty: "medium", question: "What is 12 x 12?", correct_answer: "144", incorrect_answers: ["124", "148", "121"] },
  { category: "Math", difficulty: "medium", question: "How many sides does a hexagon have?", correct_answer: "6", incorrect_answers: ["5", "7", "8"] },
  { category: "Math", difficulty: "medium", question: "What is one half written as a decimal?", correct_answer: "0.5", incorrect_answers: ["0.25", "1.5", "0.05"] },
  { category: "Math", difficulty: "medium", question: "What is 100 divided by 4?", correct_answer: "25", incorrect_answers: ["20", "40", "50"] },
  { category: "Math", difficulty: "medium", question: "How many minutes are in one hour?", correct_answer: "60", incorrect_answers: ["100", "30", "24"] },

  // ---------------------------------------------------------------------------
  // HARD  (middle-school level)
  // ---------------------------------------------------------------------------

  // Animals
  { category: "Animals", difficulty: "hard", question: "What is the only mammal capable of true flight?", correct_answer: "The bat", incorrect_answers: ["The flying squirrel", "The owl", "The sugar glider"] },
  { category: "Animals", difficulty: "hard", question: "Which of these animals is a marsupial that carries its baby in a pouch?", correct_answer: "Kangaroo", incorrect_answers: ["Elephant", "Panda", "Wolf"] },
  { category: "Animals", difficulty: "hard", question: "What is the largest species of fish in the ocean?", correct_answer: "The whale shark", incorrect_answers: ["The great white shark", "The blue marlin", "The giant squid"] },
  { category: "Animals", difficulty: "hard", question: "Which bird lays the largest egg of any living bird?", correct_answer: "The ostrich", incorrect_answers: ["The eagle", "The emu", "The albatross"] },
  { category: "Animals", difficulty: "hard", question: "What is the name of the process by which a caterpillar transforms into a butterfly?", correct_answer: "Metamorphosis", incorrect_answers: ["Hibernation", "Evolution", "Photosynthesis"] },

  // Space
  { category: "Space", difficulty: "hard", question: "Which planet is closest to the Sun?", correct_answer: "Mercury", incorrect_answers: ["Venus", "Earth", "Mars"] },
  { category: "Space", difficulty: "hard", question: "Who was the first person to walk on the Moon?", correct_answer: "Neil Armstrong", incorrect_answers: ["Buzz Aldrin", "Yuri Gagarin", "John Glenn"] },
  { category: "Space", difficulty: "hard", question: "What do we call a region in space where gravity is so strong that not even light can escape?", correct_answer: "A black hole", incorrect_answers: ["A supernova", "A nebula", "A white dwarf"] },
  { category: "Space", difficulty: "hard", question: "Which is the hottest planet in our solar system?", correct_answer: "Venus", incorrect_answers: ["Mercury", "Mars", "Jupiter"] },
  { category: "Space", difficulty: "hard", question: "About how long does light from the Sun take to reach the Earth?", correct_answer: "About 8 minutes", incorrect_answers: ["About 8 seconds", "About 8 hours", "About 8 days"] },

  // Science
  { category: "Science", difficulty: "hard", question: "What is the chemical symbol for gold?", correct_answer: "Au", incorrect_answers: ["Go", "Gd", "Ag"] },
  { category: "Science", difficulty: "hard", question: "Which part of the cell is known as its powerhouse?", correct_answer: "The mitochondria", incorrect_answers: ["The nucleus", "The ribosome", "The cell membrane"] },
  { category: "Science", difficulty: "hard", question: "At what temperature does water boil at sea level, in degrees Celsius?", correct_answer: "100", incorrect_answers: ["90", "50", "212"] },
  { category: "Science", difficulty: "hard", question: "Which gas do plants take in from the air to make food during photosynthesis?", correct_answer: "Carbon dioxide", incorrect_answers: ["Oxygen", "Nitrogen", "Hydrogen"] },
  { category: "Science", difficulty: "hard", question: "What is the hardest natural substance found on Earth?", correct_answer: "Diamond", incorrect_answers: ["Gold", "Iron", "Granite"] },
  { category: "Science", difficulty: "hard", question: "How many teeth does a typical adult human have?", correct_answer: "32", incorrect_answers: ["28", "30", "24"] },
  { category: "Science", difficulty: "hard", question: "What do we call a scientist who studies the weather?", correct_answer: "A meteorologist", incorrect_answers: ["A geologist", "An astronomer", "A biologist"] },

  // Geography
  { category: "Geography", difficulty: "hard", question: "What is the tallest mountain above sea level in the world?", correct_answer: "Mount Everest", incorrect_answers: ["K2", "Mount Kilimanjaro", "Denali"] },
  { category: "Geography", difficulty: "hard", question: "Which is the largest country in the world by land area?", correct_answer: "Russia", incorrect_answers: ["Canada", "China", "The United States"] },
  { category: "Geography", difficulty: "hard", question: "What is the capital city of Japan?", correct_answer: "Tokyo", incorrect_answers: ["Beijing", "Seoul", "Bangkok"] },
  { category: "Geography", difficulty: "hard", question: "On which continent is the Sahara Desert located?", correct_answer: "Africa", incorrect_answers: ["Asia", "Australia", "South America"] },
  { category: "Geography", difficulty: "hard", question: "Which is the largest U.S. state by area?", correct_answer: "Alaska", incorrect_answers: ["Texas", "California", "Montana"] },
  { category: "Geography", difficulty: "hard", question: "What imaginary line divides the Earth into the Northern and Southern Hemispheres?", correct_answer: "The Equator", incorrect_answers: ["The Prime Meridian", "The Tropic of Cancer", "The International Date Line"] },

  // Math
  { category: "Math", difficulty: "hard", question: "What is the value of Pi rounded to two decimal places?", correct_answer: "3.14", incorrect_answers: ["3.41", "3.12", "3.16"] },
  { category: "Math", difficulty: "hard", question: "What do you call a triangle that has all three sides the same length?", correct_answer: "Equilateral", incorrect_answers: ["Isosceles", "Scalene", "Right-angled"] },
  { category: "Math", difficulty: "hard", question: "What is the square root of 81?", correct_answer: "9", incorrect_answers: ["8", "18", "27"] },
  { category: "Math", difficulty: "hard", question: "How many degrees are in a right angle?", correct_answer: "90", incorrect_answers: ["45", "100", "180"] },
  { category: "Math", difficulty: "hard", question: "What is 15% of 200?", correct_answer: "30", incorrect_answers: ["15", "20", "45"] },
  { category: "Math", difficulty: "hard", question: "What do the three angles inside any triangle add up to, in degrees?", correct_answer: "180", incorrect_answers: ["90", "270", "360"] },

  // Sports
  { category: "Sports", difficulty: "hard", question: "How often are the Summer Olympic Games normally held?", correct_answer: "Every four years", incorrect_answers: ["Every year", "Every two years", "Every ten years"] },
  { category: "Sports", difficulty: "hard", question: "In which country were the ancient Olympic Games first held?", correct_answer: "Greece", incorrect_answers: ["Italy", "Egypt", "China"] },
  { category: "Sports", difficulty: "hard", question: "In baseball, how many strikes make an out?", correct_answer: "Three", incorrect_answers: ["Two", "Four", "One"] },
  { category: "Sports", difficulty: "hard", question: "How many players from one team are on the court at once in basketball?", correct_answer: "5", incorrect_answers: ["6", "7", "11"] },

  // Food
  { category: "Food", difficulty: "hard", question: "Which spice is the most expensive in the world by weight?", correct_answer: "Saffron", incorrect_answers: ["Black pepper", "Cinnamon", "Vanilla"] },
  { category: "Food", difficulty: "hard", question: "What food is tofu made from?", correct_answer: "Soybeans", incorrect_answers: ["Rice", "Corn", "Wheat"] },
  { category: "Food", difficulty: "hard", question: "What is the main ingredient in traditional hummus?", correct_answer: "Chickpeas", incorrect_answers: ["Lentils", "Black beans", "Green peas"] },
  { category: "Food", difficulty: "hard", question: "Which fruit was given to sailors long ago to help prevent a disease called scurvy?", correct_answer: "Limes", incorrect_answers: ["Apples", "Bananas", "Grapes"] },

  // Movies & Cartoons
  { category: "Movies & Cartoons", difficulty: "hard", question: "Which film was the first full-length movie made entirely with computer animation?", correct_answer: "Toy Story", incorrect_answers: ["Snow White and the Seven Dwarfs", "Shrek", "Frozen"] },
  { category: "Movies & Cartoons", difficulty: "hard", question: "In the classic fairy tale, what does Cinderella leave behind at the ball?", correct_answer: "A glass slipper", incorrect_answers: ["A golden ring", "A silk glove", "A diamond crown"] },
  { category: "Movies & Cartoons", difficulty: "hard", question: "In the story of Pinocchio, what happens to his nose whenever he tells a lie?", correct_answer: "It grows longer", incorrect_answers: ["It turns red", "It falls off", "It shrinks"] },
];
