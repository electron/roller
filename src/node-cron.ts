import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { handleNodeCheck } from './node-handler.js';

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  handleNodeCheck().catch((err) => {
    console.log('Node Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
