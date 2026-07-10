// electron-builder afterPack hook: flips Electron Fuses on the packaged
// binary so the hardening is baked into the executable itself, not just
// runtime configuration. See SECURITY.md §8.
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  // @electron/fuses 2.x is ESM-only; dynamic import() keeps this hook loadable
  // by electron-builder's CJS require() even on Node without require(ESM).
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const { appOutDir, packager, electronPlatformName } = context;

  let executablePath;
  if (electronPlatformName === 'win32') {
    executablePath = join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  } else if (electronPlatformName === 'darwin') {
    executablePath = join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'MacOS', packager.appInfo.productFilename);
  } else {
    executablePath = join(appOutDir, packager.executableName ?? packager.appInfo.productFilename);
  }

  console.log(`  • flipping Electron fuses on ${executablePath}`);
  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    // No Node.js side-doors into the packaged binary:
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // App code loads only from the integrity-checked archive:
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    // Encrypt cookies/storage at rest via OS keystore:
    [FuseV1Options.EnableCookieEncryption]: true,
    // file:// gets no extra privileges (the app uses app:// exclusively):
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    // macOS builds are ad-hoc-signed until real signing is configured:
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
  });
};
