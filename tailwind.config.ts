// Tailwind v4 — configuration lives in app/globals.css via @theme inline.
// This file only exists to satisfy tooling that reads tailwind.config.*
// for IDE auto-complete. Content scanning is automatic in v4.
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [], // v4 auto-detects; explicit list not required
};

export default config;
