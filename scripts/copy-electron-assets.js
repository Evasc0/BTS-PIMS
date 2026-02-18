const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'electron', 'db', 'migrations');
const targetDir = path.join(__dirname, '..', 'dist-electron', 'db', 'migrations');

if (!fs.existsSync(sourceDir)) {
  console.error('Missing migrations source directory:', sourceDir);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

const sourceFiles = new Set(fs.readdirSync(sourceDir).filter((file) => file.endsWith('.sql')));

for (const file of fs.readdirSync(targetDir)) {
  if (!file.endsWith('.sql')) continue;
  if (sourceFiles.has(file)) continue;
  fs.unlinkSync(path.join(targetDir, file));
}

for (const file of fs.readdirSync(sourceDir)) {
  if (!file.endsWith('.sql')) continue;
  const src = path.join(sourceDir, file);
  const dest = path.join(targetDir, file);
  fs.copyFileSync(src, dest);
}

console.log('Electron migration assets copied.');
