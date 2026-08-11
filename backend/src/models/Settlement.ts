import mongoose, { Document, Schema } from 'mongoose';

export interface ISettlement extends Document {
  telegramChatId: number;
  paidByTelegramUserId: number;
  paidToTelegramUserId: number;
  amount: string; // Decimal stored as string
  createdAt: Date;
}

const SettlementSchema: Schema = new Schema({
  telegramChatId: { type: Number, required: true },
  paidByTelegramUserId: { type: Number, required: true },
  paidToTelegramUserId: { type: Number, required: true },
  amount: { type: String, required: true },
}, {
  timestamps: true
});

export default mongoose.model<ISettlement>('Settlement', SettlementSchema);
