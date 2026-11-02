/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Hover-only borders and glows are built at runtime by onHover() in App.tsx,
  // so the scanner never sees them as literal class names.
  safelist: [
    ...['amber', 'rose', 'fuchsia', 'cyan'].map((c) => `hover:border-${c}-500/50`),
    'hover:shadow-[0_0_45px_rgba(250,204,21,0.28)]',
    'hover:shadow-[0_0_45px_rgba(244,63,94,0.28)]',
    'hover:shadow-[0_0_45px_rgba(217,70,239,0.28)]',
    'hover:shadow-[0_0_45px_rgba(34,211,238,0.28)]',
    'hover:shadow-[0_0_26px_rgba(244,63,94,0.22)]',
    'hover:shadow-[0_0_26px_rgba(250,204,21,0.22)]',
    'hover:shadow-[0_0_26px_rgba(217,70,239,0.22)]',
    'hover:shadow-[0_0_26px_rgba(34,211,238,0.22)]'
  ],
  theme: { extend: {} },
  plugins: []
};
