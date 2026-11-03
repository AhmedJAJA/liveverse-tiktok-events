// Honor the port supplied by local preview tools without affecting production.
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const index = args.indexOf('--port');
const port = index >= 0 ? args[index + 1] : process.env.PORT;
const child = spawn(process.execPath, ['--watch', 'server.mjs'], {
  stdio: 'inherit', env: { ...process.env, ...(port ? { PORT: port } : {}) }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
