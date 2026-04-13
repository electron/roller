import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { handleBuildImagesChromiumDepsCheck } from './build-images-chromium-deps-handler.js';

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  handleBuildImagesChromiumDepsCheck().catch((err) => {
    console.log('Build Images Chromium Deps Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
