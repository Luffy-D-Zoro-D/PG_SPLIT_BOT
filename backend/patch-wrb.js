const fs = require('fs');
const file = 'node_modules/whatsapp-rust-bridge/package.json';
try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pkg.exports && pkg.exports['.']) {
        pkg.exports['.'].require = pkg.exports['.'].import;
        pkg.exports['.'].default = pkg.exports['.'].import;
        fs.writeFileSync(file, JSON.stringify(pkg, null, 2), 'utf8');
        console.log('Successfully patched whatsapp-rust-bridge for tsx compatibility');
    }
} catch (e) {
    console.log('Skipping whatsapp-rust-bridge patch (not installed or file not found)');
}
