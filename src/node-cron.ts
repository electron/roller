import { handleNodeCheck } from './handlers';

if (require.main === module) {
  handleNodeCheck().catch(err => {
    console.log('Node Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
