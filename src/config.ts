export const SITE = {
  website: "https://ivanmagda.dev/",
  author: "Ivan Magda",
  profile: "https://github.com/ivan-magda",
  desc: "Writing about AI agents and software development.",
  title: "Ivan Magda",
  ogImage: "og-image.png",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true,
  editPost: {
    enabled: true,
    text: "Suggest Changes",
    url: "https://github.com/ivan-magda/blog/edit/main/",
  },
  dynamicOgImage: true,
  dir: "ltr",
  lang: "en",
  timezone: "Asia/Seoul",
  twitterHandle: "@magda_ivan",
} as const;
