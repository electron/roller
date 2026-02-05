import { handleBuildImagesChromiumDepsCheck } from './build-images-chromium-deps-handler';

if (require.main === module) {
  handleBuildImagesChromiumDepsCheck().catch((err) => {
    console.log('Build Images Chromium Deps Cron Failed');
    console.error(err);
    process.exit(1);
  });
}
