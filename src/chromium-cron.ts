import { handleChromiumCheck } from './handlers';

if (require.main === module) {
  handleChromiumCheck().catch(err => {
    console.log('Chromium Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
