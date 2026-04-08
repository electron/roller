import { rollActionsRunner } from './actions-runner-handler.js';

if (require.main === module) {
  rollActionsRunner().catch((err: Error) => {
    console.log('Actions Runner Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
