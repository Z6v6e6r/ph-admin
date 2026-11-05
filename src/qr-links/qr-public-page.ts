export type QrPublicPageKind = 'not_found' | 'paused' | 'archived' | 'unavailable';

interface QrPublicPage {
  status: number;
  title: string;
  message: string;
}

const PAGES: Record<QrPublicPageKind, QrPublicPage> = {
  not_found: {
    status: 404,
    title: 'QR-код не найден',
    message: 'Проверьте ссылку или обратитесь к администратору.'
  },
  paused: {
    status: 200,
    title: 'QR-код временно неактивен',
    message: 'Этот QR-код временно неактивен. Обратитесь к администратору.'
  },
  archived: {
    status: 410,
    title: 'QR-код больше не действует',
    message: 'Эта постоянная ссылка архивирована. Обратитесь к администратору.'
  },
  unavailable: {
    status: 503,
    title: 'QR-код временно недоступен',
    message: 'Не удалось открыть ссылку. Попробуйте позже.'
  }
};

export function renderQrPublicPage(kind: QrPublicPageKind): string {
  const page = PAGES[kind];
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${page.title}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 20px;
        font-family: "Manrope", "Helvetica Neue", Arial, sans-serif;
        background: #f7f4f8;
        color: #330020;
      }
      main {
        width: min(460px, 100%);
        padding: 26px 22px;
        border: 1px solid rgba(51, 0, 32, 0.14);
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 18px 40px rgba(51, 0, 32, 0.08);
      }
      h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.2; }
      p { margin: 0; font-size: 14px; line-height: 1.5; color: rgba(51, 0, 32, 0.78); }
    </style>
  </head>
  <body>
    <main>
      <h1>${page.title}</h1>
      <p>${page.message}</p>
    </main>
  </body>
</html>`;
}

export function qrPublicPageStatus(kind: QrPublicPageKind): number {
  return PAGES[kind].status;
}
