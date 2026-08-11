import mongoose, { Document, Schema } from 'mongoose';

export enum ExpenseStatus {
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED'
}

export interface IParticipantShare {
  telegramUserId: number;
  share: string; // Storing decimal values as string to preserve precision with decimal.js
}

export interface IExpense extends Document {
  telegramChatId: number;
  totalAmount: string;
  paidByTelegramUserId: number;
  description: string;
  status: ExpenseStatus;
  sharedAmount: string;
  sharedParticipants: IParticipantShare[];
  personalExpenses: IParticipantShare[];
  imageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ParticipantShareSchema = new Schema({
  telegramUserId: { type: Number, required: true },
  share: { type: String, required: true }
}, { _id: false });

const ExpenseSchema: Schema = new Schema({
  telegramChatId: { type: Number, required: true },
  totalAmount: { type: String, required: true },
  paidByTelegramUserId: { type: Number, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: Object.values(ExpenseStatus), default: ExpenseStatus.PENDING_CONFIRMATION },
  sharedAmount: { type: String, required: true },
  sharedParticipants: { type: [ParticipantShareSchema], default: [] },
  personalExpenses: { type: [ParticipantShareSchema], default: [] },
  imageUrl: { type: String },
}, {
  timestamps: true
});

export default mongoose.model<IExpense>('Expense', ExpenseSchema);
