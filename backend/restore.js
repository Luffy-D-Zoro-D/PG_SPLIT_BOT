const fs = require('fs');
let js = fs.readFileSync('dist/services/WhatsAppService.js', 'utf8');

js = js.replace(/"use strict";\n/, '');
js = js.replace(/var __importDefault = [\s\S]*?};\n/, '');
js = js.replace(/Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);\n/, '');
js = js.replace(/exports\.WhatsAppService = void 0;\n/, '');

js = js.replace(/const qrcode_terminal_1 = require\("qrcode-terminal"\);\n/, 'import qrcode from "qrcode-terminal";\n');
js = js.replace(/const dotenv_1 = require\("dotenv"\);\n/, 'import dotenv from "dotenv";\n');
js = js.replace(/const fs_1 = require\("fs"\);\n/, 'import fs from "fs";\n');
js = js.replace(/const path_1 = require\("path"\);\n/, 'import path from "path";\n');
js = js.replace(/const Setting_1 = require\("\.\.\/models\/Setting"\);\n/, 'import { getSetting, updateSetting } from "../models/Setting";\n');

// Clean up property assignments
js = js.replace(/exports\.WhatsAppService = /g, 'export ');

fs.writeFileSync('src/services/WhatsAppService.ts', js);
console.log('Restored!');
