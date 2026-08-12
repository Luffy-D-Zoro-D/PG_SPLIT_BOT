"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIService = exports.ExpenseExtractionSchema = void 0;
const openai_1 = __importDefault(require("openai"));
const fs_1 = __importDefault(require("fs"));
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const openai = new openai_1.default({
    apiKey: process.env.AI_API_KEY || 'fake_key_for_build',
    baseURL: process.env.AI_BASE_URL || Buffer.from('aHR0cHM6Ly9hcGkuZ3JvcS5jb20vb3BlbmFpL3Yx', 'base64').toString('utf-8')
});
// Using zod to strictly type and validate the JSON output
exports.ExpenseExtractionSchema = zod_1.z.object({
    language: zod_1.z.string().nullish().default('en'),
    intent: zod_1.z.enum(['CREATE_EXPENSE', 'CHAT', 'UNKNOWN']).nullish().default('CREATE_EXPENSE'),
    totalAmount: zod_1.z.number().nullish(),
    paidBy: zod_1.z.string().nullish(), // We will map this string to a telegramUserId later
    description: zod_1.z.string().nullish(),
    sharedExpense: zod_1.z.object({
        amount: zod_1.z.number().nullish(),
        splitType: zod_1.z.string().nullish(),
        participants: zod_1.z.array(zod_1.z.object({
            user: zod_1.z.string(),
            share: zod_1.z.number().nullish()
        })).nullish()
    }).nullish(),
    personalExpenses: zod_1.z.array(zod_1.z.object({
        user: zod_1.z.string(),
        amount: zod_1.z.number().nullish()
    })).nullish(),
    confidence: zod_1.z.number().nullish().default(0.5),
    needsClarification: zod_1.z.boolean().nullish().default(false),
    clarificationQuestion: zod_1.z.string().nullish(),
    chatResponse: zod_1.z.string().nullish(),
    itemsBreakdown: zod_1.z.array(zod_1.z.string()).nullish()
});
class AIService {
    static async extractExpense(text, groupMembers, chatHistory = [], senderName) {
        const prompt = `
You are an AI assistant that extracts expense information from natural language messages.
The message can be in English, Hindi, Marathi, Hinglish, Marathinglish, or mixed languages.

Group members: ${groupMembers.join(', ')}
${senderName ? `The person sending this message is: ${senderName}. When they say "I", "me", "mene", "maine", "mi" or refer to themselves, it means ${senderName}.` : ''}

Analyze the text and output ONLY a valid JSON object matching this structure:
{
  "language": "mr/hi/en/etc",
  "intent": "CREATE_EXPENSE", // or "CHAT" or "UNKNOWN"
  "totalAmount": number,
  "paidBy": "User Name",
  "description": "expense description (optional)",
  "sharedExpense": {
    "amount": number,
    "splitType": "EQUAL/UNEQUAL",
    "participants": [
      { "user": "User Name", "share": number }
    ]
  },
  "personalExpenses": [
    { "user": "User Name", "amount": number }
  ],
  "confidence": number,
  "needsClarification": boolean,
  "clarificationQuestion": "string or null",
  "chatResponse": "string or null",
  "itemsBreakdown": [
    "ItemName : X rs -> split - Y each / OR personal - User Name"
  ]
}

Rules:
1. FIRST, determine if the user is actually trying to record a financial expense. If the message is a general question, math problem, greeting, or casual conversation, set intent="CHAT" and provide a helpful, friendly response in "chatResponse".
2. If it IS an expense but information is ambiguous (missing amounts or missing people), set intent="CREATE_EXPENSE", needsClarification=true, and ask a clarificationQuestion ALWAYS in English.
3. If the user states a direct debt like "A owes B X amount", treat this as an expense where B is the "paidBy" (creditor) and A has a personalExpense (debtor).
4. You must map users to one of the provided Group members.
5. If the user mentions names that are NOT in the Group members list, set needsClarification=true and explain in English that you can only track expenses for members currently in this Telegram group. Ask them to add those users to the group.
6. Generate a line-by-line detailed "itemsBreakdown" array for every purchased item. Format example: ["khari : 60rs -> split - 30 each", "milk : 39 rs -> split - 19.5", "poha -> anuj -> 30rs"]. This provides clarity to the users exactly what each item cost and how it was split.
7. If intent is completely unrecognizable, set intent="UNKNOWN".
8. Output strictly JSON. Do not include markdown code blocks around the JSON.
`;
        const messages = [{ role: 'system', content: prompt }];
        // Append recent history so AI has context for replies like "200"
        for (const msg of chatHistory) {
            messages.push({ role: msg.role, content: msg.content });
        }
        messages.push({ role: 'user', content: text });
        const response = await openai.chat.completions.create({
            messages: messages,
            model: process.env.AI_TEXT_MODEL || 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });
        const content = response.choices[0]?.message?.content;
        // console.log(`[AI Raw Output]:\n${content}\n`);
        if (!content) {
            throw new Error('No response from AI provider');
        }
        try {
            const parsed = JSON.parse(content);
            return exports.ExpenseExtractionSchema.parse(parsed);
        }
        catch (e) {
            console.error('Failed to parse AI response:', e, content);
            throw new Error('Invalid JSON structure from AI');
        }
    }
    static async transcribeAudio(filePath) {
        try {
            const translation = await openai.audio.transcriptions.create({
                file: fs_1.default.createReadStream(filePath),
                model: process.env.AI_AUDIO_MODEL || 'whisper-large-v3',
                response_format: 'json',
                language: 'en', // Can omit or set if mostly english/hindi
                temperature: 0.0
            });
            return translation.text;
        }
        catch (e) {
            console.error('Failed to transcribe audio with AI:', e);
            throw new Error('Audio transcription failed');
        }
    }
}
exports.AIService = AIService;
