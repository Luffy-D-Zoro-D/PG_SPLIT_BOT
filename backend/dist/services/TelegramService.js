"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramService = void 0;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const getTelegramApiUrl = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const getTelegramFileUrl = (filePath) => `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
class TelegramService {
    /**
     * Send a text message to a chat
     */
    static async sendMessage(chatId, text, replyMarkup) {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            console.warn('TELEGRAM_BOT_TOKEN not set. Message not sent:', text);
            return;
        }
        try {
            await axios_1.default.post(`${getTelegramApiUrl()}/sendMessage`, {
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                reply_markup: replyMarkup
            });
        }
        catch (e) {
            console.error('Failed to send Telegram message:', e?.response?.data || e.message);
        }
    }
    static async setWebhook(url) {
        if (!process.env.TELEGRAM_BOT_TOKEN)
            return false;
        try {
            const response = await axios_1.default.post(`${getTelegramApiUrl()}/setWebhook`, { url });
            return response.data.ok;
        }
        catch (e) {
            console.error('Failed to set webhook:', e?.response?.data || e.message);
            return false;
        }
    }
    /**
     * Get file details from Telegram by file_id
     */
    static async getFile(fileId) {
        if (!process.env.TELEGRAM_BOT_TOKEN)
            return null;
        try {
            const response = await axios_1.default.get(`${getTelegramApiUrl()}/getFile?file_id=${fileId}`);
            if (response.data.ok) {
                return response.data.result.file_path;
            }
            return null;
        }
        catch (e) {
            console.error('Failed to get file:', e?.response?.data || e.message);
            return null;
        }
    }
    /**
     * Download a file from Telegram and save it temporarily
     */
    static async downloadFile(filePath, destPath) {
        if (!process.env.TELEGRAM_BOT_TOKEN)
            return null;
        try {
            const url = getTelegramFileUrl(filePath);
            const dir = path_1.default.dirname(destPath);
            if (!fs_1.default.existsSync(dir)) {
                fs_1.default.mkdirSync(dir, { recursive: true });
            }
            const response = await (0, axios_1.default)({
                url,
                method: 'GET',
                responseType: 'stream'
            });
            const writer = fs_1.default.createWriteStream(destPath);
            response.data.pipe(writer);
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(destPath));
                writer.on('error', reject);
            });
        }
        catch (e) {
            console.error('Failed to download file:', e?.response?.data || e.message);
            return null;
        }
    }
}
exports.TelegramService = TelegramService;
