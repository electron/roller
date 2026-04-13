import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rollWindowsArcImage } from './windows-image-handler.js';

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rollWindowsArcImage().catch((err: Error) => {
    console.log('Windows Image Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
