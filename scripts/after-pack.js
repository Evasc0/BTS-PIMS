const fs = require('fs');
const path = require('path');
const rcedit = require('rcedit');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const projectDir = context.packager?.projectDir || process.cwd();
  const iconPath = path.join(projectDir, 'build', 'icon.ico');
  const appOutDir = context.appOutDir;
  const productFilename = context.packager?.appInfo?.productFilename;
  let exePath = productFilename ? path.join(appOutDir, `${productFilename}.exe`) : null;

  if (!fs.existsSync(iconPath)) {
    console.warn(`[after-pack] Icon file not found: ${iconPath}`);
    return;
  }

  if (!exePath || !fs.existsSync(exePath)) {
    const detectedExe = fs
      .readdirSync(appOutDir)
      .filter((file) => file.toLowerCase().endsWith('.exe'))
      .find((file) => !file.toLowerCase().includes('uninstall'));

    if (!detectedExe) {
      console.warn(`[after-pack] Executable not found in: ${appOutDir}`);
      return;
    }

    exePath = path.join(appOutDir, detectedExe);
  }

  await rcedit(exePath, { icon: iconPath });
  console.log(`[after-pack] Windows executable icon stamped: ${exePath}`);
};
