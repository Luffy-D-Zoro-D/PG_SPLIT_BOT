const fs = require('fs');

const logFile = 'C:\\Users\\marsh\\.gemini\\antigravity-ide\\brain\\50e0db4e-95a8-46ab-89ef-235e86a156ca\\.system_generated\\logs\\transcript_full.jsonl';
const lines = fs.readFileSync(logFile, 'utf8').split('\n');

let bestContent = null;

for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i].trim()) continue;
  try {
    const obj = JSON.parse(lines[i]);
    if (obj.tool_calls) {
      for (const call of obj.tool_calls) {
        if (call.function === 'replace_file_content' || call.function === 'multi_replace_file_content' || call.function === 'write_to_file') {
            if (call.arguments) {
                const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
                if (args.TargetFile && args.TargetFile.endsWith('WhatsAppService.ts')) {
                    console.log('Found a tool call for WhatsAppService.ts at step index', obj.step_index);
                    // But wait, replace_file_content only has ReplacementContent, not the whole file!
                    // Wait! The LLM doesn't output the full file in replace_file_content. It only outputs TargetContent and ReplacementContent!
                    // So transcript won't have the full file from replace_file_content.
                }
            }
        }
      }
    }
  } catch (e) {}
}
