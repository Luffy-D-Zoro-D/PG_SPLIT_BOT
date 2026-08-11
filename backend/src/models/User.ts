import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  telegramUserId: { type: Number, required: true, unique: true },
  username: { type: String, required: false },
  firstName: { type: String, required: false },
  lastName: { type: String, required: false },
}, {
  timestamps: true
});

export default mongoose.model<IUser>('User', UserSchema);
