const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  type: {
    type: String,
    enum: ["public", "private"],
    required: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  members: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  maxMembers: {
    type: Number,
    min: 2,
    default: null, // null means unlimited
  },
  joinRequests: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      requestedAt: {
        type: Date,
        default: Date.now,
      },
      status: {
        type: String,
        enum: ["pending", "approved", "declined"],
        default: "pending",
      },
    },
  ],
  bannedUsers: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      bannedAt: {
        type: Date,
        default: Date.now,
      },
      bannedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
groupSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Check if user is member
groupSchema.methods.isMember = function (userId) {
  return this.members.some(
    (memberId) => memberId.toString() === userId.toString()
  );
};

// Check if user is banned
groupSchema.methods.isBanned = function (userId) {
  return this.bannedUsers.some(
    (ban) => ban.userId.toString() === userId.toString()
  );
};

// Check if user has pending request
groupSchema.methods.hasPendingRequest = function (userId) {
  return this.joinRequests.some(
    (req) =>
      req.userId.toString() === userId.toString() && req.status === "pending"
  );
};

module.exports = mongoose.model("Group", groupSchema);
