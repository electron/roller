import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { handleChromiumCheck } from './chromium-handler.js';

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  handleChromiumCheck().catch((err) => {
    console.log('Chromium Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
