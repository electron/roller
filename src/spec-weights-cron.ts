import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { handleSpecWeightsCheck } from './spec-weights-handler.js';

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  handleSpecWeightsCheck(process.argv[2]).catch((err) => {
    console.log('Spec Weights Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
