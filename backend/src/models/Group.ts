import mongoose, { Document, Schema } from 'mongoose';

export interface IGroup extends Document {
  telegramChatId: number;
  title: string;
  members: number[]; // telegramUserIds
  createdAt: Date;
  updatedAt: Date;
}

const GroupSchema: Schema = new Schema({
  telegramChatId: { type: Number, required: true, unique: true },
  title: { type: String, required: true },
  members: [{ type: Number }], // Array of telegramUserIds
}, {
  timestamps: true
});

export default mongoose.model<IGroup>('Group', GroupSchema);
