import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const parseEnvLine = (line: string): [string, string] | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const equalIndex = trimmed.indexOf('=');
  if (equalIndex <= 0) return null;

  const key = trimmed.slice(0, equalIndex).trim();
  let value = trimmed.slice(equalIndex + 1).trim();

  if (!key) return null;

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return [key, value];
};

export const loadLocalEnv = (): void => {
  const candidatePaths = new Set<string>();
  const addCandidate = (value: string | null | undefined) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    candidatePaths.add(path.resolve(normalized));
  };

  const explicitEnvFile = process.env.ELECTRON_ENV_FILE || process.env.DOTENV_CONFIG_PATH;
  if (explicitEnvFile) {
    addCandidate(explicitEnvFile);
  }

  const cwd = process.cwd();
  addCandidate(path.join(cwd, '.env'));
  addCandidate(path.join(cwd, '.env.local'));

  // Useful in development: dist-electron is generated in project root.
  addCandidate(path.join(__dirname, '..', '.env'));
  addCandidate(path.join(__dirname, '..', '.env.local'));

  try {
    const appPath = app.getAppPath();
    addCandidate(path.join(appPath, '.env'));
    addCandidate(path.join(appPath, '.env.local'));
    addCandidate(path.join(path.dirname(appPath), '.env'));
    addCandidate(path.join(path.dirname(appPath), '.env.local'));
  } catch {
    // app path may be unavailable during very early bootstrap
  }

  try {
    const resourcesPath = process.resourcesPath;
    addCandidate(path.join(resourcesPath, '.env'));
    addCandidate(path.join(resourcesPath, '.env.local'));
    addCandidate(path.join(path.dirname(resourcesPath), '.env'));
    addCandidate(path.join(path.dirname(resourcesPath), '.env.local'));
  } catch {
    // ignore path resolution errors
  }

  try {
    const exeDir = path.dirname(process.execPath);
    addCandidate(path.join(exeDir, '.env'));
    addCandidate(path.join(exeDir, '.env.local'));
  } catch {
    // ignore path resolution errors
  }

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/u);

    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;

      const [key, value] = parsed;
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  }
};
