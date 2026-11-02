// Copies the static app into www/ for Capacitor to bundle into the iOS app.
const fs = require('fs');
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www/vendor', { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-180.png']) fs.copyFileSync(f, 'www/' + f);
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync('vendor/' + f, 'www/vendor/' + f);
