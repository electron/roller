import { handleChromiumCheck } from './handlers';

if (process.mainModule === module) {
  handleChromiumCheck()
    .catch((err) => {
      console.log('Chromium Cron Failed');
      console.error(err);
      process.exit(1);
    });
}
