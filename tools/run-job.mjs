/** Register a finite long-job lease in the current externally supervised run. */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const run = process.env.EMPIRES_RUN_DIR;
const [pidText, secondsText, ...purpose] = process.argv.slice(2);
const pid = Number(pidText), seconds = Number(secondsText);
if (!run || !Number.isInteger(pid) || pid <= 1 || !(seconds > 0) || !purpose.length) {
  throw new Error('Inside a supervised run: node tools/run-job.mjs pid seconds purpose');
}
process.kill(pid, 0);
const status = JSON.parse(readFileSync(resolve(run, 'status.json'), 'utf8'));
if (status.state !== 'running') throw new Error('Run is not active');
const until = Math.min(status.deadline, Date.now() + seconds * 1000);
const target = resolve(run, 'job.json');
writeFileSync(target + '.tmp', JSON.stringify({ pid, until, purpose: purpose.join(' ') }));
renameSync(target + '.tmp', target);
console.log(`Registered job ${pid} until ${new Date(until).toISOString()}; the overall deadline still applies.`);
