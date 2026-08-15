const fs = require('fs');
let ts = fs.readFileSync('src/services/WhatsAppService.ts', 'utf8');

ts = ts.replace(/import Setting from "\.\.\/models\/Setting";/, 'import { Setting } from "../models/Setting";');

fs.writeFileSync('src/services/WhatsAppService.ts', ts);
console.log('Fixed TS 7!');
