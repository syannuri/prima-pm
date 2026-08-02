import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { LanguageProvider } from './context/LanguageContext';
import HomePage from './pages/HomePage';

// Build-time static render of the public landing page (see scripts/prerender.mjs). HomePage only
// needs a Router + LanguageProvider, and both are SSR-safe: detectLang() falls back to 'en' when
// there's no localStorage/navigator, and effects (scroll/parallax) simply don't run during static
// rendering. The result is injected into dist/index.html's #root so crawlers and the first paint
// get real content; the SPA then boots normally over it.
export function render(): string {
  return renderToStaticMarkup(
    <StaticRouter location="/">
      <LanguageProvider>
        <HomePage />
      </LanguageProvider>
    </StaticRouter>,
  );
}
