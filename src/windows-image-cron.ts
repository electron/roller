import { rollWindowsArcImage } from './windows-image-handler';

if (require.main === module) {
  rollWindowsArcImage().catch((err: Error) => {
    console.log('Windows Image Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
