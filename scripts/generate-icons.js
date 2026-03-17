const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const projectRoot = path.join(__dirname, '..');
const logoPath = path.join(projectRoot, 'build', 'LOGO.png');
const iconPngPath = path.join(projectRoot, 'build', 'icon.png');
const iconIcoPath = path.join(projectRoot, 'build', 'icon.ico');

const sizes = [16, 24, 32, 48, 64, 128, 256];

const resizeContainedPng = (size) =>
  sharp(logoPath)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

async function main() {
  const { default: pngToIco } = await import('png-to-ico');

  if (!fs.existsSync(logoPath)) {
    throw new Error(`Missing source logo at ${logoPath}`);
  }

  const iconPngBuffer = await resizeContainedPng(512);
  fs.writeFileSync(iconPngPath, iconPngBuffer);

  const icoFrames = await Promise.all(sizes.map((size) => resizeContainedPng(size)));
  const icoBuffer = await pngToIco(icoFrames);
  fs.writeFileSync(iconIcoPath, icoBuffer);

  console.log(`Generated icon files:\n- ${iconPngPath}\n- ${iconIcoPath}`);
}

main().catch((error) => {
  console.error('Failed to generate app icons.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
