const mongoose = require("mongoose");
const crypto = require("crypto");

const messageSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
    required: true,
    index: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  encrypted: {
    type: Boolean,
    default: true,
  },
  iv: {
    type: String,
    required: false,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  edited: {
    type: Boolean,
    default: false,
  },
  editedAt: {
    type: Date,
  },
  deleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
  },
});

// Encryption helper methods
messageSchema.statics.encryptContent = function (content) {
  const algorithm = "aes-128-cbc";
  const key = Buffer.from(
    process.env.ENCRYPTION_KEY || "defaultkey123456",
    "utf8"
  );
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(content, "utf8", "hex");
  encrypted += cipher.final("hex");

  return {
    encrypted: encrypted,
    iv: iv.toString("hex"),
  };
};

messageSchema.statics.decryptContent = function (encryptedContent, iv) {
  const algorithm = "aes-128-cbc";
  const key = Buffer.from(
    process.env.ENCRYPTION_KEY || "defaultkey123456",
    "utf8"
  );
  const ivBuffer = Buffer.from(iv, "hex");

  const decipher = crypto.createDecipheriv(algorithm, key, ivBuffer);
  let decrypted = decipher.update(encryptedContent, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};

// Encrypt content before saving
messageSchema.pre("save", function (next) {
  if (!this.isModified("content") || !this.encrypted) return next();

  try {
    const { encrypted, iv } = messageSchema.statics.encryptContent(
      this.content
    );
    this.content = encrypted;
    this.iv = iv;
    next();
  } catch (error) {
    next(error);
  }
});

// Method to get decrypted content
messageSchema.methods.getDecryptedContent = function () {
  if (!this.encrypted) return this.content;

  try {
    return messageSchema.statics.decryptContent(this.content, this.iv);
  } catch (error) {
    console.error("Decryption error:", error);
    return "[Decryption failed]";
  }
};

// Create compound index for efficient queries
messageSchema.index({ groupId: 1, timestamp: -1 });

module.exports = mongoose.model("Message", messageSchema);
