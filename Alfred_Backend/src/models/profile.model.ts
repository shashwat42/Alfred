import mongoose from "mongoose";
const profileSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, ref: "Account" },
  name: { type: String, maxlength: 100 },
  picture: { type: String, default: undefined },
}, { timestamps: true });
export const CloudProfile = mongoose.model("CloudProfile", profileSchema);
