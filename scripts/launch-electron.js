// Launches Electron with ELECTRON_RUN_AS_NODE removed from env.
// Required when launching from VS Code (which sets ELECTRON_RUN_AS_NODE=1).
const { spawn } = require('child_process');
const electronPath = require('electron'); // npm package returns path string
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
