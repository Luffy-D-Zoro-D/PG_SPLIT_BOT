const fs = require('fs');

let ts = fs.readFileSync('src/services/WhatsAppService.ts', 'utf8');

ts = ts.replace(/this\.sock\.ev\.on\('messages\.update', async \(events\) => \{/, "this.sock.ev.on('messages.update', async (events: any) => {");

ts = ts.replace(/static async setNotificationsEnabled\(enabled\)/, "static async setNotificationsEnabled(enabled: boolean)");

ts = ts.replace(/static async sendGroupMessage\(groupTitle, message, _quoteMessageId\)/, "static async sendGroupMessage(groupTitle: string, message: string, _quoteMessageId?: string)");

ts = ts.replace(/static async sendGroupPoll\(groupTitle, pollQuestion, options, settlementId\)/, "static async sendGroupPoll(groupTitle: string, pollQuestion: string, options: any, settlementId?: string)");

ts = ts.replace(/Setting_1/g, "Setting");

fs.writeFileSync('src/services/WhatsAppService.ts', ts);

console.log('Fixed TS 5!');
