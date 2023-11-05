import { rollMainBranch } from './orb-handler';

if (require.main === module) {
  rollMainBranch().catch((err: Error) => {
    console.log('Orb Roll Failed');
    console.error(err);
    process.exit(1);
  });
}
