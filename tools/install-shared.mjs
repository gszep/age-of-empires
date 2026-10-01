/** Install the single household host/join service for the current Linux user. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const [role, assets, host] = process.argv.slice(2);
if (role !== 'host' && role !== 'join') throw new Error('Usage: node tools/install-shared.mjs host|join [asset-public-directory] [host-url]');
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = role === 'host' && assets ? resolve(assets) + '/' : root;
if (role === 'host' && !existsSync(`${runtime}release.json`)) {
  throw new Error('Host installation requires a verified release: node tools/install-shared.mjs host /absolute/release/path');
}
const directory = resolve(homedir(), '.config/systemd/user');
const quote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
const command = role === 'host'
  ? [process.execPath, `${runtime}node_modules/tsx/dist/cli.mjs`, `${runtime}tools/shared-host.mts`]
  : [process.execPath, `${root}tools/shared-join.mjs`];
const environment = [
  `PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
  ...(role === 'host' ? [`MATCH_CHECKPOINT=${root}.local/shared-match.json`] : []),
  ...(role === 'join' ? [`MATCH_ASSETS=${resolve(assets ?? `${root}public`)}`, `MATCH_HOST=${host ?? 'https://ysgramor.tail6e864b.ts.net:5173'}`] : []),
];
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/open-empires-shared.service`, `[Unit]
Description=Open Empires household ${role}
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${runtime.replaceAll('%', '%%')}
ExecStart=${command.map(quote).join(' ')}
Environment=${environment.map(quote).join(' ')}
Restart=on-failure
RestartPreventExitStatus=78
RestartSec=3
TimeoutStopSec=15

[Install]
WantedBy=default.target
`);
execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', 'open-empires-shared.service'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'restart', 'open-empires-shared.service'], { stdio: 'inherit' });
console.log(`Installed household ${role} service and requested startup. Check: systemctl --user status open-empires-shared.service`);
console.log(role === 'host' ? 'Host URL when ready: http://localhost:5173/' : 'Join URL when ready: http://localhost:5174/');
