// routes/messages.js
const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const Group = require("../models/Group");
const winston = require("winston");

const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
});

/**
 * @openapi
 * /messages/{groupId}:
 *   post:
 *     summary: Send a message to a group
 *     tags:
 *       - Messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: Message sent successfully
 *       400:
 *         description: Missing content
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 *       500:
 *         description: Failed to send message
 */
router.post("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content } = req.body;
    const userId = req.userId;

    // Validate input
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        error: "Missing content",
        message: "Message content is required",
      });
    }

    // Check if group exists
    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is a member
    if (!group.isMember(userId)) {
      return res.status(403).json({
        error: "Access denied",
        message: "You must be a member to send messages",
      });
    }

    // Create and save message (encryption happens in pre-save hook)
    const message = new Message({
      groupId,
      senderId: userId,
      content: content.trim(),
      encrypted: true,
    });

    await message.save();

    // Populate sender info
    await message.populate("senderId", "username email");

    // Emit to WebSocket if available
    const io = req.app.get("io");
    if (io) {
      io.to(groupId.toString()).emit("new-message", {
        id: message._id,
        groupId: message.groupId,
        sender: message.senderId,
        content: message.getDecryptedContent(),
        timestamp: message.timestamp,
      });

      logger.debug(`WebSocket message emitted to group ${groupId}`);
    }

    logger.info(`Message sent to group ${groupId} by user ${userId}`);

    res.status(201).json({
      message: "Message sent successfully",
      data: {
        id: message._id,
        groupId: message.groupId,
        sender: message.senderId,
        content: message.getDecryptedContent(),
        timestamp: message.timestamp,
      },
    });
  } catch (error) {
    logger.error("Send message error:", error);
    res.status(500).json({
      error: "Failed to send message",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /messages/{groupId}:
 *   get:
 *     summary: Get messages from a group
 *     tags:
 *       - Messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Max number of messages to return
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Get messages before this timestamp
 *       - in: query
 *         name: after
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Get messages after this timestamp
 *     responses:
 *       200:
 *         description: List of messages
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 *       500:
 *         description: Failed to retrieve messages
 */
router.get("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.userId;
    const { limit = 50, before, after } = req.query;

    // Check if group exists
    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is a member
    if (!group.isMember(userId)) {
      return res.status(403).json({
        error: "Access denied",
        message: "You must be a member to view messages",
      });
    }

    // Build query
    let query = {
      groupId,
      deleted: false,
    };

    if (before) {
      query.timestamp = { $lt: new Date(before) };
    } else if (after) {
      query.timestamp = { $gt: new Date(after) };
    }

    // Fetch messages
    const messages = await Message.find(query)
      .populate("senderId", "username email")
      .sort("-timestamp")
      .limit(parseInt(limit));

    // Decrypt messages
    const decryptedMessages = messages.map((msg) => ({
      id: msg._id,
      groupId: msg.groupId,
      sender: msg.senderId,
      content: msg.getDecryptedContent(),
      timestamp: msg.timestamp,
      edited: msg.edited,
      editedAt: msg.editedAt,
    }));

    logger.debug(`Retrieved ${messages.length} messages from group ${groupId}`);

    res.json({
      messages: decryptedMessages.reverse(), // Return in chronological order
      hasMore: messages.length === parseInt(limit),
    });
  } catch (error) {
    logger.error("Get messages error:", error);
    res.status(500).json({
      error: "Failed to retrieve messages",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /messages/{messageId}:
 *   put:
 *     summary: Edit a message (sender only)
 *     tags:
 *       - Messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message edited successfully
 *       400:
 *         description: Missing content or time limit exceeded
 *       403:
 *         description: Access denied
 *       404:
 *         description: Message not found
 *       500:
 *         description: Failed to edit message
 */
router.put("/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.userId;

    // Validate input
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        error: "Missing content",
        message: "Message content is required",
      });
    }

    // Find the message
    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        error: "Message not found",
      });
    }

    // Check if message is deleted
    if (message.deleted) {
      return res.status(400).json({
        error: "Message deleted",
        message: "Cannot edit a deleted message",
      });
    }

    // Check if user is the sender
    if (message.senderId.toString() !== userId) {
      return res.status(403).json({
        error: "Access denied",
        message: "You can only edit your own messages",
      });
    }

    // Check if editing within time limit (e.g., 15 minutes)
    const minutesSinceSent = (Date.now() - message.timestamp) / (1000 * 60);
    if (minutesSinceSent > 15) {
      return res.status(400).json({
        error: "Time limit exceeded",
        message: "Messages can only be edited within 15 minutes of sending",
      });
    }

    // Update message with new encrypted content
    const { encrypted, iv } = Message.encryptContent(content.trim());
    message.content = encrypted;
    message.iv = iv;
    message.edited = true;
    message.editedAt = new Date();

    await message.save();
    await message.populate("senderId", "username email");

    // Emit update to WebSocket
    const io = req.app.get("io");
    if (io) {
      io.to(message.groupId.toString()).emit("message-edited", {
        id: message._id,
        groupId: message.groupId,
        sender: message.senderId,
        content: message.getDecryptedContent(),
        timestamp: message.timestamp,
        edited: true,
        editedAt: message.editedAt,
      });
    }

    logger.info(`Message ${messageId} edited by user ${userId}`);

    res.json({
      message: "Message edited successfully",
      data: {
        id: message._id,
        content: message.getDecryptedContent(),
        edited: true,
        editedAt: message.editedAt,
      },
    });
  } catch (error) {
    logger.error("Edit message error:", error);
    res.status(500).json({
      error: "Failed to edit message",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /messages/{messageId}:
 *   delete:
 *     summary: Delete a message (soft delete, sender only)
 *     tags:
 *       - Messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Message deleted successfully
 *       400:
 *         description: Already deleted
 *       403:
 *         description: Access denied
 *       404:
 *         description: Message not found
 *       500:
 *         description: Failed to delete message
 */
router.delete("/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.userId;

    // Find the message
    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        error: "Message not found",
      });
    }

    // Check if already deleted
    if (message.deleted) {
      return res.status(400).json({
        error: "Already deleted",
        message: "This message has already been deleted",
      });
    }

    // Check if user is the sender or group owner
    const group = await Group.findById(message.groupId);
    const isOwner = group && group.owner.toString() === userId;
    const isSender = message.senderId.toString() === userId;

    if (!isSender && !isOwner) {
      return res.status(403).json({
        error: "Access denied",
        message: "You can only delete your own messages",
      });
    }

    // Soft delete the message
    message.deleted = true;
    message.deletedAt = new Date();
    await message.save();

    // Emit deletion to WebSocket
    const io = req.app.get("io");
    if (io) {
      io.to(message.groupId.toString()).emit("message-deleted", {
        id: message._id,
        groupId: message.groupId,
        deletedBy: userId,
        deletedAt: message.deletedAt,
      });
    }

    logger.info(`Message ${messageId} deleted by user ${userId}`);

    res.json({
      message: "Message deleted successfully",
    });
  } catch (error) {
    logger.error("Delete message error:", error);
    res.status(500).json({
      error: "Failed to delete message",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /messages/{groupId}/search:
 *   get:
 *     summary: Search messages in a group
 *     tags:
 *       - Messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Max number of results
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Missing search query
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 *       500:
 *         description: Failed to search messages
 */
router.get("/:groupId/search", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { q, limit = 20 } = req.query;
    const userId = req.userId;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        error: "Missing search query",
      });
    }

    // Check if group exists and user is member
    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    if (!group.isMember(userId)) {
      return res.status(403).json({
        error: "Access denied",
        message: "You must be a member to search messages",
      });
    }

    // Fetch all non-deleted messages from the group
    const messages = await Message.find({
      groupId,
      deleted: false,
    })
      .populate("senderId", "username email")
      .sort("-timestamp")
      .limit(500); // Limit to recent 500 messages for search

    // Decrypt and search messages
    const searchResults = [];
    const searchTerm = q.toLowerCase();

    for (const msg of messages) {
      const decryptedContent = msg.getDecryptedContent();
      if (decryptedContent.toLowerCase().includes(searchTerm)) {
        searchResults.push({
          id: msg._id,
          groupId: msg.groupId,
          sender: msg.senderId,
          content: decryptedContent,
          timestamp: msg.timestamp,
          edited: msg.edited,
        });
      }

      if (searchResults.length >= parseInt(limit)) {
        break;
      }
    }

    logger.debug(
      `Search found ${searchResults.length} messages in group ${groupId}`
    );

    res.json({
      results: searchResults,
      query: q,
      count: searchResults.length,
    });
  } catch (error) {
    logger.error("Search messages error:", error);
    res.status(500).json({
      error: "Failed to search messages",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /messages/{groupId}/acknowledge:
 *   post:
 *     summary: Acknowledge message receipt (for simulated real-time)
 *     tags:
 *       - Messages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messageIds
 *             properties:
 *               messageIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Messages acknowledged
 *       400:
 *         description: Invalid message IDs
 *       403:
 *         description: Access denied
 *       500:
 *         description: Failed to acknowledge messages
 */
router.post("/:groupId/acknowledge", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { messageIds } = req.body;
    const userId = req.userId;

    if (!messageIds || !Array.isArray(messageIds)) {
      return res.status(400).json({
        error: "Invalid message IDs",
      });
    }

    // Check if group exists and user is member
    const group = await Group.findById(groupId);

    if (!group || !group.isMember(userId)) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    // This is a simulated acknowledgment
    // In a real system, you might update read receipts in the database

    const io = req.app.get("io");
    if (io) {
      io.to(groupId.toString()).emit("messages-acknowledged", {
        userId,
        messageIds,
        timestamp: new Date(),
      });
    }

    logger.debug(
      `Acknowledged ${messageIds.length} messages for user ${userId}`
    );

    res.json({
      message: "Messages acknowledged",
      acknowledged: messageIds,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error("Acknowledge messages error:", error);
    res.status(500).json({
      error: "Failed to acknowledge messages",
      message: error.message,
    });
  }
});

module.exports = router;
