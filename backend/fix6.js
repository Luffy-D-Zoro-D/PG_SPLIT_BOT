const fs = require('fs');
let ts = fs.readFileSync('src/services/WhatsAppService.ts', 'utf8');

ts = 'import Setting from "../models/Setting";\n' + ts;

fs.writeFileSync('src/services/WhatsAppService.ts', ts);
console.log('Fixed TS 6!');
