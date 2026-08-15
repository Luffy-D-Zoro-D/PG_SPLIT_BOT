const fs = require('fs');
let ts = fs.readFileSync('src/services/WhatsAppService.ts', 'utf8');

ts = ts.replace(/static sock = null;/g, 'static sock: any = null;');
ts = ts.replace(/static qrCode = null;/g, 'static qrCode: any = null;');
ts = ts.replace(/static cachedGroupJidMap = new Map\(\);/g, 'static cachedGroupJidMap = new Map<string, string>();');

ts = ts.replace(/Setting_1\.default/g, 'Setting');
ts = ts.replace(/Setting_1\./g, '');
ts = ts.replace(/import \{ getSetting, updateSetting \} from "\.\.\/models\/Setting";/, 'import Setting from "../models/Setting";\nimport { getSetting, updateSetting } from "../models/Setting";');

ts = ts.replace(/this\.sock!\./g, 'this.sock.'); // remove the bang operator
ts = ts.replace(/public static setNotificationsEnabled\(enabled: boolean\)/, 'public static setNotificationsEnabled(enabled: boolean)');

ts = ts.replace(/static async sendTextMessage\(groupTitle: string, message: string, _quoteMessageId\?: string\)/g, 'static async sendTextMessage(groupTitle: string, message: string, _quoteMessageId?: string)');

fs.writeFileSync('src/services/WhatsAppService.ts', ts);
console.log('Fixed TS!');
