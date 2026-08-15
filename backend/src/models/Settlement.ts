import mongoose, { Document, Schema } from 'mongoose';

export interface ISettlement extends Document {
  telegramChatId: number;
  paidByTelegramUserId: number;
  paidToTelegramUserId: number;
  amount: string; // Decimal stored as string
  status: 'PENDING_APPROVAL' | 'CONFIRMED';
  approvedBy: number[]; // Array of telegramUserIds
  whatsappPollMessageId?: string;
  createdAt: Date;
}

const SettlementSchema: Schema = new Schema({
  telegramChatId: { type: Number, required: true, index: true },
  paidByTelegramUserId: { type: Number, required: true },
  paidToTelegramUserId: { type: Number, required: true },
  amount: { type: String, required: true },
  status: { type: String, enum: ['PENDING_APPROVAL', 'CONFIRMED'], default: 'PENDING_APPROVAL' },
  approvedBy: { type: [Number], default: [] },
  whatsappPollMessageId: { type: String, required: false }
}, {
  timestamps: true
});

export default mongoose.model<ISettlement>('Settlement', SettlementSchema);
