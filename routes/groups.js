// routes/groups.js
const express = require("express");
const router = express.Router();
const Group = require("../models/Group");
const User = require("../models/User");
const Message = require("../models/Message");
const winston = require("winston");

const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
});

/**
 * @openapi
 * /groups:
 *   post:
 *     summary: Create a new group
 *     tags:
 *       - Groups
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [public, private]
 *               maxMembers:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Group created successfully
 *       400:
 *         description: Missing or invalid fields
 *       500:
 *         description: Failed to create group
 */
router.post("/", async (req, res) => {
  try {
    const { name, type, maxMembers } = req.body;
    const userId = req.userId;

    // Validate input
    if (!name || !type) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Name and type are required",
      });
    }

    if (!["public", "private"].includes(type)) {
      return res.status(400).json({
        error: "Invalid group type",
        message: "Type must be either public or private",
      });
    }

    if (maxMembers && maxMembers < 2) {
      return res.status(400).json({
        error: "Invalid max members",
        message: "Maximum members must be at least 2",
      });
    }

    // Create new group
    const group = new Group({
      name,
      type,
      owner: userId,
      members: [userId],
      maxMembers: maxMembers || null,
    });

    await group.save();

    // Add group to user's groups
    await User.findByIdAndUpdate(userId, {
      $push: { groups: group._id },
    });

    logger.info(`Group created: ${group.name} by user ${userId}`);

    res.status(201).json({
      message: "Group created successfully",
      group: {
        id: group._id,
        name: group.name,
        type: group.type,
        owner: group.owner,
        members: group.members,
        maxMembers: group.maxMembers,
      },
    });
  } catch (error) {
    logger.error("Group creation error:", error);
    res.status(500).json({
      error: "Failed to create group",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups:
 *   get:
 *     summary: List all groups (public groups and user's groups)
 *     tags:
 *       - Groups
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [public, private]
 *         description: Filter by group type
 *       - in: query
 *         name: membership
 *         schema:
 *           type: string
 *           enum: [joined, available]
 *         description: Filter by membership
 *     responses:
 *       200:
 *         description: List of groups
 *       500:
 *         description: Failed to fetch groups
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { type, membership } = req.query;

    let query = {};

    // Filter by type if specified
    if (type && ["public", "private"].includes(type)) {
      query.type = type;
    }

    // Filter by membership
    if (membership === "joined") {
      query.members = userId;
    } else if (membership === "available") {
      query.$or = [{ type: "public" }, { members: userId }];
    }

    const groups = await Group.find(query)
      .populate("owner", "username email")
      .populate("members", "username email")
      .sort("-createdAt");

    res.json({
      groups: groups.map((group) => ({
        id: group._id,
        name: group.name,
        type: group.type,
        owner: group.owner,
        memberCount: group.members.length,
        maxMembers: group.maxMembers,
        isMember: group.isMember(userId),
        createdAt: group.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Group listing error:", error);
    res.status(500).json({
      error: "Failed to fetch groups",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}:
 *   get:
 *     summary: Get group details
 *     tags:
 *       - Groups
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group details
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 *       500:
 *         description: Failed to fetch group details
 */
router.get("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.userId;

    const group = await Group.findById(groupId)
      .populate("owner", "username email")
      .populate("members", "username email")
      .populate("joinRequests.userId", "username email");

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is member or group is public
    if (group.type === "private" && !group.isMember(userId)) {
      return res.status(403).json({
        error: "Access denied",
        message: "You must be a member to view this private group",
      });
    }

    res.json({
      group: {
        id: group._id,
        name: group.name,
        type: group.type,
        owner: group.owner,
        members: group.members,
        maxMembers: group.maxMembers,
        isMember: group.isMember(userId),
        isOwner: group.owner._id.toString() === userId,
        joinRequests:
          group.owner._id.toString() === userId ? group.joinRequests : [],
        createdAt: group.createdAt,
      },
    });
  } catch (error) {
    logger.error("Group details error:", error);
    res.status(500).json({
      error: "Failed to fetch group details",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}/join:
 *   post:
 *     summary: Join a group (immediate for public, request for private)
 *     tags:
 *       - Groups
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully joined or request sent
 *       400:
 *         description: Already a member or request pending
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 *       429:
 *         description: Cooldown period
 *       500:
 *         description: Failed to join group
 */
router.post("/:groupId/join", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.userId;

    const group = await Group.findById(groupId);
    const user = await User.findById(userId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if already a member
    if (group.isMember(userId)) {
      return res.status(400).json({
        error: "Already a member",
        message: "You are already a member of this group",
      });
    }

    // Check if banned
    if (group.isBanned(userId)) {
      return res.status(403).json({
        error: "Access denied",
        message:
          "You have been banned from this group. Contact the owner to request reinstatement.",
      });
    }

    // Check max members limit
    if (group.maxMembers && group.members.length >= group.maxMembers) {
      return res.status(400).json({
        error: "Group full",
        message: "This group has reached its maximum member limit",
      });
    }

    // Handle public groups - immediate join
    if (group.type === "public") {
      group.members.push(userId);
      await group.save();

      user.groups.push(groupId);
      await user.save();

      logger.info(`User ${userId} joined public group ${groupId}`);

      return res.json({
        message: "Successfully joined the group",
        group: {
          id: group._id,
          name: group.name,
        },
      });
    }

    // Handle private groups - check cooldown
    if (!user.canRejoinPrivateGroup(groupId)) {
      return res.status(429).json({
        error: "Cooldown period",
        message:
          "You must wait 48 hours after leaving before you can request to rejoin this private group",
      });
    }

    // Check if already has pending request
    if (group.hasPendingRequest(userId)) {
      return res.status(400).json({
        error: "Request pending",
        message: "You already have a pending join request for this group",
      });
    }

    // Create join request for private group
    group.joinRequests.push({
      userId,
      status: "pending",
    });

    await group.save();

    logger.info(`User ${userId} requested to join private group ${groupId}`);

    res.json({
      message: "Join request sent successfully",
      status: "pending",
    });
  } catch (error) {
    logger.error("Join group error:", error);
    res.status(500).json({
      error: "Failed to join group",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}/leave:
 *   post:
 *     summary: Leave a group
 *     tags:
 *       - Groups
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully left the group
 *       400:
 *         description: Not a member or owner cannot leave
 *       404:
 *         description: Group not found
 *       500:
 *         description: Failed to leave group
 */
router.post("/:groupId/leave", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.userId;

    const group = await Group.findById(groupId);
    const user = await User.findById(userId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if member
    if (!group.isMember(userId)) {
      return res.status(400).json({
        error: "Not a member",
        message: "You are not a member of this group",
      });
    }

    // Check if owner trying to leave
    if (group.owner.toString() === userId) {
      return res.status(400).json({
        error: "Owner cannot leave",
        message: "You must transfer ownership before leaving the group",
      });
    }

    // Remove from group
    group.members = group.members.filter((m) => m.toString() !== userId);
    await group.save();

    // Remove from user's groups
    user.groups = user.groups.filter((g) => g.toString() !== groupId);

    // Track leaving private group for cooldown
    if (group.type === "private") {
      const existingRecord = user.leftGroups.findIndex(
        (lg) => lg.groupId.toString() === groupId
      );

      if (existingRecord !== -1) {
        user.leftGroups[existingRecord].leftAt = new Date();
      } else {
        user.leftGroups.push({
          groupId,
          leftAt: new Date(),
        });
      }
    }

    await user.save();

    logger.info(`User ${userId} left group ${groupId}`);

    res.json({
      message: "Successfully left the group",
    });
  } catch (error) {
    logger.error("Leave group error:", error);
    res.status(500).json({
      error: "Failed to leave group",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}:
 *   delete:
 *     summary: Delete a group (owner only, must be sole member)
 *     tags:
 *       - Groups
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group deleted successfully
 *       400:
 *         description: Group has members
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 *       500:
 *         description: Failed to delete group
 */
router.delete("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.userId;

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is owner
    if (group.owner.toString() !== userId) {
      return res.status(403).json({
        error: "Access denied",
        message: "Only the group owner can delete the group",
      });
    }

    // Check if owner is sole member
    if (group.members.length > 1) {
      return res.status(400).json({
        error: "Group has members",
        message: "You must be the only member to delete the group",
      });
    }

    // Delete all messages in the group
    await Message.deleteMany({ groupId });

    // Remove group from all users
    await User.updateMany({ groups: groupId }, { $pull: { groups: groupId } });

    // Delete the group
    await group.deleteOne();

    logger.info(`Group ${groupId} deleted by owner ${userId}`);

    res.json({
      message: "Group deleted successfully",
    });
  } catch (error) {
    logger.error("Delete group error:", error);
    res.status(500).json({
      error: "Failed to delete group",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}/transfer:
 *   post:
 *     summary: Transfer group ownership
 *     tags:
 *       - Groups
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
 *               - newOwnerId
 *             properties:
 *               newOwnerId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ownership transferred successfully
 *       400:
 *         description: Invalid new owner
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group or user not found
 *       500:
 *         description: Failed to transfer ownership
 */
router.post("/:groupId/transfer", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { newOwnerId } = req.body;
    const userId = req.userId;

    if (!newOwnerId) {
      return res.status(400).json({
        error: "Missing new owner ID",
      });
    }

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is owner
    if (group.owner.toString() !== userId) {
      return res.status(403).json({
        error: "Access denied",
        message: "Only the group owner can transfer ownership",
      });
    }

    // Check if new owner is a member
    if (!group.isMember(newOwnerId)) {
      return res.status(400).json({
        error: "Invalid new owner",
        message: "New owner must be a member of the group",
      });
    }

    // Transfer ownership
    group.owner = newOwnerId;
    await group.save();

    logger.info(
      `Group ${groupId} ownership transferred from ${userId} to ${newOwnerId}`
    );

    res.json({
      message: "Ownership transferred successfully",
      newOwner: newOwnerId,
    });
  } catch (error) {
    logger.error("Transfer ownership error:", error);
    res.status(500).json({
      error: "Failed to transfer ownership",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}/banish:
 *   post:
 *     summary: Banish a user from the group (owner only)
 *     tags:
 *       - Groups
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
 *               - targetUserId
 *             properties:
 *               targetUserId:
 *                 type: string
 *     responses:
 *       200:
 *         description: User banished successfully
 *       400:
 *         description: Invalid action or not a member
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group or user not found
 *       500:
 *         description: Failed to banish user
 */
router.post("/:groupId/banish", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { targetUserId } = req.body;
    const userId = req.userId;

    if (!targetUserId) {
      return res.status(400).json({
        error: "Missing target user ID",
      });
    }

    const group = await Group.findById(groupId);
    const targetUser = await User.findById(targetUserId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    if (!targetUser) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    // Check if user is owner
    if (group.owner.toString() !== userId) {
      return res.status(403).json({
        error: "Access denied",
        message: "Only the group owner can banish members",
      });
    }

    // Cannot banish yourself
    if (targetUserId === userId) {
      return res.status(400).json({
        error: "Invalid action",
        message: "You cannot banish yourself",
      });
    }

    // Check if target is a member
    if (!group.isMember(targetUserId)) {
      return res.status(400).json({
        error: "Not a member",
        message: "User is not a member of this group",
      });
    }

    // Remove from members
    group.members = group.members.filter((m) => m.toString() !== targetUserId);

    // Add to banned list
    group.bannedUsers.push({
      userId: targetUserId,
      bannedBy: userId,
    });

    await group.save();

    // Update target user's records
    targetUser.groups = targetUser.groups.filter(
      (g) => g.toString() !== groupId
    );
    targetUser.bannedGroups.push({
      groupId,
      bannedAt: new Date(),
    });

    await targetUser.save();

    logger.info(
      `User ${targetUserId} banished from group ${groupId} by ${userId}`
    );

    res.json({
      message: "User banished successfully",
    });
  } catch (error) {
    logger.error("Banish user error:", error);
    res.status(500).json({
      error: "Failed to banish user",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}/requests:
 *   get:
 *     summary: Get join requests (owner only)
 *     tags:
 *       - Groups
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of join requests
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 *       500:
 *         description: Failed to fetch join requests
 */
router.get("/:groupId/requests", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.userId;

    const group = await Group.findById(groupId).populate(
      "joinRequests.userId",
      "username email"
    );

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is owner
    if (group.owner.toString() !== userId) {
      return res.status(403).json({
        error: "Access denied",
        message: "Only the group owner can view join requests",
      });
    }

    const pendingRequests = group.joinRequests.filter(
      (req) => req.status === "pending"
    );

    res.json({
      requests: pendingRequests.map((req) => ({
        id: req._id,
        user: req.userId,
        requestedAt: req.requestedAt,
        status: req.status,
      })),
    });
  } catch (error) {
    logger.error("Get join requests error:", error);
    res.status(500).json({
      error: "Failed to fetch join requests",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}/approve:
 *   post:
 *     summary: Approve join request (owner only)
 *     tags:
 *       - Groups
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
 *               - requestId
 *             properties:
 *               requestId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request approved successfully
 *       400:
 *         description: Request already processed or group full
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group or request not found
 *       500:
 *         description: Failed to approve request
 */
router.post("/:groupId/approve", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { requestId } = req.body;
    const userId = req.userId;

    if (!requestId) {
      return res.status(400).json({
        error: "Missing request ID",
      });
    }

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is owner
    if (group.owner.toString() !== userId) {
      return res.status(403).json({
        error: "Access denied",
        message: "Only the group owner can approve requests",
      });
    }

    // Find the request
    const request = group.joinRequests.id(requestId);

    if (!request) {
      return res.status(404).json({
        error: "Request not found",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: "Request already processed",
      });
    }

    // Check max members limit
    if (group.maxMembers && group.members.length >= group.maxMembers) {
      return res.status(400).json({
        error: "Group full",
        message: "Cannot approve: group has reached maximum members",
      });
    }

    // Approve request
    request.status = "approved";
    group.members.push(request.userId);
    await group.save();

    // Update user's groups
    await User.findByIdAndUpdate(request.userId, {
      $push: { groups: groupId },
    });

    logger.info(
      `Join request approved for user ${request.userId} in group ${groupId}`
    );

    res.json({
      message: "Request approved successfully",
    });
  } catch (error) {
    logger.error("Approve request error:", error);
    res.status(500).json({
      error: "Failed to approve request",
      message: error.message,
    });
  }
});

/**
 * @openapi
 * /groups/{groupId}/decline:
 *   post:
 *     summary: Decline join request (owner only)
 *     tags:
 *       - Groups
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
 *               - requestId
 *             properties:
 *               requestId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request declined successfully
 *       400:
 *         description: Request already processed
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group or request not found
 *       500:
 *         description: Failed to decline request
 */
router.post("/:groupId/decline", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { requestId } = req.body;
    const userId = req.userId;

    if (!requestId) {
      return res.status(400).json({
        error: "Missing request ID",
      });
    }

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        error: "Group not found",
      });
    }

    // Check if user is owner
    if (group.owner.toString() !== userId) {
      return res.status(403).json({
        error: "Access denied",
        message: "Only the group owner can decline requests",
      });
    }

    // Find the request
    const request = group.joinRequests.id(requestId);

    if (!request) {
      return res.status(404).json({
        error: "Request not found",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: "Request already processed",
      });
    }

    // Decline request
    request.status = "declined";
    await group.save();

    logger.info(
      `Join request declined for user ${request.userId} in group ${groupId}`
    );

    res.json({
      message: "Request declined successfully",
    });
  } catch (error) {
    logger.error("Decline request error:", error);
    res.status(500).json({
      error: "Failed to decline request",
      message: error.message,
    });
  }
});

module.exports = router;
