import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const getTelegramApiUrl = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const getTelegramFileUrl = (filePath: string) => `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

export class TelegramService {
  /**
   * Send a text message to a chat
   */
  static async sendMessage(chatId: number, text: string, replyMarkup?: any): Promise<void> {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.warn('TELEGRAM_BOT_TOKEN not set. Message not sent:', text);
      return;
    }
    
    try {
      await axios.post(`${getTelegramApiUrl()}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    } catch (e: any) {
      console.error('Failed to send Telegram message:', e?.response?.data || e.message);
    }
  }

  static async setWebhook(url: string): Promise<boolean> {
    if (!process.env.TELEGRAM_BOT_TOKEN) return false;
    
    try {
      const response = await axios.post(`${getTelegramApiUrl()}/setWebhook`, { url });
      return response.data.ok;
    } catch (e: any) {
      console.error('Failed to set webhook:', e?.response?.data || e.message);
      return false;
    }
  }

  /**
   * Get file details from Telegram by file_id
   */
  static async getFile(fileId: string): Promise<string | null> {
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    try {
      const response = await axios.get(`${getTelegramApiUrl()}/getFile?file_id=${fileId}`);
      if (response.data.ok) {
        return response.data.result.file_path;
      }
      return null;
    } catch (e: any) {
      console.error('Failed to get file:', e?.response?.data || e.message);
      return null;
    }
  }

  /**
   * Download a file from Telegram and save it temporarily
   */
  static async downloadFile(filePath: string, destPath: string): Promise<string | null> {
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    try {
      const url = getTelegramFileUrl(filePath);
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream'
      });
      
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(destPath));
        writer.on('error', reject);
      });
    } catch (e: any) {
      console.error('Failed to download file:', e?.response?.data || e.message);
      return null;
    }
  }
}
