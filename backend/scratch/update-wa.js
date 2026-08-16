const fs = require('fs');

const path = 'src/services/WhatsAppService.ts';
let content = fs.readFileSync(path, 'utf8');

// 1. Define the block of code to insert at the top
const groupCheckLogic = `
                // Immediately check if the group is linked to ExpenseBot
                let groupName = this.cachedGroupJidMap.get(groupJid);
                if (!groupName) {
                    try {
                        const metadata = await this.sock!.groupMetadata(groupJid);
                        groupName = metadata.subject;
                        this.cachedGroupJidMap.set(groupJid, groupName!);
                    } catch (e) {
                        continue;
                    }
                }
                const Group = require('../models/Group').default;
                const group = await Group.findOne({ title: groupName });
                if (!group) {
                    // Silently ignore messages from unlinked groups to prevent spam and wasted API calls!
                    continue;
                }
`;

// Insert after senderJid definition
content = content.replace(
    /const senderJid = msg\.key\.participant \|\| msg\.participant \|\| msg\.key\.remoteJid \|\| '';/g,
    `const senderJid = msg.key.participant || msg.participant || msg.key.remoteJid || '';\n${groupCheckLogic}`
);

// 2. Remove the old group check from line ~326
const oldGroupCheckRegex = /\/\/ If not yes\/no, Process Natural Language Expense \/ Settlement[\s\S]*?const User = require\('\.\.\/models\/User'\)\.default;/g;

content = content.replace(oldGroupCheckRegex, `// If not yes/no, Process Natural Language Expense / Settlement
                const User = require('../models/User').default;`);

fs.writeFileSync(path, content, 'utf8');
console.log('WhatsAppService.ts updated successfully.');
