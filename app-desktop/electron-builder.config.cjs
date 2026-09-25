/**
 * Packaging config.
 *
 * The product name comes from the environment so one codebase can ship as the
 * generic product or as a named shop's till, without the two versions of the
 * source ever differing. `SHOP_NAME=... npm run package` brands the build.
 *
 * appId stays fixed on purpose. Windows identifies an installed program by it,
 * so changing it would make an update install alongside the old copy instead
 * of replacing it. The data folder is pinned separately, in main.ts.
 */
const productName = (process.env.SHOP_NAME || 'PharmaFlow').trim();

module.exports = {
  appId: 'com.pharmaflow.desktop',
  productName,
  directories: { output: 'dist-build' },
  files: ['dist/main/**/*', 'dist/preload/**/*', 'dist/renderer/**/*', 'package.json'],
  extraResources: [],
  win: { target: ['nsis'], icon: 'build/icon.ico' },
  nsis: {
    oneClick: true,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: productName,
  },
};
