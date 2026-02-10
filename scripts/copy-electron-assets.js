const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'electron', 'db', 'migrations');
const targetDir = path.join(__dirname, '..', 'dist-electron', 'db', 'migrations');

if (!fs.existsSync(sourceDir)) {
  console.error('Missing migrations source directory:', sourceDir);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

for (const file of fs.readdirSync(sourceDir)) {
  if (!file.endsWith('.sql')) continue;
  const src = path.join(sourceDir, file);
  const dest = path.join(targetDir, file);
  fs.copyFileSync(src, dest);
}

console.log('Electron migration assets copied.');
