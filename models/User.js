// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function (v) {
        return /^\S+@\S+\.\S+$/.test(v);
      },
      message: "Invalid email format",
    },
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  groups: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },
  ],
  bannedGroups: [
    {
      groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
      },
      bannedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  leftGroups: [
    {
      groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
      },
      leftAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if user can rejoin private group (48 hour cooldown)
userSchema.methods.canRejoinPrivateGroup = function (groupId) {
  const leftRecord = this.leftGroups.find(
    (lg) => lg.groupId.toString() === groupId.toString()
  );

  if (!leftRecord) return true;

  const hoursSinceLeft = (Date.now() - leftRecord.leftAt) / (1000 * 60 * 60);
  return hoursSinceLeft >= 48;
};

module.exports = mongoose.model("User", userSchema);
