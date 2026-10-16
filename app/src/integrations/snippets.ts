export type SourceKind = 'server' | 'browser';

export type SnippetTab = 'laravel' | 'php' | 'node' | 'python' | 'browser' | 'curl';

export type SnippetBlockId = 'install' | 'env' | 'code' | 'vue' | 'curl';

export interface SnippetBlock {
  id: SnippetBlockId;
  text: string;
}

const SERVER_TABS: SnippetTab[] = ['laravel', 'php', 'node', 'python', 'curl'];
const BROWSER_TABS: SnippetTab[] = ['browser'];

export function tabsFor(kind: SourceKind): SnippetTab[] {
  return kind === 'browser' ? BROWSER_TABS : SERVER_TABS;
}

export function snippetsFor(tab: SnippetTab, key: string, apiUrl: string): SnippetBlock[] {
  const env: SnippetBlock = { id: 'env', text: `SERENO_KEY=${key}\nSERENO_URL=${apiUrl}` };
  const install = (text: string): SnippetBlock => ({ id: 'install', text });
  const code = (text: string): SnippetBlock => ({ id: 'code', text });

  switch (tab) {
    case 'laravel':
      return [install(`composer require ascariodev/sereno-laravel && php artisan sereno:install ${key} --url=${apiUrl}`), env];
    case 'php':
      return [
        install('composer require ascariodev/sereno-php'),
        env,
        code(
          `<?php\n\nrequire __DIR__.'/vendor/autoload.php';\n\nuse Sereno\\Sereno;\n\n` +
            `$logger = Sereno::init(); // reads SERENO_KEY and SERENO_URL from the environment\n\n` +
            `$logger->error('Payment failed', ['order_id' => 42]);`,
        ),
      ];
    case 'node':
      return [
        install('npm install @ascariodev/sereno-node'),
        env,
        code(
          `import { init, captureException, log } from '@ascariodev/sereno-node';\n\n` +
            `init(); // reads SERENO_URL and SERENO_KEY from the environment\n\n` +
            `log('warning', 'Payment is slow', { order_id: 42 });`,
        ),
      ];
    case 'python':
      return [
        install('pip install sereno-sdk'),
        env,
        code(
          `import logging\nimport sereno\n\n` +
            `sereno.init()  # reads SERENO_URL and SERENO_KEY from the environment\n\n` +
            `logging.getLogger(__name__).warning("Payment is slow", extra={"order_id": 42})`,
        ),
      ];
    case 'browser':
      return [
        install('npm install @ascariodev/sereno-browser'),
        code(
          `import { init, captureException, log } from '@ascariodev/sereno-browser';\n\n` +
            `init({\n  url: '${apiUrl}',\n  key: '${key}',\n});\n\n` +
            `log('warning', 'Checkout is slow', { step: 'payment' });`,
        ),
        { id: 'vue', text: `import { SerenoVue } from '@ascariodev/sereno-browser/vue';\n\napp.use(SerenoVue);` },
      ];
    case 'curl':
      return [
        {
          id: 'curl',
          text:
            `curl -X POST ${apiUrl}/api/ingest/events \\\n` +
            `  -H "Authorization: Bearer ${key}" \\\n` +
            `  -H "Content-Type: application/json" \\\n` +
            `  -d '{"events":[{"level":"error","message":"Test event"}]}'`,
        },
      ];
  }
}
