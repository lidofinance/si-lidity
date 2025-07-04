import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";

const config: Config = {
  title: "Lido Staking Interfaces Contracts",
  tagline: "...TODO...",
  favicon: "img/favicon.png",

  // Set the production url of your site here
  url: "https://lidofinance.github.io/",

  baseUrl: "/si-lidity/",
  organizationName: "lidofinance",
  projectName: "si-lidity",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  plugins: [],
  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          path: "cli",
          // Remove this to remove the "edit this page" links.
          editUrl: "https://github.com/lidofinance/si-lidity",
          routeBasePath: "/",
        },
        blog: {
          showReadingTime: true,
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: "https://github.com/lidofinance/si-lidity",
        },
      } satisfies Preset.Options,
    ],
  ],

  markdown: {
    mermaid: true,
  },
  themes: ["@docusaurus/theme-mermaid"],
  themeConfig: {
    image: "img/package_logo.png",
    navbar: {
      title: "Lido Staking Interfaces Contracts Docs",
      logo: {
        alt: "Lido Staking Interfaces Contracts Logo",
        src: "img/favicon.png",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "cliSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/lidofinance/si-lidity",
          label: "GitHub",
          position: "right",
        },
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
