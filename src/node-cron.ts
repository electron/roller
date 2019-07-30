import { handleNodeCheck } from './handlers';

if (process.mainModule === module) {
  handleNodeCheck()
    .catch((err) => {
      console.log('Node Cron Failed');
      console.error(err);
      process.exit(1);
    });
}
