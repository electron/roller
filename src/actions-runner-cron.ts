import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rollActionsRunner } from './actions-runner-handler.js';

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rollActionsRunner().catch((err: Error) => {
    console.log('Actions Runner Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
