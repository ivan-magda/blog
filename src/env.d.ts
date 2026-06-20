interface Window {
  theme?: {
    themeValue: string;
    setPreference: () => void;
    reflectPreference: () => void;
    getTheme: () => string;
    setTheme: (val: string) => void;
  };
  umami?: { track: (name: string, data?: Record<string, unknown>) => void };
  __readingTrackerEvents?: Array<{ name: string; data?: unknown; t: number }>;
  __readingTrackerState?: () => unknown;
}
