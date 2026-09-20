/** Install the single household host/join service for the current Linux user. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const [role, assets, host] = process.argv.slice(2);
if (role !== 'host' && role !== 'join') throw new Error('Usage: node tools/install-shared.mjs host|join [asset-public-directory] [host-url]');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(homedir(), '.config/systemd/user');
const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
const command = role === 'host'
  ? [process.execPath, `${root}node_modules/tsx/dist/cli.mjs`, `${root}tools/shared-host.mts`]
  : [process.execPath, `${root}tools/shared-join.mjs`];
const environment = [
  `PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
  ...(role === 'join' ? [`MATCH_ASSETS=${resolve(assets ?? `${root}public`)}`, `MATCH_HOST=${host ?? 'https://ysgramor.tail6e864b.ts.net:5173'}`] : []),
];
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/open-empires-shared.service`, `[Unit]
Description=Open Empires household ${role}
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${root.replaceAll('%', '%%')}
ExecStart=${command.map(quote).join(' ')}
Environment=${environment.map(quote).join(' ')}
Restart=always
RestartSec=3
TimeoutStopSec=15

[Install]
WantedBy=default.target
`);
execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', 'open-empires-shared.service'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'restart', 'open-empires-shared.service'], { stdio: 'inherit' });
console.log(role === 'host' ? 'Ysgramor now hosts the shared match on port 5173.' : 'Join the shared match at http://localhost:5174/');
