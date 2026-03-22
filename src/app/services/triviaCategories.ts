export interface TriviaCategory {
  id: string;
  name: string;
}

export interface SupportedLanguage {
  code: string;
  name: string;
}

export const TRIVIA_CATEGORIES: TriviaCategory[] = [
  { id: "9", name: "General Knowledge" },
  { id: "10", name: "Entertainment: Books" },
  { id: "11", name: "Entertainment: Film" },
  { id: "12", name: "Entertainment: Music" },
  { id: "13", name: "Entertainment: Musicals & Theatres" },
  { id: "14", name: "Entertainment: Television" },
  { id: "15", name: "Entertainment: Video Games" },
  { id: "16", name: "Entertainment: Board Games" },
  { id: "17", name: "Science & Nature" },
  { id: "18", name: "Science: Computers" },
  { id: "19", name: "Science: Mathematics" },
  { id: "20", name: "Mythology" },
  { id: "21", name: "Sports" },
  { id: "22", name: "Geography" },
  { id: "23", name: "History" },
  { id: "24", name: "Politics" },
  { id: "25", name: "Art" },
  { id: "26", name: "Celebrities" },
  { id: "27", name: "Animals" },
  { id: "28", name: "Vehicles" },
  { id: "29", name: "Entertainment: Comics" },
  { id: "30", name: "Science: Gadgets" },
  { id: "31", name: "Entertainment: Japanese Anime & Manga" },
  { id: "32", name: "Entertainment: Cartoon & Animations" }
];

export const TRIVIA_CATEGORY_IDS = TRIVIA_CATEGORIES.map((item) => item.id);
export const TRIVIA_CATEGORY_BY_ID = new Map(
  TRIVIA_CATEGORIES.map((item) => [item.id, item] as const)
);

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "es", name: "espanol" },
  { code: "en", name: "ingles" },
  { code: "fr", name: "frances" },
  { code: "de", name: "aleman" },
  { code: "it", name: "italiano" }
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((item) => item.code);
export const SUPPORTED_LANGUAGE_BY_CODE = new Map(
  SUPPORTED_LANGUAGES.map((item) => [item.code, item] as const)
);
